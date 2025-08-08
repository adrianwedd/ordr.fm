// Global teardown for Playwright tests
async function globalTeardown(config) {
  console.log("🧹 Starting global test teardown...");
  console.log("✅ Global teardown completed");
}

module.exports = globalTeardown;
