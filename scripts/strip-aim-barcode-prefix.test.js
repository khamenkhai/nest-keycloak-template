'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildAliasPlan,
  buildMasterPlan,
  buildOpenColumnPlan,
  buildStoreBarcodePlan,
  buildStoreUrl,
  buildUniqueColumnPlan,
  changedRows,
  findBarcodeDuplicates,
  parseArgs,
  stripAimPrefix,
  toCamelPayload,
} = require('./strip-aim-barcode-prefix');

test('stripAimPrefix removes a leading AIM symbology identifier', () => {
  assert.equal(stripAimPrefix(']C18836000152348'), '8836000152348');
  assert.equal(stripAimPrefix(']E0123'), '123');
  assert.equal(stripAimPrefix(']d2123'), '123');
  assert.equal(stripAimPrefix(']Q3123'), '123');
});

test('stripAimPrefix leaves anything that is not a full leading triple', () => {
  assert.equal(stripAimPrefix('8836000152348'), '8836000152348');
  assert.equal(stripAimPrefix(']X'), ']X');
  assert.equal(stripAimPrefix(']CC123'), ']CC123');
  assert.equal(stripAimPrefix('12]C134'), '12]C134');
  assert.equal(stripAimPrefix(''), '');
  assert.equal(stripAimPrefix(null), null);
  assert.equal(stripAimPrefix(undefined), undefined);
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

test('toCamelPayload camel-cases the snake_case row', () => {
  assert.deepEqual(
    toCamelPayload({ id: 'a', master_barcode: '1', photo_url: null }),
    {
      id: 'a',
      masterBarcode: '1',
      photoUrl: null,
    },
  );
});

test('changedRows keeps before and after for rows that actually change', () => {
  assert.deepEqual(
    changedRows(
      [
        { id: 1, barcode: ']C1123' },
        { id: 2, barcode: '456' },
        { id: 3, barcode: null },
      ],
      'barcode',
    ),
    [{ id: 1, before: ']C1123', after: '123' }],
  );
});

test('findBarcodeDuplicates ignores nulls instead of treating them as equal', () => {
  assert.deepEqual(
    findBarcodeDuplicates(
      [
        { id: 'a', outlet_barcode: null },
        { id: 'b', outlet_barcode: null },
        { id: 'c', outlet_barcode: ']C1987' },
      ],
      'outlet_barcode',
    ),
    [],
  );

  assert.deepEqual(
    findBarcodeDuplicates(
      [
        { id: 'a', barcode: ']C1987' },
        { id: 'b', barcode: '987' },
      ],
      'barcode',
    ),
    [
      {
        normalizedBarcode: '987',
        entries: [
          { id: 'a', barcode: ']C1987' },
          { id: 'b', barcode: '987' },
        ],
      },
    ],
  );
});

test('buildUniqueColumnPlan skips a change that would collide', () => {
  const plan = buildUniqueColumnPlan(
    [
      { id: 1, barcode: ']C1123' },
      { id: 2, barcode: '123' },
      { id: 3, barcode: ']E0456' },
    ],
    'sku_masters',
    'barcode',
  );

  assert.deepEqual(plan.changes, [{ id: 3, before: ']E0456', after: '456' }]);
  assert.deepEqual(plan.skippedDuplicateChanges, [
    {
      table: 'sku_masters',
      column: 'barcode',
      id: '1',
      normalizedBarcode: '123',
      before: ']C1123',
      after: '123',
    },
  ]);
  assert.equal(plan.duplicates.length, 1);
});

test('buildOpenColumnPlan reports duplicates but never blocks a change', () => {
  const plan = buildOpenColumnPlan(
    [
      { id: 1, barcode: ']C1123' },
      { id: 2, barcode: '123' },
    ],
    'non_cannopy_skus',
    'barcode',
  );

  assert.deepEqual(plan.changes, [{ id: 1, before: ']C1123', after: '123' }]);
  assert.deepEqual(plan.skippedDuplicateChanges, []);
  assert.equal(plan.duplicates.length, 1);
});

test('buildAliasPlan strips both copies and skips unique collisions', () => {
  const plan = buildAliasPlan([
    { id: 1, barcode: ']C1123', normalized_barcode: ']C1123' },
    { id: 2, barcode: '123', normalized_barcode: '123' },
    { id: 3, barcode: ']E0456', normalized_barcode: ']E0456' },
  ]);

  assert.deepEqual(plan.changes, [
    {
      id: 3,
      before: ']E0456',
      after: '456',
      beforeNormalized: ']E0456',
      afterNormalized: '456',
    },
  ]);
  assert.deepEqual(plan.skippedDuplicateChanges, [
    {
      table: 'non_cannopy_sku_barcode_aliases',
      column: 'normalized_barcode',
      id: '1',
      normalizedBarcode: '123',
      before: ']C1123',
      after: '123',
    },
  ]);
});

test('buildMasterPlan covers all four tables and forwards blocked barcodes', () => {
  const plan = buildMasterPlan({
    skuMasters: [
      { id: 1, barcode: ']C1111' },
      { id: 2, barcode: ']C1222' },
      { id: 3, barcode: '222' },
    ],
    nonCannopySkus: [{ id: 9, barcode: ']E0333' }],
    aliases: [{ id: 7, barcode: ']d2444', normalized_barcode: ']d2444' }],
    occurrences: [{ id: 'occ-1', outlet_barcode: ']Q3555' }],
  });

  assert.deepEqual(plan.skuMasterChanges, [
    { id: 1, before: ']C1111', after: '111' },
  ]);
  assert.deepEqual(plan.blockedMasterBarcodes, ['222']);
  assert.deepEqual(plan.nonCannopySkuChanges, [
    { id: 9, before: ']E0333', after: '333' },
  ]);
  assert.equal(plan.aliasChanges.length, 1);
  assert.equal(plan.aliasChanges[0].afterNormalized, '444');
  assert.deepEqual(plan.occurrenceChanges, [
    { id: 'occ-1', before: ']Q3555', after: '555' },
  ]);
  assert.equal(plan.skippedDuplicateChanges.length, 1);
});

test('two prefixed rows with null outlet barcodes do not block each other', () => {
  // The regression the ad-hoc SQL hit: `IS NOT DISTINCT FROM` treated two NULL
  // outlet_barcodes as equal, so every affected row blocked every other one.
  const plan = buildStoreBarcodePlan(
    [
      { id: 'a', master_barcode: ']C12031156132133', outlet_barcode: null },
      { id: 'b', master_barcode: ']C18836000152348', outlet_barcode: null },
    ],
    [],
  );

  assert.equal(plan.sellingChanges.length, 2);
  assert.equal(plan.sellingChanges[0].nextMasterBarcode, '2031156132133');
  assert.equal(plan.sellingChanges[1].nextMasterBarcode, '8836000152348');
  assert.deepEqual(plan.skippedDuplicateChanges, []);
});

test('buildStoreBarcodePlan honours barcodes the master SKU could not take', () => {
  const plan = buildStoreBarcodePlan(
    [{ id: 'a', master_barcode: ']C1222', outlet_barcode: ']E0777' }],
    [],
    ['222'],
  );

  assert.equal(plan.sellingChanges.length, 1);
  // master_barcode held back, outlet_barcode still cleaned.
  assert.equal(plan.sellingChanges[0].nextMasterBarcode, ']C1222');
  assert.equal(plan.sellingChanges[0].nextOutletBarcode, '777');
  assert.deepEqual(plan.skippedDuplicateChanges, [
    {
      table: 'selling_sku_records',
      column: 'master_barcode',
      id: 'a',
      normalizedBarcode: '222',
      before: ']C1222',
      after: '222',
    },
  ]);
});

test('buildStoreBarcodePlan skips outlet SKU changes that would collide', () => {
  const plan = buildStoreBarcodePlan(
    [],
    [
      { id: 'o1', barcode: ']C1999' },
      { id: 'o2', barcode: '999' },
    ],
  );

  assert.deepEqual(plan.outletChanges, []);
  assert.equal(plan.skippedDuplicateChanges.length, 1);
  assert.equal(plan.skippedDuplicateChanges[0].table, 'sku_outlet_records');
});
