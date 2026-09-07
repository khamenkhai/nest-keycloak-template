#!/usr/bin/env node

'use strict';

require('dotenv/config');

const crypto = require('node:crypto');
const path = require('node:path');
const readline = require('node:readline');
const { Pool } = require('pg');

const STORE_ID = 15;
const SOURCE = 'POS_PRE_REGISTRATION_SERVICE';
const PRODUCT_MERGES = Object.freeze([
  {
    masterId: '589',
    keepId: '019f83be-3de1-7782-8b5e-8e8301c4c200',
    mergeIds: ['019f83c8-1fcb-72d6-b9e7-604eec8f35d3'],
  },
  {
    masterId: '592',
    keepId: '019f83bf-4a60-7548-bb0d-862bbfe1c6cc',
    mergeIds: [
      '019f83c8-a220-792d-8a69-31fb947f509d',
      '019f83c8-e5be-710d-b4be-35a80bbd0aab',
    ],
  },
  {
    masterId: '635',
    keepId: '019f7ea9-e6c4-7a04-9fc5-a151eadbfc05',
    mergeIds: ['019f839b-9385-7368-8437-df30a7372625'],
  },
  {
    masterId: '686',
    keepId: '019f83c5-d6f7-7d57-ac79-ea5e810a89e7',
    mergeIds: ['019f83c9-7ceb-7f05-8b45-9bfceeab678a'],
  },
]);

function usage() {
  const executable = path.relative(process.cwd(), __filename) || __filename;
  return [
    'Usage:',
    `  node ${executable} [--dry-run]`,
    `  node ${executable} --apply [--force]`,
  ].join('\n');
}

function parseArgs(args) {
  let explicit = null;
  const result = { mode: 'dry-run', force: false, help: false };
  for (const arg of args) {
    if (arg === '--dry-run' || arg === '--apply') {
      const mode = arg.slice(2);
      if (explicit && explicit !== mode)
        throw new Error('Choose only one mode.');
      explicit = mode;
      result.mode = mode;
    } else if (arg === '--force') result.force = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (result.force && result.mode !== 'apply')
    throw new Error('--force requires --apply.');
  return result;
}

function requireEnv(names) {
  const missing = names.filter(
    (name) => !String(process.env[name] ?? '').trim(),
  );
  if (missing.length)
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
}

function buildStoreUrl(base, prefix, storeId) {
  const url = new URL(base);
  url.pathname = `/${prefix}_${storeId}`;
  return url.toString();
}

function eventId() {
  const now = new Date();
  return `${now.getDate()}-${now.getMonth() + 1}-${now.getFullYear()}-${crypto.randomBytes(5).toString('hex')}`;
}

function camelPayload(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
      value,
    ]),
  );
}

const masterIds = PRODUCT_MERGES.map((item) => item.masterId);
const mergeIds = PRODUCT_MERGES.flatMap((item) => item.mergeIds);

async function loadSnapshot(client, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const products = (
    await client.query(
      `SELECT * FROM public.selling_product_records
       WHERE master_product_id = ANY($1::text[]) ORDER BY master_product_id,id${suffix}`,
      [masterIds],
    )
  ).rows;
  const skus = (
    await client.query(
      `SELECT * FROM public.selling_sku_records
       WHERE product_id = ANY($1::text[]) ORDER BY id${suffix}`,
      [mergeIds],
    )
  ).rows;
  return { products, skus };
}

function buildPlan(snapshot) {
  const productsById = new Map(snapshot.products.map((row) => [row.id, row]));
  const expectedIds = new Set(
    PRODUCT_MERGES.flatMap((item) => [item.keepId, ...item.mergeIds]),
  );
  const unexpected = snapshot.products.filter((row) => !expectedIds.has(row.id));
  if (unexpected.length) {
    throw new Error(
      `Store ${STORE_ID} has unexpected duplicate rows for targeted master IDs: ${unexpected.map((row) => row.id).join(', ')}`,
    );
  }

  const groups = PRODUCT_MERGES.map((mapping) => {
    const keep = productsById.get(mapping.keepId);
    if (!keep)
      throw new Error(
        `Store ${STORE_ID} KEEP product ${mapping.keepId} is missing.`,
      );
    if (String(keep.master_product_id) !== mapping.masterId)
      throw new Error(`KEEP product ${mapping.keepId} master ID changed.`);

    const merges = mapping.mergeIds
      .map((id) => productsById.get(id))
      .filter(Boolean);
    for (const row of merges) {
      if (String(row.master_product_id) !== mapping.masterId)
        throw new Error(`MERGE product ${row.id} master ID changed.`);
    }
    return { ...mapping, keep, merges };
  });

  const activeMergeIds = new Set(
    groups.flatMap((group) => group.merges.map((row) => row.id)),
  );
  const skuUpdates = snapshot.skus
    .filter((row) => activeMergeIds.has(row.product_id))
    .map((row) => {
      const group = groups.find((item) =>
        item.merges.some((product) => product.id === row.product_id),
      );
      return { row, keepId: group.keepId };
    });

  return {
    groups,
    skuUpdates,
    counts: {
      groups: groups.filter((group) => group.merges.length).length,
      productsToDelete: groups.reduce(
        (sum, group) => sum + group.merges.length,
        0,
      ),
      skusToUpdate: skuUpdates.length,
    },
  };
}

