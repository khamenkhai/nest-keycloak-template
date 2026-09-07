#!/usr/bin/env node

'use strict';

require('dotenv/config');

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const SOURCE = 'POS_PRE_REGISTRATION_SERVICE';

function normalizeBarcode(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, '') : value;
}

function usage() {
  const executable = path.relative(process.cwd(), __filename) || __filename;
  return [
    'Usage:',
    `  node ${executable} [--dry-run] [--store <id>] [--log-file <path>]`,
    `  node ${executable} --apply [--store <id>] [--log-file <path>]`,
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
  return path.resolve('logs', `barcode-whitespace-${stamp}.json`);
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
  return `barcode-normalization-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function changedMasterRows(rows) {
  return rows
    .map((row) => ({
      id: Number(row.id),
      before: row.barcode,
      after: normalizeBarcode(row.barcode),
    }))
    .filter((row) => row.before !== row.after);
}

function changedSellingRows(rows) {
  return rows
    .map((row) => ({
      ...row,
      nextMasterBarcode: normalizeBarcode(row.master_barcode),
      nextOutletBarcode: normalizeBarcode(row.outlet_barcode),
    }))
    .filter(
      (row) =>
        row.master_barcode !== row.nextMasterBarcode ||
        row.outlet_barcode !== row.nextOutletBarcode,
    );
}

function changedOutletRows(rows) {
  return rows
    .map((row) => ({ ...row, nextBarcode: normalizeBarcode(row.barcode) }))
    .filter((row) => row.barcode !== row.nextBarcode);
}

function findMasterCollisions(rows) {
  return findBarcodeDuplicates(rows, 'barcode');
}

function findBarcodeDuplicates(rows, field) {
  const grouped = new Map();
  for (const row of rows) {
    const barcode = row[field];
    if (barcode === null || barcode === undefined) continue;
    const normalized = normalizeBarcode(barcode);
    const entries = grouped.get(normalized) ?? [];
    entries.push({ id: String(row.id), barcode });
    grouped.set(normalized, entries);
  }
  return [...grouped.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([normalizedBarcode, entries]) => ({ normalizedBarcode, entries }));
}

function buildPrimaryPlan(rows) {
  const collisions = findMasterCollisions(rows);
  const duplicateBarcodes = new Set(
    collisions.map((collision) => collision.normalizedBarcode),
  );
  const candidates = changedMasterRows(rows);
  return {
    collisions,
    changes: candidates.filter(
      (change) => !duplicateBarcodes.has(change.after),
    ),
    skippedDuplicateChanges: candidates
      .filter((change) => duplicateBarcodes.has(change.after))
      .map((change) => ({
        table: 'sku_masters',
        column: 'barcode',
        id: String(change.id),
        normalizedBarcode: change.after,
        before: change.before,
        after: change.after,
      })),
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
  const duplicateSets = new Map(
    duplicateGroups.map((group) => [
      `${group.table}.${group.column}`,
      new Set(
        duplicateGroups
          .filter(
            (candidate) =>
              candidate.table === group.table &&
              candidate.column === group.column,
          )
          .map((candidate) => candidate.normalizedBarcode),
      ),
    ]),
  );
  const masterDuplicateBarcodes =
    duplicateSets.get('selling_sku_records.master_barcode') ?? new Set();
  for (const barcode of blockedMasterBarcodes) {
    masterDuplicateBarcodes.add(barcode);
  }
  duplicateSets.set(
    'selling_sku_records.master_barcode',
    masterDuplicateBarcodes,
  );
  const skippedDuplicateChanges = [];
  const sellingChanges = changedSellingRows(sellingRows)
    .map((change) => {
      let nextMasterBarcode = change.nextMasterBarcode;
      let nextOutletBarcode = change.nextOutletBarcode;
      if (
        change.master_barcode !== nextMasterBarcode &&
        duplicateSets
          .get('selling_sku_records.master_barcode')
          ?.has(nextMasterBarcode)
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
        duplicateSets
          .get('selling_sku_records.outlet_barcode')
          ?.has(nextOutletBarcode)
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
  const outletChanges = changedOutletRows(outletRows).filter((change) => {
    if (
      !duplicateSets.get('sku_outlet_records.barcode')?.has(change.nextBarcode)
    ) {
      return true;
    }
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

async function loadPrimaryPlan(pool) {
  await pool.query('SELECT id, barcode FROM public.sku_masters LIMIT 0');
  const rows = (
    await pool.query(
      'SELECT id, barcode FROM public.sku_masters WHERE barcode IS NOT NULL ORDER BY id',
    )
  ).rows;
  return buildPrimaryPlan(rows);
}

async function loadStorePlan(pool, store, blockedMasterBarcodes) {
  await pool.query(
    `SELECT id, organization_id, store_id, master_barcode, outlet_barcode
     FROM public.selling_sku_records LIMIT 0`,
  );
  await pool.query(
    `SELECT id, organization_id, store_id, barcode
     FROM public.sku_outlet_records LIMIT 0`,
  );
  await pool.query(
    `SELECT target_org_id, target_store_id, entity_type, entity_id,
            operation, payload_version, payload_json, source, source_event_id
     FROM public.server_change_logs LIMIT 0`,
  );

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

async function applyPrimaryPlan(pool, plan, report) {
  const client = await pool.connect();
  const committedChanges = [];
  try {
    await client.query('BEGIN');
    for (const change of plan.changes) {
      const result = await client.query(
        `UPDATE public.sku_masters
         SET barcode = $1, updated_at = NOW()
         WHERE id = $2 AND barcode IS NOT DISTINCT FROM $3
         RETURNING id, barcode`,
        [change.after, change.id, change.before],
      );
      if (result.rowCount !== 1) {
        throw new Error(
          `Master SKU ${change.id} changed after preflight; transaction aborted.`,
        );
      }
      committedChanges.push({
        database: 'primary',
        table: 'sku_masters',
        id: change.id,
        fields: { barcode: { before: change.before, after: change.after } },
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
      const updated = result.rows[0];
      await insertServerChangeLog(
        client,
        plan.store,
        'SellingSkuRecord',
        updated,
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
      const updated = result.rows[0];
      await insertServerChangeLog(
        client,
        plan.store,
        'SkuOutletRecord',
        updated,
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

function auditDryRun(primaryPlan, storePlans, report) {
  for (const change of primaryPlan.changes) {
    const fields = { barcode: { before: change.before, after: change.after } };
    printChange('[dry-run] primary.sku_masters', change.id, fields);
    report.changes.push({
      database: 'primary',
      table: 'sku_masters',
      id: change.id,
      fields,
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
    collisions: [],
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

    const primaryPlan = await loadPrimaryPlan(primary);
    report.collisions = primaryPlan.collisions;
    const blockedMasterBarcodes = primaryPlan.collisions.map(
      (collision) => collision.normalizedBarcode,
    );
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
          await loadStorePlan(storePool, store, blockedMasterBarcodes),
        );
      } finally {
        await storePool.end();
      }
    }
    report.duplicates = [
      ...primaryPlan.collisions.map((duplicate) => ({
        database: 'primary',
        table: 'sku_masters',
        column: 'barcode',
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
      ...primaryPlan.skippedDuplicateChanges.map((change) => ({
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
      `${options.mode === 'dry-run' ? 'DRY RUN' : 'APPLY'}: master=${primaryPlan.changes.length}, ` +
        `selling=${storePlans.reduce((sum, plan) => sum + plan.sellingChanges.length, 0)}, ` +
        `outlet=${storePlans.reduce((sum, plan) => sum + plan.outletChanges.length, 0)}`,
    );

    console.log(`Normalized duplicate groups: ${report.duplicates.length}`);
    for (const duplicate of report.duplicates) {
      console.log(
        `DUPLICATE ${duplicate.database}.${duplicate.table}.${duplicate.column} ` +
          `normalized=${JSON.stringify(duplicate.normalizedBarcode)} ` +
          `rows=${JSON.stringify(duplicate.entries)}`,
      );
    }
    console.log(
      `Duplicate changes skipped: ${report.skippedDuplicateChanges.length}`,
    );
    for (const skipped of report.skippedDuplicateChanges) {
      console.log(
        `SKIP ${skipped.database}.${skipped.table}.${skipped.column} ` +
          `id=${skipped.id} normalized=${JSON.stringify(skipped.normalizedBarcode)} ` +
          `${JSON.stringify(skipped.before)} -> ${JSON.stringify(skipped.after)}`,
      );
    }

    if (options.mode === 'dry-run') {
      auditDryRun(primaryPlan, storePlans, report);
    } else {
      await applyPrimaryPlan(primary, primaryPlan, report);
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
  buildPrimaryPlan,
  buildStoreUrl,
  buildStoreBarcodePlan,
  changedMasterRows,
  changedOutletRows,
  changedSellingRows,
  findBarcodeDuplicates,
  findMasterCollisions,
  normalizeBarcode,
  parseArgs,
  toCamelPayload,
};

if (require.main === module) main();
