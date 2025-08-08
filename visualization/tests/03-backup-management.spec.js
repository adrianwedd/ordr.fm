// Backup management functionality tests
const { test, expect } = require('@playwright/test');

test.describe('Backup Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.click('[data-tab="actions"]');
  });

  test('backup status displays correctly', async ({ page }) => {
    // Wait for backup status to load
    await page.waitForTimeout(2000);
    
    // Should show backup status info
    const statusInfo = page.locator('#backup-status-info, .backup-status-info');
    await expect(statusInfo).toBeVisible({ timeout: 10000 });
  });

  test('backup controls are present', async ({ page }) => {
    // Check for backup controls
    const startButton = page.locator('#start-cloud-backup, [data-action="start-backup"]');
    await expect(startButton).toBeVisible();
    
    // Check backup target selector
    const targetSelector = page.locator('#backup-target');
    await expect(targetSelector).toBeVisible();
  });

  test('backup conflict detection works', async ({ page }) => {
    // Mock a backup status response that shows running backup
    await page.route('/api/actions/backup-status', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          activeBackups: [{
            id: 'test_backup_123',
            target: 'gdrive',
            startTime: new Date().toISOString(),
            pid: 12345
          }],
          systemProcesses: ['rclone sync test process'],
          hasRunning: true
        })
      });
    });
    
    // Reload to get mocked status
    await page.reload();
    await page.click('[data-tab="actions"]');
    
    // Wait for status to update
    await page.waitForTimeout(3000);
    
    // Should show running backup status
    const statusDiv = page.locator('.backup-status-active, #backup-status-info');
    await expect(statusDiv).toContainText(/Active Backups.*1|backup.*running/i);
  });

  test('backup cancellation UI appears when backup is running', async ({ page }) => {
    // Mock running backup status
    await page.route('/api/actions/backup-status', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          activeBackups: [{
            id: 'test_backup_456',
            target: 'gdrive',
            startTime: new Date().toISOString(),
            pid: 56789
          }],
          systemProcesses: [],
          hasRunning: true
        })
      });
    });
    
    await page.reload();
    await page.click('[data-tab="actions"]');
    await page.waitForTimeout(3000);
    
    // Cancel button should be visible
    const cancelButton = page.locator('#cancel-cloud-backup, [data-action="cancel-backup"]');
    await expect(cancelButton).toBeVisible();
    
    // Start button should be disabled
    const startButton = page.locator('#start-cloud-backup');
    await expect(startButton).toBeDisabled();
  });

  test('database backup controls work', async ({ page }) => {
    const dbBackupButton = page.locator('#backup-database, [data-action="backup-database"]');
    
    if (await dbBackupButton.isVisible()) {
      await expect(dbBackupButton).toBeEnabled();
    }
  });
});

test.describe('Backup API Integration', () => {
  test('backup status API responds correctly', async ({ page }) => {
    // Test the API directly
    const response = await page.request.get('/api/actions/backup-status');
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('activeBackups');
    expect(data).toHaveProperty('systemProcesses');
    expect(data).toHaveProperty('hasRunning');
    expect(Array.isArray(data.activeBackups)).toBe(true);
    expect(Array.isArray(data.systemProcesses)).toBe(true);
    expect(typeof data.hasRunning).toBe('boolean');
  });

  test('backup cloud API handles conflicts', async ({ page }) => {
    // Test backup start with conflict
    const response = await page.request.post('/api/actions/backup-cloud', {
      data: { target: 'gdrive' }
    });
    
    // Should either start successfully (200) or show conflict (409)
    expect([200, 409]).toContain(response.status());
    
    if (response.status() === 409) {
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('already running');
    }
  });
});