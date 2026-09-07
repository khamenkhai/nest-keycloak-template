export function normalizeMyanmarPhone(phone: string): string {
  const trimmed = phone?.trim();

  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('09')) {
    return `959${trimmed.slice(2)}`;
  }

  if (trimmed.startsWith('+')) {
    return `959${trimmed.slice(4)}`;
  }

  if (trimmed.startsWith('959')) {
    return `959${trimmed.slice(3)}`;
  }

  return trimmed;
}
