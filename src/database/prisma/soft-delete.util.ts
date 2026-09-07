type PrismaWhere = Record<string, any>;

const ALL_DELETION_STATES = {
  OR: [{ isDeleted: false }, { isDeleted: true }],
};

/**
 * Adds a valid, explicit Prisma predicate that includes both active and
 * soft-deleted rows. The explicit predicate also opts out of the default
 * soft-delete scope installed by PrismaService.
 */
export function withDeletedRecords(where: PrismaWhere = {}): PrismaWhere {
  const existingAnd = where.AND;

  return {
    ...where,
    AND: [
      ...(existingAnd === undefined
        ? []
        : Array.isArray(existingAnd)
          ? existingAnd
          : [existingAnd]),
      ALL_DELETION_STATES,
    ],
  };
}

/** Detects an isDeleted condition at the current model's logical level. */
export function hasSoftDeleteCondition(where: unknown): boolean {
  if (!where || typeof where !== 'object') return false;
  if (Array.isArray(where)) return where.some(hasSoftDeleteCondition);

  const clause = where as PrismaWhere;
  if (Object.prototype.hasOwnProperty.call(clause, 'isDeleted')) return true;

  return ['AND', 'OR', 'NOT'].some((operator) =>
    hasSoftDeleteCondition(clause[operator]),
  );
}
