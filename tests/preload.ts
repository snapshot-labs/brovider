import { readFileSync } from 'fs';
import { join } from 'path';
import { afterAll, beforeAll } from 'bun:test';
import { config } from 'dotenv';

// Root .env first, then test overrides.
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '.env.test'), override: true });

const NODES = [
  { network: '1', url: 'https://ethereum-rpc.publicnode.com', main: 1 },
  { network: '10', url: 'https://mainnet.optimism.io', main: 1 },
  { network: '56', url: 'https://bsc-dataseed.binance.org', main: 1 },
  { network: '137', url: 'https://polygon-rpc.com', main: 1 },
  { network: '8453', url: 'https://mainnet.base.org', main: 1 },
  { network: '42161', url: 'https://arb1.arbitrum.io/rpc', main: 1 },
  { network: '11001100', url: 'invalid-url', main: 1 }
];

const db = (await import('../src/helpers/db')).default;

const { db_name: database } = await db.one('SELECT current_database() AS db_name');
if (database !== 'brovider_test') {
  throw new Error(`Expected test database 'brovider_test', but connected to '${database}'`);
}

await db.none('DROP TABLE IF EXISTS nodes CASCADE');
await db.none('DROP TABLE IF EXISTS providers CASCADE');
await db.none(readFileSync(join(__dirname, '../src/helpers/schema.sql'), 'utf8'));

for (const node of NODES) {
  await db.none(
    'INSERT INTO nodes (network, url, main) VALUES ($1, $2, $3) ON CONFLICT (url) DO NOTHING',
    [node.network, node.url, node.main]
  );
}

// The node list refreshes on a background loop the app owns. Start it once for
// the whole run and let it drain data before the first test reads `nodes`.
beforeAll(async () => {
  const { run } = await import('../src/helpers/nodes');
  run();
  await new Promise(resolve => setTimeout(resolve, 2000));
});

afterAll(async () => {
  const { stop } = await import('../src/helpers/nodes');
  // The loop only observes the flag after its current sleep, so awaiting it
  // would stall teardown for a full refresh interval.
  stop();
});
