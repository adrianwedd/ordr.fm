// File Browser E2E Tests
const { test, expect } = require('@playwright/test');

test.describe('File Browser Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3001/');
    
    // Wait for app to initialize
    await page.waitForSelector('#status', { timeout: 15000 });
    
    // Click on Actions tab
    await page.click('button:has-text("Actions")');
    await page.waitForSelector('#actions.active', { timeout: 5000 });
  });

  test('should show file browser option in source directory dropdown', async ({ page }) => {
    const sourceSelect = page.locator('#source-directory');
    await expect(sourceSelect).toBeVisible();
    
    // Check that "Browse Folders..." option is present
    const options = await sourceSelect.locator('option').allTextContents();
    expect(options).toContain('Browse Folders...');
  });

  test('should open file browser modal when "Browse Folders..." is selected', async ({ page }) => {
    const sourceSelect = page.locator('#source-directory');
    const fileBrowserModal = page.locator('#file-browser-modal');
    
    // Initially modal should not be visible
    await expect(fileBrowserModal).not.toBeVisible();
    
    // Select "Browse Folders..." option
    await sourceSelect.selectOption('browse');
    
    // Modal should become visible
    await expect(fileBrowserModal).toBeVisible();
    
    // Check modal content
    await expect(page.locator('.file-browser-header h3')).toContainText('Select Music Folder');
    await expect(page.locator('.close-browser')).toBeVisible();
    await expect(page.locator('#current-path')).toBeVisible();
  });

  test('should display directory contents in file browser', async ({ page }) => {
    const sourceSelect = page.locator('#source-directory');
    
    // Open file browser
    await sourceSelect.selectOption('browse');
    await page.waitForSelector('#file-browser-modal', { state: 'visible' });
    
    // Wait for directory contents to load
    await page.waitForTimeout(2000);
    
    const directoryList = page.locator('#directory-list');
    await expect(directoryList).toBeVisible();
    
    // Should have some directory items or a message
    const items = page.locator('.directory-item');
    const noItemsMessage = page.locator('.no-items');
    
    // Either items should exist or "no items" message should be shown
    const itemCount = await items.count();
    if (itemCount === 0) {
      await expect(noItemsMessage).toBeVisible();
    } else {
      await expect(items.first()).toBeVisible();
    }
  });

  test('should show current path in file browser', async ({ page }) => {
    const sourceSelect = page.locator('#source-directory');
    
    // Open file browser
    await sourceSelect.selectOption('browse');
    await page.waitForSelector('#file-browser-modal', { state: 'visible' });
    
    // Wait for initial load
    await page.waitForTimeout(2000);
    
    const currentPath = page.locator('#current-path');
    await expect(currentPath).toBeVisible();
    
    // Should show a valid path (starts with /)
    const pathText = await currentPath.textContent();
    expect(pathText).toMatch(/^\/.*$/);
  });

  test('should allow navigation to parent directory', async ({ page }) => {
    const sourceSelect = page.locator('#source-directory');
    
    // Open file browser
    await sourceSelect.selectOption('browse');
    await page.waitForSelector('#file-browser-modal', { state: 'visible' });
    
    // Wait for initial load
    await page.waitForTimeout(2000);
    
    const upButton = page.locator('.nav-up');
    const currentPath = page.locator('#current-path');
    
    // Get initial path
    const initialPath = await currentPath.textContent();
    
    // If not at root, up button should be visible
    if (initialPath !== '/') {
      await expect(upButton).toBeVisible();
      
      // Click up button
      await upButton.click();
      
      // Wait for navigation
      await page.waitForTimeout(1000);
      
      // Path should have changed (should be parent directory)
      const newPath = await currentPath.textContent();
      expect(newPath).not.toBe(initialPath);
      expect(initialPath).toMatch(new RegExp(`^${newPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }
  });

  test('should allow directory navigation by clicking folders', async ({ page }) => {
    const sourceSelect = page.locator('#source-directory');
    
    // Open file browser
    await sourceSelect.selectOption('browse');
    await page.waitForSelector('#file-browser-modal', { state: 'visible' });
    
    // Wait for initial load
    await page.waitForTimeout(2000);
    
    // Look for folder items (they should have folder icon)
    const folderItems = page.locator('.directory-item .item-name:has(+ .item-icon:text("📁"))');
    
    if (await folderItems.count() > 0) {
      const currentPath = page.locator('#current-path');
      const initialPath = await currentPath.textContent();
      
      // Click on first folder
      await folderItems.first().click();
      
      // Wait for navigation
      await page.waitForTimeout(2000);
      
      // Path should have changed
      const newPath = await currentPath.textContent();
      expect(newPath).not.toBe(initialPath);
      expect(newPath).toContain(initialPath);
    }
  });

  test('should show audio file indicators for folders with music', async ({ page }) => {
    const sourceSelect = page.locator('#source-directory');
    
    // Open file browser
    await sourceSelect.selectOption('browse');
    await page.waitForSelector('#file-browser-modal', { state: 'visible' });
    
    // Navigate to a music directory that likely has audio files
    // Try to navigate to /home/plex/Music if it exists
    const currentPath = page.locator('#current-path');
    let currentPathText = await currentPath.textContent();
    
    // If not already in music directory, try to navigate there
    if (!currentPathText.includes('Music')) {
      // Look for directories that might lead to music
      const directoryItems = page.locator('.directory-item');
      const itemCount = await directoryItems.count();
      
      for (let i = 0; i < Math.min(itemCount, 5); i++) {
        const item = directoryItems.nth(i);
        const itemText = await item.locator('.item-name').textContent();
        
        // Look for music-related directory names
        if (itemText && (itemText.includes('Music') || itemText.includes('media') || itemText.includes('plex'))) {
          await item.click();
          await page.waitForTimeout(2000);
          break;
        }
      }
    }
    
    // Look for audio indicators (🎵) on directories
    const audioIndicators = page.locator('.has-audio');
    const audioCount = await audioIndicators.count();
    
    // If we found any audio indicators, verify they're displayed correctly
    if (audioCount > 0) {
      await expect(audioIndicators.first()).toBeVisible();
      await expect(audioIndicators.first()).toContainText('🎵');
    }
  });

  test('should select path when clicking Select button', async ({ page }) => {
    const sourceSelect = page.locator('#source-directory');
    
    // Open file browser
    await sourceSelect.selectOption('browse');
    await page.waitForSelector('#file-browser-modal', { state: 'visible' });
    
    // Wait for initial load
    await page.waitForTimeout(2000);
    
    const selectButton = page.locator('.select-path');
    const currentPath = page.locator('#current-path');
    
    // Get the current path
    const selectedPath = await currentPath.textContent();
    
    // Click select button
    await selectButton.click();
    
    // Modal should close
    await expect(page.locator('#file-browser-modal')).not.toBeVisible();
    
    // Source directory should be set to "custom"
    await expect(sourceSelect).toHaveValue('custom');
    
    // Custom source input should be visible and contain the selected path
    const customInput = page.locator('#custom-source');
    await expect(customInput).toBeVisible();
    await expect(customInput).toHaveValue(selectedPath);
  });

  test('should close file browser when close button is clicked', async ({ page }) => {
    const sourceSelect = page.locator('#source-directory');
    
    // Open file browser
    await sourceSelect.selectOption('browse');
    await page.waitForSelector('#file-browser-modal', { state: 'visible' });
    
    const closeButton = page.locator('.close-browser');
    
    // Click close button
    await closeButton.click();
    
    // Modal should close
    await expect(page.locator('#file-browser-modal')).not.toBeVisible();
    
    // Source directory should revert to first option
    const firstOptionValue = await sourceSelect.locator('option').first().getAttribute('value');
    await expect(sourceSelect).toHaveValue(firstOptionValue);
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Mock API error for browse endpoint
    await page.route('/api/browse*', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Access denied' })
      });
    });
    
    const sourceSelect = page.locator('#source-directory');
    
    // Open file browser
    await sourceSelect.selectOption('browse');
    await page.waitForSelector('#file-browser-modal', { state: 'visible' });
    
    // Wait for API call
    await page.waitForTimeout(2000);
    
    // Should show error message
    const errorMessage = page.locator('.error-message');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText(/error/i);
  });

  test('should work on mobile devices', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    const sourceSelect = page.locator('#source-directory');
    
    // Open file browser
    await sourceSelect.selectOption('browse');
    await page.waitForSelector('#file-browser-modal', { state: 'visible' });
    
    // Wait for initial load
    await page.waitForTimeout(2000);
    
    // Modal should be responsive
    const modal = page.locator('.file-browser-modal');
    const modalBox = await modal.boundingBox();
    const viewport = page.viewportSize();
    
    // Modal should fit within viewport
    expect(modalBox.width).toBeLessThanOrEqual(viewport.width);
    expect(modalBox.height).toBeLessThanOrEqual(viewport.height);
    
    // Navigation buttons should be touch-friendly
    const upButton = page.locator('.nav-up');
    if (await upButton.isVisible()) {
      const upButtonBox = await upButton.boundingBox();
      expect(upButtonBox.height).toBeGreaterThanOrEqual(44); // Minimum touch target size
    }
  });

  test('should maintain dark theme in file browser', async ({ page }) => {
    const sourceSelect = page.locator('#source-directory');
    
    // Open file browser
    await sourceSelect.selectOption('browse');
    await page.waitForSelector('#file-browser-modal', { state: 'visible' });
    
    // Modal should have dark theme styling
    const modal = page.locator('.file-browser-modal');
    const modalContent = page.locator('.file-browser-content');
    
    // Check that dark theme colors are applied
    const modalBg = await modalContent.evaluate(el => 
      getComputedStyle(el).getPropertyValue('background-color')
    );
    
    // Should have dark background (RGB values < 128)
    if (modalBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)) {
      const [, r, g, b] = modalBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      const avgBrightness = (parseInt(r) + parseInt(g) + parseInt(b)) / 3;
      expect(avgBrightness).toBeLessThan(128);
    }
  });
});

test.describe('File Browser Integration', () => {
  test('should integrate with processing workflow', async ({ page }) => {
    await page.goto('http://localhost:3001/');
    await page.waitForSelector('#status', { timeout: 15000 });
    await page.click('button:has-text("Actions")');
    await page.waitForSelector('#actions.active', { timeout: 5000 });
    
    const sourceSelect = page.locator('#source-directory');
    
    // Open file browser and select a path
    await sourceSelect.selectOption('browse');
    await page.waitForSelector('#file-browser-modal', { state: 'visible' });
    await page.waitForTimeout(2000);
    
    // Select the current path
    await page.click('.select-path');
    
    // Verify custom source is populated
    const customInput = page.locator('#custom-source');
    await expect(customInput).toBeVisible();
    
    const selectedPath = await customInput.inputValue();
    expect(selectedPath).toMatch(/^\/.*$/);
    
    // Should be able to start dry run with selected path
    const dryRunButton = page.locator('button:has-text("Dry Run")');
    await expect(dryRunButton).toBeEnabled();
  });

  test('should preserve selected path across tab switches', async ({ page }) => {
    await page.goto('http://localhost:3001/');
    await page.waitForSelector('#status', { timeout: 15000 });
    await page.click('button:has-text("Actions")');
    await page.waitForSelector('#actions.active', { timeout: 5000 });
    
    const sourceSelect = page.locator('#source-directory');
    
    // Open file browser and select a path
    await sourceSelect.selectOption('browse');
    await page.waitForSelector('#file-browser-modal', { state: 'visible' });
    await page.waitForTimeout(2000);
    await page.click('.select-path');
    
    const customInput = page.locator('#custom-source');
    const selectedPath = await customInput.inputValue();
    
    // Switch to another tab
    await page.click('button:has-text("Overview")');
    await page.waitForSelector('#overview.active');
    
    // Switch back to Actions
    await page.click('button:has-text("Actions")');
    await page.waitForSelector('#actions.active');
    
    // Selected path should be preserved
    await expect(sourceSelect).toHaveValue('custom');
    await expect(customInput).toHaveValue(selectedPath);
  });
});