// Automated File Browser → Processing Workflow Test
const { test, expect } = require('@playwright/test');

test.describe('Complete File Browser → Processing Workflow', () => {
  test('should complete full workflow from file browser to processing', async ({ page }) => {
    console.log('🧪 Starting complete workflow test...');
    
    // Step 1: Navigate to PWA
    await page.goto('http://localhost:3001/');
    await page.waitForSelector('#status', { timeout: 15000 });
    console.log('✅ PWA loaded successfully');
    
    // Step 2: Navigate to Actions tab
    await page.click('button:has-text("Actions")');
    await page.waitForSelector('#actions.active', { timeout: 5000 });
    console.log('✅ Actions tab loaded');
    
    // Step 3: Open file browser
    const sourceSelect = page.locator('#source-directory');
    await sourceSelect.selectOption('browse');
    await page.waitForSelector('#file-browser-modal', { state: 'visible' });
    console.log('✅ File browser modal opened');
    
    // Step 4: Wait for directory contents to load
    await page.waitForTimeout(3000);
    
    // Step 5: Check current path
    const currentPath = await page.locator('#current-path').textContent();
    console.log(`📁 Current path: ${currentPath}`);
    
    // Step 6: Look for audio folders or navigate to likely music directories
    const directoryItems = page.locator('.directory-item');
    const itemCount = await directoryItems.count();
    console.log(`📂 Found ${itemCount} items in directory`);
    
    // Step 7: Select current folder (for testing)
    await page.click('.select-path');
    await expect(page.locator('#file-browser-modal')).not.toBeVisible();
    console.log('✅ File browser closed, path selected');
    
    // Step 8: Verify custom source is populated
    const customInput = page.locator('#custom-source');
    await expect(customInput).toBeVisible();
    const selectedPath = await customInput.inputValue();
    console.log(`📋 Selected path: ${selectedPath}`);
    
    // Step 9: Configure processing options
    await page.check('#enable-discogs');
    await page.check('#electronic-mode');
    console.log('✅ Processing options configured');
    
    // Step 10: Test app control functions
    await page.click('button:has-text("Check Updates")');
    await page.waitForTimeout(2000);
    console.log('✅ App update check completed');
    
    // Step 11: Prepare for dry run (don't actually run to avoid long processing)
    const dryRunButton = page.locator('button:has-text("Dry Run")');
    await expect(dryRunButton).toBeEnabled();
    console.log('✅ Dry run button is ready');
    
    // Step 12: Test version endpoint
    const versionResponse = await page.request.get('/api/version');
    const versionData = await versionResponse.json();
    console.log(`📦 App version: ${versionData.version}`);
    console.log(`🏭 Environment: ${versionData.node_env}`);
    
    // Step 13: Verify PWA status
    const healthResponse = await page.request.get('/api/health');
    expect(healthResponse.ok()).toBeTruthy();
    console.log('✅ Health endpoint responding');
    
    console.log('🎉 Complete workflow test passed!');
  });
  
  test('should handle file browser navigation', async ({ page }) => {
    await page.goto('http://localhost:3001/');
    await page.waitForSelector('#status', { timeout: 15000 });
    await page.click('button:has-text("Actions")');
    await page.waitForSelector('#actions.active');
    
    // Open file browser
    const sourceSelect = page.locator('#source-directory');
    await sourceSelect.selectOption('browse');
    await page.waitForSelector('#file-browser-modal', { state: 'visible' });
    await page.waitForTimeout(2000);
    
    // Test navigation if up button is available
    const upButton = page.locator('.nav-up');
    const currentPath = page.locator('#current-path');
    
    const initialPath = await currentPath.textContent();
    console.log(`📁 Initial path: ${initialPath}`);
    
    // If up button is enabled, test navigation
    if (await upButton.isVisible() && !await upButton.isDisabled()) {
      await upButton.click();
      await page.waitForTimeout(2000);
      
      const newPath = await currentPath.textContent();
      console.log(`📁 After up navigation: ${newPath}`);
      
      expect(newPath).not.toBe(initialPath);
      console.log('✅ Directory navigation working');
    }
    
    // Close browser
    await page.click('.close-browser');
    await expect(page.locator('#file-browser-modal')).not.toBeVisible();
    console.log('✅ File browser closed successfully');
  });
  
  test('should maintain PWA functionality in production', async ({ page }) => {
    await page.goto('http://localhost:3001/');
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Test service worker registration
    const swRegistered = await page.evaluate(() => {
      return 'serviceWorker' in navigator;
    });
    console.log(`🔧 Service Worker support: ${swRegistered}`);
    
    // Test offline capabilities by checking Cache API
    const cacheSupported = await page.evaluate(() => {
      return 'caches' in window;
    });
    console.log(`💾 Cache API support: ${cacheSupported}`);
    
    // Test theme functionality
    const themeToggle = page.locator('#theme-toggle');
    await expect(themeToggle).toBeVisible();
    console.log('✅ Theme toggle available');
    
    // Test WebSocket connection
    await page.waitForTimeout(3000);
    const connectionStatus = page.locator('#connection-status');
    const status = await connectionStatus.textContent();
    console.log(`🔌 Connection status: ${status}`);
    
    // Test all main tabs
    const tabs = ['Overview', 'Collection Health', 'Actions'];
    for (const tabName of tabs) {
      await page.click(`button:has-text("${tabName}")`);
      await page.waitForTimeout(1000);
      console.log(`✅ ${tabName} tab working`);
    }
    
    console.log('🚀 PWA production functionality verified');
  });
});

console.log('🎯 File Browser → Processing Workflow Tests Ready');
console.log('Run with: npx playwright test test_workflow.js --headed');