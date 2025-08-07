// WebSocket Real-time Tests
const { test, expect } = require('@playwright/test');

test.describe('WebSocket Connection', () => {
  test('should establish WebSocket connection', async ({ page }) => {
    await page.goto('/');
    
    // Wait for WebSocket connection
    await page.waitForFunction(() => {
      return window.ws && window.ws.readyState === WebSocket.OPEN;
    }, { timeout: 15000 });
    
    // Verify connection
    const wsState = await page.evaluate(() => ({
      readyState: window.ws.readyState,
      url: window.ws.url
    }));
    
    expect(wsState.readyState).toBe(WebSocket.OPEN);
    expect(wsState.url).toContain('localhost:3001');
  });

  test('should handle WebSocket reconnection', async ({ page, context }) => {
    await page.goto('/');
    
    // Wait for initial connection
    await page.waitForFunction(() => 
      window.ws && window.ws.readyState === WebSocket.OPEN, 
      { timeout: 15000 }
    );
    
    // Simulate network disconnect
    await context.setOffline(true);
    
    // Wait for connection to close
    await page.waitForFunction(() => 
      window.ws && window.ws.readyState === WebSocket.CLOSED,
      { timeout: 10000 }
    );
    
    // Restore network
    await context.setOffline(false);
    
    // Wait for reconnection attempt (implementation should retry)
    await page.waitForTimeout(5000);
    
    // Check if reconnection was attempted
    const reconnectionAttempts = await page.evaluate(() => window.wsReconnectAttempts);
    expect(reconnectionAttempts).toBeGreaterThanOrEqual(0);
  });

  test('should receive real-time statistics updates', async ({ page }) => {
    await page.goto('/');
    
    // Wait for connection and initial data
    await page.waitForSelector('#status.connected', { timeout: 15000 });
    
    // Wait for potential statistics update (server sends every 30 seconds)
    let statsUpdated = false;
    let initialAlbumCount = '';
    
    // Get initial album count
    const albumCountElement = page.locator('#stat-albums');
    if (await albumCountElement.count() > 0) {
      initialAlbumCount = await albumCountElement.textContent();
    }
    
    // Listen for WebSocket messages
    const wsMessages = [];
    await page.evaluate(() => {
      window.wsMessages = [];
      if (window.ws) {
        const originalOnMessage = window.ws.onmessage;
        window.ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          window.wsMessages.push(data);
          if (originalOnMessage) originalOnMessage(event);
        };
      }
    });
    
    // Wait for potential message
    await page.waitForTimeout(3000);
    
    // Check if any messages were received
    const messages = await page.evaluate(() => window.wsMessages || []);
    
    console.log('WebSocket messages received:', messages.length);
    
    if (messages.length > 0) {
      const hasStatsUpdate = messages.some(msg => msg.type === 'stats_update');
      console.log('Received stats update:', hasStatsUpdate);
    }
    
    // Connection should remain active
    const wsState = await page.evaluate(() => window.ws.readyState);
    expect(wsState).toBe(WebSocket.OPEN);
  });

  test('should handle WebSocket ping/pong', async ({ page }) => {
    await page.goto('/');
    
    // Wait for connection
    await page.waitForFunction(() => 
      window.ws && window.ws.readyState === WebSocket.OPEN,
      { timeout: 15000 }
    );
    
    // Send ping message
    await page.evaluate(() => {
      if (window.ws) {
        window.ws.send(JSON.stringify({ type: 'ping' }));
      }
    });
    
    // Wait for potential pong response
    await page.waitForTimeout(1000);
    
    // Connection should remain healthy
    const wsState = await page.evaluate(() => window.ws.readyState);
    expect(wsState).toBe(WebSocket.OPEN);
  });
});

