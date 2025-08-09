// Jest test setup for ordr.fm visualization
const { beforeAll, afterAll, beforeEach, afterEach } = require('@jest/globals');

// Global test configuration
beforeAll(() => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-key-for-jest-only';
  process.env.METADATA_DB = ':memory:';  // Use in-memory SQLite for tests
  process.env.STATE_DB = ':memory:';
  process.env.ORDRFM_DB = ':memory:';
  
  // Disable console output during tests (unless debugging)
  if (!process.env.DEBUG_TESTS) {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  }
});

afterAll(() => {
  // Restore console methods
  if (console.log.mockRestore) {
    console.log.mockRestore();
  }
  if (console.warn.mockRestore) {
    console.warn.mockRestore();
  }
  if (console.error.mockRestore) {
    console.error.mockRestore();
  }
});

beforeEach(() => {
  // Clear any module cache before each test
  jest.clearAllMocks();
});

afterEach(() => {
  // Clean up after each test
  jest.restoreAllMocks();
});