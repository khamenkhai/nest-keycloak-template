#!/usr/bin/env node

'use strict';

require('dotenv/config');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const SOURCE = 'POS_PRE_REGISTRATION_SERVICE';

/**
 * AIM symbology identifier: `]` + one letter + one digit, emitted by scanners
 * running in GS1/FNC1 mode ("Transmit AIM ID"). `]C1`, `]E0`, `]d2`, `]Q3`.
 * Anchored, so a `]` anywhere else in a barcode is left alone.
 */
const AIM_PREFIX = /^\][A-Za-z][0-9]/;

function stripAimPrefix(value) {
  return typeof value === 'string' ? value.replace(AIM_PREFIX, '') : value;
}

function usage() {
  const executable = path.relative(process.cwd(), __filename) || __filename;
  return [
    'Usage:',
    `  node ${executable} [--dry-run] [--store <id>] [--log-file <path>]`,
    `  node ${executable} --apply [--store <id>] [--log-file <path>]`,
    '',
    'Strips AIM scanner prefixes (]C1, ]E0, ...) from every barcode column in',
    'the master database and in each store database. Store writes are paired',
    'with a server_change_logs row so POS devices receive the correction.',
    '',
    'The default mode is dry-run. Repeat --store to target multiple stores.',
  ].join('\n');
}

function parseArgs(args) {
  let explicitMode = null;
  const options = {
    mode: 'dry-run',
    storeIds: [],
    logFile: null,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run' || arg === '--apply') {
      const mode = arg.slice(2);
      if (explicitMode && explicitMode !== mode) {
        throw new Error('Choose only one mode: --dry-run or --apply.');
      }
      explicitMode = mode;
      options.mode = mode;
    } else if (arg === '--store' || arg.startsWith('--store=')) {
      const raw = arg === '--store' ? args[++index] : arg.slice(8);
      const storeId = Number(raw);
      if (!Number.isInteger(storeId) || storeId <= 0) {
        throw new Error('--store requires a positive integer.');
      }
      options.storeIds.push(storeId);
    } else if (arg === '--log-file') {
      const value = args[++index];
      if (!value || value.startsWith('--')) {
        throw new Error('--log-file requires a path.');
      }
      options.logFile = path.resolve(value);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.storeIds = [...new Set(options.storeIds)];
  return options;
}

function defaultLogFile() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve('logs', `barcode-aim-prefix-${stamp}.json`);
}

function requireEnv(names) {
  const missing = names.filter(
    (name) => !String(process.env[name] ?? '').trim(),
  );
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
}

function buildStoreUrl(baseUrl, prefix, storeId) {
  const url = new URL(baseUrl);
  url.pathname = `/${prefix}_${storeId}`;
  return url.toString();
}

function toCamelPayload(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()),
      value,
    ]),
  );
}

function sourceEventId() {
  return `aim-prefix-cleanup-${crypto.randomUUID()}`;
}

/**
 * Rows whose value changes once the prefix is stripped. `before`/`after` are
 * carried through so the apply phase can assert the row did not move between
 * preflight and write.
 */
function changedRows(rows, field) {
  return rows
    .map((row) => ({
      id: row.id,
      before: row[field],
      after: stripAimPrefix(row[field]),
    }))
    .filter((row) => row.before !== row.after);
}

/**
 * Groups rows by their stripped value and returns the groups holding more than
 * one row — a stripped barcode landing on a value some other row already has.
 *
 * Null values are skipped, which is the whole point: comparing them as equal
 * (`IS NOT DISTINCT FROM`) makes every affected row block every other one.
 */
function findBarcodeDuplicates(rows, field) {
  const grouped = new Map();
  for (const row of rows) {
    const barcode = row[field];
    if (barcode === null || barcode === undefined) continue;
    const stripped = stripAimPrefix(barcode);
    const entries = grouped.get(stripped) ?? [];
    entries.push({ id: String(row.id), barcode });
    grouped.set(stripped, entries);
  }
  return [...grouped.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([normalizedBarcode, entries]) => ({ normalizedBarcode, entries }));
}

