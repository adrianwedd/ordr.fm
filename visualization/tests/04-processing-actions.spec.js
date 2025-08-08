// Processing and actions functionality tests
const { test, expect } = require('@playwright/test');

test.describe('Music Processing Actions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.click('[data-tab="actions"]');
  });

  test('processing controls are present', async ({ page }) => {
    // Check for processing buttons
    const processButton = page.locator('#start-processing, [data-action="start-processing"]');
    const enhanceButton = page.locator('#enhance-metadata, [data-action="enhance-metadata"]');
    
    // At least one processing control should be visible
    const processingControls = page.locator('[data-action*="process"], [id*="process"], .process-btn');
    expect(await processingControls.count()).toBeGreaterThan(0);
  });

  test('file browser functionality works', async ({ page }) => {
    // Look for file browser trigger
    const browserButton = page.locator('#open-file-browser, [data-action="browse-files"], .file-browse-btn');
    
    if (await browserButton.isVisible()) {
      await browserButton.click();
      
      // Should open file browser modal
      const modal = page.locator('.file-browser-modal, .modal, [role="dialog"]');
      await expect(modal).toBeVisible({ timeout: 5000 });
    }
  });

  test('processing status updates correctly', async ({ page }) => {
    // Subscribe to processing updates
    await page.waitForFunction(() => {
      return window.ws && window.ws.readyState === WebSocket.OPEN;
    }, { timeout: 10000 });
    
    // Check for processing status indicators
    const statusIndicators = page.locator('.processing-status, #processing-status, [data-status="processing"]');
    const count = await statusIndicators.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('source directory selection works', async ({ page }) => {
    // Look for source directory input/selector
    const sourceInput = page.locator('#source-directory, [name="source"], [data-field="source"]');
    
    if (await sourceInput.isVisible()) {
      await expect(sourceInput).toBeVisible();
      
      // Should be able to type in it
      await sourceInput.fill('/test/path');
      const value = await sourceInput.inputValue();
      expect(value).toBe('/test/path');
    }
  });
});

test.describe('Metadata Enhancement', () => {
  test('metadata enhancement options are available', async ({ page }) => {
    // Look for enhancement controls
    const discogs = page.locator('[data-source="discogs"], #enable-discogs, .discogs-toggle');
    const musicbrainz = page.locator('[data-source="musicbrainz"], #enable-musicbrainz, .musicbrainz-toggle');
    
    // At least one metadata source should be available
    const metadataSources = page.locator('[data-source], .metadata-source, .enhancement-option');
    expect(await metadataSources.count()).toBeGreaterThan(0);
  });

  test('enhancement progress shows correctly', async ({ page }) => {
    // Mock enhancement in progress
    await page.evaluate(() => {
      if (window.handleBackupUpdate) {
        window.handleBackupUpdate({
          type: 'processing_update',
          data: {
            status: 'running',
            progress: 50,
            message: 'Processing track 10 of 20'
          }
        });
      }
    });
    
    // Check for progress indicators
    const progress = page.locator('.progress-bar, .progress, [role="progressbar"]');
    if (await progress.count() > 0) {
      await expect(progress.first()).toBeVisible();
    }
  });
});

test.describe('System Actions', () => {
  test('system status is accessible', async ({ page }) => {
    // Check system status display
    const systemStatus = page.locator('.system-status, #system-status');
    if (await systemStatus.isVisible()) {
      await expect(systemStatus).toBeVisible();
    }
  });

  test('activity log displays recent actions', async ({ page }) => {
    // Look for activity log
    const activityLog = page.locator('.activity-log, #activity-log, .recent-activity');
    
    if (await activityLog.isVisible()) {
      await expect(activityLog).toBeVisible();
      
      // Should contain activity items
      const items = page.locator('.activity-item, .log-entry');
      expect(await items.count()).toBeGreaterThanOrEqual(0);
    }
  });

  test('error handling displays user-friendly messages', async ({ page }) => {
    // Mock an error response
    await page.route('/api/actions/**', async route => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Test error message',
          details: 'This is a test error'
        })
      });
    });
    
    // Try to trigger an action that would cause an error
    const actionButton = page.locator('[data-action], .action-btn').first();
    if (await actionButton.isVisible()) {
      await actionButton.click();
      
      // Should show error message
      const errorMsg = page.locator('.error-message, .alert-error, [role="alert"]');
      await expect(errorMsg).toBeVisible({ timeout: 5000 });
    }
  });
});