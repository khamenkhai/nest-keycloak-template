import { randomBytes } from 'crypto';

export function generateSourceEventId(): string {
  const now = new Date();

  const day = now.getDate();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const dateStr = `${day}-${month}-${year}`;
  const randomId = randomBytes(5).toString('hex');

  return `${dateStr}-${randomId}`;
}
