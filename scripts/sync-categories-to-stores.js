#!/usr/bin/env node

'use strict';

require('dotenv/config');

const crypto = require('node:crypto');
const path = require('node:path');
const readline = require('node:readline');
const { Pool } = require('pg');

const STORE_IDS = Object.freeze([2, 15, 18]);
const SOURCE = 'POS_PRE_REGISTRATION_SERVICE';

function usage() {
  const executable = path.relative(process.cwd(), __filename) || __filename;
  return [
    'Usage:',
    `  node ${executable} [--dry-run]`,
    `  node ${executable} --apply [--force]`,
  ].join('\n');
}

function parseArgs(args) {
  let explicitMode = null;
  const result = { mode: 'dry-run', force: false, help: false };
  for (const arg of args) {
    if (arg === '--dry-run' || arg === '--apply') {
      const mode = arg.slice(2);
      if (explicitMode && explicitMode !== mode) {
        throw new Error('Choose only one mode.');
      }
      explicitMode = mode;
      result.mode = mode;
    } else if (arg === '--force') {
      result.force = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (result.force && result.mode !== 'apply') {
    throw new Error('--force can only be used with --apply.');
  }
  return result;
}

function requireEnv(names) {
  const missing = names.filter(
    (name) => !String(process.env[name] ?? '').trim(),
  );
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
}

function buildStoreUrl(baseUrl, prefix, storeId) {
  const url = new URL(baseUrl);
  url.pathname = `/${prefix}_${storeId}`;
  return url.toString();
}

function sourceEventId() {
  const now = new Date();
  return `${now.getDate()}-${now.getMonth() + 1}-${now.getFullYear()}-${crypto
    .randomBytes(5)
    .toString('hex')}`;
}

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('en-US');
}

function displayName(category) {
  return (
    category.name?.trim() ||
    category.myanmar_name?.trim() ||
    `Category-${category.id}`
  );
}

function toPayload(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()),
      value,
    ]),
  );
}

function sortAndValidateCategories(categories) {
  const byId = new Map(
    categories.map((category) => [Number(category.id), category]),
  );
  if (byId.size !== categories.length) {
    throw new Error('Master categories contain duplicate IDs.');
  }
  const depths = new Map();
  const visiting = new Set();
  function getDepth(category) {
    const id = Number(category.id);
    if (depths.has(id)) return depths.get(id);
    if (visiting.has(id)) {
      throw new Error(
        `Master category hierarchy contains a cycle at category ${id}.`,
      );
    }
    visiting.add(id);
    let depth = 0;
    if (category.parent_id !== null && category.parent_id !== undefined) {
      const parentId = Number(category.parent_id);
      const parent = byId.get(parentId);
      if (!parent) {
        throw new Error(
          `Master category ${id} references missing parent ${parentId}.`,
        );
      }
      depth = getDepth(parent) + 1;
    }
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  }
  for (const category of categories) getDepth(category);
  return [...categories].sort(
    (left, right) =>
      depths.get(Number(left.id)) - depths.get(Number(right.id)) ||
      Number(left.id) - Number(right.id),
  );
}

function desiredValues(category, store, localIdsByMasterId) {
  const parentId =
    category.parent_id === null || category.parent_id === undefined
      ? null
      : localIdsByMasterId.get(String(category.parent_id));
  if (parentId === undefined) {
    throw new Error(
      `No store parent mapping for master category ${category.parent_id}.`,
    );
  }
  return {
    organization_id: Number(store.organization_id),
    store_id: Number(store.id),
    name: displayName(category),
    myanmar_name: category.myanmar_name ?? null,
    myanmar_alias: category.myanmar_alias ?? null,
    description: category.description ?? null,
    level: category.level ?? null,
    parent_id: parentId,
    master_category_id: String(category.id),
    status: String(category.status),
  };
}

function hasChanges(row, desired) {
  return Object.entries(desired).some(([key, value]) => {
    const current = row[key] ?? null;
    const target = value ?? null;
    if (['organization_id', 'store_id', 'level'].includes(key)) {
      return current === null || target === null
        ? current !== target
        : Number(current) !== Number(target);
    }
    return current !== target;
  });
}