/** A column carrying a UNIQUE constraint: a collision has to be skipped. */
function buildUniqueColumnPlan(rows, table, column) {
  const duplicates = findBarcodeDuplicates(rows, column).map((duplicate) => ({
    table,
    column,
    ...duplicate,
  }));
  const blocked = new Set(
    duplicates.map((duplicate) => duplicate.normalizedBarcode),
  );
  const candidates = changedRows(rows, column);

  return {
    duplicates,
    changes: candidates.filter((change) => !blocked.has(change.after)),
    skippedDuplicateChanges: candidates
      .filter((change) => blocked.has(change.after))
      .map((change) => ({
        table,
        column,
        id: String(change.id),
        normalizedBarcode: change.after,
        before: change.before,
        after: change.after,
      })),
  };
}

/**
 * A column with no unique constraint. Duplicates are reported for visibility
 * but never block: these tables are keyed through the alias table, and leaving
 * a prefixed barcode behind is worse than two rows sharing a value.
 */
function buildOpenColumnPlan(rows, table, column) {
  return {
    duplicates: findBarcodeDuplicates(rows, column).map((duplicate) => ({
      table,
      column,
      ...duplicate,
    })),
    changes: changedRows(rows, column),
    skippedDuplicateChanges: [],
  };
}

/**
 * The alias table keeps the barcode twice: `barcode` as captured and
 * `normalized_barcode` as the globally unique lookup key. Both are stripped,
 * and uniqueness is judged on the normalized column.
 */
function buildAliasPlan(rows) {
  const table = 'non_cannopy_sku_barcode_aliases';
  const duplicates = findBarcodeDuplicates(rows, 'normalized_barcode').map(
    (duplicate) => ({ table, column: 'normalized_barcode', ...duplicate }),
  );
  const blocked = new Set(
    duplicates.map((duplicate) => duplicate.normalizedBarcode),
  );

  const candidates = rows
    .map((row) => ({
      id: row.id,
      before: row.barcode,
      after: stripAimPrefix(row.barcode),
      beforeNormalized: row.normalized_barcode,
      afterNormalized: stripAimPrefix(row.normalized_barcode),
    }))
    .filter(
      (change) =>
        change.before !== change.after ||
        change.beforeNormalized !== change.afterNormalized,
    );

  return {
    duplicates,
    changes: candidates.filter(
      (change) => !blocked.has(change.afterNormalized),
    ),
    skippedDuplicateChanges: candidates
      .filter((change) => blocked.has(change.afterNormalized))
      .map((change) => ({
        table,
        column: 'normalized_barcode',
        id: String(change.id),
        normalizedBarcode: change.afterNormalized,
        before: change.beforeNormalized,
        after: change.afterNormalized,
      })),
  };
}

/**
 * Master database plan. `sku_masters.barcode` and the alias table's
 * `normalized_barcode` are unique; the other two columns are not.
 *
 * `blockedMasterBarcodes` carries the values `sku_masters` could not take
 * forward into the store plans, so a store row is never cleaned to a
 * `master_barcode` its master SKU still spells the old way.
 */
