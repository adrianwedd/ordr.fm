// Jest setup file for ordr.fm server tests

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.METADATA_DB = ':memory:';
process.env.STATE_DB = ':memory:';

// Suppress console logs during tests unless DEBUG is set
if (!process.env.DEBUG) {
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
}

// Global test timeout (30 seconds)
jest.setTimeout(30000);

// Clean up after each test
afterEach(() => {
  // Clear any mocks
  jest.clearAllMocks();
});

// Global teardown
afterAll((done) => {
  // Allow a moment for any async operations to complete
  setTimeout(done, 100);
});