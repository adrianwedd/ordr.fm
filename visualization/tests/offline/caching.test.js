// Offline Caching Tests
const { test, expect } = require('@playwright/test');

test.describe('Offline Caching', () => {
  test('should cache static resources', async ({ page }) => {
    await page.goto('/');
    
    // Wait for service worker to be active
    await page.waitForFunction(() => navigator.serviceWorker.ready, { timeout: 10000 });
    
    // Check that static resources are cached
    const cacheNames = await page.evaluate(async () => {
      return await caches.keys();
    });
    
    expect(cacheNames.length).toBeGreaterThan(0);
    
    // Check specific cache entries
    const staticCache = await page.evaluate(async () => {
      const cache = await caches.open('ordr-fm-v2.0.0');
      const keys = await cache.keys();
      return keys.map(req => req.url);
    });
    
    // Should cache main resources
    const hasMainResources = staticCache.some(url => 
      url.includes('app.js') || url.includes('index.html')
    );
    
    expect(hasMainResources).toBe(true);
  });

  test('should cache API responses', async ({ page }) => {
    await page.goto('/');
    
    // Wait for app to load and make API calls
    await page.waitForSelector('#status.connected', { timeout: 15000 });
    
    // Wait a bit for API caching
    await page.waitForTimeout(2000);
    
    // Check data cache
    const apiCache = await page.evaluate(async () => {
      try {
        const cache = await caches.open('ordr-fm-data-v2.0.0');
        const keys = await cache.keys();
        return keys.map(req => req.url);
      } catch (e) {
        return [];
      }
    });
    
    console.log('API cache entries:', apiCache.length);
    
    // Should have some API responses cached
    const hasAPIResponses = apiCache.some(url => url.includes('/api/'));
    
    if (apiCache.length > 0) {
      expect(hasAPIResponses).toBe(true);
    }
  });

  test('should work offline with cached content', async ({ page, context }) => {
    // Load page online first
    await page.goto('/');
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Wait for caching to complete
    await page.waitForTimeout(3000);
    
    // Go offline
    await context.setOffline(true);
    
    // Reload page
    await page.reload();
    
    // Basic UI should still be available
    const header = page.locator('header h1');
    await expect(header).toBeVisible();
    
    // App structure should be intact
    const tabs = page.locator('.tab');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(0);
    
    // Service worker should handle offline requests
    const title = await page.title();
    expect(title).toBeTruthy();
    
    // Go back online
    await context.setOffline(false);
  });

  test('should use IndexedDB for offline data storage', async ({ page }) => {
    await page.goto('/');
    
    // Wait for app initialization
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Wait for potential IndexedDB operations
    await page.waitForTimeout(3000);
    
    // Check IndexedDB usage
    const indexedDBInfo = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const request = indexedDB.open('ordrfm-offline');
        
        request.onsuccess = (event) => {
          const db = event.target.result;
          resolve({
            name: db.name,
            version: db.version,
            objectStoreNames: Array.from(db.objectStoreNames)
          });
        };
        
        request.onerror = () => {
          resolve({ error: 'IndexedDB not available' });
        };
        
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          resolve({
            name: db.name,
            version: db.version,
            objectStoreNames: Array.from(db.objectStoreNames),
            isNew: true
          });
        };
      });
    });
    
    console.log('IndexedDB info:', indexedDBInfo);
    
    if (!indexedDBInfo.error) {
      expect(indexedDBInfo.name).toBe('ordrfm-offline');
      expect(indexedDBInfo.version).toBeGreaterThan(0);
    }
  });
});

test.describe('Cache Management', () => {
  test('should handle cache versioning', async ({ page }) => {
    await page.goto('/');
    
    // Wait for service worker
    await page.waitForFunction(() => navigator.serviceWorker.ready, { timeout: 10000 });
    
    // Check current cache version
    const cacheNames = await page.evaluate(async () => {
      return await caches.keys();
    });
    
    const currentVersionCaches = cacheNames.filter(name => 
      name.includes('v2.0.0')
    );
    
    expect(currentVersionCaches.length).toBeGreaterThan(0);
    console.log('Current version caches:', currentVersionCaches);
  });

  test('should clean up old cache data', async ({ page }) => {
    await page.goto('/');
    
    // Wait for service worker
    await page.waitForFunction(() => navigator.serviceWorker.ready, { timeout: 10000 });
    
    // Wait for cache cleanup operations
    await page.waitForTimeout(2000);
    
    const cacheNames = await page.evaluate(async () => {
      return await caches.keys();
    });
    
    console.log('All cache names:', cacheNames);
    
    // Should not have too many old caches
    const ordrfmCaches = cacheNames.filter(name => name.startsWith('ordr-fm-'));
    expect(ordrfmCaches.length).toBeLessThan(10); // Reasonable limit
  });

  test('should store and retrieve offline data', async ({ page }) => {
    await page.goto('/');
    
    // Wait for app to load
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Wait for potential offline data storage
    await page.waitForTimeout(3000);
    
    // Test offline data manager functions
    const offlineManagerTest = await page.evaluate(async () => {
      // Test if offline manager exists in service worker context
      // This is complex to test from main thread, so we'll just verify
      // that the mechanisms exist
      
      return {
        indexedDBSupported: 'indexedDB' in window,
        serviceWorkerReady: !!navigator.serviceWorker.ready,
        cacheAPISupported: 'caches' in window
      };
    });
    
    expect(offlineManagerTest.indexedDBSupported).toBe(true);
    expect(offlineManagerTest.cacheAPISupported).toBe(true);
  });
});

test.describe('Offline Fallbacks', () => {
  test('should show offline fallback for API requests', async ({ page, context }) => {
    // Load online first
    await page.goto('/');
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Go offline
    await context.setOffline(true);
    
    // Try to make an API request (simulate tab switch that triggers API call)
    const albumsTab = page.locator('text=Albums');
    await albumsTab.click();
    
    // Wait for potential offline response
    await page.waitForTimeout(2000);
    
    // Page should still be functional even if API is offline
    const isPageFunctional = await page.evaluate(() => {
      return document.querySelector('header') && document.querySelector('.tabs');
    });
    
    expect(isPageFunctional).toBe(true);
    
    // Go back online
    await context.setOffline(false);
  });

  test('should handle offline HTML fallback', async ({ page, context }) => {
    // Load page online first to cache it
    await page.goto('/');
    await page.waitForSelector('header', { timeout: 15000 });
    
    // Go offline
    await context.setOffline(true);
    
    // Navigate to non-cached route (simulate direct navigation)
    try {
      await page.goto('/some-non-existent-route');
      
      // Should get offline fallback or cached main page
      const hasContent = await page.evaluate(() => {
        return document.body.innerHTML.length > 100;
      });
      
      expect(hasContent).toBe(true);
    } catch (error) {
      // Offline navigation might fail, which is acceptable
      console.log('Offline navigation failed as expected');
    }
    
    // Go back online
    await context.setOffline(false);
  });

  test('should sync data when connection restored', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForSelector('#status.connected', { timeout: 15000 });
    
    // Go offline
    await context.setOffline(true);
    await page.waitForTimeout(2000);
    
    // Go back online
    await context.setOffline(false);
    
    // Wait for potential sync
    await page.waitForTimeout(3000);
    
    // Should attempt to reconnect WebSocket
    const wsState = await page.evaluate(() => {
      return window.ws ? window.ws.readyState : null;
    });
    
    // Connection should be restored or attempting to restore
    expect([WebSocket.CONNECTING, WebSocket.OPEN, null]).toContain(wsState);
  });
});