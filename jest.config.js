/** @type {import('jest').Config} */
export default {
  // Use Node environment for server-side scripts
  testEnvironment: 'node',
  
  // Test file locations
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],
  
  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'scripts/**/*.js',
    '!scripts/**/*.test.js',
    '!scripts/**/node_modules/**'
  ],
  coverageReporters: ['text', 'lcov', 'html'],
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  // Module transformations for ES modules
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(sharp)/)'
  ],
  
  // Timeout for async operations
  testTimeout: 30000,
  
  // Verbose output
  verbose: true
};
