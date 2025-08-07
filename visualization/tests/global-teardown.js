// Global teardown for Playwright tests

async function globalTeardown(config) {
  console.log('🧹 Starting global test teardown...');
  
  // Cleanup any test artifacts
  // This could include clearing test databases, stopping processes, etc.
  
  console.log('✅ Global teardown completed');
}

module.exports = globalTeardown;