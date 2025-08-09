// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests',
  /* CI Mode: Only run smoke tests */
  testMatch: process.env.CI ? '**/00-ci-smoke.spec.js' : '**/*.spec.js',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['line']
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://127.0.0.1:3847',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    
    /* Take screenshot on failure */
    screenshot: 'only-on-failure',
    
    /* Record video on failure */
    video: 'retain-on-failure'
  },

  /* Configure projects - ULTRA LEAN CI: Just Chromium for smoke tests, comprehensive local testing */
  projects: process.env.CI ? [
    // CI: Single browser smoke tests only - comprehensive testing done locally
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        permissions: ['notifications'],
        serviceWorkers: 'allow'
      }
    }
  ] : [
    // Local development: Full browser matrix for comprehensive testing
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        permissions: ['notifications', 'camera', 'microphone'],
        serviceWorkers: 'allow'
      }
    },
    {
      name: 'firefox',
      use: { 
        ...devices['Desktop Firefox'],
        permissions: ['notifications'],
        serviceWorkers: 'allow'
      }
    },
    {
      name: 'webkit',
      use: { 
        ...devices['Desktop Safari'],
        permissions: ['notifications'],
        serviceWorkers: 'allow'
      }
    },
    {
      name: 'Mobile Chrome',
      use: { 
        ...devices['Pixel 5'],
        permissions: ['notifications'],
        serviceWorkers: 'allow'
      }
    },
    {
      name: 'Mobile Safari',
      use: { 
        ...devices['iPhone 12'],
        permissions: ['notifications'],
        serviceWorkers: 'allow'
      }
    },
    {
      name: 'PWA Desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1200, height: 800 },
        permissions: ['notifications', 'camera', 'microphone'],
        serviceWorkers: 'allow',
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      }
    },
    {
      name: 'PWA Mobile',
      use: {
        ...devices['Pixel 5'],
        permissions: ['notifications'],
        serviceWorkers: 'allow',
        isMobile: true,
        hasTouch: true
      }
    }
  ],

  /* Global setup to start the server */
  globalSetup: require.resolve('./tests/global-setup.js'),
  
  /* Global teardown to stop the server */
  globalTeardown: require.resolve('./tests/global-teardown.js'),

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'ORDRFM_DB=test-metadata.db JWT_SECRET=test-playwright-secret npm start',
    url: 'http://127.0.0.1:3847',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000 // 2 minutes
  }
});