// Dark Mode E2E Tests
const { test, expect } = require('@playwright/test');

test.describe('Dark Mode Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status', { timeout: 15000 });
  });

  test('should default to dark mode', async ({ page }) => {
    // Should not have light-theme class by default
    const body = page.locator('body');
    await expect(body).not.toHaveClass(/light-theme/);
    
    // Theme toggle should show "Light Mode" text
    const themeToggle = page.locator('#theme-toggle');
    await expect(themeToggle).toContainText('☀️ Light Mode');
  });

  test('should toggle between light and dark themes', async ({ page }) => {
    const body = page.locator('body');
    const themeToggle = page.locator('#theme-toggle');
    
    // Initially dark mode
    await expect(body).not.toHaveClass(/light-theme/);
    await expect(themeToggle).toContainText('☀️ Light Mode');
    
    // Click to switch to light mode
    await themeToggle.click();
    
    // Should now be light theme
    await expect(body).toHaveClass(/light-theme/);
    await expect(themeToggle).toContainText('🌙 Dark Mode');
    
    // Click again to switch back to dark mode
    await themeToggle.click();
    
    // Should be dark theme again
    await expect(body).not.toHaveClass(/light-theme/);
    await expect(themeToggle).toContainText('☀️ Light Mode');
  });

  test('should persist theme choice in localStorage', async ({ page }) => {
    const themeToggle = page.locator('#theme-toggle');
    
    // Switch to light mode
    await themeToggle.click();
    
    // Reload page
    await page.reload();
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Should still be in light mode
    const body = page.locator('body');
    await expect(body).toHaveClass(/light-theme/);
    await expect(themeToggle).toContainText('🌙 Dark Mode');
    
    // Check localStorage value
    const savedTheme = await page.evaluate(() => localStorage.getItem('ordr-fm-theme'));
    expect(savedTheme).toBe('light');
  });

  test('should apply dark theme styles correctly', async ({ page }) => {
    // Check that dark theme CSS variables are applied
    const header = page.locator('header');
    const card = page.locator('.card').first();
    
    // Get computed styles
    const headerBg = await header.evaluate(el => 
      getComputedStyle(el).getPropertyValue('background-color')
    );
    
    // Dark theme should have darker backgrounds
    expect(headerBg).toMatch(/rgba?\(45,\s*45,\s*45/);
  });

  test('should apply light theme styles when toggled', async ({ page }) => {
    const themeToggle = page.locator('#theme-toggle');
    
    // Switch to light theme
    await themeToggle.click();
    
    const header = page.locator('header');
    
    // Get computed styles for light theme
    const headerBg = await header.evaluate(el => 
      getComputedStyle(el).getPropertyValue('background-color')
    );
    
    // Light theme should have lighter backgrounds
    expect(headerBg).toMatch(/rgba?\(255,\s*255,\s*255/);
  });

  test('should maintain theme across tab navigation', async ({ page }) => {
    const themeToggle = page.locator('#theme-toggle');
    const body = page.locator('body');
    
    // Switch to light theme
    await themeToggle.click();
    await expect(body).toHaveClass(/light-theme/);
    
    // Navigate to Actions tab
    await page.click('button:has-text("Actions")');
    await page.waitForSelector('#actions.active');
    
    // Theme should still be light
    await expect(body).toHaveClass(/light-theme/);
    await expect(themeToggle).toContainText('🌙 Dark Mode');
    
    // Navigate to other tabs
    await page.click('button:has-text("Collection Health")');
    await page.waitForSelector('#health.active');
    
    // Theme should still persist
    await expect(body).toHaveClass(/light-theme/);
  });

  test('should show theme toggle button in correct position', async ({ page }) => {
    const themeToggle = page.locator('#theme-toggle');
    
    // Theme toggle should be visible and positioned correctly
    await expect(themeToggle).toBeVisible();
    
    // Check it's positioned in top-right
    const boundingBox = await themeToggle.boundingBox();
    const viewport = page.viewportSize();
    
    // Should be near the right edge
    expect(boundingBox.x).toBeGreaterThan(viewport.width - 200);
    // Should be near the top
    expect(boundingBox.y).toBeLessThan(100);
  });

  test('should work on mobile devices', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    const themeToggle = page.locator('#theme-toggle');
    const body = page.locator('body');
    
    // Theme toggle should still be visible on mobile
    await expect(themeToggle).toBeVisible();
    
    // Should still work on mobile
    await themeToggle.click();
    await expect(body).toHaveClass(/light-theme/);
    
    // Click again
    await themeToggle.click();
    await expect(body).not.toHaveClass(/light-theme/);
  });

  test('should have smooth transitions', async ({ page }) => {
    const body = page.locator('body');
    
    // Check that transition property is set
    const transitionProperty = await body.evaluate(el => 
      getComputedStyle(el).getPropertyValue('transition')
    );
    
    // Should have transition for smooth theme switching
    expect(transitionProperty).toContain('0.3s');
  });

  test('should respect system theme preference when no saved preference', async ({ page }) => {
    // Clear any saved theme preference
    await page.evaluate(() => localStorage.removeItem('ordr-fm-theme'));
    
    // Set system preference to light mode
    await page.emulateMedia({ colorScheme: 'light' });
    
    // Reload to apply system preference
    await page.reload();
    await page.waitForSelector('#status', { timeout: 15000 });
    
    const body = page.locator('body');
    const themeToggle = page.locator('#theme-toggle');
    
    // Should use light theme when system prefers light
    await expect(body).toHaveClass(/light-theme/);
    await expect(themeToggle).toContainText('🌙 Dark Mode');
    
    // Change system preference to dark
    await page.emulateMedia({ colorScheme: 'dark' });
    
    // Clear saved preference and reload
    await page.evaluate(() => localStorage.removeItem('ordr-fm-theme'));
    await page.reload();
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Should use dark theme when system prefers dark
    await expect(body).not.toHaveClass(/light-theme/);
    await expect(themeToggle).toContainText('☀️ Light Mode');
  });

  test('should maintain user preference over system preference', async ({ page }) => {
    // Set system preference to light
    await page.emulateMedia({ colorScheme: 'light' });
    
    const themeToggle = page.locator('#theme-toggle');
    const body = page.locator('body');
    
    // Manually set to dark theme (opposite of system preference)
    await themeToggle.click(); // This should set to dark since system prefers light
    await expect(body).not.toHaveClass(/light-theme/);
    
    // Reload page
    await page.reload();
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Should maintain user's dark preference despite system light preference
    await expect(body).not.toHaveClass(/light-theme/);
    await expect(themeToggle).toContainText('☀️ Light Mode');
  });
});

