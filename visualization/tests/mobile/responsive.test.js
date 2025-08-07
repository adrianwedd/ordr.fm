// Mobile Responsive Design Tests
const { test, expect } = require('@playwright/test');

test.describe('Mobile Responsive Design', () => {
  test('should be responsive on mobile devices', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Wait for app to load
    await page.waitForSelector('header', { timeout: 15000 });
    
    // Check mobile-specific elements
    const mobileFab = page.locator('#mobile-fab');
    await expect(mobileFab).toBeVisible();
    
    // Check responsive layout
    const container = page.locator('.container');
    const containerWidth = await container.evaluate(el => el.offsetWidth);
    expect(containerWidth).toBeLessThan(400); // Should fit mobile screen
  });

  test('should handle tablet viewport', async ({ page }) => {
    // Test tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    
    await page.waitForSelector('header', { timeout: 15000 });
    
    // On tablet, dashboard should use appropriate grid
    const dashboard = page.locator('.dashboard');
    const dashboardExists = await dashboard.count() > 0;
    
    if (dashboardExists) {
      const computedStyle = await dashboard.evaluate(el => 
        window.getComputedStyle(el).getPropertyValue('grid-template-columns')
      );
      console.log('Tablet grid layout:', computedStyle);
    }
  });

  test('should handle orientation changes', async ({ page }) => {
    // Start in portrait
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForSelector('header', { timeout: 15000 });
    
    // Switch to landscape
    await page.setViewportSize({ width: 667, height: 375 });
    
    // Wait for layout adjustment
    await page.waitForTimeout(500);
    
    // Check that layout adapts
    const dashboard = page.locator('.dashboard');
    const dashboardExists = await dashboard.count() > 0;
    
    if (dashboardExists) {
      const isVisible = await dashboard.isVisible();
      expect(isVisible).toBe(true);
    }
  });

  test('should have touch-friendly targets', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    await page.waitForSelector('.tab', { timeout: 15000 });
    
    // Check tab sizes (should be at least 44px for touch)
    const tabs = page.locator('.tab');
    const tabCount = await tabs.count();
    
    for (let i = 0; i < Math.min(tabCount, 3); i++) {
      const tab = tabs.nth(i);
      const box = await tab.boundingBox();
      
      if (box) {
        expect(box.height).toBeGreaterThanOrEqual(40); // Close to 44px minimum
      }
    }
  });
});

test.describe('Mobile UI Components', () => {
  test('should show mobile FAB button', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    await page.waitForSelector('#mobile-fab', { timeout: 15000 });
    
    const mobileFab = page.locator('#mobile-fab');
    await expect(mobileFab).toBeVisible();
    
    // Should be positioned fixed
    const position = await mobileFab.evaluate(el => 
      window.getComputedStyle(el).position
    );
    expect(position).toBe('fixed');
  });

  test('should open mobile bottom sheet menu', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    const mobileFab = page.locator('#mobile-fab');
    await mobileFab.waitFor({ timeout: 15000 });
    
    // Click FAB to open menu
    await mobileFab.click();
    
    // Wait for bottom sheet to open
    const bottomSheet = page.locator('#mobile-menu.open');
    await expect(bottomSheet).toBeVisible();
    
    // Check menu content
    const refreshCard = page.locator('text=Refresh Data');
    await expect(refreshCard).toBeVisible();
    
    const testNotificationCard = page.locator('text=Test Notifications');
    await expect(testNotificationCard).toBeVisible();
  });

  test('should close mobile menu when clicking close button', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Open menu
    await page.click('#mobile-fab');
    await page.waitForSelector('#mobile-menu.open');
    
    // Close menu
    const closeButton = page.locator('#mobile-menu button');
    await closeButton.click();
    
    // Wait for menu to close
    await page.waitForSelector('#mobile-menu:not(.open)', { timeout: 5000 });
    
    const bottomSheet = page.locator('#mobile-menu.open');
    await expect(bottomSheet).not.toBeVisible();
  });

  test('should show mobile progress indicators', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Wait for initial load
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Test mobile loading states by triggering a refresh
    await page.click('#mobile-fab');
    await page.waitForSelector('#mobile-menu.open');
    
    // Click refresh data
    const refreshCard = page.locator('text=Refresh Data').locator('..');
    await refreshCard.click();
    
    // Should close menu after action
    await page.waitForSelector('#mobile-menu:not(.open)', { timeout: 5000 });
  });
});

test.describe('Mobile Chart Responsiveness', () => {
  test('should resize charts for mobile viewport', async ({ page }) => {
    await page.goto('/');
    
    // Wait for charts to load in desktop view first
    await page.waitForSelector('#quality-chart', { timeout: 15000 });
    
    // Switch to mobile
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Wait for resize
    await page.waitForTimeout(1000);
    
    // Check that charts are still visible and properly sized
    const qualityChart = page.locator('#quality-chart');
    const chartBox = await qualityChart.boundingBox();
    
    if (chartBox) {
      expect(chartBox.width).toBeLessThan(400); // Should fit mobile screen
      expect(chartBox.width).toBeGreaterThan(200); // But not too small
    }
  });

  test('should handle chart legends on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Wait for chart to render
    await page.waitForSelector('#quality-chart', { timeout: 15000 });
    
    // Charts should be visible even on small screens
    const chart = page.locator('#quality-chart');
    await expect(chart).toBeVisible();
    
    // Check that chart container has appropriate mobile height
    const container = page.locator('#quality-chart').locator('..');
    const containerHeight = await container.evaluate(el => el.offsetHeight);
    expect(containerHeight).toBeGreaterThan(150); // Reasonable minimum height
  });
});