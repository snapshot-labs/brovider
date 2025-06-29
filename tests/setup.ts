// Test setup file
// Add any global test configuration here

import { readFileSync } from 'fs';
import path from 'path';
import { config } from 'dotenv';

// Load environment variables for tests
config({ path: 'tests/.env.test' });
config({ path: 'tests/.env.local.test' });

// Insert test data into database
async function insertTestData() {
  // Import db connection after env is loaded
  const db = (await import('../src/helpers/db')).default;
  try {
    // Clear existing data
    await db.none('TRUNCATE TABLE nodes, graph CASCADE');

    // Insert nodes data
    const nodeData = [
      { network: '1', url: 'https://eth.llamarpc.com', main: 1 },
      { network: '10', url: 'https://mainnet.optimism.io', main: 1 },
      { network: '56', url: 'https://bsc-dataseed.binance.org', main: 1 },
      { network: '137', url: 'https://polygon-rpc.com', main: 1 },
      { network: '8453', url: 'https://mainnet.base.org', main: 1 },
      { network: '42161', url: 'https://arb1.arbitrum.io/rpc', main: 1 }
    ];

    for (const node of nodeData) {
      await db.none(
        'INSERT INTO nodes (network, url, main) VALUES ($1, $2, $3) ON CONFLICT (url) DO NOTHING',
        [node.network, node.url, node.main]
      );
    }

    // Insert graph data
    const graphData = [
      {
        network: 'mainnet',
        url: `https://gateway.network.thegraph.com/api/${process.env.NON_RESTRICTED_SUBGRAPH_KEY}/subgraphs/id/`,
        type: 'subgraph'
      },
      {
        network: 'arbitrum',
        url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.NON_RESTRICTED_SUBGRAPH_KEY}/subgraphs/id/`,
        type: 'subgraph'
      },
      {
        network: '1',
        url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.NON_RESTRICTED_SUBGRAPH_KEY}/subgraphs/id/4YgtogVaqoM8CErHWDK8mKQ825BcVdKB8vBYmb4avAQo`,
        type: 'delegation'
      },
      {
        network: '10',
        url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.NON_RESTRICTED_SUBGRAPH_KEY}/subgraphs/id/CAsVTyvLA6vnvDX9zgXifmi3wFM8GYeNHvRpxsABvbYL`,
        type: 'delegation'
      },
      {
        network: '56',
        url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.NON_RESTRICTED_SUBGRAPH_KEY}/subgraphs/id/GuTMtMnx7zukaA1hiHB1uz6FR45gpZX3GtiEN7Cyitjd`,
        type: 'delegation'
      },
      {
        network: '100',
        url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.NON_RESTRICTED_SUBGRAPH_KEY}/subgraphs/id/2XuuZyGrxw972keXKfeHQW7yaGqVa7dyoghkgdGMdC6Az`,
        type: 'delegation'
      },
      {
        network: '137',
        url: `https://gateway-arbitrum.network.thegraph.com/api/${process.env.NON_RESTRICTED_SUBGRAPH_KEY}/subgraphs/id/7ynRuH2PPw975dtHkthpZCyQGKBCrxFA8VsYD3KE631B`,
        type: 'delegation'
      }
    ];

    for (const graph of graphData) {
      await db.none(
        'INSERT INTO graph (network, url, type) VALUES ($1, $2, $3) ON CONFLICT (network, url) DO NOTHING',
        [graph.network, graph.url, graph.type]
      );
    }

    console.log('Test data inserted successfully');
  } catch (error) {
    console.error('Error inserting test data:', error);
    throw error;
  }
}

// Setup test database
async function setupTestDatabase() {
  // Import db connection after env is loaded
  const db = (await import('../src/helpers/db')).default;

  try {
    // Verify we're using the test database
    const currentDb = await db.one('SELECT current_database() AS db_name');
    if (currentDb.db_name !== 'brovider_test') {
      throw new Error(
        `Expected test database 'brovider_test', but connected to '${currentDb.db_name}'`
      );
    }
    // Drop and recreate tables
    await db.none('DROP TABLE IF EXISTS graph CASCADE');
    await db.none('DROP TABLE IF EXISTS nodes CASCADE');
    await db.none('DROP TABLE IF EXISTS providers CASCADE');

    // Apply schema
    const schemaPath = path.join(__dirname, '../src/helpers/schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    await db.none(schema);
    console.log('Test database schema recreated');

    // Insert test data
    await insertTestData();
  } catch (error) {
    console.error('Error setting up test database:', error);
    throw error;
  }
}

// Run database setup - use Jest's global setup hook
export default async function globalSetup() {
  await setupTestDatabase();
  console.log('Database setup completed for tests');
}