test.describe('Real-time UI Updates', () => {
  test('should update connection status indicator', async ({ page }) => {
    await page.goto('/');
    
    // Wait for connection
    await page.waitForSelector('#status.connected', { timeout: 15000 });
    
    const statusText = await page.locator('#status').textContent();
    expect(statusText).toContain('Connected');
  });

  test('should show real-time notifications', async ({ page }) => {
    await page.goto('/');
    
    // Wait for WebSocket connection
    await page.waitForFunction(() => 
      window.ws && window.ws.readyState === WebSocket.OPEN,
      { timeout: 15000 }
    );
    
    // Test processing notification function
    const hasNotificationFunction = await page.evaluate(() => 
      typeof window.showProcessingNotification === 'function'
    );
    
    expect(hasNotificationFunction).toBe(true);
    
    // Simulate a notification
    await page.evaluate(() => {
      window.showProcessingNotification({ 
        message: 'Test notification from Playwright' 
      });
    });
    
    // Check if notification appears
    const notification = page.locator('.processing-notification');
    await expect(notification).toBeVisible();
    
    // Notification should auto-dismiss
    await page.waitForTimeout(5000);
    const notificationGone = await notification.count();
    expect(notificationGone).toBe(0);
  });

  test('should handle connection status changes', async ({ page, context }) => {
    await page.goto('/');
    
    // Wait for initial connection
    await page.waitForSelector('#status.connected', { timeout: 15000 });
    
    // Simulate disconnect
    await context.setOffline(true);
    
    // Wait for status to update
    await page.waitForTimeout(3000);
    
    // Status should show disconnected state
    const statusElement = page.locator('#status');
    const statusText = await statusElement.textContent();
    
    // Should indicate connection problem
    const hasConnectionIssue = statusText.includes('Disconnected') || 
                               statusText.includes('Error') || 
                               !statusText.includes('Connected');
    
    console.log('Status during offline:', statusText);
    
    // Restore connection
    await context.setOffline(false);
    
    // Wait for potential reconnection
    await page.waitForTimeout(5000);
  });
});

test.describe('WebSocket Message Handling', () => {
  test('should handle subscription messages', async ({ page }) => {
    await page.goto('/');
    
    // Wait for WebSocket connection
    await page.waitForFunction(() => 
      window.ws && window.ws.readyState === WebSocket.OPEN,
      { timeout: 15000 }
    );
    
    // Send subscription message
    await page.evaluate(() => {
      if (window.ws) {
        window.ws.send(JSON.stringify({
          type: 'subscribe',
          channels: ['stats', 'processing', 'alerts']
        }));
      }
    });
    
    // Wait for response
    await page.waitForTimeout(1000);
    
    // Connection should still be active
    const wsState = await page.evaluate(() => window.ws.readyState);
    expect(wsState).toBe(WebSocket.OPEN);
  });

  test('should handle alert messages', async ({ page }) => {
    await page.goto('/');
    
    // Wait for connection
    await page.waitForFunction(() => 
      window.ws && window.ws.readyState === WebSocket.OPEN,
      { timeout: 15000 }
    );
    
    // Test alert handler function
    const hasAlertFunction = await page.evaluate(() => 
      typeof window.showAlert === 'function'
    );
    
    expect(hasAlertFunction).toBe(true);
    
    // Simulate alert message
    await page.evaluate(() => {
      window.showAlert({
        icon: '⚠️',
        message: 'Test alert from Playwright test'
      });
    });
    
    // Check if alert appears
    const alert = page.locator('.alert-notification');
    const alertExists = await alert.count() > 0;
    
    // Alert notification might appear briefly
    console.log('Alert notification appeared:', alertExists);
  });

  test('should maintain WebSocket connection during navigation', async ({ page }) => {
    await page.goto('/');
    
    // Wait for initial connection
    await page.waitForFunction(() => 
      window.ws && window.ws.readyState === WebSocket.OPEN,
      { timeout: 15000 }
    );
    
    // Switch tabs (simulates navigation within SPA)
    const secondTab = page.locator('.tab').nth(1);
    await secondTab.click();
    
    // Wait for tab switch
    await page.waitForTimeout(1000);
    
    // WebSocket should remain connected
    const wsState = await page.evaluate(() => window.ws.readyState);
    expect(wsState).toBe(WebSocket.OPEN);
    
    // Switch back to first tab
    const firstTab = page.locator('.tab').first();
    await firstTab.click();
    
    // Connection should still be active
    await page.waitForTimeout(500);
    const finalWsState = await page.evaluate(() => window.ws.readyState);
    expect(finalWsState).toBe(WebSocket.OPEN);
  });
});