module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/e2e/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  collectCoverageFrom: ['./src/**'],
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  coveragePathIgnorePatterns: ['/node_modules/', '<rootDir>/dist/', '<rootDir>/tests'],
  globalSetup: '<rootDir>/tests/setup.ts',
  testTimeout: 10000,
  setupFilesAfterEnv: ['<rootDir>/tests/env-setup.ts']
};
