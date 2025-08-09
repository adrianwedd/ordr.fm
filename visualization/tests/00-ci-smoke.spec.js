// CI Smoke Tests - Ultra minimal tests for CI environment
// Run comprehensive tests locally with: npm run test:e2e

const { test, expect } = require('@playwright/test');

// Only run critical smoke tests in CI
test.describe('CI Smoke Tests', () => {
    test('app loads and basic functionality works', async ({ page }) => {
        await page.goto('/');
        
        // Basic page load
        await expect(page.locator('h1')).toContainText('ordr.fm', { timeout: 10000 });
        
        // Status check
        await expect(page.locator('#status')).toBeVisible({ timeout: 10000 });
        
        // Navigation works
        await page.click('text=Albums');
        await expect(page.locator('#tab-albums')).toBeVisible({ timeout: 5000 });
        
        // Basic API connectivity (don't fail if no data)
        const response = await page.request.get('/api/stats');
        expect(response.status()).toBe(200);
        
        console.log('✅ CI Smoke tests passed - app loads and basic functionality works');
    });

    test('server health check', async ({ page }) => {
        // Simple health check
        const response = await page.request.get('/health');
        expect(response.status()).toBe(200);
        
        console.log('✅ CI Smoke tests passed - server health check OK');
    });
});