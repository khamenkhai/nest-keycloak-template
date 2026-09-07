#!/usr/bin/env node

'use strict';

require('dotenv/config');

const crypto = require('node:crypto');
const path = require('node:path');
const readline = require('node:readline');
const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
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

function normalizeKey(raw, bucket) {
  if (!raw) return null;
  let key = String(raw).split('?')[0].trim();
  if (/^https?:\/\//i.test(key)) {
    try {
      key = new URL(key).pathname;
    } catch {
      return null;
    }
  }
  key = key.replace(/^\/+/, '');
  if (bucket && key.startsWith(`${bucket}/`))
    key = key.slice(bucket.length + 1);
  return key || null;
}

function createMediaResolver() {
  requireEnv([
    'MINIO_ENDPOINT',
    'MINIO_ACCESS_KEY',
    'MINIO_SECRET_KEY',
    'MINIO_BUCKET',
  ]);
  const bucket = process.env.MINIO_BUCKET.trim();
  const client = new S3Client({
    region: 'us-east-1',
    endpoint: process.env.MINIO_ENDPOINT,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY,
      secretAccessKey: process.env.MINIO_SECRET_KEY,
    },
    forcePathStyle: true,
  });
  return async (raw) => {
    const key = normalizeKey(raw, bucket);
    if (!key) return { key: null, url: null };
    const signed = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 43200 },
    );
    return { key, url: signed.split('?')[0] || null };
  };
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function valuesDiffer(row, desired) {
  return Object.entries(desired).some(([key, target]) => {
    const current = row[key] ?? null;
    const value = target ?? null;
    if (
      [
        'organization_id',
        'store_id',
        'level',
        'conversion_factor',
        'weight',
      ].includes(key)
    ) {
      return current === null || value === null
        ? current !== value
        : Number(current) !== Number(value);
    }
    return current !== value;
  });
}

function uniqueMasterMap(rows, column, storeId, label) {
  const map = new Map();
  for (const row of rows) {
    if (row[column] == null) continue;
    const key = String(row[column]);
    if (map.has(key))
      throw new Error(
        `Store ${storeId} has duplicate ${label} rows for master ID ${key}.`,
      );
    map.set(key, row);
  }
  return map;
}

function productValues(master, store) {
  return {
    organization_id: Number(store.organization_id),
    store_id: Number(store.id),
    name: master.name ?? '',
    myanmar_name: master.myanmar_name ?? null,
    myanmar_alias: master.myanmar_alias ?? null,
    description: master.description ?? null,
    product_code: master.product_code ?? null,
    uom_id: master.uom_id == null ? null : String(master.uom_id),
    product_type:
      master.product_type == null ? null : String(master.product_type),
    master_product_id: String(master.id),
    status: String(master.status),
  };
}

function brandValues(master, store) {
  return {
    organization_id: Number(store.organization_id),
    store_id: Number(store.id),
    name: master.name ?? '',
    myanmar_name: master.myanmar_name ?? null,
    myanmar_alias: master.myanmar_alias ?? null,
    description: master.description ?? null,
    master_brand_id: String(master.id),
    status: String(master.status),
  };
}

function skuValues(master, local, store, productId, brandId, media) {
  return {
    organization_id: Number(store.organization_id),
    store_id: Number(store.id),
    sku_id: String(master.id),
    master_sku_id: String(master.id),
    sku_code: master.sku_code ?? null,
    product_id: productId,
    brand_id: brandId,
    master_barcode: master.barcode ?? null,
    name: master.name ?? master.sku_code ?? `SKU-${master.id}`,
    myanmar_name: master.myanmar_name ?? null,
    myanmar_alias: master.myanmar_alias ?? null,
    description: master.description ?? null,
    photo_key: media.key,
    photo_url: media.url,
    master_image_key: media.key,
    master_image_url: media.url,
    uom_id: master.uom_id == null ? null : String(master.uom_id),
    base_uom_id: master.base_uom_id == null ? null : String(master.base_uom_id),
    conversion_factor:
      master.conversion_factor == null
        ? null
        : Number(master.conversion_factor),
    weight: master.weight == null ? null : Number(master.weight),
    weight_uom_id:
      master.weight_uom_id == null ? null : String(master.weight_uom_id),
    status: String(master.status),
  };
}