function buildStorePlan(categories, localRows, store) {
  const byMasterId = new Map();
  const byName = new Map();
  for (const row of localRows) {
    if (
      row.master_category_id !== null &&
      row.master_category_id !== undefined
    ) {
      const key = String(row.master_category_id);
      byMasterId.set(key, [...(byMasterId.get(key) ?? []), row]);
    }
    const nameKey = normalizeName(row.name);
    if (nameKey) byName.set(nameKey, [...(byName.get(nameKey) ?? []), row]);
  }

  const claimedLocalIds = new Set();
  const assignments = [];
  for (const category of categories) {
    const masterId = String(category.id);
    const exact = byMasterId.get(masterId) ?? [];
    if (exact.length > 1) {
      throw new Error(
        `Store ${store.id} has ${exact.length} rows linked to master category ${masterId}.`,
      );
    }
    let kind;
    let row = null;
    if (exact.length === 1) {
      kind = 'exact';
      row = exact[0];
    } else {
      const nameMatches =
        byName.get(normalizeName(displayName(category))) ?? [];
      const adoptable = nameMatches.filter(
        (candidate) => candidate.master_category_id == null,
      );
      const linkedElsewhere = nameMatches.filter(
        (candidate) => candidate.master_category_id != null,
      );
      if (adoptable.length > 1) {
        throw new Error(
          `Store ${store.id} has multiple unlinked rows named "${displayName(category)}".`,
        );
      }
      if (adoptable.length === 1) {
        kind = 'adopt';
        row = adoptable[0];
      } else if (linkedElsewhere.length) {
        throw new Error(
          `Store ${store.id} name "${displayName(category)}" is linked to another master category.`,
        );
      } else {
        kind = 'create';
      }
    }
    if (row && claimedLocalIds.has(String(row.id))) {
      throw new Error(
        `Store ${store.id} local category ${row.id} matches more than one master category.`,
      );
    }
    if (row) claimedLocalIds.add(String(row.id));
    assignments.push({ category, kind, row });
  }

  const provisionalIds = new Map(
    assignments.map((assignment) => [
      String(assignment.category.id),
      assignment.row?.id ?? `__new__${assignment.category.id}`,
    ]),
  );
  const counts = { create: 0, update: 0, adopt: 0, unchanged: 0 };
  for (const assignment of assignments) {
    if (assignment.kind === 'create') counts.create += 1;
    else if (assignment.kind === 'adopt') counts.adopt += 1;
    else if (
      hasChanges(
        assignment.row,
        desiredValues(assignment.category, store, provisionalIds),
      )
    ) {
      counts.update += 1;
    } else counts.unchanged += 1;
  }
  return { assignments, counts };
}

function planSignature(plan) {
  return plan.assignments.map((assignment) => ({
    masterId: String(assignment.category.id),
    kind: assignment.kind,
    localId: assignment.row ? String(assignment.row.id) : null,
  }));
}

async function verifyPrimarySchema(pool) {
  await pool.query(
    'SELECT id, organization_id FROM public.stores WHERE id = ANY($1::int[]) LIMIT 0',
    [STORE_IDS],
  );
  await pool.query(
    `SELECT id, name, myanmar_name, myanmar_alias, description, status,
            level, parent_id FROM public.categories LIMIT 0`,
  );
}

async function verifyStoreSchema(pool) {
  await pool.query(
    `SELECT id, organization_id, store_id, name, myanmar_name, myanmar_alias,
            description, level, parent_id, master_category_id,
            outlet_category_id, status
     FROM public.selling_category_records LIMIT 0`,
  );
  await pool.query(
    `SELECT target_org_id, target_store_id, entity_type, entity_id,
            operation, payload_version, payload_json, source, source_event_id
     FROM public.server_change_logs LIMIT 0`,
  );
}

async function loadMasterData(pool) {
  const [categoryResult, storeResult] = await Promise.all([
    pool.query('SELECT * FROM public.categories ORDER BY level ASC, id ASC'),
    pool.query(
      'SELECT id, organization_id FROM public.stores WHERE id = ANY($1::int[]) ORDER BY id ASC',
      [STORE_IDS],
    ),
  ]);
  const categories = sortAndValidateCategories(categoryResult.rows);
  const stores = storeResult.rows;
  const found = new Set(stores.map((store) => Number(store.id)));
  const missing = STORE_IDS.filter((id) => !found.has(id));
  if (missing.length) {
    throw new Error(`Master DB is missing stores: ${missing.join(', ')}`);
  }
  return { categories, stores };
}

async function loadStoreRows(pool, forUpdate = false) {
  const result = await pool.query(
    `SELECT * FROM public.selling_category_records ORDER BY id ASC${
      forUpdate ? ' FOR UPDATE' : ''
    }`,
  );
  return result.rows;
}