function buildMasterPlan({
  skuMasters = [],
  nonCannopySkus = [],
  aliases = [],
  occurrences = [],
}) {
  const skuMasterPlan = buildUniqueColumnPlan(
    skuMasters,
    'sku_masters',
    'barcode',
  );
  const nonCannopyPlan = buildOpenColumnPlan(
    nonCannopySkus,
    'non_cannopy_skus',
    'barcode',
  );
  const aliasPlan = buildAliasPlan(aliases);
  const occurrencePlan = buildOpenColumnPlan(
    occurrences,
    'non_cannopy_sku_occurrences',
    'outlet_barcode',
  );

  return {
    skuMasterChanges: skuMasterPlan.changes,
    nonCannopySkuChanges: nonCannopyPlan.changes,
    aliasChanges: aliasPlan.changes,
    occurrenceChanges: occurrencePlan.changes,
    blockedMasterBarcodes: skuMasterPlan.duplicates.map(
      (duplicate) => duplicate.normalizedBarcode,
    ),
    duplicates: [
      ...skuMasterPlan.duplicates,
      ...nonCannopyPlan.duplicates,
      ...aliasPlan.duplicates,
      ...occurrencePlan.duplicates,
    ],
    skippedDuplicateChanges: [
      ...skuMasterPlan.skippedDuplicateChanges,
      ...aliasPlan.skippedDuplicateChanges,
    ],
  };
}

function buildStoreBarcodePlan(
  sellingRows,
  outletRows,
  blockedMasterBarcodes = [],
) {
  const duplicateGroups = [
    ...findBarcodeDuplicates(sellingRows, 'master_barcode').map(
      (duplicate) => ({
        table: 'selling_sku_records',
        column: 'master_barcode',
        ...duplicate,
      }),
    ),
    ...findBarcodeDuplicates(sellingRows, 'outlet_barcode').map(
      (duplicate) => ({
        table: 'selling_sku_records',
        column: 'outlet_barcode',
        ...duplicate,
      }),
    ),
    ...findBarcodeDuplicates(outletRows, 'barcode').map((duplicate) => ({
      table: 'sku_outlet_records',
      column: 'barcode',
      ...duplicate,
    })),
  ];

  const blockedFor = (table, column) =>
    new Set(
      duplicateGroups
        .filter((group) => group.table === table && group.column === column)
        .map((group) => group.normalizedBarcode),
    );

  const blockedMaster = blockedFor('selling_sku_records', 'master_barcode');
  for (const barcode of blockedMasterBarcodes) blockedMaster.add(barcode);
  const blockedOutlet = blockedFor('selling_sku_records', 'outlet_barcode');
  const blockedSkuOutlet = blockedFor('sku_outlet_records', 'barcode');

  const skippedDuplicateChanges = [];

  const sellingChanges = sellingRows
    .map((row) => ({
      ...row,
      nextMasterBarcode: stripAimPrefix(row.master_barcode),
      nextOutletBarcode: stripAimPrefix(row.outlet_barcode),
    }))
    .filter(
      (change) =>
        change.master_barcode !== change.nextMasterBarcode ||
        change.outlet_barcode !== change.nextOutletBarcode,
    )
    .map((change) => {
      let nextMasterBarcode = change.nextMasterBarcode;
      let nextOutletBarcode = change.nextOutletBarcode;

      if (
        change.master_barcode !== nextMasterBarcode &&
        blockedMaster.has(nextMasterBarcode)
      ) {
        skippedDuplicateChanges.push({
          table: 'selling_sku_records',
          column: 'master_barcode',
          id: String(change.id),
          normalizedBarcode: nextMasterBarcode,
          before: change.master_barcode,
          after: nextMasterBarcode,
        });
        nextMasterBarcode = change.master_barcode;
      }

      if (
        change.outlet_barcode !== nextOutletBarcode &&
        blockedOutlet.has(nextOutletBarcode)
      ) {
        skippedDuplicateChanges.push({
          table: 'selling_sku_records',
          column: 'outlet_barcode',
          id: String(change.id),
          normalizedBarcode: nextOutletBarcode,
          before: change.outlet_barcode,
          after: nextOutletBarcode,
        });
        nextOutletBarcode = change.outlet_barcode;
      }

      return { ...change, nextMasterBarcode, nextOutletBarcode };
    })
    .filter(
      (change) =>
        change.master_barcode !== change.nextMasterBarcode ||
        change.outlet_barcode !== change.nextOutletBarcode,
    );

  const outletChanges = outletRows
    .map((row) => ({ ...row, nextBarcode: stripAimPrefix(row.barcode) }))
    .filter((change) => change.barcode !== change.nextBarcode)
    .filter((change) => {
      if (!blockedSkuOutlet.has(change.nextBarcode)) return true;
      skippedDuplicateChanges.push({
        table: 'sku_outlet_records',
        column: 'barcode',
        id: String(change.id),
        normalizedBarcode: change.nextBarcode,
        before: change.barcode,
        after: change.nextBarcode,
      });
      return false;
    });

  return {
    duplicates: duplicateGroups,
    sellingChanges,
    outletChanges,
    skippedDuplicateChanges,
  };
}

