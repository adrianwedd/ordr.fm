// Basic Functionality Tests
const { test, expect } = require('@playwright/test');

test.describe('Basic App Functionality', () => {
  test('should load the main page', async ({ page }) => {
    await page.goto('/');
    
    // Check page title
    await expect(page).toHaveTitle(/ordr\.fm Visualization Dashboard/);
    
    // Check main header
    const header = page.locator('header h1');
    await expect(header).toBeVisible();
    await expect(header).toContainText('ordr.fm Visualization Dashboard');
  });

  test('should show connection status', async ({ page }) => {
    await page.goto('/');
    
    // Wait for status element
    const status = page.locator('#status');
    await expect(status).toBeVisible();
    
    // Should eventually show connected status or some status
    await page.waitForTimeout(5000);
    const statusText = await status.textContent();
    expect(statusText).toBeTruthy();
    expect(statusText.length).toBeGreaterThan(0);
  });

  test('should display navigation tabs', async ({ page }) => {
    await page.goto('/');
    
    // Check tabs are present
    const tabs = page.locator('.tab');
    await expect(tabs.first()).toBeVisible();
    
    // Should have multiple tabs
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(1);
    
    // Check specific tabs
    await expect(page.locator('text=Overview')).toBeVisible();
    await expect(page.locator('text=Albums')).toBeVisible();
  });

  test('should allow tab navigation', async ({ page }) => {
    await page.goto('/');
    
    // Wait for tabs to be ready
    await page.waitForSelector('.tab', { timeout: 15000 });
    
    // Overview should be active by default
    const overviewTab = page.locator('text=Overview');
    await expect(overviewTab).toHaveClass(/active/);
    
    // Click Albums tab
    const albumsTab = page.locator('text=Albums');
    await albumsTab.click();
    
    // Albums tab should become active
    await expect(albumsTab).toHaveClass(/active/);
    await expect(overviewTab).not.toHaveClass(/active/);
    
    // Albums content should be visible
    const albumsContent = page.locator('#albums');
    await expect(albumsContent).toHaveClass(/active/);
  });

  test('should load charts in overview', async ({ page }) => {
    await page.goto('/');
    
    // Wait for overview to load
    await page.waitForSelector('#overview.active', { timeout: 15000 });
    
    // Should have chart containers
    const qualityChart = page.locator('#quality-chart');
    await expect(qualityChart).toBeVisible();
    
    const modeChart = page.locator('#mode-chart');
    await expect(modeChart).toBeVisible();
  });

  test('should display statistics', async ({ page }) => {
    await page.goto('/');
    
    // Wait for stats to load
    await page.waitForSelector('.stat-value', { timeout: 15000 });
    
    // Should have stat values (even if 0)
    const statAlbums = page.locator('#stat-albums');
    const statTracks = page.locator('#stat-tracks');
    const statArtists = page.locator('#stat-artists');
    const statLabels = page.locator('#stat-labels');
    
    await expect(statAlbums).toBeVisible();
    await expect(statTracks).toBeVisible();
    await expect(statArtists).toBeVisible();
    await expect(statLabels).toBeVisible();
    
    // Values should be present (could be 0 or numbers)
    const albumsValue = await statAlbums.textContent();
    expect(/^\d+$/.test(albumsValue.trim())).toBe(true);
  });

  test('should handle error states gracefully', async ({ page }) => {
    await page.goto('/');
    
    // Wait for app to initialize
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Check if error container exists (it might be empty, which is good)
    const errorContainer = page.locator('#error-container');
    const hasErrorContainer = await errorContainer.count() > 0;
    expect(hasErrorContainer).toBe(true);
    
    // If there are errors, they should be displayed properly
    const errorContent = await errorContainer.textContent();
    console.log('Error content:', errorContent);
    
    // App should still be functional even with potential errors
    const header = page.locator('header');
    await expect(header).toBeVisible();
  });
});

test.describe('Data Loading', () => {
  test('should load albums data', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to albums tab
    const albumsTab = page.locator('text=Albums');
    await albumsTab.click();
    
    // Wait for albums table
    await page.waitForSelector('#albums-tbody', { timeout: 15000 });
    
    const albumsTable = page.locator('#albums-table');
    await expect(albumsTable).toBeVisible();
    
    // Should have table headers
    const headers = page.locator('#albums-table th');
    const headerCount = await headers.count();
    expect(headerCount).toBeGreaterThan(0);
  });

  test('should load artists data', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to artists tab
    const artistsTab = page.locator('text=Artists');
    await artistsTab.click();
    
    // Wait for artists content
    await page.waitForSelector('#artists-tbody', { timeout: 15000 });
    
    const artistsTable = page.locator('#artists-table');
    await expect(artistsTable).toBeVisible();
  });

  test('should handle empty data states', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to different tabs and check they don't crash on empty data
    const tabs = [
      { name: 'Albums', content: '#albums-tbody' },
      { name: 'Artists', content: '#artists-tbody' },
      { name: 'Labels', content: '#labels-tbody' }
    ];
    
    for (const tab of tabs) {
      const tabElement = page.locator(`text=${tab.name}`);
      await tabElement.click();
      
      await page.waitForSelector(tab.content, { timeout: 10000 });
      
      // Content should be visible (even if showing "Loading..." or "No data")
      const content = page.locator(tab.content);
      await expect(content).toBeVisible();
    }
  });
});

test.describe('Performance and Reliability', () => {
  test('should load within reasonable time', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('/');
    
    // Wait for main UI to be ready
    await page.waitForSelector('header', { timeout: 15000 });
    await page.waitForSelector('#status', { timeout: 15000 });
    
    const loadTime = Date.now() - startTime;
    console.log('App load time:', loadTime, 'ms');
    
    // Should load within 15 seconds (generous for slow systems)
    expect(loadTime).toBeLessThan(15000);
  });

  test('should be responsive to user interactions', async ({ page }) => {
    await page.goto('/');
    
    // Wait for app to be ready
    await page.waitForSelector('.tab', { timeout: 15000 });
    
    // Test tab switching responsiveness
    const startTime = Date.now();
    
    const albumsTab = page.locator('text=Albums');
    await albumsTab.click();
    
    await page.waitForSelector('#albums.active', { timeout: 5000 });
    
    const switchTime = Date.now() - startTime;
    console.log('Tab switch time:', switchTime, 'ms');
    
    // Tab switching should be fast
    expect(switchTime).toBeLessThan(2000);
  });

  test('should handle concurrent operations', async ({ page }) => {
    await page.goto('/');
    
    // Wait for initial load
    await page.waitForSelector('.tab', { timeout: 15000 });
    
    // Rapidly switch between tabs
    const tabs = page.locator('.tab');
    const tabCount = Math.min(await tabs.count(), 4);
    
    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(100); // Brief pause between clicks
    }
    
    // App should remain stable
    const activeTab = page.locator('.tab.active');
    await expect(activeTab).toBeVisible();
    
    // No JavaScript errors should have occurred
    const jsErrors = await page.evaluate(() => {
      return window.jsErrors || [];
    });
    
    expect(jsErrors.length).toBe(0);
  });
});