async function writeChangeLog(client, store, row, idFactory) {
  await client.query(
    `INSERT INTO public.server_change_logs (
       target_org_id, target_store_id, entity_type, entity_id,
       operation, payload_version, payload_json, source, source_event_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [
      Number(store.organization_id),
      Number(store.id),
      'SellingCategoryRecord',
      String(row.id),
      'UPSERT',
      1,
      JSON.stringify(toPayload(row)),
      SOURCE,
      idFactory(),
    ],
  );
}

async function applyStorePlan(
  pool,
  store,
  categories,
  preflightPlan,
  idFactory = sourceEventId,
  recordIdFactory = null,
) {
  const createRecordId = recordIdFactory ?? (await import('uuid')).v7;
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const currentRows = await loadStoreRows(client, true);
    const currentPlan = buildStorePlan(categories, currentRows, store);
    if (
      JSON.stringify(planSignature(currentPlan)) !==
      JSON.stringify(planSignature(preflightPlan))
    ) {
      throw new Error(
        `Store ${store.id} changed after preflight; aborting its transaction.`,
      );
    }
    const localIds = new Map(
      currentPlan.assignments
        .filter((assignment) => assignment.row)
        .map((assignment) => [
          String(assignment.category.id),
          String(assignment.row.id),
        ]),
    );
    const result = { create: 0, update: 0, adopt: 0, unchanged: 0, logged: 0 };

    for (const assignment of currentPlan.assignments) {
      const desired = desiredValues(assignment.category, store, localIds);
      let row;
      if (assignment.kind === 'create') {
        const created = await client.query(
          `INSERT INTO public.selling_category_records (
             id, organization_id, store_id, name, myanmar_name, myanmar_alias,
             description, level, parent_id, master_category_id, status, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
           RETURNING *`,
          [createRecordId(), ...Object.values(desired)],
        );
        row = created.rows[0];
        result.create += 1;
      } else if (!hasChanges(assignment.row, desired)) {
        localIds.set(String(assignment.category.id), String(assignment.row.id));
        result.unchanged += 1;
        continue;
      } else {
        const updated = await client.query(
          `UPDATE public.selling_category_records
           SET organization_id = $1, store_id = $2, name = $3,
               myanmar_name = $4, myanmar_alias = $5, description = $6,
               level = $7, parent_id = $8, master_category_id = $9,
               status = $10, updated_at = NOW()
           WHERE id = $11 RETURNING *`,
          [...Object.values(desired), assignment.row.id],
        );
        row = updated.rows[0];
        if (assignment.kind === 'adopt') result.adopt += 1;
        else result.update += 1;
      }
      localIds.set(String(assignment.category.id), String(row.id));
      await writeChangeLog(client, store, row, idFactory);
      result.logged += 1;
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function askConfirmation(question) {
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    terminal.question(question, (answer) => {
      terminal.close();
      resolve(['y', 'yes'].includes(answer.trim().toLowerCase()));
    });
  });
}

function printPlan(storeId, plan) {
  const { create, update, adopt, unchanged } = plan.counts;
  console.log(
    `  Store ${storeId}: create=${create} update=${update} adopt=${adopt} unchanged=${unchanged}`,
  );
}

async function runSync(options) {
  requireEnv(['DATABASE_URL', 'STORE_DATABASE_URL']);
  const primaryPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prefix = String(process.env.STORE_DB_PREFIX || 'pos_store').trim();
  const preflight = new Map();
  try {
    await verifyPrimarySchema(primaryPool);
    const { categories, stores } = await loadMasterData(primaryPool);
    console.log(`\nMaster categories: ${categories.length}`);
    for (const store of stores) {
      const pool = new Pool({
        connectionString: buildStoreUrl(
          process.env.STORE_DATABASE_URL,
          prefix,
          store.id,
        ),
      });
      try {
        await verifyStoreSchema(pool);
        const plan = buildStorePlan(
          categories,
          await loadStoreRows(pool),
          store,
        );
        preflight.set(Number(store.id), plan);
        printPlan(store.id, plan);
      } finally {
        await pool.end();
      }
    }
    if (options.mode === 'dry-run') {
      console.log(
        '\nDRY RUN complete — no database writes or MQTT messages were made.',
      );
      return;
    }
    if (
      !options.force &&
      !(await askConfirmation(
        '\nSync these master categories to stores 2, 15, and 18? (y/N) ',
      ))
    ) {
      console.log('Aborted; no changes were made.');
      return;
    }
    for (const store of stores) {
      const pool = new Pool({
        connectionString: buildStoreUrl(
          process.env.STORE_DATABASE_URL,
          prefix,
          store.id,
        ),
      });
      try {
        const result = await applyStorePlan(
          pool,
          store,
          categories,
          preflight.get(Number(store.id)),
        );
        console.log(
          `Store ${store.id} complete: create=${result.create} update=${result.update} ` +
            `adopt=${result.adopt} unchanged=${result.unchanged} logged=${result.logged}`,
        );
      } finally {
        await pool.end();
      }
    }
    console.log('Category sync completed successfully.');
  } finally {
    await primaryPool.end();
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage());
    else await runSync(options);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  STORE_IDS,
  applyStorePlan,
  buildStorePlan,
  buildStoreUrl,
  displayName,
  hasChanges,
  normalizeName,
  parseArgs,
  sortAndValidateCategories,
  toPayload,
};

if (require.main === module) main();