async function loadStoreSnapshot(pool) {
  const skus = (
    await pool.query(
      'SELECT * FROM public.selling_sku_records WHERE master_sku_id IS NOT NULL ORDER BY id',
    )
  ).rows;
  const [products, brands, categories, links] = await Promise.all([
    pool.query('SELECT * FROM public.selling_product_records ORDER BY id'),
    pool.query('SELECT * FROM public.selling_brand_records ORDER BY id'),
    pool.query(
      'SELECT * FROM public.selling_category_records WHERE master_category_id IS NOT NULL ORDER BY id',
    ),
    skus.length
      ? pool.query(
          'SELECT * FROM public.selling_sku_category_records WHERE sku_id = ANY($1::text[]) ORDER BY id',
          [skus.map((row) => row.id)],
        )
      : Promise.resolve({ rows: [] }),
  ]);
  return {
    skus,
    products: products.rows,
    brands: brands.rows,
    categories: categories.rows,
    links: links.rows,
  };
}

async function loadMasterData(pool, masterIds, resolveMedia) {
  if (!masterIds.length)
    return {
      skus: new Map(),
      products: new Map(),
      brands: new Map(),
      categoryIds: new Map(),
      media: new Map(),
    };
  const skuRows = (
    await pool.query(
      'SELECT * FROM public.sku_masters WHERE id = ANY($1::int[])',
      [masterIds],
    )
  ).rows;
  const productIds = [
    ...new Set(skuRows.map((row) => row.product_id).filter((id) => id != null)),
  ];
  const brandIds = [
    ...new Set(skuRows.map((row) => row.brand_id).filter((id) => id != null)),
  ];
  const [products, brands, categories] = await Promise.all([
    productIds.length
      ? pool.query('SELECT * FROM public.products WHERE id = ANY($1::int[])', [
          productIds,
        ])
      : Promise.resolve({ rows: [] }),
    brandIds.length
      ? pool.query('SELECT * FROM public.brands WHERE id = ANY($1::int[])', [
          brandIds,
        ])
      : Promise.resolve({ rows: [] }),
    pool.query(
      'SELECT sku_id, category_id FROM public.sku_categories WHERE sku_id = ANY($1::int[]) ORDER BY id',
      [masterIds],
    ),
  ]);
  const media = new Map();
  for (const sku of skuRows)
    media.set(Number(sku.id), await resolveMedia(sku.photo_key));
  const categoryIds = new Map();
  for (const link of categories.rows)
    categoryIds.set(Number(link.sku_id), [
      ...(categoryIds.get(Number(link.sku_id)) ?? []),
      Number(link.category_id),
    ]);
  return {
    skus: new Map(skuRows.map((row) => [Number(row.id), row])),
    products: new Map(products.rows.map((row) => [Number(row.id), row])),
    brands: new Map(brands.rows.map((row) => [Number(row.id), row])),
    categoryIds,
    media,
  };
}

