type AnyRecord = Record<string, unknown>;

const DEFAULT_IGNORED_KEYS = new Set([
  'createdAt',
  'createdBy',
  'createdByAdmin',
  'updatedAt',
  'updatedBy',
  'updatedByAdmin',
]);

function normalizeForCompare(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeForCompare);
  if (value && typeof value === 'object') {
    const record = value as AnyRecord;
    const sortedKeys = Object.keys(record).sort();
    const out: AnyRecord = {};
    for (const key of sortedKeys) {
      out[key] = normalizeForCompare(record[key]);
    }
    return out;
  }
  return value;
}

function stripIgnoredKeys(input: unknown, ignoredKeys: Set<string>): unknown {
  if (Array.isArray(input)) {
    return input.map((v) => stripIgnoredKeys(v, ignoredKeys));
  }

  if (!input || typeof input !== 'object') return input;

  const record = input as AnyRecord;
  const out: AnyRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (ignoredKeys.has(key)) continue;
    out[key] = stripIgnoredKeys(value, ignoredKeys);
  }
  return out;
}

export function shouldSendDataSyncLog(params: {
  before: unknown;
  after: unknown;
  ignoreKeys?: string[];
}): boolean {
  const ignored = new Set(DEFAULT_IGNORED_KEYS);
  for (const key of params.ignoreKeys ?? []) ignored.add(key);

  const beforeStripped = normalizeForCompare(
    stripIgnoredKeys(params.before, ignored),
  );
  const afterStripped = normalizeForCompare(
    stripIgnoredKeys(params.after, ignored),
  );

  return JSON.stringify(beforeStripped) !== JSON.stringify(afterStripped);
}
