#!/usr/bin/env node

'use strict';

require('dotenv/config');

const crypto = require('node:crypto');
const path = require('node:path');
const readline = require('node:readline');
const { Pool } = require('pg');

const STORE_ID = 15;
const SOURCE = 'POS_PRE_REGISTRATION_SERVICE';
const BRAND_MERGES = Object.freeze([
  {
    masterId: '148',
    keepId: '019f7ea9-e6d0-77c5-beff-84e955f3514b',
    mergeIds: ['019f839b-938b-78dd-850e-0757d65602f9'],
  },
  {
    masterId: '240',
    keepId: '019f83be-3dec-7040-bb87-c45ae33e41d9',
    mergeIds: [
      '019f83bf-4a6b-74c8-8d7f-6d068ca1f507',
      '019f83c8-1fd7-7a30-9a65-1187b097cb82',
    ],
  },
  {
    masterId: '332',
    keepId: '019f83c5-d6ff-7621-a32f-b0170d8b92fb',
    mergeIds: ['019f83c9-7cf9-707a-98c8-699d51504edd'],
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

const masterIds = BRAND_MERGES.map((item) => item.masterId);
const mergeIds = BRAND_MERGES.flatMap((item) => item.mergeIds);

async function loadSnapshot(client, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const brands = (
    await client.query(
      `SELECT * FROM public.selling_brand_records
       WHERE master_brand_id = ANY($1::text[]) ORDER BY master_brand_id,id${suffix}`,
      [masterIds],
    )
  ).rows;
  const skus = (
    await client.query(
      `SELECT * FROM public.selling_sku_records
       WHERE brand_id = ANY($1::text[]) ORDER BY id${suffix}`,
      [mergeIds],
    )
  ).rows;
  return { brands, skus };
}

function buildPlan(snapshot) {
  const brandsById = new Map(snapshot.brands.map((row) => [row.id, row]));
  const expectedIds = new Set(
    BRAND_MERGES.flatMap((item) => [item.keepId, ...item.mergeIds]),
  );
  const unexpected = snapshot.brands.filter((row) => !expectedIds.has(row.id));
  if (unexpected.length)
    throw new Error(
      `Store ${STORE_ID} has unexpected duplicate rows for targeted master IDs: ${unexpected.map((row) => row.id).join(', ')}`,
    );

  const groups = BRAND_MERGES.map((mapping) => {
    const keep = brandsById.get(mapping.keepId);
    if (!keep)
      throw new Error(`Store ${STORE_ID} KEEP brand ${mapping.keepId} is missing.`);
    if (String(keep.master_brand_id) !== mapping.masterId)
      throw new Error(`KEEP brand ${mapping.keepId} master ID changed.`);
    const merges = mapping.mergeIds
      .map((id) => brandsById.get(id))
      .filter(Boolean);
    for (const row of merges)
      if (String(row.master_brand_id) !== mapping.masterId)
        throw new Error(`MERGE brand ${row.id} master ID changed.`);
    return { ...mapping, keep, merges };
  });

  const activeMergeIds = new Set(
    groups.flatMap((group) => group.merges.map((row) => row.id)),
  );
  const skuUpdates = snapshot.skus
    .filter((row) => activeMergeIds.has(row.brand_id))
    .map((row) => {
      const group = groups.find((item) =>
        item.merges.some((brand) => brand.id === row.brand_id),
      );
      return { row, keepId: group.keepId };
    });

  return {
    groups,
    skuUpdates,
    counts: {
      groups: groups.filter((group) => group.merges.length).length,
      brandsToDelete: groups.reduce(
        (sum, group) => sum + group.merges.length,
        0,
      ),
      skusToUpdate: skuUpdates.length,
    },
  };
}

function planSignature(plan) {
  return JSON.stringify({
    brands: plan.groups.flatMap((group) =>
      group.merges.map((row) => [row.id, group.keepId]),
    ),
    skus: plan.skuUpdates.map((item) => [
      item.row.id,
      item.row.brand_id,
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
         SET brand_id=$1,updated_at=NOW() WHERE id=$2 RETURNING *`,
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
      for (const brand of group.merges) {
        const deleted = await client.query(
          'DELETE FROM public.selling_brand_records WHERE id=$1 RETURNING *',
          [brand.id],
        );
        if (deleted.rowCount !== 1)
          throw new Error(`Selling brand ${brand.id} could not be deleted.`);
        await writeLog(
          client,
          store,
          'SellingBrandRecord',
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
  console.log(`\nStore ${STORE_ID} duplicate selling brand merge`);
  for (const group of plan.groups)
    console.log(
      `  Master ${group.masterId}: keep=${group.keepId} merge=${group.merges.map((row) => row.id).join(', ') || 'none'}`,
    );
  console.log(
    `  Summary: groups=${plan.counts.groups} SKU links=${plan.counts.skusToUpdate} brands=${plan.counts.brandsToDelete}`,
  );
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
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
    connectionString: buildStoreUrl(process.env.STORE_DATABASE_URL, prefix, STORE_ID),
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
    if (!plan.counts.brandsToDelete) {
      console.log('\nNothing to merge.');
      return;
    }
    if (
      !options.force &&
      !(await ask(
        `\nUpdate ${plan.counts.skusToUpdate} SKU links and delete ${plan.counts.brandsToDelete} duplicate brands? (y/N) `,
      ))
    ) {
      console.log('Aborted.');
      return;
    }
    const result = await applyPlan(storePool, store, plan);
    console.log(
      `Store ${STORE_ID} complete: SKU links=${result.skusToUpdate}, deleted brands=${result.brandsToDelete}, logs=${result.logs}`,
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

module.exports = { BRAND_MERGES, applyPlan, buildPlan, parseArgs };

if (require.main === module) main();