function buildPlan(snapshot, master, store) {
  const valid = [],
    skipped = [];
  for (const local of snapshot.skus) {
    const id = positiveId(local.master_sku_id);
    const masterSku = id == null ? null : master.skus.get(id);
    if (!masterSku) {
      skipped.push(local);
      continue;
    }
    valid.push({ local, master: masterSku });
  }
  const usedProductIds = [
    ...new Set(
      valid.map(({ master }) => master.product_id).filter((id) => id != null),
    ),
  ];
  const usedBrandIds = [
    ...new Set(
      valid.map(({ master }) => master.brand_id).filter((id) => id != null),
    ),
  ];
  const usedCategoryIds = new Set(
    valid
      .flatMap(
        ({ master: source }) => master.categoryIds.get(Number(source.id)) ?? [],
      )
      .map(String),
  );
  const productIdSet = new Set(usedProductIds.map(String));
  const brandIdSet = new Set(usedBrandIds.map(String));
  const productRows = uniqueMasterMap(
    snapshot.products.filter((row) =>
      productIdSet.has(String(row.master_product_id)),
    ),
    'master_product_id',
    store.id,
    'selling product',
  );
  const brandRows = uniqueMasterMap(
    snapshot.brands.filter((row) =>
      brandIdSet.has(String(row.master_brand_id)),
    ),
    'master_brand_id',
    store.id,
    'selling brand',
  );
  const categoryRows = uniqueMasterMap(
    snapshot.categories.filter((row) =>
      usedCategoryIds.has(String(row.master_category_id)),
    ),
    'master_category_id',
    store.id,
    'selling category',
  );
  const products = usedProductIds.map((id) => {
    const source = master.products.get(Number(id));
    if (!source) throw new Error(`Master product ${id} is missing.`);
    const row = productRows.get(String(id)) ?? null;
    const desired = productValues(source, store);
    return {
      source,
      row,
      kind: row
        ? valuesDiffer(row, desired)
          ? 'update'
          : 'unchanged'
        : 'create',
      desired,
    };
  });
  const brands = usedBrandIds.map((id) => {
    const source = master.brands.get(Number(id));
    if (!source) throw new Error(`Master brand ${id} is missing.`);
    const row = brandRows.get(String(id)) ?? null;
    const desired = brandValues(source, store);
    return {
      source,
      row,
      kind: row
        ? valuesDiffer(row, desired)
          ? 'update'
          : 'unchanged'
        : 'create',
      desired,
    };
  });
  const productLocalIds = new Map(
    products.map((item) => [
      String(item.source.id),
      item.row?.id ?? `__product__${item.source.id}`,
    ]),
  );
  const brandLocalIds = new Map(
    brands.map((item) => [
      String(item.source.id),
      item.row?.id ?? `__brand__${item.source.id}`,
    ]),
  );
  const linksBySku = new Map();
  for (const link of snapshot.links)
    linksBySku.set(String(link.sku_id), [
      ...(linksBySku.get(String(link.sku_id)) ?? []),
      link,
    ]);
  const skus = valid.map(({ local, master: source }) => {
    const desiredCategories = (
      master.categoryIds.get(Number(source.id)) ?? []
    ).map((id) => {
      const row = categoryRows.get(String(id));
      if (!row)
        throw new Error(
          `Store ${store.id} lacks selling category for master category ${id} (SKU ${source.id}).`,
        );
      return String(row.id);
    });
    const currentLinks = linksBySku.get(String(local.id)) ?? [];
    const desiredSet = new Set(desiredCategories),
      currentSet = new Set(currentLinks.map((row) => String(row.category_id)));
    return {
      local,
      source,
      currentLinks,
      addCategoryIds: desiredCategories.filter((id) => !currentSet.has(id)),
      removeLinks: currentLinks.filter(
        (row) => !desiredSet.has(String(row.category_id)),
      ),
      desired: skuValues(
        source,
        local,
        store,
        source.product_id == null
          ? null
          : productLocalIds.get(String(source.product_id)),
        source.brand_id == null
          ? null
          : brandLocalIds.get(String(source.brand_id)),
        master.media.get(Number(source.id)) ?? { key: null, url: null },
      ),
    };
  });
  const counts = {
    scanned: snapshot.skus.length,
    skipped: skipped.length,
    skuUpdated: skus.filter((item) => valuesDiffer(item.local, item.desired))
      .length,
    skuUnchanged: skus.filter((item) => !valuesDiffer(item.local, item.desired))
      .length,
    productsCreated: products.filter((x) => x.kind === 'create').length,
    productsUpdated: products.filter((x) => x.kind === 'update').length,
    brandsCreated: brands.filter((x) => x.kind === 'create').length,
    brandsUpdated: brands.filter((x) => x.kind === 'update').length,
    linksAdded: skus.reduce((n, x) => n + x.addCategoryIds.length, 0),
    linksRemoved: skus.reduce((n, x) => n + x.removeLinks.length, 0),
  };
  return { products, brands, skus, skipped, counts };
}

