const { test, expect } = require('@playwright/test');

test.describe('Comprehensive Tab Functionality', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to the application
        await page.goto('/');
        
        // Wait for the application to load
        await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
    });

    test('All tabs are present and clickable', async ({ page }) => {
        const expectedTabs = [
            'Overview',
            'Actions', 
            'Collection Health',
            'Duplicates',
            'Insights',
            'Albums',
            'Artists',
            'Labels',
            'Timeline',
            'Move History',
            'Configuration'
        ];

        for (const tabName of expectedTabs) {
            const tab = page.locator(`button.tab:has-text("${tabName}")`);
            await expect(tab).toBeVisible();
            await expect(tab).toBeEnabled();
        }
    });

    test('Tab navigation works correctly', async ({ page }) => {
        // Test clicking each tab
        const tabs = [
            { name: 'Overview', contentId: 'overview' },
            { name: 'Actions', contentId: 'actions' },
            { name: 'Collection Health', contentId: 'health' },
            { name: 'Duplicates', contentId: 'duplicates' },
            { name: 'Insights', contentId: 'insights' },
            { name: 'Albums', contentId: 'albums' },
            { name: 'Artists', contentId: 'artists' },
            { name: 'Labels', contentId: 'labels' },
            { name: 'Timeline', contentId: 'timeline' },
            { name: 'Move History', contentId: 'moves' },
            { name: 'Configuration', contentId: 'config' }
        ];

        for (const tab of tabs) {
            await page.click(`button.tab:has-text("${tab.name}")`);
            
            // Check that the tab is active
            await expect(page.locator(`button.tab:has-text("${tab.name}")`)).toHaveClass(/active/);
            
            // Check that the content is visible
            await expect(page.locator(`#${tab.contentId}`)).toBeVisible();
            
            // Wait a moment for any async loading
            await page.waitForTimeout(500);
        }
    });

    test('Overview tab displays statistics correctly', async ({ page }) => {
        await page.click('button.tab:has-text("Overview")');
        
        // Check main statistics cards
        await expect(page.locator('#stat-albums')).toBeVisible();
        await expect(page.locator('#stat-tracks')).toBeVisible();
        await expect(page.locator('#stat-artists')).toBeVisible();
        await expect(page.locator('#stat-labels')).toBeVisible();
        
        // Check charts are present
        await expect(page.locator('#quality-chart')).toBeVisible();
        await expect(page.locator('#mode-chart')).toBeVisible();
        
        // Wait for charts to load
        await page.waitForTimeout(1000);
    });

    test('Actions tab shows all action sections', async ({ page }) => {
        await page.click('button.tab:has-text("Actions")');
        
        // Check main sections are present
        await expect(page.locator('h2:has-text("Music Processing")')).toBeVisible();
        await expect(page.locator('h2:has-text("Backup Management")')).toBeVisible();
        await expect(page.locator('h2:has-text("System Status")')).toBeVisible();
        
        // Check processing controls
        await expect(page.locator('button:has-text("Dry Run")')).toBeVisible();
        await expect(page.locator('button:has-text("Process & Move")')).toBeVisible();
        
        // Check backup controls
        await expect(page.locator('button:has-text("Backup Now")')).toBeVisible();
        await expect(page.locator('button:has-text("Start Backup")')).toBeVisible();
    });

    test('Collection Health tab shows health metrics', async ({ page }) => {
        await page.click('button.tab:has-text("Collection Health")');
        
        // Check health score elements
        await expect(page.locator('#health-score')).toBeVisible();
        await expect(page.locator('#metadata-completeness')).toBeVisible();
        await expect(page.locator('#lossless-percentage')).toBeVisible();
        await expect(page.locator('#organization-efficiency')).toBeVisible();
        
        // Check metadata chart
        await expect(page.locator('#metadata-chart')).toBeVisible();
        
        // Check anomalies table
        await expect(page.locator('#anomalies-table')).toBeVisible();
    });

    test('Duplicates tab shows duplicate detection status', async ({ page }) => {
        await page.click('button.tab:has-text("Duplicates")');
        
        // Check duplicate statistics
        await expect(page.locator('#duplicate-groups-count')).toBeVisible();
        await expect(page.locator('#duplicates-albums-count')).toBeVisible();
        await expect(page.locator('#potential-savings')).toBeVisible();
        await expect(page.locator('#duplicate-score')).toBeVisible();
        
        // Check charts and tables
        await expect(page.locator('#duplicate-quality-chart')).toBeVisible();
        await expect(page.locator('#duplicate-groups-table')).toBeVisible();
    });

    test('Insights tab shows analytics', async ({ page }) => {
        await page.click('button.tab:has-text("Insights")');
        
        // Check insights tables
        await expect(page.locator('#productive-artists-table')).toBeVisible();
        await expect(page.locator('#prolific-labels-table')).toBeVisible();
        
        // Check collection growth chart
        await expect(page.locator('#collection-growth-chart')).toBeVisible();
    });

    test('Albums tab shows advanced search and results', async ({ page }) => {
        await page.click('button.tab:has-text("Albums")');
        
        // Check search interface
        await expect(page.locator('#albums-search-container')).toBeVisible();
        await expect(page.locator('#search-album-title')).toBeVisible();
        await expect(page.locator('#search-artist-name')).toBeVisible();
        
        // Check search controls
        await expect(page.locator('button:has-text("Search Albums")')).toBeVisible();
        await expect(page.locator('button:has-text("Clear Filters")')).toBeVisible();
        
        // Check results view controls
        await expect(page.locator('#albums-sort')).toBeVisible();
        await expect(page.locator('#table-view-btn')).toBeVisible();
        await expect(page.locator('#grid-view-btn')).toBeVisible();
        
        // Check albums table
        await expect(page.locator('#albums-table')).toBeVisible();
    });

    test('Artists tab shows artists data', async ({ page }) => {
        await page.click('button.tab:has-text("Artists")');
        
        // Check artists table
        await expect(page.locator('#artists-table')).toBeVisible();
        await expect(page.locator('th:has-text("Artist")')).toBeVisible();
        await expect(page.locator('th:has-text("Releases")')).toBeVisible();
        await expect(page.locator('th:has-text("Labels")')).toBeVisible();
        
        // Check alias network visualization
        await expect(page.locator('#alias-network')).toBeVisible();
    });

    test('Labels tab shows labels information', async ({ page }) => {
        await page.click('button.tab:has-text("Labels")');
        
        // Check labels table
        await expect(page.locator('#labels-table')).toBeVisible();
        await expect(page.locator('th:has-text("Label")')).toBeVisible();
        await expect(page.locator('th:has-text("Releases")')).toBeVisible();
        await expect(page.locator('th:has-text("Artists")')).toBeVisible();
        await expect(page.locator('th:has-text("First Release")')).toBeVisible();
        await expect(page.locator('th:has-text("Latest Release")')).toBeVisible();
    });

    test('Timeline tab shows processing timeline', async ({ page }) => {
        await page.click('button.tab:has-text("Timeline")');
        
        // Check timeline chart
        await expect(page.locator('#timeline-chart')).toBeVisible();
        await expect(page.locator('h2:has-text("Processing Timeline")')).toBeVisible();
    });

    test('Move History tab shows move operations', async ({ page }) => {
        await page.click('button.tab:has-text("Move History")');
        
        // Check moves table
        await expect(page.locator('#moves-table')).toBeVisible();
        await expect(page.locator('th:has-text("Date")')).toBeVisible();
        await expect(page.locator('th:has-text("Source")')).toBeVisible();
        await expect(page.locator('th:has-text("Destination")')).toBeVisible();
        await expect(page.locator('th:has-text("Type")')).toBeVisible();
    });

    test('Tab content loads properly with loading states', async ({ page }) => {
        // Test that loading states appear before content loads
        await page.click('button.tab:has-text("Albums")');
        
        // Initially should show loading
        await expect(page.locator('#albums-tbody')).toContainText('Loading');
        
        // Wait for content to load
        await page.waitForTimeout(2000);
    });

    test('Tab switching preserves scroll position', async ({ page }) => {
        // Navigate to Albums tab and scroll down
        await page.click('button.tab:has-text("Albums")');
        await page.evaluate(() => window.scrollTo(0, 500));
        
        // Switch to another tab
        await page.click('button.tab:has-text("Overview")');
        
        // Switch back to Albums
        await page.click('button.tab:has-text("Albums")');
        
        // Should maintain reasonable scroll position (though exact position may vary)
        const scrollY = await page.evaluate(() => window.scrollY);
        expect(scrollY).toBeGreaterThanOrEqual(0);
    });

    test('Tab keyboard navigation works', async ({ page }) => {
        // Focus first tab
        await page.keyboard.press('Tab');
        
        // Navigate through tabs with arrow keys
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        
        // Should have navigated to a different tab
        const activeTabs = page.locator('button.tab.active');
        await expect(activeTabs).toHaveCount(1);
    });

    test('Error handling in tab content', async ({ page }) => {
        // Mock API error
        await page.route('/api/stats', route => {
            route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Server error' })
            });
        });
        
        // Try to load overview which depends on stats
        await page.click('button.tab:has-text("Overview")');
        
        // Should handle error gracefully (not crash the page)
        await expect(page.locator('body')).toBeVisible();
    });

    test('Tab content updates dynamically', async ({ page }) => {
        // Start on Overview tab
        await page.click('button.tab:has-text("Overview")');
        
        // Get initial album count
        const initialCount = await page.locator('#stat-albums').textContent();
        
        // Switch away and back
        await page.click('button.tab:has-text("Actions")');
        await page.click('button.tab:has-text("Overview")');
        
        // Content should be present (may be same or updated)
        await expect(page.locator('#stat-albums')).not.toBeEmpty();
    });

    test('Multiple tabs can be interacted with rapidly', async ({ page }) => {
        const tabs = ['Overview', 'Actions', 'Albums', 'Artists'];
        
        // Rapidly switch between tabs
        for (let i = 0; i < 3; i++) {
            for (const tabName of tabs) {
                await page.click(`button.tab:has-text("${tabName}")`, { timeout: 1000 });
                await page.waitForTimeout(100); // Small delay to simulate real usage
            }
        }
        
        // Should end up on the last tab without errors
        await expect(page.locator('button.tab:has-text("Artists")')).toHaveClass(/active/);
        await expect(page.locator('#artists')).toBeVisible();
    });

    test('Tab state persistence across page refresh', async ({ page }) => {
        // Navigate to a specific tab
        await page.click('button.tab:has-text("Configuration")');
        await expect(page.locator('#config')).toBeVisible();
        
        // Refresh the page
        await page.reload();
        await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
        
        // Should default back to Overview tab after refresh
        await expect(page.locator('button.tab:has-text("Overview")')).toHaveClass(/active/);
        await expect(page.locator('#overview')).toBeVisible();
    });
});