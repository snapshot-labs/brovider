// Test setup file
// Add any global test configuration here

import { config } from 'dotenv';

// Load environment variables for tests
config({ path: '.env' });

// Mock nodes helper
jest.mock('../src/helpers/nodes', () => ({
  nodes: {
    '1': 'https://rpc.snapshot.org/1',
    '10': 'https://rpc.snapshot.org/10',
    '137': 'https://rpc.snapshot.org/137',
    '42161': 'https://rpc.snapshot.org/42161',
    '8453': 'https://rpc.snapshot.org/8453'
  }
}));

// Increase timeout for e2e tests
jest.setTimeout(10000);