function planSignature(plan) {
  return JSON.stringify({
    products: plan.products.map((x) => [
      String(x.source.id),
      x.row?.id ?? null,
      x.kind,
    ]),
    brands: plan.brands.map((x) => [
      String(x.source.id),
      x.row?.id ?? null,
      x.kind,
    ]),
    skus: plan.skus.map((x) => [
      x.local.id,
      x.addCategoryIds,
      x.removeLinks.map((r) => r.id),
    ]),
    skipped: plan.skipped.map((x) => x.id),
  });
}

async function writeLog(client, store, type, row, operation, idFactory) {
  await client.query(
    `INSERT INTO public.server_change_logs
    (target_org_id,target_store_id,entity_type,entity_id,operation,payload_version,payload_json,source,source_event_id)
    VALUES ($1,$2,$3,$4,$5,1,$6::jsonb,$7,$8)`,
    [
      Number(store.organization_id),
      Number(store.id),
      type,
      String(row.id),
      operation,
      JSON.stringify(camelPayload(row)),
      SOURCE,
      idFactory(),
    ],
  );
}

async function upsertRelation(
  client,
  store,
  item,
  table,
  columns,
  type,
  uuid,
  idFactory,
) {
  if (item.kind === 'unchanged') return item.row.id;
  let result;
  if (item.kind === 'create') {
    const keys = ['id', ...columns, 'created_at'];
    const params = [uuid(), ...columns.map((key) => item.desired[key])];
    result = await client.query(
      `INSERT INTO public.${table} (${keys.join(',')}) VALUES (${params.map((_, i) => `$${i + 1}`).join(',')},NOW()) RETURNING *`,
      params,
    );
  } else {
    const params = columns.map((key) => item.desired[key]);
    result = await client.query(
      `UPDATE public.${table} SET ${columns.map((key, i) => `${key}=$${i + 1}`).join(',')},updated_at=NOW() WHERE id=$${params.length + 1} RETURNING *`,
      [...params, item.row.id],
    );
  }
  await writeLog(client, store, type, result.rows[0], 'UPSERT', idFactory);
  return result.rows[0].id;
}

