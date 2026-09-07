'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BRAND_MERGES,
  applyPlan,
  buildPlan,
  parseArgs,
} = require('./merge-store-15-duplicate-brands');

function brand(id, masterId) {
  return {
    id,
    organization_id: 4,
    store_id: 15,
    name: `Brand ${masterId}`,
    master_brand_id: masterId,
    outlet_brand_id: `outlet-${id}`,
    status: 'ACTIVE',
  };
}

function snapshot() {
  const brands = BRAND_MERGES.flatMap((group) => [
    brand(group.keepId, group.masterId),
    ...group.mergeIds.map((id) => brand(id, group.masterId)),
  ]);
  const skus = [];
  for (const [groupIndex, group] of BRAND_MERGES.entries()) {
    for (const [index, id] of group.mergeIds.entries()) {
      const count = group.masterId === '240' && index === 0 ? 4 : group.masterId === '240' ? 2 : 1;
      for (let skuIndex = 0; skuIndex < count; skuIndex++)
        skus.push({
          id: `sku-${groupIndex}-${index}-${skuIndex}`,
          organization_id: 4,
          store_id: 15,
          brand_id: id,
          name: 'SKU',
          price: 100,
          stock_qty: 5,
        });
    }
  }
  return { brands, skus };
}

test('parses dry-run and apply modes', () => {
  assert.equal(parseArgs([]).mode, 'dry-run');
  assert.deepEqual(parseArgs(['--apply', '--force']), {
    mode: 'apply',
    force: true,
    help: false,
  });
  assert.throws(() => parseArgs(['--dry-run', '--force']), /requires --apply/);
});

test('builds three groups, four deletes, and eight SKU link updates', () => {
  assert.deepEqual(buildPlan(snapshot()).counts, {
    groups: 3,
    brandsToDelete: 4,
    skusToUpdate: 8,
  });
});

test('rejects an unexpected duplicate for a targeted master brand', () => {
  const data = snapshot();
  data.brands.push(brand('unexpected', '148'));
  assert.throws(() => buildPlan(data), /unexpected duplicate/);
});

function harness({ failLog = false } = {}) {
  const state = snapshot();
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT \* FROM public\.selling_brand_records/.test(sql))
        return { rows: state.brands };
      if (/SELECT \* FROM public\.selling_sku_records/.test(sql))
        return { rows: state.skus };
      if (/UPDATE public\.selling_sku_records/.test(sql)) {
        const row = state.skus.find((item) => item.id === params[1]);
        row.brand_id = params[0];
        return { rows: [{ ...row }], rowCount: 1 };
      }
      if (/DELETE FROM public\.selling_brand_records/.test(sql)) {
        const index = state.brands.findIndex((item) => item.id === params[0]);
        const [row] = state.brands.splice(index, 1);
        return { rows: [row], rowCount: 1 };
      }
      if (/INSERT INTO public\.server_change_logs/.test(sql) && failLog)
        throw new Error('log failed');
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return { state, calls, pool: { async connect() { return client; } } };
}

test('updates SKU links, deletes duplicates, and logs in one transaction', async () => {
  const h = harness();
  let event = 0;
  const result = await applyPlan(
    h.pool,
    { id: 15, organization_id: 4 },
    buildPlan(snapshot()),
    () => `event-${++event}`,
  );
  assert.equal(result.logs, 12);
  assert.equal(h.state.brands.length, 3);
  assert.ok(
    h.state.skus.every((sku) =>
      BRAND_MERGES.some((group) => group.keepId === sku.brand_id),
    ),
  );
  assert.ok(h.calls.some((call) => call.sql === 'COMMIT'));
});

test('rolls back when change logging fails', async () => {
  const h = harness({ failLog: true });
  await assert.rejects(
    () =>
      applyPlan(
        h.pool,
        { id: 15, organization_id: 4 },
        buildPlan(snapshot()),
        () => 'event',
      ),
    /log failed/,
  );
  assert.ok(h.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!h.calls.some((call) => call.sql === 'COMMIT'));
});
