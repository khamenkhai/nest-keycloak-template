'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applyPlan,
  buildPlan,
  normalizeKey,
  parseArgs,
  positiveId,
  valuesDiffer,
} = require('./sync-master-skus-to-stores');

const store = { id: 2, organization_id: 9 };
const masterSku = {
  id: 10,
  sku_code: 'MASTER-10',
  product_id: 20,
  brand_id: 30,
  barcode: '123',
  name: 'Master SKU',
  myanmar_name: 'မြန်မာ',
  myanmar_alias: 'မ',
  description: 'Master description',
  uom_id: 2,
  base_uom_id: null,
  conversion_factor: 1,
  weight: '2.5',
  weight_uom_id: null,
  status: 'ACTIVE',
  photo_key: 'master/10.jpg',
};
const masterProduct = {
  id: 20,
  name: 'Master Product',
  myanmar_name: null,
  myanmar_alias: null,
  description: 'Product description',
  product_code: 'P20',
  uom_id: 2,
  product_type: 'LOCAL',
  status: 'ACTIVE',
};
const masterBrand = {
  id: 30,
  name: 'Master Brand',
  myanmar_name: null,
  myanmar_alias: null,
  description: 'Brand description',
  status: 'ACTIVE',
};

function sellingSku(overrides = {}) {
  return {
    id: 'selling-1',
    organization_id: 9,
    store_id: 2,
    sku_id: '10',
    master_sku_id: '10',
    sku_code: 'OLD',
    product_id: 'product-20',
    brand_id: null,
    master_barcode: 'old',
    name: 'Old',
    myanmar_name: null,
    myanmar_alias: null,
    description: null,
    photo_key: null,
    photo_url: null,
    master_image_key: null,
    master_image_url: null,
    uom_id: null,
    base_uom_id: 'old',
    conversion_factor: null,
    weight: null,
    weight_uom_id: 'old',
    status: 'INACTIVE',
    cost: 50,
    price: 100,
    stock_qty: 7,
    outlet_sku_id: 'outlet-1',
    outlet_barcode: 'outlet-code',
    ...overrides,
  };
}

function masterData(overrides = {}) {
  return {
    skus: new Map([[10, masterSku]]),
    products: new Map([[20, masterProduct]]),
    brands: new Map([[30, masterBrand]]),
    categoryIds: new Map([[10, [40]]]),
    media: new Map([
      [10, { key: 'master/10.jpg', url: 'https://media/master/10.jpg' }],
    ]),
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    skus: [sellingSku()],
    products: [
      {
        id: 'product-20',
        organization_id: 9,
        store_id: 2,
        name: 'Old Product',
        myanmar_name: null,
        myanmar_alias: null,
        description: null,
        product_code: null,
        uom_id: null,
        product_type: null,
        master_product_id: '20',
        outlet_product_id: 'outlet-product',
        status: 'INACTIVE',
      },
    ],
    brands: [],
    categories: [{ id: 'category-40', master_category_id: '40' }],
    links: [
      {
        id: 'remove-link',
        organization_id: 9,
        store_id: 2,
        sku_id: 'selling-1',
        category_id: 'old-category',
      },
    ],
    ...overrides,
  };
}

test('CLI is dry-run by default and helpers normalize IDs/media', () => {
  assert.deepEqual(parseArgs([]), {
    mode: 'dry-run',
    force: false,
    help: false,
  });
  assert.equal(parseArgs(['--apply', '--force']).mode, 'apply');
  assert.equal(positiveId('12'), 12);
  assert.equal(positiveId('bad'), null);
  assert.equal(
    normalizeKey('https://media/bucket/master/a.jpg?signature=x', 'bucket'),
    'master/a.jpg',
  );
});

test('plans authoritative SKU sync, relation update/create, and category diff', () => {
  const plan = buildPlan(snapshot(), masterData(), store);
  assert.deepEqual(plan.counts, {
    scanned: 1,
    skipped: 0,
    skuUpdated: 1,
    skuUnchanged: 0,
    productsCreated: 0,
    productsUpdated: 1,
    brandsCreated: 1,
    brandsUpdated: 0,
    linksAdded: 1,
    linksRemoved: 1,
  });
  assert.equal(plan.products[0].desired.master_product_id, '20');
  assert.equal(plan.brands[0].desired.master_brand_id, '30');
  assert.equal(plan.skus[0].desired.product_id, 'product-20');
  assert.equal(plan.skus[0].desired.brand_id, '__brand__30');
  assert.deepEqual(plan.skus[0].addCategoryIds, ['category-40']);
  assert.equal(plan.skus[0].removeLinks[0].id, 'remove-link');
});