function printChange(prefix, id, changes) {
  const fields = Object.entries(changes)
    .map(
      ([field, values]) =>
        `${field}: ${JSON.stringify(values.before)} -> ${JSON.stringify(values.after)}`,
    )
    .join(', ');
  console.log(`${prefix} id=${id} ${fields}`);
}

async function loadMasterPlan(pool) {
  const [skuMasters, nonCannopySkus, aliases, occurrences] = await Promise.all([
    pool.query(
      `SELECT id, barcode FROM public.sku_masters
       WHERE barcode IS NOT NULL ORDER BY id`,
    ),
    pool.query(
      `SELECT id, barcode FROM public.non_cannopy_skus
       WHERE barcode IS NOT NULL ORDER BY id`,
    ),
    pool.query(
      `SELECT id, barcode, normalized_barcode
       FROM public.non_cannopy_sku_barcode_aliases ORDER BY id`,
    ),
    pool.query(
      `SELECT id, outlet_barcode FROM public.non_cannopy_sku_occurrences
       WHERE outlet_barcode IS NOT NULL ORDER BY id`,
    ),
  ]);

  return buildMasterPlan({
    skuMasters: skuMasters.rows,
    nonCannopySkus: nonCannopySkus.rows,
    aliases: aliases.rows,
    occurrences: occurrences.rows,
  });
}

async function loadStorePlan(pool, store, blockedMasterBarcodes) {
  const [sellingResult, outletResult] = await Promise.all([
    pool.query(
      `SELECT id, organization_id, store_id, master_barcode, outlet_barcode
       FROM public.selling_sku_records
       WHERE master_barcode IS NOT NULL OR outlet_barcode IS NOT NULL
       ORDER BY id`,
    ),
    pool.query(
      `SELECT id, organization_id, store_id, barcode
       FROM public.sku_outlet_records
       WHERE barcode IS NOT NULL
       ORDER BY id`,
    ),
  ]);

  return {
    store,
    ...buildStoreBarcodePlan(
      sellingResult.rows,
      outletResult.rows,
      blockedMasterBarcodes,
    ),
  };
}

async function insertServerChangeLog(client, store, entityType, row) {
  await client.query(
    `INSERT INTO public.server_change_logs (
       target_org_id, target_store_id, entity_type, entity_id,
       operation, payload_version, payload_json, source, source_event_id
     ) VALUES ($1, $2, $3, $4, 'UPSERT', 1, $5::jsonb, $6, $7)`,
    [
      Number(row.organization_id ?? store.organization_id),
      Number(store.id),
      entityType,
      String(row.id),
      JSON.stringify(toCamelPayload(row)),
      SOURCE,
      sourceEventId(),
    ],
  );
}

/**
 * One transaction over every master table. Each UPDATE re-asserts the value it
 * saw during preflight, so a row edited in between aborts the whole run rather
 * than being silently overwritten.
 */
