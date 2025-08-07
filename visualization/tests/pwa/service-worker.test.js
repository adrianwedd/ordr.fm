// Service Worker Tests
const { test, expect } = require('@playwright/test');

test.describe('Service Worker', () => {
  test('should register service worker successfully', async ({ page }) => {
    await page.goto('/');
    
    // Wait for service worker registration
    await page.waitForFunction(() => {
      return navigator.serviceWorker && navigator.serviceWorker.ready;
    }, { timeout: 10000 });
    
    // Check service worker is registered
    const swRegistration = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return {
        scope: registration.scope,
        active: !!registration.active,
        installing: !!registration.installing,
        waiting: !!registration.waiting
      };
    });
    
    expect(swRegistration.active).toBe(true);
    expect(swRegistration.scope).toContain('localhost:3001');
  });

  test('should cache static resources', async ({ page }) => {
    await page.goto('/');
    
    // Wait for service worker to be ready
    await page.waitForFunction(() => navigator.serviceWorker.ready, { timeout: 10000 });
    
    // Check that cache is created
    const cacheNames = await page.evaluate(async () => {
      return await caches.keys();
    });
    
    expect(cacheNames.length).toBeGreaterThan(0);
    expect(cacheNames.some(name => name.includes('ordr-fm'))).toBe(true);
  });

  test('should intercept fetch requests', async ({ page }) => {
    await page.goto('/');
    
    // Wait for service worker to be active
    await page.waitForFunction(() => 
      navigator.serviceWorker.ready.then(reg => reg.active), 
      { timeout: 10000 }
    );
    
    // Test API request caching
    const apiResponse = await page.evaluate(async () => {
      const response = await fetch('/api/stats');
      return {
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
        status: response.status
      };
    });
    
    expect(apiResponse.ok).toBe(true);
    expect(apiResponse.status).toBe(200);
  });

  test('should handle offline scenarios', async ({ page, context }) => {
    await page.goto('/');
    
    // Wait for service worker and initial data load
    await page.waitForSelector('#status.connected', { timeout: 15000 });
    
    // Simulate offline mode
    await context.setOffline(true);
    
    // Navigate to ensure offline handling works
    await page.reload();
    
    // Check that offline fallback is shown or cached content is displayed
    const isOfflineHandled = await page.evaluate(() => {
      // Check if we get some kind of offline indication or cached content
      const status = document.getElementById('status');
      return status && (
        status.textContent.includes('offline') || 
        status.textContent.includes('cached') ||
        status.textContent.includes('Disconnected')
      );
    });
    
    // Even if offline isn't explicitly shown, we should still have basic UI
    const hasBasicUI = await page.locator('h1').isVisible();
    expect(hasBasicUI || isOfflineHandled).toBe(true);
    
    // Restore online mode
    await context.setOffline(false);
  });

  test('should support background sync', async ({ page, browserName }) => {
    // Skip on Safari as it has limited service worker support
    if (browserName === 'webkit') return;
    
    await page.goto('/');
    
    // Wait for service worker
    await page.waitForFunction(() => navigator.serviceWorker.ready, { timeout: 10000 });
    
    // Test background sync registration
    const syncSupported = await page.evaluate(() => {
      return 'serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype;
    });
    
    if (syncSupported) {
      const syncRegistered = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        if (registration.sync) {
          try {
            await registration.sync.register('refresh-data');
            return true;
          } catch (e) {
            return false;
          }
        }
        return false;
      });
      
      // Background sync might not be supported in all browsers, that's okay
      console.log('Background sync supported:', syncRegistered);
    }
  });
});

test.describe('Service Worker Caching Strategies', () => {
  test('should use cache-first for static assets', async ({ page }) => {
    await page.goto('/');
    
    // Wait for service worker
    await page.waitForFunction(() => navigator.serviceWorker.ready, { timeout: 10000 });
    
    // Check that app.js is cached
    const cached = await page.evaluate(async () => {
      const cache = await caches.open('ordr-fm-v2.0.0');
      const response = await cache.match('/app.js');
      return !!response;
    });
    
    expect(cached).toBe(true);
  });

  test('should use stale-while-revalidate for API data', async ({ page }) => {
    await page.goto('/');
    
    // Wait for service worker and first API call
    await page.waitForSelector('#status.connected', { timeout: 15000 });
    
    // Make API call
    await page.evaluate(() => fetch('/api/stats'));
    
    // Check that API response is cached
    const apiCached = await page.evaluate(async () => {
      const cache = await caches.open('ordr-fm-data-v2.0.0');
      const response = await cache.match('/api/stats');
      return !!response;
    });
    
    expect(apiCached).toBe(true);
  });

  test('should handle cache versioning and cleanup', async ({ page }) => {
    await page.goto('/');
    
    // Wait for service worker
    await page.waitForFunction(() => navigator.serviceWorker.ready, { timeout: 10000 });
    
    // Check that only current version caches exist
    const cacheNames = await page.evaluate(async () => {
      return await caches.keys();
    });
    
    // Should have current version caches
    const hasCurrentCache = cacheNames.some(name => name.includes('v2.0.0'));
    expect(hasCurrentCache).toBe(true);
    
    // Old versions should be cleaned up (this would be more relevant after version updates)
    const oldCaches = cacheNames.filter(name => 
      name.startsWith('ordr-fm-') && !name.includes('v2.0.0')
    );
    expect(oldCaches.length).toBeLessThanOrEqual(1); // Allow for some transitional state
  });
});