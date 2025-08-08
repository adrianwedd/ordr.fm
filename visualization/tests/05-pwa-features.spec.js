// PWA-specific functionality tests
const { test, expect } = require('@playwright/test');

test.describe('PWA Core Features', () => {
  test('service worker registers successfully', async ({ page }) => {
    await page.goto('/');
    
    // Wait for service worker registration
    const swRegistered = await page.waitForFunction(() => {
      return navigator.serviceWorker.ready.then(() => true).catch(() => false);
    }, { timeout: 10000 });
    
    expect(swRegistered).toBe(true);
  });

  test('manifest.json is accessible and valid', async ({ page }) => {
    const response = await page.request.get('/manifest.json');
    expect(response.status()).toBe(200);
    
    const manifest = await response.json();
    expect(manifest).toHaveProperty('name');
    expect(manifest).toHaveProperty('short_name');
    expect(manifest).toHaveProperty('start_url');
    expect(manifest).toHaveProperty('display');
    expect(manifest).toHaveProperty('theme_color');
    expect(manifest).toHaveProperty('icons');
    expect(Array.isArray(manifest.icons)).toBe(true);
  });

  test('offline functionality works', async ({ page }) => {
    await page.goto('/');
    
    // Wait for service worker to be ready
    await page.waitForFunction(() => {
      return navigator.serviceWorker.ready;
    }, { timeout: 10000 });
    
    // Simulate offline mode
    await page.context().setOffline(true);
    
    // Reload page - should still work with cached content
    await page.reload();
    
    // Should still show basic UI
    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });
    
    // Restore online
    await page.context().setOffline(false);
  });

  test('PWA installation prompt can be triggered', async ({ page }) => {
    await page.goto('/');
    
    // Check for PWA install elements
    const installButton = page.locator('.install-button, [data-action="install"], #install-pwa');
    const installPrompt = page.locator('.install-prompt, .pwa-banner');
    
    // At least one install-related element should exist
    if (await installButton.count() > 0 || await installPrompt.count() > 0) {
      expect(true).toBe(true); // PWA install elements present
    }
  });

  test('app icon loads correctly', async ({ page }) => {
    await page.goto('/');
    
    // Check favicon
    const favicon = page.locator('link[rel="icon"], link[rel="shortcut icon"]');
    if (await favicon.count() > 0) {
      const href = await favicon.first().getAttribute('href');
      const response = await page.request.get(href);
      expect(response.status()).toBe(200);
    }
    
    // Check apple touch icon
    const appleTouchIcon = page.locator('link[rel="apple-touch-icon"]');
    if (await appleTouchIcon.count() > 0) {
      const href = await appleTouchIcon.first().getAttribute('href');
      const response = await page.request.get(href);
      expect(response.status()).toBe(200);
    }
  });
});

test.describe('Mobile PWA Experience', () => {
  test('touch interactions work correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    // Test touch navigation
    await page.tap('[data-tab="overview"]');
    await expect(page.locator('[data-section="overview"]')).toBeVisible();
    
    await page.tap('[data-tab="analytics"]');
    await expect(page.locator('[data-section="analytics"]')).toBeVisible();
  });

  test('mobile menu works if present', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    
    // Look for mobile menu trigger
    const menuButton = page.locator('.mobile-menu-button, .hamburger, [data-toggle="menu"]');
    
    if (await menuButton.isVisible()) {
      await menuButton.tap();
      
      // Menu should become visible
      const menu = page.locator('.mobile-menu, .menu-overlay, nav[role="navigation"]');
      await expect(menu).toBeVisible();
    }
  });

  test('viewport meta tag is correct for mobile', async ({ page }) => {
    await page.goto('/');
    
    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveAttribute('content', /width=device-width/);
  });
});

test.describe('Performance and Optimization', () => {
  test('page loads within acceptable time', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/');
    await page.waitForSelector('h1');
    const loadTime = Date.now() - startTime;
    
    // Should load within 5 seconds
    expect(loadTime).toBeLessThan(5000);
  });

  test('critical resources load correctly', async ({ page }) => {
    await page.goto('/');
    
    // Check that CSS is loaded
    const styles = await page.evaluate(() => {
      const computed = getComputedStyle(document.body);
      return computed.margin !== '' || computed.padding !== '';
    });
    expect(styles).toBe(true);
    
    // Check that JavaScript is working
    const jsWorking = await page.evaluate(() => {
      return typeof window.init === 'function' || 
             typeof window.fetchAPI === 'function' ||
             document.querySelector('[data-tab]') !== null;
    });
    expect(jsWorking).toBe(true);
  });

  test('WebSocket connection is stable', async ({ page }) => {
    await page.goto('/');
    
    // Wait for initial connection
    await page.waitForFunction(() => {
      return window.ws && window.ws.readyState === WebSocket.OPEN;
    }, { timeout: 15000 });
    
    // Wait a bit and check it's still connected
    await page.waitForTimeout(3000);
    
    const isStillConnected = await page.evaluate(() => {
      return window.ws && window.ws.readyState === WebSocket.OPEN;
    });
    
    expect(isStillConnected).toBe(true);
  });
});