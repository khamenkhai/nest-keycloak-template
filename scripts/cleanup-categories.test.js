'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CATEGORY_TARGET_SQL,
  STORE_IDS,
  buildStoreUrl,
  createSyncEntries,
  parseArgs,
  sendGrpcLogs,
  toPayload,
  updateStore,
} = require('./cleanup-categories');

test('defaults to dry-run and requires an explicit apply mode', () => {
  assert.deepEqual(parseArgs([]), {
    mode: 'dry-run',
    force: false,
    manifestPath: null,
    help: false,
  });
  assert.equal(parseArgs(['--apply', '--force']).mode, 'apply');
  assert.throws(() => parseArgs(['--apply', '--resume', 'file.json']));
  assert.throws(() => parseArgs(['--dry-run', '--apply']));
  assert.throws(() => parseArgs(['--force']));
});

test('fixes store scope and category selection semantics', () => {
  assert.deepEqual(STORE_IDS, [2, 15, 18]);
  assert.match(CATEGORY_TARGET_SQL, /name NOT ILIKE \$1/);
  assert.match(CATEGORY_TARGET_SQL, /WITH RECURSIVE/);
  assert.match(CATEGORY_TARGET_SQL, /child\.parent_id = parent\.id/);
});

test('builds a store URL without changing credentials or query parameters', () => {
  assert.equal(
    buildStoreUrl(
      'postgresql://user:pass@db:5432/placeholder?sslmode=require',
      'pos_store',
      15,
    ),
    'postgresql://user:pass@db:5432/pos_store_15?sslmode=require',
  );
});

test('converts database rows to the camel-case sync payload shape', () => {
  const payload = toPayload({
    id: 7,
    myanmar_name: 'အစားအစာ',
    parent_id: null,
    cleanup_depth: 3,
  });
  assert.deepEqual(payload, {
    id: 7,
    myanmarName: 'အစားအစာ',
    parentId: null,
  });
});

test('creates deterministic Category and SkuCategory DELETE entries', () => {
  let sequence = 0;
  const entries = createSyncEntries(
    [{ id: 10, name: 'Old' }],
    [{ id: 20, sku_id: 30, category_id: 10 }],
    () => `event-${++sequence}`,
  );
  assert.deepEqual(
    entries.map(({ entityType, entityId, operation, sourceEventId }) => ({
      entityType,
      entityId,
      operation,
      sourceEventId,
    })),
    [
      {
        entityType: 'SkuCategory',
        entityId: '20',
        operation: 'DELETE',
        sourceEventId: 'event-1',
      },
      {
        entityType: 'Category',
        entityId: '10',
        operation: 'DELETE',
        sourceEventId: 'event-2',
      },
    ],
  );
  assert.deepEqual(JSON.parse(entries[0].payloadJson), {
    id: 20,
    skuId: 30,
    categoryId: 10,
  });
});

function fakeStorePool({ failLog = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/UPDATE public\.selling_category_records/.test(sql)) {
        return {
          rows: [
            {
              id: 'selling-category-1',
              organization_id: 9,
              store_id: 2,
              master_category_id: null,
              updated_at: new Date('2026-08-06T00:00:00.000Z'),
            },
          ],
          rowCount: 1,
        };
      }
      if (/INSERT INTO public\.server_change_logs/.test(sql) && failLog) {
        throw new Error('log failed');
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      calls.push({ sql: 'RELEASE' });
    },
  };
  return {
    calls,
    pool: {
      async connect() {
        return client;
      },
    },
  };
}

test('updates store references and writes their logs in one transaction', async () => {
  const harness = fakeStorePool();
  const rows = await updateStore(harness.pool, 2, [10], () => 'event-store');
  assert.equal(rows.length, 1);
  assert.deepEqual(
    harness.calls.map((call) =>
      call.sql.trim().split(/\s+/).slice(0, 3).join(' '),
    ),
    [
      'BEGIN',
      'UPDATE public.selling_category_records SET',
      'INSERT INTO public.server_change_logs',
      'COMMIT',
      'RELEASE',
    ],
  );
  const insert = harness.calls.find((call) => /INSERT INTO/.test(call.sql));
  assert.equal(insert.params[1], 2);
  assert.equal(insert.params[2], 'SellingCategoryRecord');
  assert.equal(insert.params[4], 'UPSERT');
  assert.equal(JSON.parse(insert.params[6]).masterCategoryId, null);
});

test('rolls back a store update when its server-change log fails', async () => {
  const harness = fakeStorePool({ failLog: true });
  await assert.rejects(() => updateStore(harness.pool, 2, [10]), /log failed/);
  assert.ok(harness.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!harness.calls.some((call) => call.sql === 'COMMIT'));
});

test('deletes SKU links before categories and categories deepest-first', async () => {
  const calls = [];
  const snapshot = {
    categoryIds: [10, 11],
    categories: [
      { id: 11, name: 'Child-New', parent_id: 10, cleanup_depth: 1 },
      { id: 10, name: 'Parent', parent_id: null, cleanup_depth: 0 },
    ],
    skuCategories: [{ id: 20, sku_id: 30, category_id: 11 }],
  };
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT \* FROM public\.categories/.test(sql)) {
        return {
          rows: snapshot.categories.map(({ cleanup_depth: _, ...row }) => row),
        };
      }
      if (/SELECT \* FROM public\.sku_categories/.test(sql)) {
        return { rows: snapshot.skuCategories };
      }
      if (/DELETE FROM public\.sku_categories/.test(sql)) {
        return { rows: [{ id: 20 }], rowCount: 1 };
      }
      if (/DELETE FROM public\.categories/.test(sql)) {
        return {
          rows: params[0].map((id) => ({ id })),
          rowCount: params[0].length,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
  };

  const result = await require('./cleanup-categories').applyPrimaryCleanup(
    pool,
    snapshot,
  );

  assert.deepEqual(result, { deletedSkuCategories: 1, deletedCategories: 2 });
  const deletes = calls.filter((call) => /^DELETE FROM/.test(call.sql.trim()));
  assert.match(deletes[0].sql, /sku_categories/);
  assert.deepEqual(deletes[1].params[0], [11]);
  assert.deepEqual(deletes[2].params[0], [10]);
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));
});

test('resumes gRPC batching from the saved entry index', async () => {
  const received = [];
  const progress = [];
  const client = {
    logChanges(request, _metadata, callback) {
      received.push(request.entries.map((entry) => entry.entityId));
      callback(null, { success: true });
    },
  };
  const entries = Array.from({ length: 520 }, (_, id) => ({
    entityId: String(id),
  }));
  const nextIndex = await sendGrpcLogs(
    client,
    'secret',
    entries,
    10,
    async (index) => {
      progress.push(index);
    },
  );
  assert.equal(nextIndex, 520);
  assert.equal(received[0][0], '10');
  assert.equal(received.length, 51);
  assert.ok(received.every((batch) => batch.length === 10));
  assert.equal(progress[0], 20);
  assert.equal(progress.at(-1), 520);
});
