// Jest configuration for ordr.fm visualization
module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Root directory for tests
  rootDir: '.',
  
  // Test file patterns
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/integration/**/*.test.js'
  ],
  
  // Coverage settings
  collectCoverage: true,
  collectCoverageFrom: [
    'server.js',
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/__mocks__/**',
    '!node_modules/**'
  ],
  
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  // Test timeout
  testTimeout: 10000,
  
  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
  
  // Verbose output
  verbose: true,
  
  // Transform files
  transform: {},
  
  // Module paths
  modulePaths: ['<rootDir>'],
  
  // Global setup/teardown (Jest-specific, not Playwright)
  // globalSetup: '<rootDir>/tests/jest-global-setup.js',
  // globalTeardown: '<rootDir>/tests/jest-global-teardown.js'
};