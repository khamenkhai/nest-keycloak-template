'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PRODUCT_MERGES,
  applyPlan,
  buildPlan,
  parseArgs,
} = require('./merge-store-15-duplicate-products');

function product(id, masterId) {
  return {
    id,
    organization_id: 1,
    store_id: 15,
    name: `Product ${masterId}`,
    master_product_id: masterId,
    outlet_product_id: `outlet-${id}`,
    status: 'ACTIVE',
  };
}

function snapshot() {
  const products = PRODUCT_MERGES.flatMap((group) => [
    product(group.keepId, group.masterId),
    ...group.mergeIds.map((id) => product(id, group.masterId)),
  ]);
  const skus = PRODUCT_MERGES.flatMap((group, groupIndex) =>
    group.mergeIds.map((id, index) => ({
      id: `sku-${groupIndex}-${index}`,
      organization_id: 1,
      store_id: 15,
      product_id: id,
      name: 'SKU',
      price: 100,
      stock_qty: 5,
    })),
  );
  return { products, skus };
}

test('parses dry-run and apply modes', () => {
  assert.deepEqual(parseArgs([]), {
    mode: 'dry-run',
    force: false,
    help: false,
  });
  assert.deepEqual(parseArgs(['--apply', '--force']), {
    mode: 'apply',
    force: true,
    help: false,
  });
  assert.throws(() => parseArgs(['--dry-run', '--force']), /requires --apply/);
});

test('builds the approved four-group, five-product merge plan', () => {
  const plan = buildPlan(snapshot());
  assert.deepEqual(plan.counts, {
    groups: 4,
    productsToDelete: 5,
    skusToUpdate: 5,
  });
  assert.equal(plan.skuUpdates[0].keepId, PRODUCT_MERGES[0].keepId);
});

test('rejects a new unexpected duplicate for a targeted master product', () => {
  const data = snapshot();
  data.products.push(product('unexpected', '635'));
  assert.throws(() => buildPlan(data), /unexpected duplicate/);
});

function harness({ failLog = false } = {}) {
  const state = snapshot();
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT \* FROM public\.selling_product_records/.test(sql))
        return { rows: state.products };
      if (/SELECT \* FROM public\.selling_sku_records/.test(sql))
        return { rows: state.skus };
      if (/UPDATE public\.selling_sku_records/.test(sql)) {
        const row = state.skus.find((item) => item.id === params[1]);
        row.product_id = params[0];
        row.updated_at = new Date();
        return { rows: [{ ...row }], rowCount: 1 };
      }
      if (/DELETE FROM public\.selling_product_records/.test(sql)) {
        const index = state.products.findIndex((item) => item.id === params[0]);
        const [row] = state.products.splice(index, 1);
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

test('updates SKU links, deletes duplicate products, and logs atomically', async () => {
  const data = snapshot();
  const preflight = buildPlan(data);
  const h = harness();
  let event = 0;
  const result = await applyPlan(
    h.pool,
    { id: 15, organization_id: 1 },
    preflight,
    () => `event-${++event}`,
  );
  assert.equal(result.productsToDelete, 5);
  assert.equal(result.logs, 10);
  assert.equal(h.state.products.length, 4);
  assert.ok(
    h.state.skus.every((sku) =>
      PRODUCT_MERGES.some(
        (group) => group.keepId === sku.product_id,
      ),
    ),
  );
  assert.ok(h.calls.some((call) => call.sql === 'COMMIT'));
});

test('rolls back when a server-change log insert fails', async () => {
  const h = harness({ failLog: true });
  await assert.rejects(
    () =>
      applyPlan(
        h.pool,
        { id: 15, organization_id: 1 },
        buildPlan(snapshot()),
        () => 'event',
      ),
    /log failed/,
  );
  assert.ok(h.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!h.calls.some((call) => call.sql === 'COMMIT'));
});
