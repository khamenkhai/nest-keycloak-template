export function normalizeBarcode(value: string): string;
export function normalizeBarcode<T extends null | undefined>(value: T): T;
export function normalizeBarcode(value: unknown): unknown;
export function normalizeBarcode(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/\s+/g, '') : value;
}
