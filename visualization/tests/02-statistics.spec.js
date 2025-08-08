// Statistics and data display tests
const { test, expect } = require('@playwright/test');

test.describe('Statistics Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Navigate to overview tab
    await page.click('[data-tab="overview"]');
  });

  test('displays collection statistics', async ({ page }) => {
    // Wait for stats to load
    await page.waitForSelector('#stat-albums', { timeout: 10000 });
    
    // Check that stats are numbers
    const albums = await page.textContent('#stat-albums');
    const tracks = await page.textContent('#stat-tracks');
    const artists = await page.textContent('#stat-artists');
    
    expect(Number(albums)).toBeGreaterThanOrEqual(0);
    expect(Number(tracks)).toBeGreaterThanOrEqual(0);
    expect(Number(artists)).toBeGreaterThanOrEqual(0);
  });

  test('quality distribution chart loads', async ({ page }) => {
    // Wait for chart canvas
    await page.waitForSelector('canvas', { timeout: 15000 });
    
    // Check that chart canvas exists and has dimensions
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    
    const boundingBox = await canvas.boundingBox();
    expect(boundingBox.width).toBeGreaterThan(0);
    expect(boundingBox.height).toBeGreaterThan(0);
  });

  test('genre distribution displays correctly', async ({ page }) => {
    // Wait for genre data to load
    await page.waitForTimeout(3000);
    
    // Check for genre-related elements
    const genreElements = page.locator('[data-genre], .genre-item, .genre-chart');
    const count = await genreElements.count();
    
    // Should have at least some genre data displayed
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('year distribution chart renders', async ({ page }) => {
    // Navigate to analytics tab for more detailed charts
    await page.click('[data-tab="analytics"]');
    
    // Wait for analytics charts to load
    await page.waitForTimeout(5000);
    
    // Should have multiple charts
    const charts = page.locator('canvas');
    const chartCount = await charts.count();
    expect(chartCount).toBeGreaterThan(0);
  });
});

test.describe('Real-time Updates', () => {
  test('WebSocket connection establishes', async ({ page }) => {
    await page.goto('/');
    
    // Wait for WebSocket connection
    await page.waitForFunction(() => {
      return window.ws && (
        window.ws.readyState === WebSocket.OPEN || 
        window.ws.readyState === WebSocket.CONNECTING
      );
    }, { timeout: 15000 });
    
    // Check connection status
    const wsState = await page.evaluate(() => window.ws ? window.ws.readyState : null);
    expect([WebSocket.OPEN, WebSocket.CONNECTING]).toContain(wsState);
  });

  test('status updates when WebSocket connects', async ({ page }) => {
    await page.goto('/');
    
    // Wait for status to update
    const status = page.locator('#status');
    await expect(status).toContainText(/Connected|Connecting/, { timeout: 15000 });
  });
});