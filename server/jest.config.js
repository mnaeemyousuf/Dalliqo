/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleNameMapper: { '^@recrm/shared$': '<rootDir>/../shared/src/index.ts' },
  globalSetup: '<rootDir>/tests/support/globalSetup.ts',
  globalTeardown: '<rootDir>/tests/support/globalTeardown.ts',
  setupFiles: ['<rootDir>/tests/support/env.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/support/db.ts'],
  testTimeout: 30000,
};
