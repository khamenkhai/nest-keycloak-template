import { hasSoftDeleteCondition, withDeletedRecords } from './soft-delete.util';

describe('soft-delete utilities', () => {
  it('builds a valid predicate that includes both deletion states', () => {
    expect(withDeletedRecords({ productCode: 'LB' })).toEqual({
      productCode: 'LB',
      AND: [{ OR: [{ isDeleted: false }, { isDeleted: true }] }],
    });
  });

  it('preserves existing AND clauses', () => {
    expect(withDeletedRecords({ AND: [{ status: 'ACTIVE' }] })).toEqual({
      AND: [
        { status: 'ACTIVE' },
        { OR: [{ isDeleted: false }, { isDeleted: true }] },
      ],
    });
  });

  it('finds explicit deletion filters inside logical operators', () => {
    expect(
      hasSoftDeleteCondition({
        AND: [{ productCode: 'LB' }, { OR: [{ isDeleted: false }] }],
      }),
    ).toBe(true);
  });

  it('does not mistake a related model filter for a root deletion filter', () => {
    expect(hasSoftDeleteCondition({ brand: { isDeleted: false } })).toBe(false);
  });
});
