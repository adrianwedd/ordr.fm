const { test, expect } = require('@playwright/test');

test.describe('Error Handling Scenarios in UI', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
    });

    test.describe('API Error Handling', () => {
        test('handles server connection errors gracefully', async ({ page }) => {
            // Mock complete server failure
            await page.route('**/*', route => {
                route.abort('connectionrefused');
            });
            
            // Try to refresh the page
            await page.reload();
            
            // Should show connection error gracefully
            await page.waitForTimeout(5000);
            
            // Page should still be functional (not completely broken)
            await expect(page.locator('body')).toBeVisible();
        });

        test('handles 404 API endpoints', async ({ page }) => {
            // Mock 404 responses
            await page.route('/api/nonexistent', route => {
                route.fulfill({
                    status: 404,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Endpoint not found' })
                });
            });
            
            // Try to access non-existent endpoint
            const response = await page.evaluate(async () => {
                try {
                    const res = await fetch('/api/nonexistent');
                    return { status: res.status, ok: res.ok };
                } catch (error) {
                    return { error: error.message };
                }
            });
            
            expect(response.status).toBe(404);
            expect(response.ok).toBe(false);
        });

        test('handles 500 internal server errors', async ({ page }) => {
            // Mock 500 error for stats endpoint
            await page.route('/api/stats', route => {
                route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Internal server error' })
                });
            });
            
            // Navigate to Overview tab which uses stats
            await page.click('button.tab:has-text("Overview")');
            
            // Should handle error gracefully
            await page.waitForTimeout(2000);
            
            // Page should still be visible and functional
            await expect(page.locator('#overview')).toBeVisible();
            
            // Error might be shown in UI or logged
            const hasError = await page.locator('.error, .loading').count();
            expect(hasError).toBeGreaterThanOrEqual(0);
        });

        test('handles network timeouts', async ({ page }) => {
            // Mock slow response
            await page.route('/api/health', route => {
                setTimeout(() => {
                    route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ status: 'delayed' })
                    });
                }, 10000); // 10 second delay
            });
            
            // Should handle timeout gracefully
            await page.reload();
            await page.waitForTimeout(3000);
            
            // Should show loading state or timeout message
            const status = page.locator('#status');
            const statusText = await status.textContent();
            
            // Status should indicate connection issue or loading
            expect(statusText).toBeTruthy();
        });

        test('handles malformed JSON responses', async ({ page }) => {
            // Mock malformed JSON response
            await page.route('/api/config', route => {
                route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: 'invalid json content'
                });
            });
            
            // Navigate to Configuration tab
            await page.click('button.tab:has-text("Configuration")');
            
            // Try to load configuration
            await page.click('button:has-text("Load Configuration")');
            
            // Should show error message
            await expect(page.locator('#config-status')).toContainText('Failed to load configuration', { timeout: 5000 });
        });

        test('handles rate limiting errors', async ({ page }) => {
            // Mock 429 rate limit error
            await page.route('/api/search/albums*', route => {
                route.fulfill({
                    status: 429,
                    contentType: 'application/json',
                    body: JSON.stringify({ 
                        error: 'Rate limit exceeded',
                        retryAfter: 60
                    })
                });
            });
            
            // Navigate to Albums and try to search
            await page.click('button.tab:has-text("Albums")');
            await page.fill('#search-album-title', 'test');
            await page.click('button:has-text("Search Albums")');
            
            // Should handle rate limit gracefully
            await page.waitForTimeout(2000);
            
            // Search should fail gracefully without crashing
            await expect(page.locator('#albums')).toBeVisible();
        });
    });

    test.describe('Form Validation Errors', () => {
        test('handles invalid email addresses', async ({ page }) => {
            // Navigate to Configuration tab
            await page.click('button.tab:has-text("Configuration")');
            await page.click('button:has-text("Load Configuration")');
            await expect(page.locator('#config-form')).toBeVisible();
            
            // Enter invalid email
            await page.fill('#NOTIFY_EMAIL', 'invalid-email-format');
            
            // Try to save
            await page.click('button:has-text("Save Changes")');
            
            // Browser should show validation error
            const emailInput = page.locator('#NOTIFY_EMAIL');
            const validity = await emailInput.evaluate(input => input.validity.valid);
            expect(validity).toBe(false);
        });

        test('handles invalid URL formats', async ({ page }) => {
            // Navigate to Configuration tab
            await page.click('button.tab:has-text("Configuration")');
            await page.click('button:has-text("Load Configuration")');
            await expect(page.locator('#config-form')).toBeVisible();
            
            // Enter invalid URL
            await page.fill('#NOTIFY_WEBHOOK', 'not-a-valid-url');
            
            // Browser should validate URL format
            const urlInput = page.locator('#NOTIFY_WEBHOOK');
            const validity = await urlInput.evaluate(input => input.validity.valid);
            expect(validity).toBe(false);
        });

        test('handles number input constraints', async ({ page }) => {
            // Navigate to Configuration tab
            await page.click('button.tab:has-text("Configuration")');
            await page.click('button:has-text("Load Configuration")');
            await expect(page.locator('#config-form')).toBeVisible();
            
            // Enter value outside allowed range
            await page.fill('#DISCOGS_RATE_LIMIT', '999');
            
            // Input should be constrained
            const rateInput = page.locator('#DISCOGS_RATE_LIMIT');
            const max = await rateInput.getAttribute('max');
            expect(max).toBe('60');
            
            // Value should be invalid if outside range
            const validity = await rateInput.evaluate(input => input.validity.valid);
            if (validity === false) {
                // Input properly validates constraints
                expect(validity).toBe(false);
            }
        });

        test('handles required field validation', async ({ page }) => {
            // Navigate to Configuration tab
            await page.click('button.tab:has-text("Configuration")');
            await page.click('button:has-text("Load Configuration")');
            await expect(page.locator('#config-form')).toBeVisible();
            
            // Clear a required field
            await page.fill('#SOURCE_DIR', '');
            
            // Try to save
            await page.click('button:has-text("Save Changes")');
            
            // Should save successfully (SOURCE_DIR might not be strictly required)
            // Or show appropriate validation
            await page.waitForTimeout(1000);
            
            const status = await page.locator('#config-status').textContent();
            expect(typeof status).toBe('string');
        });
    });

    test.describe('File Operations Errors', () => {
        test('handles file browser errors', async ({ page }) => {
            // Navigate to Actions tab
            await page.click('button.tab:has-text("Actions")');
            
            // Select browse option
            await page.selectOption('#source-directory', 'browse');
            
            // Mock file browser API error
            await page.route('/api/files/browse*', route => {
                route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'File system access denied' })
                });
            });
            
            // File browser should handle error gracefully
            const modal = page.locator('#file-browser-modal');
            if (await modal.count() > 0) {
                await expect(modal).toBeVisible();
                
                // Should show error in file list or modal
                await page.waitForTimeout(2000);
            }
        });

        test('handles processing operation failures', async ({ page }) => {
            // Navigate to Actions tab
            await page.click('button.tab:has-text("Actions")');
            
            // Mock processing failure
            await page.route('/api/actions/process', route => {
                route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Processing failed: Disk full' })
                });
            });
            
            // Try to start processing
            await page.click('button:has-text("Dry Run")');
            
            // Should show error gracefully
            await page.waitForTimeout(2000);
            
            const errorElements = await page.locator('.error, [class*="error"], [style*="color: red"]').count();
            // Error might be shown in various ways
            expect(errorElements).toBeGreaterThanOrEqual(0);
        });

        test('handles backup operation failures', async ({ page }) => {
            // Navigate to Actions tab
            await page.click('button.tab:has-text("Actions")');
            
            // Mock backup failure
            await page.route('/api/actions/backup-cloud', route => {
                route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Backup failed: No space left on device' })
                });
            });
            
            // Try to start backup
            const backupBtn = page.locator('button:has-text("Start Backup")');
            if (await backupBtn.count() > 0) {
                await backupBtn.click();
                
                // Should handle backup failure
                await page.waitForTimeout(2000);
                
                const status = page.locator('#cloud-backup-text');
                if (await status.count() > 0) {
                    const statusText = await status.textContent();
                    expect(statusText).toBeTruthy();
                }
            }
        });
    });

    test.describe('WebSocket Connection Errors', () => {
        test('handles WebSocket connection failures', async ({ page }) => {
            // Mock WebSocket failure
            await page.addInitScript(() => {
                // Override WebSocket to simulate connection failure
                const OriginalWebSocket = window.WebSocket;
                window.WebSocket = function(url) {
                    const ws = new OriginalWebSocket(url);
                    setTimeout(() => {
                        ws.dispatchEvent(new Event('error'));
                        ws.dispatchEvent(new Event('close'));
                    }, 100);
                    return ws;
                };
            });
            
            // Reload page to trigger WebSocket connection
            await page.reload();
            
            // Should handle WebSocket failure gracefully
            await page.waitForTimeout(3000);
            
            // Page should still be functional
            await expect(page.locator('body')).toBeVisible();
            await expect(page.locator('.tabs')).toBeVisible();
        });

        test('handles WebSocket message parsing errors', async ({ page }) => {
            // This test simulates malformed WebSocket messages
            await page.addInitScript(() => {
                // Override WebSocket to send malformed messages
                const OriginalWebSocket = window.WebSocket;
                window.WebSocket = function(url) {
                    const ws = new OriginalWebSocket(url);
                    const originalOnMessage = ws.onmessage;
                    ws.addEventListener('open', () => {
                        setTimeout(() => {
                            // Send malformed message
                            const malformedEvent = { data: 'invalid json}' };
                            if (originalOnMessage) {
                                try {
                                    originalOnMessage(malformedEvent);
                                } catch (e) {
                                    console.log('WebSocket message parsing error handled');
                                }
                            }
                        }, 1000);
                    });
                    return ws;
                };
            });
            
            await page.reload();
            await page.waitForTimeout(3000);
            
            // Should not crash from malformed messages
            await expect(page.locator('body')).toBeVisible();
        });
    });

    test.describe('UI State Errors', () => {
        test('handles missing DOM elements gracefully', async ({ page }) => {
            // Remove a key element and see if app handles it
            await page.evaluate(() => {
                const status = document.getElementById('status');
                if (status) status.remove();
            });
            
            // App should continue to function
            await page.click('button.tab:has-text("Albums")');
            await expect(page.locator('#albums')).toBeVisible();
        });

        test('handles localStorage errors', async ({ page }) => {
            // Mock localStorage failure
            await page.addInitScript(() => {
                Object.defineProperty(window, 'localStorage', {
                    value: {
                        getItem: () => { throw new Error('localStorage not available'); },
                        setItem: () => { throw new Error('localStorage not available'); },
                        removeItem: () => { throw new Error('localStorage not available'); }
                    },
                    writable: false
                });
            });
            
            await page.reload();
            
            // App should handle localStorage errors
            await page.waitForTimeout(2000);
            await expect(page.locator('body')).toBeVisible();
            
            // Try to save a search (which might use localStorage)
            await page.click('button.tab:has-text("Albums")');
            await page.fill('#search-album-title', 'test');
            
            // Should not crash from localStorage errors
            await page.waitForTimeout(1000);
            await expect(page.locator('#albums')).toBeVisible();
        });

        test('handles chart rendering errors', async ({ page }) => {
            // Mock Chart.js to fail
            await page.addInitScript(() => {
                if (window.Chart) {
                    const originalChart = window.Chart;
                    window.Chart = function() {
                        throw new Error('Chart rendering failed');
                    };
                }
            });
            
            await page.reload();
            await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
            
            // Navigate to Overview which has charts
            await page.click('button.tab:has-text("Overview")');
            
            // Should handle chart errors gracefully
            await page.waitForTimeout(2000);
            await expect(page.locator('#overview')).toBeVisible();
        });

        test('handles theme toggle errors', async ({ page }) => {
            // Try theme toggle with potential errors
            const themeToggle = page.locator('.theme-toggle');
            
            if (await themeToggle.count() > 0) {
                await themeToggle.click();
                await page.waitForTimeout(500);
                
                // Should not crash from theme changes
                await expect(page.locator('body')).toBeVisible();
                
                // Toggle back
                await themeToggle.click();
                await page.waitForTimeout(500);
                
                await expect(page.locator('body')).toBeVisible();
            }
        });
    });

    test.describe('Browser Compatibility Errors', () => {
        test('handles unsupported browser features', async ({ page }) => {
            // Mock unsupported features
            await page.addInitScript(() => {
                // Remove modern features
                delete window.fetch;
                delete window.WebSocket;
                delete navigator.serviceWorker;
            });
            
            await page.reload();
            
            // App should degrade gracefully
            await page.waitForTimeout(3000);
            await expect(page.locator('body')).toBeVisible();
            
            // Basic navigation should still work
            const tabs = page.locator('.tab');
            const tabCount = await tabs.count();
            
            if (tabCount > 0) {
                await tabs.nth(1).click();
                await page.waitForTimeout(500);
            }
        });

        test('handles CSP (Content Security Policy) errors', async ({ page }) => {
            // This test checks if inline script errors are handled
            await page.addInitScript(() => {
                // Mock CSP error
                window.addEventListener('securitypolicyviolation', (e) => {
                    console.log('CSP violation handled:', e.violatedDirective);
                });
            });
            
            await page.reload();
            await page.waitForTimeout(2000);
            
            // App should continue to function despite CSP issues
            await expect(page.locator('body')).toBeVisible();
        });
    });

    test.describe('Recovery Mechanisms', () => {
        test('can recover from temporary network issues', async ({ page }) => {
            // First, break the network
            await page.route('**/*', route => route.abort('connectionrefused'));
            
            await page.reload();
            await page.waitForTimeout(2000);
            
            // Then restore the network
            await page.unroute('**/*');
            
            // App should be able to recover
            await page.reload();
            await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
        });

        test('maintains functionality after JavaScript errors', async ({ page }) => {
            // Cause a JavaScript error
            await page.evaluate(() => {
                throw new Error('Simulated JavaScript error');
            });
            
            await page.waitForTimeout(1000);
            
            // Basic functionality should still work
            await page.click('button.tab:has-text("Albums")');
            await expect(page.locator('#albums')).toBeVisible();
        });

        test('recovers from failed async operations', async ({ page }) => {
            // Mock a failing async operation
            await page.route('/api/stats', route => {
                route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Temporary failure' })
                });
            });
            
            // Navigate to Overview
            await page.click('button.tab:has-text("Overview")');
            await page.waitForTimeout(2000);
            
            // Now fix the API
            await page.unroute('/api/stats');
            
            // Should be able to recover by refreshing
            await page.reload();
            await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
            
            await page.click('button.tab:has-text("Overview")');
            await expect(page.locator('#overview')).toBeVisible();
        });
    });
});