'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
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
} = require('./normalize-barcode-whitespace');

test('normalizeBarcode removes all JavaScript whitespace', () => {
  assert.equal(normalizeBarcode(' 12 3\t4\n5\u00a0'), '12345');
  assert.equal(normalizeBarcode('12345'), '12345');
  assert.equal(normalizeBarcode(null), null);
});

test('parseArgs defaults to dry-run and accepts store filters', () => {
  assert.deepEqual(parseArgs([]), {
    mode: 'dry-run',
    storeIds: [],
    logFile: null,
    help: false,
  });
  assert.deepEqual(parseArgs(['--apply', '--store', '2', '--store=15']), {
    mode: 'apply',
    storeIds: [2, 15],
    logFile: null,
    help: false,
  });
  assert.throws(() => parseArgs(['--dry-run', '--apply']), /only one mode/);
  assert.throws(() => parseArgs(['--store', 'nope']), /positive integer/);
});

test('buildStoreUrl selects the requested store database', () => {
  assert.equal(
    buildStoreUrl('postgresql://user:pass@localhost:5432/postgres', 'shop', 7),
    'postgresql://user:pass@localhost:5432/shop_7',
  );
});

test('change planners retain before and after barcode values', () => {
  assert.deepEqual(
    changedMasterRows([
      { id: 1, barcode: ' 12 3 ' },
      { id: 2, barcode: '456' },
    ]),
    [{ id: 1, before: ' 12 3 ', after: '123' }],
  );

  const selling = changedSellingRows([
    {
      id: 'selling-1',
      master_barcode: ' 12 3 ',
      outlet_barcode: '4\t56',
    },
  ]);
  assert.equal(selling[0].nextMasterBarcode, '123');
  assert.equal(selling[0].nextOutletBarcode, '456');

  const outlet = changedOutletRows([{ id: 'outlet-1', barcode: ' 7 8 9 ' }]);
  assert.equal(outlet[0].nextBarcode, '789');
});

test('findMasterCollisions detects normalized unique-key conflicts', () => {
  assert.deepEqual(
    findMasterCollisions([
      { id: 1, barcode: '12 3' },
      { id: 2, barcode: '123' },
      { id: 3, barcode: '456' },
    ]),
    [
      {
        normalizedBarcode: '123',
        entries: [
          { id: '1', barcode: '12 3' },
          { id: '2', barcode: '123' },
        ],
      },
    ],
  );
});

test('findBarcodeDuplicates checks the selected barcode column', () => {
  assert.deepEqual(
    findBarcodeDuplicates(
      [
        { id: 'a', outlet_barcode: ' 98 7 ' },
        { id: 'b', outlet_barcode: '987' },
        { id: 'c', outlet_barcode: null },
      ],
      'outlet_barcode',
    ),
    [
      {
        normalizedBarcode: '987',
        entries: [
          { id: 'a', barcode: ' 98 7 ' },
          { id: 'b', barcode: '987' },
        ],
      },
    ],
  );
});

test('buildPrimaryPlan skips duplicate changes and keeps unique changes', () => {
  const plan = buildPrimaryPlan([
    { id: 1, barcode: '12 3' },
    { id: 2, barcode: '123' },
    { id: 3, barcode: ' 456 ' },
  ]);

  assert.deepEqual(plan.changes, [{ id: 3, before: ' 456 ', after: '456' }]);
  assert.deepEqual(plan.skippedDuplicateChanges, [
    {
      table: 'sku_masters',
      column: 'barcode',
      id: '1',
      normalizedBarcode: '123',
      before: '12 3',
      after: '123',
    },
  ]);
});

test('buildStoreBarcodePlan skips duplicate fields but keeps unique fields', () => {
  const plan = buildStoreBarcodePlan(
    [
      {
        id: 'a',
        master_barcode: '12 3',
        outlet_barcode: ' 456 ',
      },
      { id: 'b', master_barcode: '123', outlet_barcode: null },
    ],
    [
      { id: 'c', barcode: '7 89' },
      { id: 'd', barcode: '789' },
    ],
  );

  assert.equal(plan.sellingChanges.length, 1);
  assert.equal(plan.sellingChanges[0].nextMasterBarcode, '12 3');
  assert.equal(plan.sellingChanges[0].nextOutletBarcode, '456');
  assert.equal(plan.outletChanges.length, 0);
  assert.deepEqual(
    plan.skippedDuplicateChanges.map((change) => [
      change.table,
      change.column,
      change.id,
    ]),
    [
      ['selling_sku_records', 'master_barcode', 'a'],
      ['sku_outlet_records', 'barcode', 'c'],
    ],
  );
});

test('buildStoreBarcodePlan skips master barcodes blocked by primary collisions', () => {
  const plan = buildStoreBarcodePlan(
    [{ id: 'a', master_barcode: '12 3', outlet_barcode: null }],
    [],
    ['123'],
  );

  assert.equal(plan.sellingChanges.length, 0);
  assert.deepEqual(plan.skippedDuplicateChanges, [
    {
      table: 'selling_sku_records',
      column: 'master_barcode',
      id: 'a',
      normalizedBarcode: '123',
      before: '12 3',
      after: '123',
    },
  ]);
});
