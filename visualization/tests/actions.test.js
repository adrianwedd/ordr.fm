// Actions Tab E2E Tests
const { test, expect } = require('@playwright/test');

test.describe('Actions Tab Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    
    // Wait for app to initialize
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Click on Actions tab
    await page.click('button:has-text("Actions")');
    await page.waitForSelector('#actions.active', { timeout: 5000 });
  });

  test('should display Actions tab with all sections', async ({ page }) => {
    // Check that Actions tab is active
    await expect(page.locator('#actions')).toHaveClass(/active/);
    
    // Check main sections are present
    await expect(page.locator('h2:has-text("🎵 Music Processing")')).toBeVisible();
    await expect(page.locator('h2:has-text("💾 Backup Management")')).toBeVisible();
    await expect(page.locator('h2:has-text("⚙️ System Status")')).toBeVisible();
  });

  test('should show music processing controls', async ({ page }) => {
    // Check Process Collection card
    await expect(page.locator('h3:has-text("Process Collection")')).toBeVisible();
    
    // Check source directory dropdown
    const sourceSelect = page.locator('#source-directory');
    await expect(sourceSelect).toBeVisible();
    
    // Check processing buttons
    await expect(page.locator('button:has-text("Dry Run")')).toBeVisible();
    await expect(page.locator('button:has-text("Process & Move")')).toBeVisible();
    
    // Check Discogs Enhancement section
    await expect(page.locator('h3:has-text("Discogs Enhancement")')).toBeVisible();
    await expect(page.locator('#enable-discogs')).toBeVisible();
    await expect(page.locator('#electronic-mode')).toBeVisible();
    await expect(page.locator('button:has-text("Enhance Existing")')).toBeVisible();
  });

  test('should show backup management controls', async ({ page }) => {
    // Check Database Backup section
    await expect(page.locator('h3:has-text("Database Backup")')).toBeVisible();
    await expect(page.locator('button:has-text("Backup Now")')).toBeVisible();
    await expect(page.locator('button:has-text("Restore")')).toBeVisible();
    
    // Check Cloud Backup section
    await expect(page.locator('h3:has-text("Cloud Backup")')).toBeVisible();
    await expect(page.locator('#backup-target')).toBeVisible();
    await expect(page.locator('button:has-text("Start Backup")')).toBeVisible();
    await expect(page.locator('button:has-text("Pause")')).toBeVisible();
  });

  test('should show system status monitoring', async ({ page }) => {
    // Wait for system status to load
    await page.waitForTimeout(2000);
    
    // Check Dependencies section
    await expect(page.locator('h3:has-text("Dependencies")')).toBeVisible();
    await expect(page.locator('.dependency-name:has-text("exiftool")')).toBeVisible();
    await expect(page.locator('.dependency-name:has-text("jq")')).toBeVisible();
    await expect(page.locator('.dependency-name:has-text("rsync")')).toBeVisible();
    await expect(page.locator('.dependency-name:has-text("rclone")')).toBeVisible();
    
    // Check Disk Space section
    await expect(page.locator('h3:has-text("Disk Space")')).toBeVisible();
    await expect(page.locator('.disk-label:has-text("Source:")')).toBeVisible();
    await expect(page.locator('.disk-label:has-text("Destination:")')).toBeVisible();
    
    // Check Services section
    await expect(page.locator('h3:has-text("Services")')).toBeVisible();
    await expect(page.locator('.service-name:has-text("ordr.fm Script")')).toBeVisible();
    await expect(page.locator('.service-name:has-text("Discogs API")')).toBeVisible();
    await expect(page.locator('.service-name:has-text("Backup Service")')).toBeVisible();
    
    // Check Recent Activity section
    await expect(page.locator('h3:has-text("Recent Activity")')).toBeVisible();
  });

  test('should handle source directory selection', async ({ page }) => {
    const sourceSelect = page.locator('#source-directory');
    const customInput = page.locator('#custom-source');
    
    // Initially custom input should be hidden
    await expect(customInput).not.toBeVisible();
    
    // Select custom option
    await sourceSelect.selectOption('custom');
    
    // Custom input should now be visible
    await expect(customInput).toBeVisible();
    
    // Select a predefined option
    await sourceSelect.selectOption('/home/plex/Music/Unsorted and Incomplete/Incomplete Albums');
    
    // Custom input should be hidden again
    await expect(customInput).not.toBeVisible();
  });

  test('should start database backup', async ({ page }) => {
    const backupButton = page.locator('button:has-text("Backup Now")');
    const indicator = page.locator('#db-backup-indicator');
    const statusText = page.locator('#db-backup-text');
    
    // Initial state
    await expect(indicator).toContainText('⏱️');
    
    // Click backup button
    await backupButton.click();
    
    // Should show loading state
    await expect(indicator).toContainText('⏳');
    await expect(statusText).toContainText('Creating backup...');
    
    // Wait for completion (should be quick for database backup)
    await page.waitForTimeout(3000);
    
    // Should show success or completion
    const finalIndicator = await indicator.textContent();
    expect(['✅', '❌']).toContain(finalIndicator);
  });

  test('should show processing progress when started', async ({ page }) => {
    const dryRunButton = page.locator('button:has-text("Dry Run")');
    const progressSection = page.locator('#processing-progress');
    const progressBar = page.locator('#processing-progress-bar');
    const statusText = page.locator('#processing-status');
    
    // Initially progress should be hidden
    await expect(progressSection).not.toBeVisible();
    
    // Start dry run
    await dryRunButton.click();
    
    // Progress section should become visible
    await expect(progressSection).toBeVisible();
    await expect(progressBar).toBeVisible();
    await expect(statusText).toBeVisible();
    
    // Should show initial status
    await expect(statusText).toContainText(/Starting|Ready/);
  });

  test('should validate Discogs requirement for metadata enhancement', async ({ page }) => {
    const enhanceButton = page.locator('button:has-text("Enhance Existing")');
    const discogsCheckbox = page.locator('#enable-discogs');
    
    // Uncheck Discogs
    await discogsCheckbox.uncheck();
    
    // Try to enhance metadata
    await enhanceButton.click();
    
    // Should show error message
    await expect(page.locator('#error-container')).toContainText(/Please enable Discogs lookup/);
    
    // Check Discogs and try again
    await discogsCheckbox.check();
    
    // Create a mock confirmation dialog handler
    page.on('dialog', dialog => {
      expect(dialog.message()).toContain('re-process your first 10 organized albums');
      dialog.dismiss(); // Cancel the operation
    });
    
    await enhanceButton.click();
  });

  test('should display system status indicators correctly', async ({ page }) => {
    // Wait for system status to load
    await page.waitForTimeout(3000);
    
    // Check that dependency indicators are present
    const exiftoolStatus = page.locator('#exiftool-status');
    const jqStatus = page.locator('#jq-status');
    const rsyncStatus = page.locator('#rsync-status');
    const rcloneStatus = page.locator('#rclone-status');
    
    await expect(exiftoolStatus).toBeVisible();
    await expect(jqStatus).toBeVisible();
    await expect(rsyncStatus).toBeVisible();
    await expect(rcloneStatus).toBeVisible();
    
    // Status indicators should show either ✅ or ❌
    const exiftoolText = await exiftoolStatus.textContent();
    expect(['✅', '❌']).toContain(exiftoolText);
  });

  test('should show real-time activity log', async ({ page }) => {
    // Wait for activity to load
    await page.waitForTimeout(2000);
    
    const activityLog = page.locator('#recent-activity .activity-log');
    await expect(activityLog).toBeVisible();
    
    // Should have activity items or "No recent activity" message
    const activityItems = page.locator('.activity-item');
    await expect(activityItems.first()).toBeVisible();
  });

  test('should handle mobile responsiveness', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Actions tab should still be functional
    await expect(page.locator('#actions')).toHaveClass(/active/);
    
    // Cards should stack vertically on mobile
    const actionCards = page.locator('.action-card');
    const firstCard = actionCards.first();
    const secondCard = actionCards.nth(1);
    
    const firstCardBox = await firstCard.boundingBox();
    const secondCardBox = await secondCard.boundingBox();
    
    // Second card should be below first card (mobile stacking)
    expect(secondCardBox.y).toBeGreaterThan(firstCardBox.y + firstCardBox.height - 50);
  });

  test('should maintain state during tab switching', async ({ page }) => {
    // Set some form values
    await page.selectOption('#source-directory', 'custom');
    await page.fill('#custom-source', '/test/path');
    await page.check('#electronic-mode');
    
    // Switch to another tab
    await page.click('button:has-text("Overview")');
    await page.waitForSelector('#overview.active');
    
    // Switch back to Actions
    await page.click('button:has-text("Actions")');
    await page.waitForSelector('#actions.active');
    
    // Form values should be preserved
    await expect(page.locator('#source-directory')).toHaveValue('custom');
    await expect(page.locator('#custom-source')).toHaveValue('/test/path');
    await expect(page.locator('#electronic-mode')).toBeChecked();
  });
});

test.describe('Actions Tab API Integration', () => {
  test('should handle API errors gracefully', async ({ page }) => {
    // Mock a failed API response
    await page.route('/api/actions/process', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' })
      });
    });
    
    await page.goto('/');
    await page.click('button:has-text("Actions")');
    await page.waitForSelector('#actions.active');
    
    // Try to start processing
    await page.click('button:has-text("Dry Run")');
    
    // Should show error message
    await expect(page.locator('#error-container')).toContainText(/Failed to start processing/);
  });

  test('should handle WebSocket disconnection', async ({ page }) => {
    await page.goto('/');
    await page.click('button:has-text("Actions")');
    await page.waitForSelector('#actions.active');
    
    // Wait for WebSocket connection
    await page.waitForTimeout(2000);
    
    // Simulate WebSocket disconnection by closing connection
    await page.evaluate(() => {
      if (window.ws) {
        window.ws.close();
      }
    });
    
    // Actions should still be functional (graceful degradation)
    const backupButton = page.locator('button:has-text("Backup Now")');
    await expect(backupButton).toBeEnabled();
  });
});