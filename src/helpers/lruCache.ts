type Entry = { value: string; size: number; expiresAt: number };

const ENTRY_TTL = 3600e3;
const MAX_VALUE_SIZE = 100e3;
const MAX_CACHE_SIZE = 16e6;
const ENTRY_OVERHEAD = 128;

// Insertion order doubles as recency order: a read re-inserts the entry it hit,
// so eviction from the front always drops the least recently used one.
const cache = new Map<string, Entry>();
let cacheSize = 0;

export function get(key: string): string | undefined {
  const entry = cache.get(key);
  if (entry === undefined) return undefined;

  cache.delete(key);
  if (entry.expiresAt <= Date.now()) {
    cacheSize -= entry.size;
    return undefined;
  }

  cache.set(key, entry);
  return entry.value;
}

export function set(key: string, value: string): void {
  if (cache.has(key) || value.length > MAX_VALUE_SIZE) return;

  const size = 2 * (value.length + key.length) + ENTRY_OVERHEAD;
  cache.set(key, { value, size, expiresAt: Date.now() + ENTRY_TTL });
  cacheSize += size;

  while (cacheSize > MAX_CACHE_SIZE && cache.size > 1) {
    const [oldest, entry] = cache.entries().next().value as [string, Entry];
    cache.delete(oldest);
    cacheSize -= entry.size;
  }
}