test.describe('Dark Mode Visual Consistency', () => {
  test('should apply dark theme to all UI components', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Navigate to Actions tab to test all components
    await page.click('button:has-text("Actions")');
    await page.waitForSelector('#actions.active');
    
    // Wait for system status to load
    await page.waitForTimeout(2000);
    
    // Check various components have appropriate dark styling
    const components = [
      { selector: 'header', description: 'Header' },
      { selector: '.card', description: 'Cards' },
      { selector: '.action-card', description: 'Action cards' },
      { selector: '.status-card', description: 'Status cards' },
      { selector: '.action-input', description: 'Input fields' },
      { selector: '.action-btn', description: 'Buttons' }
    ];
    
    for (const component of components) {
      const element = page.locator(component.selector).first();
      
      if (await element.count() > 0) {
        const backgroundColor = await element.evaluate(el => 
          getComputedStyle(el).getPropertyValue('background-color')
        );
        
        const color = await element.evaluate(el => 
          getComputedStyle(el).getPropertyValue('color')
        );
        
        console.log(`${component.description}: bg=${backgroundColor}, color=${color}`);
        
        // Ensure components have dark appropriate styling
        // (Dark backgrounds should have RGB values < 128)
        if (backgroundColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)) {
          const [, r, g, b] = backgroundColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
          const avgBrightness = (parseInt(r) + parseInt(g) + parseInt(b)) / 3;
          expect(avgBrightness).toBeLessThan(128); // Should be dark
        }
      }
    }
  });

  test('should provide good contrast in dark mode', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Check text contrast on dark backgrounds
    const textElements = page.locator('h1, h2, h3, p, .stat-label, .dependency-name');
    const firstTextElement = textElements.first();
    
    const color = await firstTextElement.evaluate(el => 
      getComputedStyle(el).getPropertyValue('color')
    );
    
    // Text should be light colored (high RGB values) for good contrast
    if (color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)) {
      const [, r, g, b] = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      const avgBrightness = (parseInt(r) + parseInt(g) + parseInt(b)) / 3;
      expect(avgBrightness).toBeGreaterThan(128); // Should be light for contrast
    }
  });
});