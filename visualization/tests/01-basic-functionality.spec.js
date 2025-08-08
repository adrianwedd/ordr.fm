// Basic functionality tests for ordr.fm PWA
const { test, expect } = require('@playwright/test');

test.describe('Basic Application Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('loads the main page successfully', async ({ page }) => {
    await expect(page).toHaveTitle(/ordr\.fm/);
    await expect(page.locator('h1')).toContainText('ordr.fm');
  });

  test('displays PWA elements correctly', async ({ page }) => {
    // Check for PWA manifest
    const manifest = await page.locator('link[rel="manifest"]');
    await expect(manifest).toHaveAttribute('href', 'manifest.json');
    
    // Check for meta tags
    await expect(page.locator('meta[name="theme-color"]')).toBeVisible();
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toBeVisible();
  });

  test('navigation works correctly', async ({ page }) => {
    // Test tab navigation
    await page.click('[data-tab="overview"]');
    await expect(page.locator('[data-section="overview"]')).toBeVisible();
    
    await page.click('[data-tab="analytics"]');
    await expect(page.locator('[data-section="analytics"]')).toBeVisible();
    
    await page.click('[data-tab="actions"]');
    await expect(page.locator('[data-section="actions"]')).toBeVisible();
  });

  test('status indicator displays correctly', async ({ page }) => {
    const status = page.locator('#status');
    await expect(status).toBeVisible();
    
    // Should show either "Connected" or "Connecting" or "Disconnected"
    await expect(status).toContainText(/Connected|Connecting|Disconnected/);
  });

  test('database connection status is shown', async ({ page }) => {
    // Wait for database status to load
    const dbStatus = page.locator('.database-status, #database-status');
    await expect(dbStatus).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Responsive Design', () => {
  test('works on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Check mobile layout
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('[data-tab="overview"]')).toBeVisible();
  });

  test('works on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.tab-nav')).toBeVisible();
  });

  test('works on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/');
    
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.container')).toBeVisible();
  });
});