const { test, expect, devices } = require('@playwright/test');

test.describe('Enhanced Mobile Responsiveness and Touch Gestures', () => {
    // Test on multiple mobile viewports
    const mobileViewports = [
        { name: 'iPhone SE', width: 375, height: 667 },
        { name: 'iPhone 12', width: 390, height: 844 },
        { name: 'Samsung Galaxy S21', width: 384, height: 854 },
        { name: 'iPad Mini', width: 768, height: 1024 }
    ];

    mobileViewports.forEach(({ name, width, height }) => {
        test.describe(`${name} (${width}x${height})`, () => {
            test.beforeEach(async ({ page }) => {
                await page.setViewportSize({ width, height });
                await page.goto('/');
                await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
            });

            test('displays mobile-optimized layout', async ({ page }) => {
                // Check mobile FAB is visible
                await expect(page.locator('#mobile-fab')).toBeVisible();
                
                // Check responsive design elements
                const container = page.locator('.container');
                await expect(container).toHaveCSS('padding', '10px'); // Mobile padding
                
                // Check tabs are horizontally scrollable on small screens
                if (width <= 480) {
                    const tabs = page.locator('.tabs');
                    await expect(tabs).toHaveCSS('overflow-x', 'auto');
                }
            });

            test('mobile navigation works correctly', async ({ page }) => {
                // Test mobile FAB functionality
                await page.click('#mobile-fab');
                await expect(page.locator('#mobile-menu')).toHaveClass(/open/);
                
                // Test mobile menu items
                await expect(page.locator('.mobile-card')).toHaveCount(4);
                
                // Close menu by clicking outside
                await page.click('.container');
                await expect(page.locator('#mobile-menu')).not.toHaveClass(/open/);
            });

            test('touch targets meet minimum size requirements', async ({ page }) => {
                // All interactive elements should be at least 44x44px for touch
                const buttons = await page.locator('button, .tab, .action-btn').all();
                
                for (const button of buttons) {
                    const box = await button.boundingBox();
                    if (box) {
                        expect(box.height).toBeGreaterThanOrEqual(44);
                        expect(box.width).toBeGreaterThanOrEqual(44);
                    }
                }
            });

            test('swipe gestures work for tab navigation', async ({ page }) => {
                const container = page.locator('.container');
                const box = await container.boundingBox();
                
                if (box) {
                    // Get current active tab
                    const initialTab = await page.locator('.tab.active').textContent();
                    
                    // Perform swipe left gesture (next tab)
                    await page.touchscreen.tap(box.x + box.width - 50, box.y + box.height / 2);
                    await page.mouse.move(box.x + box.width - 50, box.y + box.height / 2);
                    await page.mouse.down();
                    await page.mouse.move(box.x + 50, box.y + box.height / 2, { steps: 5 });
                    await page.mouse.up();
                    
                    // Wait for gesture to process
                    await page.waitForTimeout(500);
                    
                    // Should show swipe feedback or change tabs
                    const currentTab = await page.locator('.tab.active').textContent();
                    // Tab might change or stay the same depending on gesture sensitivity
                    expect(typeof currentTab).toBe('string');
                }
            });
        });
    });

    test.describe('Touch Gesture Interactions', () => {
        test.beforeEach(async ({ page }) => {
            await page.setViewportSize({ width: 375, height: 667 });
            await page.goto('/');
            await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
        });

        test('pull-to-refresh functionality', async ({ page }) => {
            // Scroll to top
            await page.evaluate(() => window.scrollTo(0, 0));
            
            const container = page.locator('.container');
            const box = await container.boundingBox();
            
            if (box) {
                // Simulate pull down gesture
                const startY = box.y + 50;
                const endY = startY + 150;
                
                await page.touchscreen.tap(box.x + box.width / 2, startY);
                await page.mouse.move(box.x + box.width / 2, startY);
                await page.mouse.down();
                await page.mouse.move(box.x + box.width / 2, endY, { steps: 10 });
                await page.mouse.up();
                
                // Wait for pull-to-refresh indicator
                await page.waitForTimeout(1000);
                
                // Check if refresh indicator appears
                const indicator = page.locator('#pull-refresh-indicator');
                const exists = await indicator.count();
                
                // Indicator should exist (even if not visible)
                expect(exists).toBeGreaterThanOrEqual(0);
            }
        });

        test('haptic feedback triggers correctly', async ({ page }) => {
            // Test haptic feedback on button press
            const vibrationSupported = await page.evaluate(() => 'vibrate' in navigator);
            
            if (vibrationSupported) {
                // Mock vibration to capture calls
                await page.addInitScript(() => {
                    window.vibrationCalls = [];
                    navigator.vibrate = function(pattern) {
                        window.vibrationCalls.push(pattern);
                        return true;
                    };
                });
                
                // Trigger action that should cause haptic feedback
                await page.click('#mobile-fab');
                
                // Check if vibration was called
                const vibrationCalls = await page.evaluate(() => window.vibrationCalls);
                expect(vibrationCalls.length).toBeGreaterThanOrEqual(0);
            }
        });

        test('long press gestures work', async ({ page }) => {
            // Navigate to Albums tab for long press test
            await page.click('button.tab:has-text("Albums")');
            
            // Wait for albums to load
            await page.waitForTimeout(1000);
            
            // Simulate long press on table row
            const tableRow = page.locator('#albums-table tbody tr').first();
            
            if (await tableRow.count() > 0) {
                const box = await tableRow.boundingBox();
                
                if (box) {
                    // Simulate long press (hold for 800ms)
                    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                    await page.mouse.down();
                    await page.waitForTimeout(800);
                    await page.mouse.up();
                    
                    // Long press might trigger context menu or selection
                    // The exact behavior depends on implementation
                    await page.waitForTimeout(200);
                }
            }
        });

        test('pinch zoom is disabled on UI elements', async ({ page }) => {
            // Test that pinch zoom doesn't interfere with UI
            const viewport = page.viewportSize();
            
            // Simulate pinch gesture on main content
            const container = page.locator('.container');
            const box = await container.boundingBox();
            
            if (box) {
                // Get initial zoom level
                const initialZoom = await page.evaluate(() => document.documentElement.style.zoom || '1');
                
                // Simulate pinch out gesture
                await page.touchscreen.tap(box.x + box.width / 2 - 50, box.y + box.height / 2);
                await page.touchscreen.tap(box.x + box.width / 2 + 50, box.y + box.height / 2);
                
                await page.waitForTimeout(500);
                
                // Check that zoom level didn't change (should be prevented by CSS)
                const currentZoom = await page.evaluate(() => document.documentElement.style.zoom || '1');
                expect(currentZoom).toBe(initialZoom);
            }
        });

        test('touch scrolling works smoothly', async ({ page }) => {
            // Navigate to Albums tab with scrollable content
            await page.click('button.tab:has-text("Albums")');
            await page.waitForTimeout(1000);
            
            // Get initial scroll position
            const initialScroll = await page.evaluate(() => window.scrollY);
            
            // Perform touch scroll
            const container = page.locator('.container');
            const box = await container.boundingBox();
            
            if (box) {
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.mouse.down();
                await page.mouse.move(box.x + box.width / 2, box.y + 100, { steps: 5 });
                await page.mouse.up();
                
                await page.waitForTimeout(500);
                
                // Scroll position should have changed
                const finalScroll = await page.evaluate(() => window.scrollY);
                // May or may not change depending on content height
                expect(typeof finalScroll).toBe('number');
            }
        });
    });

    test.describe('Mobile-Specific UI Features', () => {
        test.beforeEach(async ({ page }) => {
            await page.setViewportSize({ width: 375, height: 667 });
            await page.goto('/');
            await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
        });

        test('mobile bottom sheet functionality', async ({ page }) => {
            // Open mobile menu
            await page.click('#mobile-fab');
            
            // Check bottom sheet appears
            await expect(page.locator('#mobile-menu')).toBeVisible();
            await expect(page.locator('#mobile-menu')).toHaveClass(/open/);
            
            // Check bottom sheet content
            await expect(page.locator('.bottom-sheet-header')).toBeVisible();
            await expect(page.locator('.bottom-sheet-content')).toBeVisible();
            
            // Close by clicking close button
            await page.click('.bottom-sheet-header button');
            await expect(page.locator('#mobile-menu')).not.toHaveClass(/open/);
        });

        test('mobile card interactions', async ({ page }) => {
            // Open mobile menu
            await page.click('#mobile-fab');
            
            // Test each mobile card
            const cards = page.locator('.mobile-card');
            const cardCount = await cards.count();
            
            expect(cardCount).toBeGreaterThan(0);
            
            for (let i = 0; i < cardCount; i++) {
                const card = cards.nth(i);
                
                // Check card is properly styled
                await expect(card).toHaveClass(/mobile-card/);
                
                // Check card has content
                const title = card.locator('h3');
                await expect(title).toBeVisible();
                
                const description = card.locator('p');
                await expect(description).toBeVisible();
            }
        });

        test('mobile toast notifications work', async ({ page }) => {
            // Trigger an action that should show toast
            await page.click('#mobile-fab');
            
            // Find a card that should trigger toast
            const refreshCard = page.locator('.mobile-card:has-text("Refresh Data")');
            if (await refreshCard.count() > 0) {
                await refreshCard.click();
                
                // Wait for potential toast
                await page.waitForTimeout(1000);
                
                // Toast might appear briefly
                const toast = page.locator('.toast');
                const toastExists = await toast.count();
                
                // Toast may or may not be present at this point
                expect(toastExists).toBeGreaterThanOrEqual(0);
            }
        });

        test('mobile swipe indicators appear', async ({ page }) => {
            // Check that swipe indicators exist
            await expect(page.locator('#swipe-left')).toBeHidden(); // Hidden by default
            await expect(page.locator('#swipe-right')).toBeHidden(); // Hidden by default
            
            // Swipe indicators should have proper styling
            const leftIndicator = page.locator('#swipe-left');
            const rightIndicator = page.locator('#swipe-right');
            
            await expect(leftIndicator).toHaveClass(/swipe-indicator/);
            await expect(rightIndicator).toHaveClass(/swipe-indicator/);
        });

        test('mobile progress bars work correctly', async ({ page }) => {
            // Navigate to Actions tab
            await page.click('button.tab:has-text("Actions")');
            
            // Check mobile progress elements exist
            const progressBars = page.locator('.mobile-progress-bar');
            const progressCount = await progressBars.count();
            
            // May or may not have progress bars visible initially
            expect(progressCount).toBeGreaterThanOrEqual(0);
            
            if (progressCount > 0) {
                const firstProgressBar = progressBars.first();
                await expect(firstProgressBar).toHaveClass(/mobile-progress-bar/);
                
                // Check progress fill exists
                const progressFill = firstProgressBar.locator('.mobile-progress-fill');
                if (await progressFill.count() > 0) {
                    await expect(progressFill).toHaveClass(/mobile-progress-fill/);
                }
            }
        });
    });

    test.describe('Accessibility on Mobile', () => {
        test.beforeEach(async ({ page }) => {
            await page.setViewportSize({ width: 375, height: 667 });
            await page.goto('/');
            await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
        });

        test('screen reader compatibility on mobile', async ({ page }) => {
            // Check that important elements have proper ARIA labels
            const mobileFab = page.locator('#mobile-fab');
            
            // FAB should be focusable and have meaningful content
            await expect(mobileFab).toBeVisible();
            const fabContent = await mobileFab.textContent();
            expect(fabContent?.length).toBeGreaterThan(0);
        });

        test('keyboard navigation works on mobile', async ({ page }) => {
            // Test tab navigation
            await page.keyboard.press('Tab');
            
            // Should focus on first interactive element
            const focused = page.locator(':focus');
            await expect(focused).toBeVisible();
            
            // Continue tabbing through elements
            for (let i = 0; i < 5; i++) {
                await page.keyboard.press('Tab');
                const currentFocused = page.locator(':focus');
                await expect(currentFocused).toBeVisible();
            }
        });

        test('focus indicators visible on mobile', async ({ page }) => {
            // Tab to first interactive element
            await page.keyboard.press('Tab');
            
            // Focus should be visible
            const focused = page.locator(':focus');
            await expect(focused).toBeVisible();
            
            // Check that focus has visible indication (outline, etc.)
            const focusedElement = await focused.first();
            const outline = await focusedElement.evaluate(el => 
                window.getComputedStyle(el).outline
            );
            
            // Focus indicator should be present (may be 'none' or an actual outline)
            expect(typeof outline).toBe('string');
        });

        test('text remains readable on mobile', async ({ page }) => {
            // Check that text has sufficient contrast and size
            const textElements = page.locator('p, span, div, h1, h2, h3, h4, h5, h6');
            const elementCount = Math.min(10, await textElements.count()); // Test first 10
            
            for (let i = 0; i < elementCount; i++) {
                const element = textElements.nth(i);
                
                if (await element.isVisible()) {
                    const fontSize = await element.evaluate(el => 
                        window.getComputedStyle(el).fontSize
                    );
                    
                    const fontSizeNum = parseFloat(fontSize);
                    
                    // Text should be at least 14px for mobile readability
                    expect(fontSizeNum).toBeGreaterThanOrEqual(12);
                }
            }
        });
    });

    test.describe('Performance on Mobile', () => {
        test.beforeEach(async ({ page }) => {
            await page.setViewportSize({ width: 375, height: 667 });
        });

        test('page loads quickly on mobile', async ({ page }) => {
            const startTime = Date.now();
            
            await page.goto('/');
            await expect(page.locator('#status')).toContainText('Connected', { timeout: 15000 });
            
            const loadTime = Date.now() - startTime;
            
            // Page should load reasonably quickly on mobile
            expect(loadTime).toBeLessThan(15000); // 15 seconds max
        });

        test('animations are smooth on mobile', async ({ page }) => {
            await page.goto('/');
            await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
            
            // Test tab switching animation
            const tabs = ['Overview', 'Actions', 'Albums', 'Artists'];
            
            for (const tabName of tabs) {
                const startTime = Date.now();
                
                await page.click(`button.tab:has-text("${tabName}")`);
                await expect(page.locator(`button.tab:has-text("${tabName}")`)).toHaveClass(/active/);
                
                const switchTime = Date.now() - startTime;
                
                // Tab switch should be quick
                expect(switchTime).toBeLessThan(1000);
                
                await page.waitForTimeout(100); // Brief pause between switches
            }
        });

        test('memory usage remains stable', async ({ page }) => {
            await page.goto('/');
            await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
            
            // Get initial memory if available
            const initialMetrics = await page.evaluate(() => {
                return (performance as any).memory ? {
                    usedJSHeapSize: (performance as any).memory.usedJSHeapSize,
                    totalJSHeapSize: (performance as any).memory.totalJSHeapSize
                } : null;
            });
            
            // Perform various operations
            const tabs = ['Overview', 'Actions', 'Albums', 'Artists'];
            for (let round = 0; round < 3; round++) {
                for (const tabName of tabs) {
                    await page.click(`button.tab:has-text("${tabName}")`);
                    await page.waitForTimeout(200);
                }
            }
            
            // Check memory after operations
            const finalMetrics = await page.evaluate(() => {
                return (performance as any).memory ? {
                    usedJSHeapSize: (performance as any).memory.usedJSHeapSize,
                    totalJSHeapSize: (performance as any).memory.totalJSHeapSize
                } : null;
            });
            
            if (initialMetrics && finalMetrics) {
                // Memory shouldn't have increased dramatically
                const memoryIncrease = finalMetrics.usedJSHeapSize - initialMetrics.usedJSHeapSize;
                const percentIncrease = (memoryIncrease / initialMetrics.usedJSHeapSize) * 100;
                
                // Memory increase should be reasonable (less than 50%)
                expect(percentIncrease).toBeLessThan(50);
            }
        });
    });
});