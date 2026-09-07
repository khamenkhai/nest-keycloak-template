'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  STORE_IDS,
  applyStorePlan,
  buildStorePlan,
  parseArgs,
  sortAndValidateCategories,
} = require('./sync-categories-to-stores');

const store = { id: 2, organization_id: 9 };
const categories = [
  {
    id: 1,
    name: 'Food',
    myanmar_name: null,
    myanmar_alias: null,
    description: null,
    status: 'ACTIVE',
    level: 1,
    parent_id: null,
  },
  {
    id: 2,
    name: 'Snacks',
    myanmar_name: null,
    myanmar_alias: null,
    description: 'Child',
    status: 'ACTIVE',
    level: 2,
    parent_id: 1,
  },
  {
    id: 3,
    name: 'Drinks',
    myanmar_name: null,
    myanmar_alias: null,
    description: null,
    status: 'INACTIVE',
    level: 1,
    parent_id: null,
  },
];

function localRow(overrides) {
  return {
    id: 'local-default',
    organization_id: 9,
    store_id: 2,
    name: 'Default',
    myanmar_name: null,
    myanmar_alias: null,
    description: null,
    level: 1,
    parent_id: null,
    master_category_id: null,
    outlet_category_id: 'outlet-preserved',
    status: 'ACTIVE',
    ...overrides,
  };
}

test('defaults to dry-run with fixed store scope', () => {
  assert.deepEqual(STORE_IDS, [2, 15, 18]);
  assert.deepEqual(parseArgs([]), {
    mode: 'dry-run',
    force: false,
    help: false,
  });
  assert.equal(parseArgs(['--apply', '--force']).mode, 'apply');
  assert.throws(() => parseArgs(['--dry-run', '--apply']));
});

test('sorts parents before children and rejects invalid hierarchies', () => {
  assert.deepEqual(
    sortAndValidateCategories([categories[1], categories[0]]).map(
      (row) => row.id,
    ),
    [1, 2],
  );
  assert.throws(
    () =>
      sortAndValidateCategories([
        { id: 1, parent_id: 2 },
        { id: 2, parent_id: 1 },
      ]),
    /cycle/,
  );
  assert.throws(
    () => sortAndValidateCategories([{ id: 1, parent_id: 99 }]),
    /missing parent/,
  );
});

test('plans exact updates, unique-name adoption, and creates', () => {
  const rows = [
    localRow({
      id: 'food-id',
      name: 'Old Food',
      master_category_id: '1',
    }),
    localRow({
      id: 'snacks-id',
      name: '  SNACKS  ',
      level: 2,
    }),
  ];
  const plan = buildStorePlan(categories, rows, store);
  assert.deepEqual(
    plan.assignments.map(({ kind, row }) => [kind, row?.id ?? null]),
    [
      ['exact', 'food-id'],
      ['adopt', 'snacks-id'],
      ['create', null],
    ],
  );
  assert.deepEqual(plan.counts, {
    create: 1,
    update: 1,
    adopt: 1,
    unchanged: 0,
  });
});

test('rejects ambiguous local name matches and duplicate claims', () => {
  assert.throws(
    () =>
      buildStorePlan(
        [categories[0]],
        [
          localRow({ id: 'a', name: 'Food' }),
          localRow({ id: 'b', name: ' food ' }),
        ],
        store,
      ),
    /multiple unlinked rows/,
  );
  assert.throws(
    () =>
      buildStorePlan(
        [categories[0], { ...categories[0], id: 4 }],
        [localRow({ id: 'a', name: 'Food' })],
        store,
      ),
    /matches more than one master category/,
  );
});

function createApplyHarness(initialRows, { failLog = false } = {}) {
  const calls = [];
  const rows = initialRows.map((row) => ({ ...row }));
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT \* FROM public\.selling_category_records/.test(sql)) {
        return { rows: rows.map((row) => ({ ...row })) };
      }
      if (/INSERT INTO public\.selling_category_records/.test(sql)) {
        const created = localRow({
          id: params[0],
          organization_id: params[1],
          store_id: params[2],
          name: params[3],
          myanmar_name: params[4],
          myanmar_alias: params[5],
          description: params[6],
          level: params[7],
          parent_id: params[8],
          master_category_id: params[9],
          status: params[10],
        });
        rows.push(created);
        return { rows: [created], rowCount: 1 };
      }
      if (/UPDATE public\.selling_category_records/.test(sql)) {
        const row = rows.find((candidate) => candidate.id === params[10]);
        Object.assign(row, {
          organization_id: params[0],
          store_id: params[1],
          name: params[2],
          myanmar_name: params[3],
          myanmar_alias: params[4],
          description: params[5],
          level: params[6],
          parent_id: params[7],
          master_category_id: params[8],
          status: params[9],
        });
        return { rows: [{ ...row }], rowCount: 1 };
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
    rows,
    pool: {
      async connect() {
        return client;
      },
    },
  };
}

test('applies hierarchy, preserves outlet linkage, and logs each mutation', async () => {
  const initialRows = [
    localRow({ id: 'food-id', name: 'Food', master_category_id: '1' }),
    localRow({ id: 'snacks-id', name: 'SNACKS', level: 2 }),
  ];
  const preflight = buildStorePlan(categories, initialRows, store);
  const harness = createApplyHarness(initialRows);
  let createdSequence = 100;
  const result = await applyStorePlan(
    harness.pool,
    store,
    categories,
    preflight,
    () => 'event-id',
    () => `created-${++createdSequence}`,
  );

  assert.deepEqual(result, {
    create: 1,
    update: 0,
    adopt: 1,
    unchanged: 1,
    logged: 2,
  });
  const snacks = harness.rows.find((row) => row.id === 'snacks-id');
  assert.equal(snacks.master_category_id, '2');
  assert.equal(snacks.parent_id, 'food-id');
  assert.equal(snacks.outlet_category_id, 'outlet-preserved');
  assert.equal(
    harness.calls.filter((call) => /server_change_logs/.test(call.sql)).length,
    2,
  );
  assert.ok(harness.calls.some((call) => call.sql === 'COMMIT'));
});

test('rolls back the store transaction when change logging fails', async () => {
  const preflight = buildStorePlan([categories[0]], [], store);
  const harness = createApplyHarness([], { failLog: true });
  await assert.rejects(
    () =>
      applyStorePlan(
        harness.pool,
        store,
        [categories[0]],
        preflight,
        () => 'event-id',
        () => 'created-id',
      ),
    /log failed/,
  );
  assert.ok(harness.calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!harness.calls.some((call) => call.sql === 'COMMIT'));
});