async function applyMasterPlan(pool, plan, report) {
  const client = await pool.connect();
  const committedChanges = [];

  const updateOne = async (table, column, change) => {
    const result = await client.query(
      `UPDATE public.${table}
       SET ${column} = $1, updated_at = NOW()
       WHERE id = $2 AND ${column} IS NOT DISTINCT FROM $3
       RETURNING id`,
      [change.after, change.id, change.before],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        `${table} ${change.id} changed after preflight; transaction aborted.`,
      );
    }
    committedChanges.push({
      database: 'primary',
      table,
      id: String(change.id),
      fields: { [column]: { before: change.before, after: change.after } },
    });
  };

  try {
    await client.query('BEGIN');

    for (const change of plan.skuMasterChanges) {
      await updateOne('sku_masters', 'barcode', change);
    }
    for (const change of plan.nonCannopySkuChanges) {
      await updateOne('non_cannopy_skus', 'barcode', change);
    }
    for (const change of plan.occurrenceChanges) {
      await updateOne('non_cannopy_sku_occurrences', 'outlet_barcode', change);
    }

    // The alias table has no updated_at column and writes both barcode copies.
    for (const change of plan.aliasChanges) {
      const result = await client.query(
        `UPDATE public.non_cannopy_sku_barcode_aliases
         SET barcode = $1, normalized_barcode = $2
         WHERE id = $3
           AND barcode IS NOT DISTINCT FROM $4
           AND normalized_barcode IS NOT DISTINCT FROM $5
         RETURNING id`,
        [
          change.after,
          change.afterNormalized,
          change.id,
          change.before,
          change.beforeNormalized,
        ],
      );
      if (result.rowCount !== 1) {
        throw new Error(
          `non_cannopy_sku_barcode_aliases ${change.id} changed after preflight; transaction aborted.`,
        );
      }
      committedChanges.push({
        database: 'primary',
        table: 'non_cannopy_sku_barcode_aliases',
        id: String(change.id),
        fields: {
          barcode: { before: change.before, after: change.after },
          normalizedBarcode: {
            before: change.beforeNormalized,
            after: change.afterNormalized,
          },
        },
      });
    }

    await client.query('COMMIT');
    report.changes.push(...committedChanges);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function applyStorePlan(pool, plan, report) {
  const client = await pool.connect();
  const committedChanges = [];
  try {
    await client.query('BEGIN');

    for (const change of plan.sellingChanges) {
      const result = await client.query(
        `UPDATE public.selling_sku_records
         SET master_barcode = $1, outlet_barcode = $2, updated_at = NOW()
         WHERE id = $3
           AND master_barcode IS NOT DISTINCT FROM $4
           AND outlet_barcode IS NOT DISTINCT FROM $5
         RETURNING *`,
        [
          change.nextMasterBarcode,
          change.nextOutletBarcode,
          change.id,
          change.master_barcode,
          change.outlet_barcode,
        ],
      );
      if (result.rowCount !== 1) {
        throw new Error(
          `Store ${plan.store.id} selling SKU ${change.id} changed after preflight; transaction aborted.`,
        );
      }
      await insertServerChangeLog(
        client,
        plan.store,
        'SellingSkuRecord',
        result.rows[0],
      );
      committedChanges.push({
        database: `store_${plan.store.id}`,
        table: 'selling_sku_records',
        id: String(change.id),
        fields: {
          ...(change.master_barcode !== change.nextMasterBarcode && {
            masterBarcode: {
              before: change.master_barcode,
              after: change.nextMasterBarcode,
            },
          }),
          ...(change.outlet_barcode !== change.nextOutletBarcode && {
            outletBarcode: {
              before: change.outlet_barcode,
              after: change.nextOutletBarcode,
            },
          }),
        },
      });
    }

    for (const change of plan.outletChanges) {
      const result = await client.query(
        `UPDATE public.sku_outlet_records
         SET barcode = $1, updated_at = NOW()
         WHERE id = $2 AND barcode IS NOT DISTINCT FROM $3
         RETURNING *`,
        [change.nextBarcode, change.id, change.barcode],
      );
      if (result.rowCount !== 1) {
        throw new Error(
          `Store ${plan.store.id} outlet SKU ${change.id} changed after preflight; transaction aborted.`,
        );
      }
      await insertServerChangeLog(
        client,
        plan.store,
        'SkuOutletRecord',
        result.rows[0],
      );
      committedChanges.push({
        database: `store_${plan.store.id}`,
        table: 'sku_outlet_records',
        id: String(change.id),
        fields: {
          barcode: { before: change.barcode, after: change.nextBarcode },
        },
      });
    }

    await client.query('COMMIT');
    report.changes.push(...committedChanges);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function auditDryRun(masterPlan, storePlans, report) {
  const record = (table, id, fields) => {
    printChange(`[dry-run] primary.${table}`, id, fields);
    report.changes.push({ database: 'primary', table, id: String(id), fields });
  };

  for (const change of masterPlan.skuMasterChanges) {
    record('sku_masters', change.id, {
      barcode: { before: change.before, after: change.after },
    });
  }
  for (const change of masterPlan.nonCannopySkuChanges) {
    record('non_cannopy_skus', change.id, {
      barcode: { before: change.before, after: change.after },
    });
  }
  for (const change of masterPlan.aliasChanges) {
    record('non_cannopy_sku_barcode_aliases', change.id, {
      barcode: { before: change.before, after: change.after },
      normalizedBarcode: {
        before: change.beforeNormalized,
        after: change.afterNormalized,
      },
    });
  }
  for (const change of masterPlan.occurrenceChanges) {
    record('non_cannopy_sku_occurrences', change.id, {
      outletBarcode: { before: change.before, after: change.after },
    });
  }

  for (const plan of storePlans) {
    for (const change of plan.sellingChanges) {
      const fields = {
        ...(change.master_barcode !== change.nextMasterBarcode && {
          masterBarcode: {
            before: change.master_barcode,
            after: change.nextMasterBarcode,
          },
        }),
        ...(change.outlet_barcode !== change.nextOutletBarcode && {
          outletBarcode: {
            before: change.outlet_barcode,
            after: change.nextOutletBarcode,
          },
        }),
      };
      printChange(
        `[dry-run] store_${plan.store.id}.selling_sku_records`,
        change.id,
        fields,
      );
      report.changes.push({
        database: `store_${plan.store.id}`,
        table: 'selling_sku_records',
        id: String(change.id),
        fields,
      });
    }
    for (const change of plan.outletChanges) {
      const fields = {
        barcode: { before: change.barcode, after: change.nextBarcode },
      };
      printChange(
        `[dry-run] store_${plan.store.id}.sku_outlet_records`,
        change.id,
        fields,
      );
      report.changes.push({
        database: `store_${plan.store.id}`,
        table: 'sku_outlet_records',
        id: String(change.id),
        fields,
      });
    }
  }
}

function writeReport(filePath, report) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

async function run(options) {
  requireEnv(['DATABASE_URL', 'STORE_DATABASE_URL']);
  const logFile = options.logFile ?? defaultLogFile();
  const report = {
    version: 1,
    mode: options.mode,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    requestedStoreIds: options.storeIds,
    duplicates: [],
    skippedDuplicateChanges: [],
    changes: [],
    errors: [],
  };
  const primary = new Pool({ connectionString: process.env.DATABASE_URL });
  const prefix = process.env.STORE_DB_PREFIX || 'pos_store';

  try {
    const stores = (
      await primary.query(
        `SELECT id, organization_id, name FROM public.stores
         WHERE ($1::int[] IS NULL OR id = ANY($1::int[]))
         ORDER BY id`,
        [options.storeIds.length ? options.storeIds : null],
      )
    ).rows;
    if (options.storeIds.length && stores.length !== options.storeIds.length) {
      const found = new Set(stores.map((store) => Number(store.id)));
      const missing = options.storeIds.filter((id) => !found.has(id));
      throw new Error(`Stores not found: ${missing.join(', ')}`);
    }

    const masterPlan = await loadMasterPlan(primary);

    const storePlans = [];
    for (const store of stores) {
      const storePool = new Pool({
        connectionString: buildStoreUrl(
          process.env.STORE_DATABASE_URL,
          prefix,
          Number(store.id),
        ),
      });
      try {
        storePlans.push(
          await loadStorePlan(
            storePool,
            store,
            masterPlan.blockedMasterBarcodes,
          ),
        );
      } finally {
        await storePool.end();
      }
    }

    report.duplicates = [
      ...masterPlan.duplicates.map((duplicate) => ({
        database: 'primary',
        ...duplicate,
      })),
      ...storePlans.flatMap((plan) =>
        plan.duplicates.map((duplicate) => ({
          database: `store_${plan.store.id}`,
          storeId: Number(plan.store.id),
          storeName: plan.store.name,
          ...duplicate,
        })),
      ),
    ];
    report.skippedDuplicateChanges = [
      ...masterPlan.skippedDuplicateChanges.map((change) => ({
        database: 'primary',
        ...change,
      })),
      ...storePlans.flatMap((plan) =>
        plan.skippedDuplicateChanges.map((change) => ({
          database: `store_${plan.store.id}`,
          storeId: Number(plan.store.id),
          storeName: plan.store.name,
          ...change,
        })),
      ),
    ];

    console.log(
      `${options.mode === 'dry-run' ? 'DRY RUN' : 'APPLY'}: ` +
        `master=${masterPlan.skuMasterChanges.length}, ` +
        `nonCannopy=${masterPlan.nonCannopySkuChanges.length}, ` +
        `alias=${masterPlan.aliasChanges.length}, ` +
        `occurrence=${masterPlan.occurrenceChanges.length}, ` +
        `selling=${storePlans.reduce((sum, plan) => sum + plan.sellingChanges.length, 0)}, ` +
        `outlet=${storePlans.reduce((sum, plan) => sum + plan.outletChanges.length, 0)}`,
    );

    console.log(`Stripped duplicate groups: ${report.duplicates.length}`);
    for (const duplicate of report.duplicates) {
      console.log(
        `DUPLICATE ${duplicate.database}.${duplicate.table}.${duplicate.column} ` +
          `stripped=${JSON.stringify(duplicate.normalizedBarcode)} ` +
          `rows=${JSON.stringify(duplicate.entries)}`,
      );
    }
    console.log(
      `Duplicate changes skipped: ${report.skippedDuplicateChanges.length}`,
    );
    for (const skipped of report.skippedDuplicateChanges) {
      console.log(
        `SKIP ${skipped.database}.${skipped.table}.${skipped.column} ` +
          `id=${skipped.id} stripped=${JSON.stringify(skipped.normalizedBarcode)} ` +
          `${JSON.stringify(skipped.before)} -> ${JSON.stringify(skipped.after)}`,
      );
    }

    if (options.mode === 'dry-run') {
      auditDryRun(masterPlan, storePlans, report);
    } else {
      await applyMasterPlan(primary, masterPlan, report);
      for (const plan of storePlans) {
        const storePool = new Pool({
          connectionString: buildStoreUrl(
            process.env.STORE_DATABASE_URL,
            prefix,
            Number(plan.store.id),
          ),
        });
        try {
          await applyStorePlan(storePool, plan, report);
        } finally {
          await storePool.end();
        }
      }
    }

    report.status = 'completed';
    console.log(`Completed. Changes recorded: ${report.changes.length}`);
  } catch (error) {
    report.status = 'failed';
    report.errors.push(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await primary.end();
    writeReport(logFile, report);
    console.log(`Audit report: ${logFile}`);
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage());
    else await run(options);
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildAliasPlan,
  buildMasterPlan,
  buildOpenColumnPlan,
  buildStoreBarcodePlan,
  buildStoreUrl,
  buildUniqueColumnPlan,
  changedRows,
  findBarcodeDuplicates,
  parseArgs,
  stripAimPrefix,
  toCamelPayload,
};

if (require.main === module) main();
