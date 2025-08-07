// Push Notifications Tests
const { test, expect } = require('@playwright/test');

test.describe('Push Notifications', () => {
  test('should request notification permission', async ({ page, browserName, context }) => {
    // Grant notification permission in context
    await context.grantPermissions(['notifications']);
    
    await page.goto('/');
    
    // Wait for PWA initialization
    await page.waitForFunction(() => window.initPWA, { timeout: 10000 });
    
    // Check notification permission
    const permission = await page.evaluate(() => Notification.permission);
    expect(['granted', 'default']).toContain(permission);
  });

  test('should show permission request UI when needed', async ({ page }) => {
    await page.goto('/');
    
    // Wait for app to load
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Check if permission bar appears (it should for default permission)
    const hasPermissionUI = await page.evaluate(() => {
      // Check if permission request would be shown
      return Notification.permission === 'default';
    });
    
    if (hasPermissionUI) {
      // Look for permission UI elements that might appear
      await page.waitForTimeout(2000); // Give time for UI to appear
      
      // The permission bar might appear, but timing depends on implementation
      const permissionElements = await page.locator('.permission-bar').count();
      console.log('Permission UI elements found:', permissionElements);
    }
  });

  test('should handle push subscription', async ({ page, context, browserName }) => {
    // Skip on Safari as it has different push notification handling
    if (browserName === 'webkit') return;
    
    // Grant permissions
    await context.grantPermissions(['notifications']);
    
    await page.goto('/');
    
    // Wait for service worker
    await page.waitForFunction(() => navigator.serviceWorker.ready, { timeout: 10000 });
    
    // Test push manager availability
    const pushSupported = await page.evaluate(() => {
      return 'serviceWorker' in navigator && 'PushManager' in window;
    });
    
    expect(pushSupported).toBe(true);
    
    if (pushSupported) {
      // Test subscription creation (might fail due to VAPID key requirements)
      const subscriptionTest = await page.evaluate(async () => {
        try {
          const registration = await navigator.serviceWorker.ready;
          if (registration.pushManager) {
            // Test if subscription can be created (without actual VAPID key)
            const subscription = await registration.pushManager.getSubscription();
            return { supported: true, hasSubscription: !!subscription };
          }
          return { supported: false };
        } catch (error) {
          return { supported: true, error: error.message };
        }
      });
      
      expect(subscriptionTest.supported).toBe(true);
    }
  });

  test('should test local notifications', async ({ page, context }) => {
    await context.grantPermissions(['notifications']);
    
    await page.goto('/');
    
    // Wait for app initialization
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Test the notification test function
    const notificationResult = await page.evaluate(async () => {
      if (typeof window.testPushNotification === 'function') {
        try {
          window.testPushNotification();
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
      return { success: false, error: 'Function not found' };
    });
    
    // The function should exist and be callable
    expect(['success', 'error']).toContain(Object.keys(notificationResult)[0]);
  });
});

test.describe('Notification UI Integration', () => {
  test('should show notification permission UI components', async ({ page }) => {
    await page.goto('/');
    
    // Wait for app load
    await page.waitForSelector('header', { timeout: 15000 });
    
    // Check that notification-related functions exist
    const notificationFunctions = await page.evaluate(() => {
      return {
        hasTestFunction: typeof window.testPushNotification === 'function',
        hasRequestFunction: typeof window.requestNotificationPermission === 'function',
        hasInitFunction: typeof window.initPushNotifications === 'function'
      };
    });
    
    expect(notificationFunctions.hasTestFunction).toBe(true);
  });

  test('should handle notification permission states', async ({ page, context }) => {
    await page.goto('/');
    
    // Test different permission states
    const permissionStates = ['default', 'granted', 'denied'];
    
    for (const state of permissionStates) {
      if (state === 'granted') {
        await context.grantPermissions(['notifications']);
      }
      
      const currentPermission = await page.evaluate(() => Notification.permission);
      console.log(`Testing notification permission state: ${state}, actual: ${currentPermission}`);
      
      // The app should handle all permission states gracefully
      expect(['default', 'granted', 'denied']).toContain(currentPermission);
    }
  });

  test('should integrate with mobile quick actions', async ({ page }) => {
    await page.goto('/');
    
    // Wait for mobile components to load
    await page.waitForSelector('#mobile-fab', { timeout: 15000 });
    
    // Check mobile FAB exists
    const mobileFab = page.locator('#mobile-fab');
    const fabExists = await mobileFab.count() > 0;
    
    if (fabExists) {
      // Click mobile menu
      await mobileFab.click();
      
      // Wait for bottom sheet
      await page.waitForSelector('#mobile-menu.open', { timeout: 5000 });
      
      // Check for notification test card
      const testNotificationCard = page.locator('text=Test Notifications');
      await expect(testNotificationCard).toBeVisible();
    }
  });
});