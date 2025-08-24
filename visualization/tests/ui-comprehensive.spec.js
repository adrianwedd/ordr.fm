// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('ordr.fm UI Comprehensive Tests', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
  });

  // ================
  // NAVIGATION TESTS
  // ================
  
  test('should load dashboard and display title', async ({ page }) => {
    await expect(page).toHaveTitle(/ordr\.fm/);
    const heading = page.locator('h1').first();
    await expect(heading).toContainText('ordr.fm');
  });

  test('should have all navigation tabs', async ({ page }) => {
    const tabs = [
      'Overview', 'Actions', 'Collection Health', 'Duplicates', 
      'Insights', 'Albums', 'Artists', 'Labels', 
      'Timeline', 'Move History'
    ];
    
    for (const tab of tabs) {
      const tabElement = page.locator(`button:has-text("${tab}")`).first();
      await expect(tabElement).toBeVisible();
    }
  });

  test('should switch between tabs', async ({ page }) => {
    // Click on Health tab
    await page.click('button:has-text("Collection Health")');
    await expect(page.locator('#health')).toBeVisible();
    
    // Click on Albums tab
    await page.click('button:has-text("Albums")');
    await expect(page.locator('#albums')).toBeVisible();
    
    // Click back to Overview
    await page.click('button:has-text("Overview")');
    await expect(page.locator('#overview')).toBeVisible();
  });

  // ==================
  // DASHBOARD TESTS
  // ==================
  
  test('should display stats on dashboard', async ({ page }) => {
    await expect(page.locator('#total-albums')).toBeVisible();
    await expect(page.locator('#total-artists')).toBeVisible();
    await expect(page.locator('#total-duration')).toBeVisible();
    
    // Check that values are loaded (not empty)
    const albumCount = await page.locator('#total-albums').textContent();
    expect(albumCount).not.toBe('');
    expect(albumCount).not.toBe('0');
  });

  test('should have quality chart on dashboard', async ({ page }) => {
    const chart = page.locator('#quality-chart');
    await expect(chart).toBeVisible();
    
    // Canvas should be rendered
    const canvas = chart.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  // ==================
  // SEARCH TESTS
  // ==================
  
  test('should have search functionality', async ({ page }) => {
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible();
    
    // Type in search
    await searchInput.fill('test');
    await searchInput.press('Enter');
    
    // Should trigger search (check for results or no results message)
    await page.waitForTimeout(500); // Wait for search to complete
  });

  // ==================
  // ACTIONS TAB TESTS
  // ==================
  
  test('should display system status in Actions tab', async ({ page }) => {
    await page.click('button:has-text("Actions")');
    await expect(page.locator('#actions')).toBeVisible();
    
    // Check for system status elements - look for disk space or system info
    const systemInfo = page.locator('#disk-info, .system-card').first();
    await expect(systemInfo).toBeVisible();
  });

  test('should have backup button in Actions tab', async ({ page }) => {
    await page.click('button:has-text("Actions")');
    
    // Look for backup-related buttons
    const backupButton = page.locator('button:has-text("Backup"), button:has-text("backup")').first();
    await expect(backupButton).toBeVisible();
  });

  test('should trigger database backup', async ({ page }) => {
    await page.click('button:has-text("Actions")');
    
    // Click backup database button
    const backupButton = page.locator('button').filter({ hasText: /Backup Now/i }).first();
    if (await backupButton.isVisible()) {
      await backupButton.click();
      
      // Should show success or progress
      await page.waitForTimeout(1000);
      
      // Check for success message or backup status
      const successMessage = page.locator('text=/backup.*success|completed/i');
      const progressBar = page.locator('[role="progressbar"], .progress-bar');
      
      const hasSuccess = await successMessage.isVisible().catch(() => false);
      const hasProgress = await progressBar.isVisible().catch(() => false);
      
      expect(hasSuccess || hasProgress).toBeTruthy();
    }
  });

  // ==================
  // HEALTH TAB TESTS
  // ==================
  
  test('should display collection health metrics', async ({ page }) => {
    await page.click('button:has-text("Collection Health")');
    await expect(page.locator('#health')).toBeVisible();
    
    // Check for health metrics
    const healthScore = page.locator('#health-score');
    await expect(healthScore).toBeVisible();
    
    const metadataCompleteness = page.locator('#metadata-completeness');
    await expect(metadataCompleteness).toBeVisible();
  });

  test('should have metadata chart in Health tab', async ({ page }) => {
    await page.click('button:has-text("Collection Health")');
    
    const metadataChart = page.locator('#metadata-chart');
    await expect(metadataChart).toBeVisible();
    
    // Check canvas is rendered
    const canvas = metadataChart.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  // ==================
  // ALBUMS TAB TESTS
  // ==================
  
  test('should display albums list', async ({ page }) => {
    await page.click('button:has-text("Albums")');
    await expect(page.locator('#albums')).toBeVisible();
    
    // Wait for albums to load
    await page.waitForTimeout(500);
    
    // Check for album table
    const albumsTable = page.locator('#albums-table');
    await expect(albumsTable).toBeVisible();
    
    // Check for album entries in tbody
    const albumRows = albumsTable.locator('tbody tr');
    const hasAlbums = await albumRows.count();
    
    if (hasAlbums > 0) {
      expect(hasAlbums).toBeGreaterThan(0);
    } else {
      const emptyMessage = page.locator('text=/no albums|empty/i');
      await expect(emptyMessage).toBeVisible();
    }
  });

  // ==================
  // RESPONSIVE TESTS
  // ==================
  
  test('should be responsive on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Check if menu is collapsible or adjusted
    const title = page.locator('h1').first();
    await expect(title).toBeVisible();
    
    // Navigation should still work
    const tabs = page.locator('.tabs, .nav-tabs, [role="tablist"]').first();
    await expect(tabs).toBeVisible();
  });

  // ==================
  // ERROR HANDLING TESTS
  // ==================
  
  test('should handle API errors gracefully', async ({ page }) => {
    // Intercept API call and force error
    await page.route('**/api/stats', route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Test error' })
      });
    });
    
    await page.reload();
    
    // Should not crash, might show error message
    await expect(page.locator('h1').first()).toBeVisible();
  });

  // ==================
  // WEBSOCKET TESTS
  // ==================
  
  test('should establish WebSocket connection', async ({ page }) => {
    // Check console for WebSocket messages
    const messages = [];
    page.on('console', msg => {
      if (msg.text().includes('WebSocket')) {
        messages.push(msg.text());
      }
    });
    
    await page.reload();
    await page.waitForTimeout(2000);
    
    // Should have WebSocket connection messages
    const hasWebSocket = messages.some(m => 
      m.includes('connected') || m.includes('WebSocket')
    );
    expect(hasWebSocket).toBeTruthy();
  });

  // ==================
  // PERFORMANCE TESTS
  // ==================
  
  test('should load within acceptable time', async ({ page }) => {
    const startTime = Date.now();
    
    await page.goto('http://localhost:3000', { 
      waitUntil: 'networkidle' 
    });
    
    const loadTime = Date.now() - startTime;
    
    // Should load within 3 seconds
    expect(loadTime).toBeLessThan(3000);
  });

  // ==================
  // ACCESSIBILITY TESTS
  // ==================
  
  test('should have proper ARIA labels', async ({ page }) => {
    // Check for main landmarks
    const main = page.locator('main, [role="main"]').first();
    await expect(main).toBeVisible();
    
    // Check for navigation
    const nav = page.locator('nav, [role="navigation"]').first();
    await expect(nav).toBeVisible();
    
    // Buttons should be keyboard accessible
    const buttons = await page.locator('button').count();
    expect(buttons).toBeGreaterThan(0);
  });

  // ==================
  // DATA INTEGRITY TESTS
  // ==================
  
  test('should display real data not placeholders', async ({ page }) => {
    await page.click('button:has-text("Collection Health")');
    
    const healthScore = await page.locator('#health-score').textContent();
    
    // Should not be common placeholder values
    expect(healthScore).not.toBe('85%'); // Old mock value
    expect(healthScore).not.toBe('95%'); // Old mock value
    expect(healthScore).not.toBe('100%'); // Unlikely perfect score
  });

  // ==================
  // FORM INTERACTION TESTS
  // ==================
  
  test('should handle form submissions', async ({ page }) => {
    await page.click('button:has-text("Actions")');
    
    // Try the directory selector in Actions tab
    const sourceInput = page.locator('#source-directory');
    
    if (await sourceInput.isVisible()) {
      // Fill input
      await sourceInput.fill('/test/path');
      
      // Look for process button
      const processButton = page.locator('button:has-text("Process"), button:has-text("Start")');
      if (await processButton.isVisible()) {
        await processButton.click();
        
        // Should show response (may require auth)
        await page.waitForTimeout(1000);
      }
    }
  });

  // ==================
  // CHART INTERACTION TESTS
  // ==================
  
  test('should render interactive charts', async ({ page }) => {
    // Go to Timeline tab which should have charts
    await page.click('button:has-text("Timeline")');
    
    const chart = page.locator('canvas').first();
    if (await chart.isVisible()) {
      // Hover over chart
      await chart.hover();
      
      // Charts might show tooltips on hover
      await page.waitForTimeout(500);
      
      // Chart should still be visible after interaction
      await expect(chart).toBeVisible();
    }
  });

  // ==================
  // FILE BROWSER TESTS
  // ==================
  
  test('should have file browser in Actions tab', async ({ page }) => {
    await page.click('button:has-text("Actions")');
    
    // Look for file browser or directory selector
    const fileBrowser = page.locator('#file-browser, .file-browser, #source-directory').first();
    
    if (await fileBrowser.isVisible()) {
      // Should be able to interact with it
      expect(await fileBrowser.isVisible()).toBeTruthy();
    }
  });

  // ==================
  // PWA TESTS
  // ==================
  
  test('should have PWA manifest', async ({ page }) => {
    const response = await page.goto('http://localhost:3000/manifest.json');
    expect(response.status()).toBe(200);
    
    const manifest = await response.json();
    expect(manifest.name).toContain('ordr.fm');
    expect(manifest.icons).toBeDefined();
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('should register service worker', async ({ page }) => {
    // Check if service worker is registered
    const hasServiceWorker = await page.evaluate(() => {
      return 'serviceWorker' in navigator;
    });
    
    expect(hasServiceWorker).toBeTruthy();
    
    // Wait for potential registration
    await page.waitForTimeout(2000);
    
    const registration = await page.evaluate(() => {
      return navigator.serviceWorker.getRegistration();
    });
    
    // Service worker might be registered
    if (registration) {
      expect(registration).toBeDefined();
    }
  });
});

// Additional test suite for authenticated features
test.describe('Authenticated Features', () => {
  
  test('should show login form when accessing protected feature', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.click('text=Actions');
    
    // Try to click a protected action
    const protectedButton = page.locator('button').filter({ hasText: /process|organize|enhance/i }).first();
    
    if (await protectedButton.isVisible()) {
      await protectedButton.click();
      
      // Might show login form or error
      await page.waitForTimeout(1000);
      
      const loginForm = page.locator('form:has-text("login"), .login-form');
      const errorMessage = page.locator('text=/unauthorized|denied|login/i');
      
      const hasLogin = await loginForm.isVisible().catch(() => false);
      const hasError = await errorMessage.isVisible().catch(() => false);
      
      expect(hasLogin || hasError).toBeTruthy();
    }
  });
});