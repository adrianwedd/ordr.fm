// PWA Manifest and Installation Tests
const { test, expect } = require('@playwright/test');

test.describe('PWA Manifest', () => {
  test('should have valid PWA manifest', async ({ page }) => {
    await page.goto('/');
    
    // Check manifest link exists
    const manifestLink = await page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute('href', 'manifest.json');
    
    // Fetch and validate manifest content
    const manifestResponse = await page.request.get('/manifest.json');
    expect(manifestResponse.ok()).toBeTruthy();
    
    const manifest = await manifestResponse.json();
    
    // Validate required manifest fields
    expect(manifest.name).toBe('ordr.fm Music Analytics');
    expect(manifest.short_name).toBe('ordr.fm');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#667eea');
    expect(manifest.background_color).toBe('#ffffff');
    
    // Check icons array
    expect(manifest.icons).toBeDefined();
    expect(manifest.icons.length).toBeGreaterThan(0);
    
    // Validate icon sizes
    const iconSizes = manifest.icons.map(icon => icon.sizes);
    expect(iconSizes).toContain('192x192');
    expect(iconSizes).toContain('512x512');
  });

  test('should have all PWA meta tags', async ({ page }) => {
    await page.goto('/');
    
    // Check essential PWA meta tags
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#667eea');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', 'width=device-width, initial-scale=1.0');
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'ordr.fm');
    
    // Check Apple touch icon
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', 'icons/icon-192x192.png');
  });

  test('should have valid icons at all sizes', async ({ page }) => {
    await page.goto('/manifest.json');
    const manifest = await page.evaluate(() => window.fetch('/manifest.json').then(r => r.json()));
    
    // Test each icon URL
    for (const icon of manifest.icons) {
      const iconResponse = await page.request.get('/' + icon.src);
      expect(iconResponse.ok()).toBeTruthy();
      expect(iconResponse.headers()['content-type']).toContain('image/png');
    }
  });
});

test.describe('PWA Installation', () => {
  test('should support installation prompt', async ({ page, browserName }) => {
    // Skip on Safari as it doesn't support beforeinstallprompt
    if (browserName === 'webkit') {return;}
    
    await page.goto('/');
    
    // Wait for PWA initialization
    await page.waitForFunction(() => window.deferredPrompt !== undefined, { timeout: 5000 });
    
    // Simulate beforeinstallprompt event
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt');
      event.preventDefault = () => {};
      event.prompt = async () => ({ outcome: 'accepted' });
      event.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(event);
    });
    
    // Check if install button appears
    await page.waitForSelector('#install-button', { timeout: 5000 });
    const installButton = page.locator('#install-button');
    await expect(installButton).toBeVisible();
  });

  test('should handle app installation lifecycle', async ({ page, browserName }) => {
    if (browserName === 'webkit') {return;}
    
    await page.goto('/');
    
    // Simulate installation
    await page.evaluate(() => {
      const installEvent = new Event('appinstalled');
      window.dispatchEvent(installEvent);
    });
    
    // Check that install button is hidden after installation
    await page.waitForFunction(() => {
      const button = document.getElementById('install-button');
      return !button || button.style.display === 'none';
    });
  });
});

test.describe('PWA Shortcuts and Protocol Handlers', () => {
  test('should have app shortcuts defined', async ({ page }) => {
    const manifestResponse = await page.request.get('/manifest.json');
    const manifest = await manifestResponse.json();
    
    expect(manifest.shortcuts).toBeDefined();
    expect(manifest.shortcuts.length).toBeGreaterThan(0);
    
    // Check specific shortcuts
    const shortcutNames = manifest.shortcuts.map(s => s.name);
    expect(shortcutNames).toContain('Collection Health');
    expect(shortcutNames).toContain('Duplicate Analysis');
    expect(shortcutNames).toContain('Advanced Insights');
  });

  test('should have protocol handlers', async ({ page }) => {
    const manifestResponse = await page.request.get('/manifest.json');
    const manifest = await manifestResponse.json();
    
    expect(manifest.protocol_handlers).toBeDefined();
    expect(manifest.protocol_handlers.length).toBeGreaterThan(0);
    
    const protocolHandler = manifest.protocol_handlers[0];
    expect(protocolHandler.protocol).toBe('web+ordrfm');
    expect(protocolHandler.url).toBe('/?action=%s');
  });
});