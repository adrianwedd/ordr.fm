const { test, expect } = require('@playwright/test');

test.describe('Advanced Search Functionality', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to the application and Albums tab
        await page.goto('/');
        await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
        await page.click('button.tab:has-text("Albums")');
        await expect(page.locator('#albums')).toBeVisible();
    });

    test('Search interface is properly displayed', async ({ page }) => {
        // Check search container is visible
        await expect(page.locator('#albums-search-container')).toBeVisible();
        
        // Check search header
        await expect(page.locator('.search-header h2')).toContainText('Advanced Album Search');
        
        // Check toggle button
        const toggleBtn = page.locator('#albums-search-toggle');
        await expect(toggleBtn).toBeVisible();
        await expect(toggleBtn).toContainText('Hide Search');
        
        // Check all search fields are present
        await expect(page.locator('#search-album-title')).toBeVisible();
        await expect(page.locator('#search-artist-name')).toBeVisible();
        await expect(page.locator('#search-label-name')).toBeVisible();
        await expect(page.locator('#search-year-from')).toBeVisible();
        await expect(page.locator('#search-year-to')).toBeVisible();
        await expect(page.locator('#search-quality')).toBeVisible();
        await expect(page.locator('#search-org-mode')).toBeVisible();
        
        // Check search action buttons
        await expect(page.locator('button:has-text("Search Albums")')).toBeVisible();
        await expect(page.locator('button:has-text("Clear Filters")')).toBeVisible();
        await expect(page.locator('button:has-text("Save Search")')).toBeVisible();
    });

    test('Search toggle functionality works', async ({ page }) => {
        // Initially search form should be visible
        await expect(page.locator('#albums-search-form')).toBeVisible();
        
        // Click toggle to hide
        await page.click('#albums-search-toggle');
        
        // Form should be hidden
        await expect(page.locator('#albums-search-container')).toHaveClass(/search-collapsed/);
        await expect(page.locator('#albums-search-toggle')).toContainText('Show Search');
        
        // Click toggle to show again
        await page.click('#albums-search-toggle');
        
        // Form should be visible
        await expect(page.locator('#albums-search-container')).not.toHaveClass(/search-collapsed/);
        await expect(page.locator('#albums-search-toggle')).toContainText('Hide Search');
    });

    test('Search input validation works', async ({ page }) => {
        // Test year inputs have proper constraints
        const yearFrom = page.locator('#search-year-from');
        const yearTo = page.locator('#search-year-to');
        
        await expect(yearFrom).toHaveAttribute('type', 'number');
        await expect(yearFrom).toHaveAttribute('min', '1900');
        await expect(yearFrom).toHaveAttribute('max', '2030');
        
        await expect(yearTo).toHaveAttribute('type', 'number');
        await expect(yearTo).toHaveAttribute('min', '1900');
        await expect(yearTo).toHaveAttribute('max', '2030');
        
        // Test select options
        const qualitySelect = page.locator('#search-quality');
        await expect(qualitySelect.locator('option:has-text("All Qualities")')).toBeVisible();
        await expect(qualitySelect.locator('option:has-text("Lossless")')).toBeVisible();
        await expect(qualitySelect.locator('option:has-text("Lossy")')).toBeVisible();
        await expect(qualitySelect.locator('option:has-text("Mixed")')).toBeVisible();
        
        const orgModeSelect = page.locator('#search-org-mode');
        await expect(orgModeSelect.locator('option:has-text("All Modes")')).toBeVisible();
        await expect(orgModeSelect.locator('option:has-text("Artist Mode")')).toBeVisible();
        await expect(orgModeSelect.locator('option:has-text("Label Mode")')).toBeVisible();
    });

    test('Basic search functionality works', async ({ page }) => {
        // Enter search criteria
        await page.fill('#search-album-title', 'Test Album');
        await page.fill('#search-artist-name', 'Test Artist');
        
        // Perform search
        await page.click('button:has-text("Search Albums")');
        
        // Check that search stats appear
        await expect(page.locator('#albums-search-stats')).toBeVisible();
        await expect(page.locator('#albums-results-count')).toContainText('results found');
        await expect(page.locator('#albums-search-time')).toContainText('Search took');
        
        // Check that active filters are displayed
        const activeFilters = page.locator('#albums-active-filters');
        await expect(activeFilters).toBeVisible();
        await expect(activeFilters.locator('.filter-chip')).toHaveCount(2); // album and artist filters
    });

    test('Search filters are properly displayed and removable', async ({ page }) => {
        // Add multiple search criteria
        await page.fill('#search-album-title', 'Album');
        await page.fill('#search-artist-name', 'Artist');
        await page.selectOption('#search-quality', 'Lossless');
        await page.fill('#search-year-from', '2000');
        
        // Perform search
        await page.click('button:has-text("Search Albums")');
        
        // Check filter chips
        const filterChips = page.locator('.filter-chip');
        await expect(filterChips).toHaveCount(4);
        
        // Check filter chip content
        await expect(page.locator('.filter-chip:has-text("Album: Album")')).toBeVisible();
        await expect(page.locator('.filter-chip:has-text("Artist: Artist")')).toBeVisible();
        await expect(page.locator('.filter-chip:has-text("Quality: Lossless")')).toBeVisible();
        await expect(page.locator('.filter-chip:has-text("From: 2000")')).toBeVisible();
        
        // Test removing a filter
        await page.click('.filter-chip:has-text("Album: Album") .remove');
        
        // Filter should be removed and search re-performed
        await expect(page.locator('.filter-chip:has-text("Album: Album")')).not.toBeVisible();
        await expect(filterChips).toHaveCount(3);
    });

    test('Clear filters functionality works', async ({ page }) => {
        // Add search criteria
        await page.fill('#search-album-title', 'Test');
        await page.fill('#search-artist-name', 'Artist');
        await page.selectOption('#search-quality', 'Lossless');
        
        // Perform search
        await page.click('button:has-text("Search Albums")');
        
        // Check filters are applied
        await expect(page.locator('.filter-chip')).toHaveCount(3);
        
        // Clear filters
        await page.click('button:has-text("Clear Filters")');
        
        // All inputs should be cleared
        await expect(page.locator('#search-album-title')).toHaveValue('');
        await expect(page.locator('#search-artist-name')).toHaveValue('');
        await expect(page.locator('#search-quality')).toHaveValue('');
        
        // No active filters
        await expect(page.locator('.filter-chip')).toHaveCount(0);
        
        // Search stats should be hidden
        await expect(page.locator('#albums-search-stats')).toBeHidden();
    });

    test('Save search functionality works', async ({ page }) => {
        // Add search criteria
        await page.fill('#search-album-title', 'Electronic');
        await page.selectOption('#search-quality', 'Lossless');
        
        // Perform search
        await page.click('button:has-text("Search Albums")');
        
        // Save search
        page.on('dialog', async dialog => {
            expect(dialog.type()).toBe('prompt');
            expect(dialog.message()).toBe('Enter a name for this search:');
            await dialog.accept('Electronic Lossless');
        });
        
        await page.click('button:has-text("Save Search")');
        
        // Should show success alert
        page.on('dialog', async dialog => {
            expect(dialog.type()).toBe('alert');
            expect(dialog.message()).toContain('saved successfully');
            await dialog.accept();
        });
    });

    test('Save search shows warning for empty filters', async ({ page }) => {
        // Try to save without any filters
        page.on('dialog', async dialog => {
            expect(dialog.type()).toBe('alert');
            expect(dialog.message()).toBe('No active filters to save');
            await dialog.accept();
        });
        
        await page.click('button:has-text("Save Search")');
    });

    test('View mode toggle works', async ({ page }) => {
        // Initially should be in table view
        await expect(page.locator('#table-view-btn')).toHaveClass(/active/);
        await expect(page.locator('#albums-table-view')).toBeVisible();
        await expect(page.locator('#albums-grid-view')).toBeHidden();
        
        // Switch to grid view
        await page.click('#grid-view-btn');
        
        // Grid view should be active
        await expect(page.locator('#grid-view-btn')).toHaveClass(/active/);
        await expect(page.locator('#table-view-btn')).not.toHaveClass(/active/);
        await expect(page.locator('#albums-grid-view')).toBeVisible();
        await expect(page.locator('#albums-table-view')).toBeHidden();
        
        // Switch back to table view
        await page.click('#table-view-btn');
        
        // Table view should be active
        await expect(page.locator('#table-view-btn')).toHaveClass(/active/);
        await expect(page.locator('#albums-table-view')).toBeVisible();
        await expect(page.locator('#albums-grid-view')).toBeHidden();
    });

    test('Sort functionality works', async ({ page }) => {
        // Perform a search first
        await page.fill('#search-album-title', 'test');
        await page.click('button:has-text("Search Albums")');
        
        // Test different sort options
        const sortOptions = ['artist', 'album', 'year-desc', 'year-asc', 'label', 'quality'];
        
        for (const option of sortOptions) {
            await page.selectOption('#albums-sort', option);
            
            // Wait for sort to apply
            await page.waitForTimeout(500);
            
            // Verify sort option is selected
            await expect(page.locator('#albums-sort')).toHaveValue(option);
        }
    });

    test('Table column sorting works', async ({ page }) => {
        // Click on table column headers
        const sortableColumns = ['artist', 'album', 'year', 'label', 'quality'];
        
        for (const column of sortableColumns) {
            const header = page.locator(`th[onclick*="${column}"]`);
            if (await header.count() > 0) {
                await header.click();
                
                // Wait for sort to apply
                await page.waitForTimeout(300);
            }
        }
        
        // Should still show table content
        await expect(page.locator('#albums-table')).toBeVisible();
    });

    test('Search handles API errors gracefully', async ({ page }) => {
        // Mock API error
        await page.route('/api/search/albums*', route => {
            route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Search service unavailable' })
            });
        });
        
        // Try to search
        await page.fill('#search-album-title', 'test');
        await page.click('button:has-text("Search Albums")');
        
        // Should show error gracefully
        await expect(page.locator('body')).toBeVisible(); // Page doesn't crash
        
        // Search stats should be hidden on error
        await expect(page.locator('#albums-search-stats')).toBeHidden();
    });

    test('Search performance with large result sets', async ({ page }) => {
        // Perform a broad search that might return many results
        await page.fill('#search-album-title', '');
        await page.selectOption('#search-quality', ''); // All qualities
        
        // Measure search time
        const startTime = Date.now();
        await page.click('button:has-text("Search Albums")');
        
        // Wait for search to complete
        await expect(page.locator('#albums-search-stats')).toBeVisible({ timeout: 10000 });
        
        const endTime = Date.now();
        const searchTime = endTime - startTime;
        
        // Search should complete reasonably quickly
        expect(searchTime).toBeLessThan(10000); // Less than 10 seconds
        
        // Results should be displayed
        await expect(page.locator('#albums-results-count')).toContainText('results found');
    });

    test('Search state persistence during tab switching', async ({ page }) => {
        // Perform a search
        await page.fill('#search-album-title', 'Persistent Search');
        await page.click('button:has-text("Search Albums")');
        
        // Verify search is active
        await expect(page.locator('.filter-chip')).toHaveCount(1);
        
        // Switch to another tab
        await page.click('button.tab:has-text("Overview")');
        await page.waitForTimeout(500);
        
        // Switch back to Albums tab
        await page.click('button.tab:has-text("Albums")');
        
        // Search state should be preserved
        await expect(page.locator('#search-album-title')).toHaveValue('Persistent Search');
        await expect(page.locator('.filter-chip')).toHaveCount(1);
    });

    test('Complex search combinations work', async ({ page }) => {
        // Create a complex search with multiple criteria
        await page.fill('#search-album-title', 'Electronic');
        await page.fill('#search-artist-name', 'Aphex');
        await page.fill('#search-label-name', 'Warp');
        await page.fill('#search-year-from', '1990');
        await page.fill('#search-year-to', '2020');
        await page.selectOption('#search-quality', 'Lossless');
        await page.selectOption('#search-org-mode', 'Artist Mode');
        
        // Perform search
        await page.click('button:has-text("Search Albums")');
        
        // Should handle complex query
        await expect(page.locator('#albums-search-stats')).toBeVisible();
        await expect(page.locator('.filter-chip')).toHaveCount(7);
        
        // All filters should be displayed correctly
        await expect(page.locator('.filter-chip:has-text("Album: Electronic")')).toBeVisible();
        await expect(page.locator('.filter-chip:has-text("Artist: Aphex")')).toBeVisible();
        await expect(page.locator('.filter-chip:has-text("Label: Warp")')).toBeVisible();
        await expect(page.locator('.filter-chip:has-text("From: 1990")')).toBeVisible();
        await expect(page.locator('.filter-chip:has-text("To: 2020")')).toBeVisible();
        await expect(page.locator('.filter-chip:has-text("Quality: Lossless")')).toBeVisible();
        await expect(page.locator('.filter-chip:has-text("Mode: Artist Mode")')).toBeVisible();
    });
});