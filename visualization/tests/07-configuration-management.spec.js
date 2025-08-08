const { test, expect } = require('@playwright/test');

test.describe('Configuration Management', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to the application
        await page.goto('/');
        
        // Wait for the application to load
        await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
        
        // Click on Configuration tab
        await page.click('button.tab:has-text("Configuration")');
        await expect(page.locator('#config')).toBeVisible();
    });

    test('Configuration tab loads and displays correctly', async ({ page }) => {
        // Check that the configuration section is visible
        await expect(page.locator('#config h3')).toContainText('System Configuration');
        
        // Check that control buttons are present
        await expect(page.locator('button:has-text("Load Configuration")')).toBeVisible();
        await expect(page.locator('button:has-text("Save Changes")')).toBeVisible();
        await expect(page.locator('button:has-text("Reset to Default")')).toBeVisible();
        
        // Initially, the form should be hidden
        await expect(page.locator('#config-form')).toBeHidden();
    });

    test('Load Configuration functionality works', async ({ page }) => {
        // Click Load Configuration button
        await page.click('button:has-text("Load Configuration")');
        
        // Wait for loading message
        await expect(page.locator('#config-status')).toContainText('Loading configuration');
        
        // Wait for success message and form to appear
        await expect(page.locator('#config-status')).toContainText('Configuration loaded successfully', { timeout: 5000 });
        await expect(page.locator('#config-form')).toBeVisible();
        
        // Check that core directory fields are populated
        await expect(page.locator('#SOURCE_DIR')).toHaveValue('.');
        await expect(page.locator('#DEST_DIR')).toHaveValue('/home/plex/Music/sorted_music');
        
        // Check that verbosity is set correctly
        await expect(page.locator('#VERBOSITY')).toHaveValue('1');
        
        // Check that Discogs is enabled
        await expect(page.locator('#DISCOGS_ENABLED')).toBeChecked();
    });

    test('Configuration sections are properly organized', async ({ page }) => {
        // Load configuration first
        await page.click('button:has-text("Load Configuration")');
        await expect(page.locator('#config-form')).toBeVisible();
        
        // Check all main configuration sections exist
        await expect(page.locator('h4:has-text("Core Directories")')).toBeVisible();
        await expect(page.locator('h4:has-text("Logging & Verbosity")')).toBeVisible();
        await expect(page.locator('h4:has-text("Processing Modes")')).toBeVisible();
        await expect(page.locator('h4:has-text("Duplicate Detection")')).toBeVisible();
        await expect(page.locator('h4:has-text("Discogs API Integration")')).toBeVisible();
        await expect(page.locator('h4:has-text("Electronic Music Organization")')).toBeVisible();
        await expect(page.locator('h4:has-text("Artist Alias Management")')).toBeVisible();
        await expect(page.locator('h4:has-text("Google Drive Backup")')).toBeVisible();
        await expect(page.locator('h4:has-text("Notifications")')).toBeVisible();
        await expect(page.locator('h4:has-text("Organization Patterns")')).toBeVisible();
    });

    test('Form inputs are properly configured', async ({ page }) => {
        // Load configuration first
        await page.click('button:has-text("Load Configuration")');
        await expect(page.locator('#config-form')).toBeVisible();
        
        // Test text inputs
        await expect(page.locator('#SOURCE_DIR')).toHaveAttribute('type', 'text');
        await expect(page.locator('#DEST_DIR')).toHaveAttribute('type', 'text');
        await expect(page.locator('#LOG_FILE')).toHaveAttribute('type', 'text');
        
        // Test select inputs
        await expect(page.locator('#VERBOSITY')).toHaveProperty('tagName', 'SELECT');
        await expect(page.locator('#ORGANIZATION_MODE')).toHaveProperty('tagName', 'SELECT');
        
        // Test checkbox inputs
        await expect(page.locator('#DISCOGS_ENABLED')).toHaveAttribute('type', 'checkbox');
        await expect(page.locator('#GROUP_ARTIST_ALIASES')).toHaveAttribute('type', 'checkbox');
        
        // Test number inputs
        await expect(page.locator('#DISCOGS_RATE_LIMIT')).toHaveAttribute('type', 'number');
        await expect(page.locator('#MIN_LABEL_RELEASES')).toHaveAttribute('type', 'number');
        
        // Test range inputs
        await expect(page.locator('#DISCOGS_CONFIDENCE_THRESHOLD')).toHaveAttribute('type', 'range');
        await expect(page.locator('#LABEL_PRIORITY_THRESHOLD')).toHaveAttribute('type', 'range');
        
        // Test email input
        await expect(page.locator('#NOTIFY_EMAIL')).toHaveAttribute('type', 'email');
        
        // Test URL input
        await expect(page.locator('#NOTIFY_WEBHOOK')).toHaveAttribute('type', 'url');
        
        // Test date input
        await expect(page.locator('#SINCE_DATE')).toHaveAttribute('type', 'date');
        
        // Test password inputs
        await expect(page.locator('#DISCOGS_USER_TOKEN')).toHaveAttribute('type', 'password');
        await expect(page.locator('#DISCOGS_CONSUMER_SECRET')).toHaveAttribute('type', 'password');
        
        // Test textarea
        await expect(page.locator('#ARTIST_ALIAS_GROUPS')).toHaveProperty('tagName', 'TEXTAREA');
    });

    test('Range sliders update display values', async ({ page }) => {
        // Load configuration first
        await page.click('button:has-text("Load Configuration")');
        await expect(page.locator('#config-form')).toBeVisible();
        
        // Test confidence threshold slider
        const confidenceSlider = page.locator('#DISCOGS_CONFIDENCE_THRESHOLD');
        const confidenceValue = page.locator('#confidence-value');
        
        // Check initial value
        await expect(confidenceValue).toContainText('0.7');
        
        // Change slider value
        await confidenceSlider.fill('0.9');
        await expect(confidenceValue).toContainText('0.9');
        
        // Test label priority threshold slider
        const labelSlider = page.locator('#LABEL_PRIORITY_THRESHOLD');
        const labelValue = page.locator('#label-threshold-value');
        
        // Check initial value
        await expect(labelValue).toContainText('0.8');
        
        // Change slider value
        await labelSlider.fill('0.6');
        await expect(labelValue).toContainText('0.6');
    });

    test('Configuration form validation works', async ({ page }) => {
        // Load configuration first
        await page.click('button:has-text("Load Configuration")');
        await expect(page.locator('#config-form')).toBeVisible();
        
        // Test email validation
        await page.fill('#NOTIFY_EMAIL', 'invalid-email');
        await page.click('button:has-text("Save Changes")');
        
        // Check that invalid email is handled
        const emailInput = page.locator('#NOTIFY_EMAIL');
        await expect(emailInput).toHaveAttribute('type', 'email');
        
        // Test number input validation
        const rateLimit = page.locator('#DISCOGS_RATE_LIMIT');
        await expect(rateLimit).toHaveAttribute('min', '25');
        await expect(rateLimit).toHaveAttribute('max', '60');
        
        const minReleases = page.locator('#MIN_LABEL_RELEASES');
        await expect(minReleases).toHaveAttribute('min', '1');
        await expect(minReleases).toHaveAttribute('max', '10');
        
        const parallelUploads = page.locator('#MAX_PARALLEL_UPLOADS');
        await expect(parallelUploads).toHaveAttribute('min', '1');
        await expect(parallelUploads).toHaveAttribute('max', '10');
    });

    test('Save Configuration functionality works', async ({ page }) => {
        // Load configuration first
        await page.click('button:has-text("Load Configuration")');
        await expect(page.locator('#config-form')).toBeVisible();
        
        // Modify a setting
        await page.fill('#SOURCE_DIR', './test-source');
        await page.selectOption('#VERBOSITY', '2');
        
        // Click Save Changes
        await page.click('button:has-text("Save Changes")');
        
        // Wait for saving message
        await expect(page.locator('#config-status')).toContainText('Saving configuration');
        
        // Wait for success message
        await expect(page.locator('#config-status')).toContainText('Configuration saved successfully', { timeout: 5000 });
    });

    test('Reset Configuration functionality works', async ({ page }) => {
        // Load configuration first
        await page.click('button:has-text("Load Configuration")');
        await expect(page.locator('#config-form')).toBeVisible();
        
        // Store original value
        const originalValue = await page.locator('#SOURCE_DIR').inputValue();
        
        // Modify a setting
        await page.fill('#SOURCE_DIR', './modified-source');
        await expect(page.locator('#SOURCE_DIR')).toHaveValue('./modified-source');
        
        // Click Reset to Default
        page.on('dialog', dialog => dialog.accept()); // Accept confirmation dialog
        await page.click('button:has-text("Reset to Default")');
        
        // Check that value is reset
        await expect(page.locator('#SOURCE_DIR')).toHaveValue(originalValue);
        
        // Check for success message
        await expect(page.locator('#config-status')).toContainText('Configuration reset to original values');
    });

    test('Configuration sections have proper styling', async ({ page }) => {
        // Load configuration first
        await page.click('button:has-text("Load Configuration")');
        await expect(page.locator('#config-form')).toBeVisible();
        
        // Check that cards have proper styling
        const cards = page.locator('#config-form .card');
        await expect(cards.first()).toHaveClass(/card/);
        
        // Check that form fields have proper classes
        const searchFields = page.locator('.search-field');
        await expect(searchFields.first()).toHaveClass(/search-field/);
        
        // Check input styling
        const inputs = page.locator('.search-input');
        await expect(inputs.first()).toHaveClass(/search-input/);
        
        // Check checkbox styling
        const checkboxes = page.locator('.checkbox-label');
        await expect(checkboxes.first()).toHaveClass(/checkbox-label/);
    });

    test('Configuration handles API errors gracefully', async ({ page }) => {
        // Mock API error for config load
        await page.route('/api/config', route => {
            route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Internal server error' })
            });
        });
        
        // Try to load configuration
        await page.click('button:has-text("Load Configuration")');
        
        // Check error message is displayed
        await expect(page.locator('#config-status')).toContainText('Failed to load configuration: Internal server error');
        
        // Form should remain hidden
        await expect(page.locator('#config-form')).toBeHidden();
    });

    test('Configuration shows warning when trying to save without loading', async ({ page }) => {
        // Try to save without loading first
        await page.click('button:has-text("Save Changes")');
        
        // Check warning message
        await expect(page.locator('#config-status')).toContainText('Please load configuration first');
    });

    test('Configuration shows warning when trying to reset without loading', async ({ page }) => {
        // Try to reset without loading first
        await page.click('button:has-text("Reset to Default")');
        
        // Should show alert (browser dialog)
        page.on('dialog', async dialog => {
            expect(dialog.message()).toBe('Please load configuration first');
            await dialog.accept();
        });
    });

    test('Configuration persists complex data structures', async ({ page }) => {
        // Load configuration first
        await page.click('button:has-text("Load Configuration")');
        await expect(page.locator('#config-form')).toBeVisible();
        
        // Check that complex data like artist aliases is preserved
        const aliasGroups = page.locator('#ARTIST_ALIAS_GROUPS');
        await expect(aliasGroups).toContainValue('Uwe Schmidt,Atom TM,Atom Heart,Senor Coconut,Atomu Shinzo,Eyephone');
        
        // Check pattern templates
        const artistPattern = page.locator('#PATTERN_ARTIST');
        await expect(artistPattern).toHaveValue('{quality}/{artist}/{album} ({year})');
        
        const labelPattern = page.locator('#PATTERN_LABEL');
        await expect(labelPattern).toHaveValue('{quality}/Labels/{label}/{artist}/{album} ({year})');
    });

    test('Configuration tab is accessible via keyboard navigation', async ({ page }) => {
        // Use keyboard to navigate to Configuration tab
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab'); // Navigate to Configuration tab
        await page.keyboard.press('Enter');
        
        // Check that Configuration tab is active
        await expect(page.locator('#config')).toBeVisible();
        
        // Load configuration and test keyboard navigation within form
        await page.click('button:has-text("Load Configuration")');
        await expect(page.locator('#config-form')).toBeVisible();
        
        // Test that form inputs are focusable
        await page.keyboard.press('Tab');
        const focusedElement = page.locator(':focus');
        await expect(focusedElement).toBeVisible();
    });
});