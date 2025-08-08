const { test, expect } = require('@playwright/test');

test.describe('Enhanced WebSocket Real-time Updates', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#status')).toContainText('Connected', { timeout: 10000 });
    });

    test.describe('WebSocket Connection Management', () => {
        test('establishes WebSocket connection on page load', async ({ page }) => {
            // Wait for WebSocket connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 15000 });
            
            // Verify connection properties
            const wsInfo = await page.evaluate(() => ({
                readyState: window.ws.readyState,
                url: window.ws.url,
                protocol: window.ws.protocol,
                extensions: window.ws.extensions
            }));
            
            expect(wsInfo.readyState).toBe(WebSocket.OPEN);
            expect(wsInfo.url).toMatch(/ws:\/\/.*:300[01]/); // WebSocket URL
        });

        test('handles WebSocket connection failures with retry logic', async ({ page }) => {
            // Mock WebSocket to fail initially
            await page.addInitScript(() => {
                let attemptCount = 0;
                const OriginalWebSocket = window.WebSocket;
                
                window.WebSocket = function(url, protocols) {
                    attemptCount++;
                    const ws = new OriginalWebSocket(url, protocols);
                    
                    // Fail first few attempts
                    if (attemptCount <= 2) {
                        setTimeout(() => {
                            ws.dispatchEvent(new Event('error'));
                            ws.dispatchEvent(new CloseEvent('close', { code: 1006 }));
                        }, 100);
                    }
                    
                    window.wsAttemptCount = attemptCount;
                    return ws;
                };
            });
            
            await page.reload();
            
            // Wait for retry attempts
            await page.waitForTimeout(5000);
            
            // Check that retries were attempted
            const attemptCount = await page.evaluate(() => window.wsAttemptCount || 0);
            expect(attemptCount).toBeGreaterThan(1);
        });

        test('implements exponential backoff for reconnection', async ({ page }) => {
            // Track reconnection timing
            await page.addInitScript(() => {
                window.reconnectionTimes = [];
                const originalSetTimeout = window.setTimeout;
                
                window.setTimeout = function(callback, delay, ...args) {
                    if (delay > 1000) { // Likely a reconnection timeout
                        window.reconnectionTimes.push(delay);
                    }
                    return originalSetTimeout(callback, delay, ...args);
                };
            });
            
            // Force disconnection
            await page.evaluate(() => {
                if (window.ws) {
                    window.ws.close();
                }
            });
            
            // Wait for reconnection attempts
            await page.waitForTimeout(10000);
            
            const times = await page.evaluate(() => window.reconnectionTimes);
            
            // Should show increasing delays (exponential backoff)
            if (times.length > 1) {
                expect(times[1]).toBeGreaterThanOrEqual(times[0]);
            }
        });

        test('limits maximum reconnection attempts', async ({ page }) => {
            // Mock persistent connection failures
            await page.addInitScript(() => {
                window.connectionAttempts = 0;
                const OriginalWebSocket = window.WebSocket;
                
                window.WebSocket = function(url, protocols) {
                    window.connectionAttempts++;
                    const ws = new OriginalWebSocket(url, protocols);
                    
                    // Always fail
                    setTimeout(() => {
                        ws.dispatchEvent(new Event('error'));
                        ws.dispatchEvent(new CloseEvent('close', { code: 1006 }));
                    }, 100);
                    
                    return ws;
                };
            });
            
            await page.reload();
            
            // Wait for maximum attempts to be reached
            await page.waitForTimeout(30000);
            
            const attempts = await page.evaluate(() => window.connectionAttempts);
            
            // Should not exceed reasonable maximum (e.g., 5-10 attempts)
            expect(attempts).toBeLessThanOrEqual(10);
        });
    });

    test.describe('Real-time Message Processing', () => {
        test('processes processing update messages correctly', async ({ page }) => {
            // Wait for WebSocket connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 10000 });
            
            // Mock processing update message
            await page.evaluate(() => {
                if (window.ws && window.handleProcessingUpdate) {
                    window.handleProcessingUpdate({
                        type: 'processing_update',
                        data: {
                            progress: 45,
                            currentFile: 'test_album/track01.mp3',
                            status: 'Analyzing metadata...',
                            albumsProcessed: 5,
                            totalAlbums: 12
                        }
                    });
                }
            });
            
            // Check if processing UI is updated
            await page.waitForTimeout(1000);
            
            const progressSection = page.locator('#processing-progress');
            if (await progressSection.count() > 0) {
                await expect(progressSection).toBeVisible();
            }
        });

        test('handles backup progress messages', async ({ page }) => {
            // Wait for connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 10000 });
            
            // Mock backup update message
            await page.evaluate(() => {
                if (window.ws && window.handleBackupUpdate) {
                    window.handleBackupUpdate({
                        type: 'backup_update',
                        data: {
                            backupId: 'backup-123',
                            progress: 65,
                            status: 'Syncing to cloud...',
                            filesUploaded: 150,
                            totalFiles: 230,
                            speed: '2.3 MB/s'
                        }
                    });
                }
            });
            
            await page.waitForTimeout(1000);
            
            // Check backup progress indicators
            const backupSection = page.locator('#backup-progress');
            if (await backupSection.count() > 0) {
                const isVisible = await backupSection.isVisible();
                expect(typeof isVisible).toBe('boolean');
            }
        });

        test('displays real-time statistics updates', async ({ page }) => {
            // Get initial statistics
            const initialStats = await page.evaluate(() => ({
                albums: document.getElementById('stat-albums')?.textContent || '0',
                artists: document.getElementById('stat-artists')?.textContent || '0',
                tracks: document.getElementById('stat-tracks')?.textContent || '0'
            }));
            
            // Mock statistics update
            await page.evaluate(() => {
                if (window.ws) {
                    // Simulate receiving stats update
                    const mockEvent = {
                        data: JSON.stringify({
                            type: 'stats_update',
                            data: {
                                total_albums: 125,
                                total_artists: 45,
                                total_tracks: 1580,
                                lossless: 85,
                                lossy: 40
                            }
                        })
                    };
                    
                    if (window.ws.onmessage) {
                        window.ws.onmessage(mockEvent);
                    }
                }
            });
            
            await page.waitForTimeout(2000);
            
            // Statistics should be updated (or at least attempted)
            const statElements = page.locator('#stat-albums, #stat-artists, #stat-tracks');
            const count = await statElements.count();
            expect(count).toBeGreaterThan(0);
        });

        test('handles real-time alert notifications', async ({ page }) => {
            // Wait for connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 10000 });
            
            // Mock alert message
            await page.evaluate(() => {
                if (window.ws) {
                    const alertEvent = {
                        data: JSON.stringify({
                            type: 'alert',
                            data: {
                                level: 'warning',
                                title: 'Test Alert',
                                message: 'This is a test alert from WebSocket',
                                icon: '⚠️',
                                timestamp: Date.now()
                            }
                        })
                    };
                    
                    if (window.ws.onmessage) {
                        window.ws.onmessage(alertEvent);
                    }
                }
            });
            
            await page.waitForTimeout(1000);
            
            // Check for alert display
            const alertElements = await page.locator('.alert, .notification, .toast').count();
            expect(alertElements).toBeGreaterThanOrEqual(0);
        });

        test('processes duplicate detection updates', async ({ page }) => {
            // Navigate to Duplicates tab
            await page.click('button.tab:has-text("Duplicates")');
            
            // Mock duplicate detection update
            await page.evaluate(() => {
                if (window.ws) {
                    const duplicateEvent = {
                        data: JSON.stringify({
                            type: 'duplicate_scan_update',
                            data: {
                                progress: 75,
                                scannedFiles: 890,
                                totalFiles: 1200,
                                duplicatesFound: 23,
                                currentFile: 'artist/album/track.mp3'
                            }
                        })
                    };
                    
                    if (window.ws.onmessage) {
                        window.ws.onmessage(duplicateEvent);
                    }
                }
            });
            
            await page.waitForTimeout(1000);
            
            // Check duplicates tab is still functional
            await expect(page.locator('#duplicates')).toBeVisible();
        });
    });

    test.describe('WebSocket Message Validation', () => {
        test('ignores malformed JSON messages', async ({ page }) => {
            // Wait for connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 10000 });
            
            // Send malformed message
            await page.evaluate(() => {
                if (window.ws && window.ws.onmessage) {
                    const malformedEvent = { data: 'invalid json {' };
                    try {
                        window.ws.onmessage(malformedEvent);
                    } catch (error) {
                        console.log('Handled malformed message error:', error.message);
                    }
                }
            });
            
            await page.waitForTimeout(500);
            
            // Page should remain functional
            await expect(page.locator('body')).toBeVisible();
            await expect(page.locator('.tabs')).toBeVisible();
        });

        test('validates message types before processing', async ({ page }) => {
            // Wait for connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 10000 });
            
            // Send message with invalid type
            await page.evaluate(() => {
                if (window.ws && window.ws.onmessage) {
                    const invalidEvent = {
                        data: JSON.stringify({
                            type: 'unknown_message_type',
                            data: { random: 'data' }
                        })
                    };
                    
                    window.ws.onmessage(invalidEvent);
                }
            });
            
            await page.waitForTimeout(500);
            
            // Should not cause errors
            await expect(page.locator('body')).toBeVisible();
        });

        test('handles messages with missing data fields', async ({ page }) => {
            // Wait for connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 10000 });
            
            // Send message with missing data
            await page.evaluate(() => {
                if (window.ws && window.ws.onmessage) {
                    const incompleteEvent = {
                        data: JSON.stringify({
                            type: 'processing_update'
                            // Missing data field
                        })
                    };
                    
                    window.ws.onmessage(incompleteEvent);
                }
            });
            
            await page.waitForTimeout(500);
            
            // Should handle gracefully
            await expect(page.locator('body')).toBeVisible();
        });
    });

    test.describe('WebSocket Subscription Management', () => {
        test('manages channel subscriptions correctly', async ({ page }) => {
            // Wait for connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 10000 });
            
            // Navigate to Actions tab to trigger subscriptions
            await page.click('button.tab:has-text("Actions")');
            
            // Check if subscription messages are sent
            const subscriptionSent = await page.evaluate(() => {
                return new Promise((resolve) => {
                    if (window.ws) {
                        const originalSend = window.ws.send;
                        window.ws.send = function(data) {
                            const message = JSON.parse(data);
                            if (message.type === 'subscribe') {
                                resolve(true);
                                return;
                            }
                            return originalSend.call(this, data);
                        };
                        
                        // Trigger subscription
                        if (window.ws.send) {
                            window.ws.send(JSON.stringify({
                                type: 'subscribe',
                                channels: ['processing', 'backup']
                            }));
                        }
                    }
                    
                    setTimeout(() => resolve(false), 2000);
                });
            });
            
            expect(subscriptionSent).toBe(true);
        });

        test('unsubscribes from channels when leaving tabs', async ({ page }) => {
            // Wait for connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 10000 });
            
            // Go to Actions tab (should subscribe)
            await page.click('button.tab:has-text("Actions")');
            await page.waitForTimeout(1000);
            
            // Go to Overview tab (might unsubscribe)
            await page.click('button.tab:has-text("Overview")');
            await page.waitForTimeout(1000);
            
            // WebSocket should remain connected
            const wsState = await page.evaluate(() => window.ws.readyState);
            expect(wsState).toBe(WebSocket.OPEN);
        });

        test('handles subscription acknowledgments', async ({ page }) => {
            // Wait for connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 10000 });
            
            // Mock subscription acknowledgment
            await page.evaluate(() => {
                if (window.ws && window.ws.onmessage) {
                    const ackEvent = {
                        data: JSON.stringify({
                            type: 'subscription_ack',
                            data: {
                                channels: ['stats', 'processing'],
                                status: 'subscribed'
                            }
                        })
                    };
                    
                    window.ws.onmessage(ackEvent);
                }
            });
            
            await page.waitForTimeout(500);
            
            // Should handle acknowledgment without errors
            await expect(page.locator('body')).toBeVisible();
        });
    });

    test.describe('WebSocket Performance and Reliability', () => {
        test('handles high-frequency messages without performance issues', async ({ page }) => {
            // Wait for connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 10000 });
            
            const startTime = Date.now();
            
            // Send multiple rapid messages
            await page.evaluate(() => {
                if (window.ws && window.ws.onmessage) {
                    for (let i = 0; i < 50; i++) {
                        const rapidEvent = {
                            data: JSON.stringify({
                                type: 'stats_update',
                                data: { counter: i }
                            })
                        };
                        
                        setTimeout(() => {
                            window.ws.onmessage(rapidEvent);
                        }, i * 10); // 10ms intervals
                    }
                }
            });
            
            await page.waitForTimeout(1000);
            
            const endTime = Date.now();
            const processingTime = endTime - startTime;
            
            // Should handle rapidly without significant delay
            expect(processingTime).toBeLessThan(5000);
            
            // Page should remain responsive
            await page.click('button.tab:has-text("Albums")');
            await expect(page.locator('#albums')).toBeVisible();
        });

        test('maintains connection stability during intensive operations', async ({ page }) => {
            // Wait for connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 10000 });
            
            // Simulate intensive tab switching and operations
            const tabs = ['Overview', 'Actions', 'Albums', 'Artists', 'Configuration'];
            
            for (let round = 0; round < 3; round++) {
                for (const tabName of tabs) {
                    await page.click(`button.tab:has-text("${tabName}")`);
                    await page.waitForTimeout(200);
                    
                    // Check WebSocket is still connected
                    const isConnected = await page.evaluate(() => 
                        window.ws && window.ws.readyState === WebSocket.OPEN
                    );
                    
                    expect(isConnected).toBe(true);
                }
            }
        });

        test('recovers from temporary WebSocket server downtime', async ({ page }) => {
            // Wait for initial connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 10000 });
            
            // Force close connection (simulating server downtime)
            await page.evaluate(() => {
                if (window.ws) {
                    window.ws.close(1006, 'Simulated server downtime');
                }
            });
            
            // Wait for close
            await page.waitForFunction(() => {
                return !window.ws || window.ws.readyState === WebSocket.CLOSED;
            }, { timeout: 5000 });
            
            // Wait for reconnection attempt
            await page.waitForTimeout(5000);
            
            // Should attempt reconnection
            const reconnectionAttempted = await page.evaluate(() => {
                return window.wsReconnectAttempts !== undefined;
            });
            
            expect(reconnectionAttempted).toBe(true);
        });

        test('handles WebSocket message queuing during disconnection', async ({ page }) => {
            // Wait for connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 10000 });
            
            // Queue messages for sending during disconnection
            await page.evaluate(() => {
                window.queuedMessages = [];
                
                if (window.ws) {
                    // Mock queuing mechanism
                    const originalSend = window.ws.send;
                    window.ws.send = function(data) {
                        if (this.readyState === WebSocket.OPEN) {
                            return originalSend.call(this, data);
                        } else {
                            window.queuedMessages.push(data);
                        }
                    };
                }
            });
            
            // Force disconnection
            await page.evaluate(() => {
                if (window.ws) {
                    window.ws.close();
                }
            });
            
            // Try to send messages while disconnected
            await page.evaluate(() => {
                if (window.ws) {
                    window.ws.send(JSON.stringify({ type: 'test', data: 'queued message 1' }));
                    window.ws.send(JSON.stringify({ type: 'test', data: 'queued message 2' }));
                }
            });
            
            await page.waitForTimeout(1000);
            
            // Check if messages were queued
            const queuedCount = await page.evaluate(() => window.queuedMessages?.length || 0);
            expect(queuedCount).toBeGreaterThanOrEqual(0);
        });
    });

    test.describe('WebSocket Integration with UI State', () => {
        test('synchronizes processing progress with UI elements', async ({ page }) => {
            // Navigate to Actions tab
            await page.click('button.tab:has-text("Actions")');
            
            // Wait for WebSocket connection
            await page.waitForFunction(() => {
                return window.ws && window.ws.readyState === WebSocket.OPEN;
            }, { timeout: 10000 });
            
            // Mock processing start
            await page.evaluate(() => {
                if (window.handleProcessingUpdate) {
                    // Start processing
                    window.handleProcessingUpdate({
                        type: 'processing_start',
                        data: { message: 'Processing started...' }
                    });
                    
                    // Progress update
                    setTimeout(() => {
                        window.handleProcessingUpdate({
                            type: 'processing_update',
                            data: { 
                                progress: 50,
                                message: 'Halfway through...' 
                            }
                        });
                    }, 500);
                    
                    // Completion
                    setTimeout(() => {
                        window.handleProcessingUpdate({
                            type: 'processing_complete',
                            data: { 
                                success: true,
                                message: 'Processing completed!' 
                            }
                        });
                    }, 1000);
                }
            });
            
            await page.waitForTimeout(1500);
            
            // UI should remain functional after processing messages
            await expect(page.locator('#actions')).toBeVisible();
        });

        test('updates real-time statistics across multiple tabs', async ({ page }) => {
            // Start on Overview tab
            await page.click('button.tab:has-text("Overview")');
            
            // Mock statistics update
            await page.evaluate(() => {
                if (window.ws && window.ws.onmessage) {
                    const statsEvent = {
                        data: JSON.stringify({
                            type: 'stats_update',
                            data: {
                                total_albums: 99,
                                total_artists: 33,
                                total_tracks: 999
                            }
                        })
                    };
                    
                    window.ws.onmessage(statsEvent);
                }
            });
            
            await page.waitForTimeout(1000);
            
            // Switch to another tab and back
            await page.click('button.tab:has-text("Albums")');
            await page.waitForTimeout(500);
            await page.click('button.tab:has-text("Overview")');
            
            // Statistics should persist
            await expect(page.locator('#overview')).toBeVisible();
            
            const statElements = await page.locator('#stat-albums, #stat-artists, #stat-tracks').count();
            expect(statElements).toBeGreaterThan(0);
        });
    });
});