test('mirrors master NULLs while comparison ignores local commerce fields', () => {
  const desired = { base_uom_id: null, weight_uom_id: null, product_id: null };
  assert.equal(valuesDiffer(sellingSku(), desired), true);
  const local = sellingSku({
    base_uom_id: null,
    weight_uom_id: null,
    product_id: null,
  });
  assert.equal(valuesDiffer(local, desired), false);
  assert.equal(local.price, 100);
  assert.equal(local.stock_qty, 7);
});

test('skips dangling master IDs and rejects missing category/duplicate relations', () => {
  const dangling = snapshot({
    skus: [sellingSku({ master_sku_id: '999' })],
    links: [],
  });
  assert.equal(buildPlan(dangling, masterData(), store).counts.skipped, 1);
  assert.throws(
    () => buildPlan(snapshot({ categories: [] }), masterData(), store),
    /lacks selling category/,
  );
  const duplicateProducts = snapshot({
    products: [
      snapshot().products[0],
      { ...snapshot().products[0], id: 'product-duplicate' },
    ],
  });
  assert.throws(
    () => buildPlan(duplicateProducts, masterData(), store),
    /duplicate selling product/,
  );
});

function applyHarness({ failLog = false } = {}) {
  const state = snapshot();
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT \* FROM public\.selling_sku_records/.test(sql))
        return { rows: state.skus };
      if (/SELECT \* FROM public\.selling_product_records/.test(sql))
        return { rows: state.products };
      if (/SELECT \* FROM public\.selling_brand_records/.test(sql))
        return { rows: state.brands };
      if (/SELECT \* FROM public\.selling_category_records/.test(sql))
        return { rows: state.categories };
      if (/SELECT \* FROM public\.selling_sku_category_records/.test(sql))
        return { rows: state.links };
      if (/UPDATE public\.selling_product_records/.test(sql)) {
        const row = {
          ...state.products[0],
          name: params[2],
          description: params[5],
          status: params[10],
        };
        state.products[0] = row;
        return { rows: [row], rowCount: 1 };
      }
      if (/INSERT INTO public\.selling_brand_records/.test(sql)) {
        const row = {
          id: params[0],
          organization_id: params[1],
          store_id: params[2],
          name: params[3],
          master_brand_id: params[7],
          status: params[8],
        };
        state.brands.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (/UPDATE public\.selling_sku_records/.test(sql)) {
        const row = {
          ...state.skus[0],
          product_id: params[5],
          brand_id: params[6],
          name: params[8],
          cost: 50,
          price: 100,
          stock_qty: 7,
          outlet_sku_id: 'outlet-1',
        };
        state.skus[0] = row;
        return { rows: [row], rowCount: 1 };
      }
      if (/DELETE FROM public\.selling_sku_category_records/.test(sql)) {
        state.links = [];
        return { rowCount: 1, rows: [] };
      }
      if (/INSERT INTO public\.selling_sku_category_records/.test(sql)) {
        const row = {
          id: params[0],
          organization_id: params[1],
          store_id: params[2],
          sku_id: params[3],
          category_id: params[4],
        };
        state.links.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (/INSERT INTO public\.server_change_logs/.test(sql) && failLog)
        throw new Error('log failed');
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return {
    state,
    calls,
    pool: {
      async connect() {
        return client;
      },
    },
  };
}

test('applies relations/SKU/category logs atomically and preserves local fields', async () => {
  const data = masterData();
  const preflight = buildPlan(snapshot(), data, store);
  const harness = applyHarness();
  let sequence = 0;
  const result = await applyPlan(
    harness.pool,
    store,
    data,
    preflight,
    () => `id-${++sequence}`,
    () => `event-${sequence}`,
  );
  assert.equal(result.logs, 5);
  assert.equal(harness.state.skus[0].product_id, 'product-20');
  assert.equal(harness.state.skus[0].brand_id, 'id-1');
  assert.equal(harness.state.skus[0].price, 100);
  assert.equal(harness.state.skus[0].stock_qty, 7);
  assert.equal(harness.state.skus[0].outlet_sku_id, 'outlet-1');
  assert.equal(harness.state.products[0].outlet_product_id, 'outlet-product');
  assert.ok(harness.calls.some((call) => call.sql === 'COMMIT'));
});

test('rolls back when an entity change log fails', async () => {
  const data = masterData();
  const preflight = buildPlan(snapshot(), data, store);
  const harness = applyHarness({ failLog: true });
  await assert.rejects(
    () =>
      applyPlan(
        harness.pool,
        store,
        data,
        preflight,
        () => 'id',
        () => 'event',
      ),
    /log failed/,
  );
  assert.ok(harness.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!harness.calls.some((call) => call.sql === 'COMMIT'));
});