function planSignature(plan) {
  return JSON.stringify({
    products: plan.groups.flatMap((group) =>
      group.merges.map((row) => [row.id, group.keepId]),
    ),
    skus: plan.skuUpdates.map((item) => [
      item.row.id,
      item.row.product_id,
      item.keepId,
    ]),
  });
}

async function writeLog(client, store, type, row, operation, idFactory) {
  await client.query(
    `INSERT INTO public.server_change_logs
    (target_org_id,target_store_id,entity_type,entity_id,operation,payload_version,payload_json,source,source_event_id)
    VALUES ($1,$2,$3,$4,$5,1,$6::jsonb,$7,$8)`,
    [
      Number(store.organization_id),
      STORE_ID,
      type,
      String(row.id),
      operation,
      JSON.stringify(camelPayload(row)),
      SOURCE,
      idFactory(),
    ],
  );
}

async function applyPlan(pool, store, preflight, idFactory = eventId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const current = buildPlan(await loadSnapshot(client, true));
    if (planSignature(current) !== planSignature(preflight))
      throw new Error(`Store ${STORE_ID} changed after preflight.`);

    let logs = 0;
    for (const item of current.skuUpdates) {
      const updated = await client.query(
        `UPDATE public.selling_sku_records
         SET product_id=$1,updated_at=NOW() WHERE id=$2 RETURNING *`,
        [item.keepId, item.row.id],
      );
      if (updated.rowCount !== 1)
        throw new Error(`Selling SKU ${item.row.id} could not be updated.`);
      await writeLog(
        client,
        store,
        'SellingSkuRecord',
        updated.rows[0],
        'UPSERT',
        idFactory,
      );
      logs++;
    }

    for (const group of current.groups) {
      for (const product of group.merges) {
        const deleted = await client.query(
          'DELETE FROM public.selling_product_records WHERE id=$1 RETURNING *',
          [product.id],
        );
        if (deleted.rowCount !== 1)
          throw new Error(`Selling product ${product.id} could not be deleted.`);
        await writeLog(
          client,
          store,
          'SellingProductRecord',
          deleted.rows[0],
          'DELETE',
          idFactory,
        );
        logs++;
      }
    }
    await client.query('COMMIT');
    return { ...current.counts, logs };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function printPlan(plan) {
  console.log(`\nStore ${STORE_ID} duplicate selling product merge`);
  for (const group of plan.groups) {
    console.log(
      `  Master ${group.masterId}: keep=${group.keepId} merge=${group.merges.map((row) => row.id).join(', ') || 'none'}`,
    );
  }
  console.log(
    `  Summary: groups=${plan.counts.groups} SKU links=${plan.counts.skusToUpdate} products=${plan.counts.productsToDelete}`,
  );
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(['y', 'yes'].includes(answer.trim().toLowerCase()));
    }),
  );
}

async function run(options) {
  requireEnv(['DATABASE_URL', 'STORE_DATABASE_URL']);
  const primary = new Pool({ connectionString: process.env.DATABASE_URL });
  const prefix = process.env.STORE_DB_PREFIX || 'pos_store';
  const storePool = new Pool({
    connectionString: buildStoreUrl(
      process.env.STORE_DATABASE_URL,
      prefix,
      STORE_ID,
    ),
  });
  try {
    const storeResult = await primary.query(
      'SELECT id,organization_id FROM public.stores WHERE id=$1',
      [STORE_ID],
    );
    if (storeResult.rowCount !== 1)
      throw new Error(`Store ${STORE_ID} is missing from the primary DB.`);
    const store = storeResult.rows[0];
    const plan = buildPlan(await loadSnapshot(storePool));
    printPlan(plan);
    if (options.mode === 'dry-run') {
      console.log('\nDRY RUN complete — no writes or MQTT messages.');
      return;
    }
    if (!plan.counts.productsToDelete) {
      console.log('\nNothing to merge.');
      return;
    }
    if (
      !options.force &&
      !(await ask(
        `\nUpdate ${plan.counts.skusToUpdate} SKU links and delete ${plan.counts.productsToDelete} duplicate products? (y/N) `,
      ))
    ) {
      console.log('Aborted.');
      return;
    }
    const result = await applyPlan(storePool, store, plan);
    console.log(
      `Store ${STORE_ID} complete: SKU links=${result.skusToUpdate}, deleted products=${result.productsToDelete}, logs=${result.logs}`,
    );
  } finally {
    await Promise.all([primary.end(), storePool.end()]);
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage());
    else await run(options);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  PRODUCT_MERGES,
  applyPlan,
  buildPlan,
  parseArgs,
  planSignature,
};

if (require.main === module) main();
