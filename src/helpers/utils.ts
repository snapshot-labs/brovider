import { createHash } from 'crypto';

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function sha256(str: string): string {
  return createHash('sha256').update(str).digest('hex');
}