async function applyPlan(
  pool,
  store,
  master,
  preflight,
  uuid,
  idFactory = eventId,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const current = buildPlan(await loadStoreSnapshot(client), master, store);
    if (planSignature(current) !== planSignature(preflight))
      throw new Error(`Store ${store.id} changed after preflight.`);
    const productIds = new Map(),
      brandIds = new Map();
    const productColumns = [
      'organization_id',
      'store_id',
      'name',
      'myanmar_name',
      'myanmar_alias',
      'description',
      'product_code',
      'uom_id',
      'product_type',
      'master_product_id',
      'status',
    ];
    const brandColumns = [
      'organization_id',
      'store_id',
      'name',
      'myanmar_name',
      'myanmar_alias',
      'description',
      'master_brand_id',
      'status',
    ];
    for (const item of current.products)
      productIds.set(
        String(item.source.id),
        await upsertRelation(
          client,
          store,
          item,
          'selling_product_records',
          productColumns,
          'SellingProductRecord',
          uuid,
          idFactory,
        ),
      );
    for (const item of current.brands)
      brandIds.set(
        String(item.source.id),
        await upsertRelation(
          client,
          store,
          item,
          'selling_brand_records',
          brandColumns,
          'SellingBrandRecord',
          uuid,
          idFactory,
        ),
      );
    let logs =
      current.products.filter((x) => x.kind !== 'unchanged').length +
      current.brands.filter((x) => x.kind !== 'unchanged').length;
    const skuColumns = [
      'organization_id',
      'store_id',
      'sku_id',
      'master_sku_id',
      'sku_code',
      'product_id',
      'brand_id',
      'master_barcode',
      'name',
      'myanmar_name',
      'myanmar_alias',
      'description',
      'photo_key',
      'photo_url',
      'master_image_key',
      'master_image_url',
      'uom_id',
      'base_uom_id',
      'conversion_factor',
      'weight',
      'weight_uom_id',
      'status',
    ];
    for (const item of current.skus) {
      item.desired.product_id =
        item.source.product_id == null
          ? null
          : productIds.get(String(item.source.product_id));
      item.desired.brand_id =
        item.source.brand_id == null
          ? null
          : brandIds.get(String(item.source.brand_id));
      if (valuesDiffer(item.local, item.desired)) {
        const params = skuColumns.map((key) => item.desired[key]);
        const updated = await client.query(
          `UPDATE public.selling_sku_records SET ${skuColumns.map((key, i) => `${key}=$${i + 1}`).join(',')},updated_at=NOW() WHERE id=$${params.length + 1} RETURNING *`,
          [...params, item.local.id],
        );
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
      for (const link of item.removeLinks) {
        await client.query(
          'DELETE FROM public.selling_sku_category_records WHERE id=$1',
          [link.id],
        );
        await writeLog(
          client,
          store,
          'SellingSkuCategoryRecord',
          link,
          'DELETE',
          idFactory,
        );
        logs++;
      }
      for (const categoryId of item.addCategoryIds) {
        const inserted = await client.query(
          `INSERT INTO public.selling_sku_category_records
          (id,organization_id,store_id,sku_id,category_id,created_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
          [
            uuid(),
            Number(store.organization_id),
            Number(store.id),
            item.local.id,
            categoryId,
          ],
        );
        await writeLog(
          client,
          store,
          'SellingSkuCategoryRecord',
          inserted.rows[0],
          'UPSERT',
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

function printCounts(storeId, c) {
  console.log(
    `  Store ${storeId}: scanned=${c.scanned} skuUpdated=${c.skuUpdated} unchanged=${c.skuUnchanged} skipped=${c.skipped} products(create/update)=${c.productsCreated}/${c.productsUpdated} brands(create/update)=${c.brandsCreated}/${c.brandsUpdated} links(+/-)=${c.linksAdded}/${c.linksRemoved}`,
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
  const resolveMedia = createMediaResolver();
  const stores = (
    await primary.query(
      'SELECT id,organization_id FROM public.stores WHERE id=ANY($1::int[]) ORDER BY id',
      [STORE_IDS],
    )
  ).rows;
  if (stores.length !== STORE_IDS.length)
    throw new Error('One or more target stores are missing.');
  const snapshots = new Map(),
    allIds = new Set();
  try {
    for (const store of stores) {
      const pool = new Pool({
        connectionString: buildStoreUrl(
          process.env.STORE_DATABASE_URL,
          prefix,
          store.id,
        ),
      });
      try {
        const snapshot = await loadStoreSnapshot(pool);
        snapshots.set(Number(store.id), snapshot);
        for (const row of snapshot.skus) {
          const id = positiveId(row.master_sku_id);
          if (id) allIds.add(id);
        }
      } finally {
        await pool.end();
      }
    }
    const master = await loadMasterData(primary, [...allIds], resolveMedia);
    const plans = new Map();
    console.log(`\nLinked master SKU IDs: ${allIds.size}`);
    for (const store of stores) {
      const plan = buildPlan(snapshots.get(Number(store.id)), master, store);
      plans.set(Number(store.id), plan);
      printCounts(store.id, plan.counts);
    }
    if (options.mode === 'dry-run') {
      console.log('\nDRY RUN complete — no writes or MQTT messages.');
      return;
    }
    if (
      !options.force &&
      !(await ask('\nApply this sync to stores 2, 15, and 18? (y/N) '))
    ) {
      console.log('Aborted.');
      return;
    }
    const { v7 } = await import('uuid');
    for (const store of stores) {
      const pool = new Pool({
        connectionString: buildStoreUrl(
          process.env.STORE_DATABASE_URL,
          prefix,
          store.id,
        ),
      });
      try {
        const result = await applyPlan(
          pool,
          store,
          master,
          plans.get(Number(store.id)),
          v7,
        );
        console.log(`Store ${store.id} complete: logs=${result.logs}`);
      } finally {
        await pool.end();
      }
    }
    console.log('Master SKU sync completed successfully.');
  } finally {
    await primary.end();
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
  applyPlan,
  brandValues,
  buildPlan,
  normalizeKey,
  parseArgs,
  positiveId,
  productValues,
  skuValues,
  valuesDiffer,
};
if (require.main === module) main();
