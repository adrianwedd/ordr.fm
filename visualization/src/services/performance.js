// Performance monitoring service for ordr.fm
const EventEmitter = require('events');

/**
 * Performance monitoring service with metrics collection and analysis
 * Tracks request performance, resource usage, and system health
 */
class PerformanceMonitor extends EventEmitter {
    constructor() {
        super();
        this.metrics = {
            requests: new Map(), // Active request tracking
            responses: [], // Response time history
            system: {
                cpu: [],
                memory: [],
                uptime: process.uptime()
            },
            database: {
                queries: [],
                connections: 0,
                slowQueries: []
            },
            cache: {
                hits: 0,
                misses: 0,
                evictions: 0
            },
            websocket: {
                connections: 0,
                messages: 0,
                errors: 0
            }
        };
        
        this.thresholds = {
            slowRequest: 1000, // 1 second
            slowQuery: 500,    // 500ms
            highMemory: 0.95,  // 95% of available memory (raised from 80%)
            highCpu: 0.9       // 90% CPU usage (raised from 70%)
        };
        
        // Memory management limits
        this.limits = {
            maxResponses: 500,       // Reduced from 1000
            maxQueries: 250,         // Reduced from 500
            maxSlowQueries: 50,      // New limit
            maxSystemMetrics: 50,    // Reduced from 100
            maxActiveRequests: 100   // New limit
        };
        
        this.isEnabled = process.env.NODE_ENV === 'production';
        this.startTime = Date.now();
        
        // Start system monitoring only in production
        if (this.isEnabled) {
            this.startSystemMonitoring();
            this.startMemoryCleanup();
        }
    }
    
    /**
     * Start tracking a request
     */
    startRequest(requestId, metadata = {}) {
        if (!this.isEnabled) {return;}
        
        // Prevent memory overflow from active requests
        if (this.metrics.requests.size >= this.limits.maxActiveRequests) {
            // Clean up old active requests (likely stale)
            const cutoffTime = Date.now() - 300000; // 5 minutes ago
            for (const [id, request] of this.metrics.requests.entries()) {
                if (request.startTimestamp < cutoffTime) {
                    this.metrics.requests.delete(id);
                }
            }
            
            // If still too many, remove oldest
            if (this.metrics.requests.size >= this.limits.maxActiveRequests) {
                const oldestId = this.metrics.requests.keys().next().value;
                this.metrics.requests.delete(oldestId);
            }
        }
        
        this.metrics.requests.set(requestId, {
            startTime: process.hrtime.bigint(),
            startTimestamp: Date.now(),
            ...metadata
        });
    }
    
    /**
     * End tracking a request and record metrics
     */
    endRequest(requestId, statusCode = 200, responseSize = 0) {
        if (!this.isEnabled) {return;}
        
        const request = this.metrics.requests.get(requestId);
        if (!request) {return;}
        
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - request.startTime) / 1000000; // Convert to milliseconds
        
        const responseMetric = {
            requestId,
            duration,
            statusCode,
            responseSize,
            timestamp: Date.now(),
            method: request.method,
            route: request.route,
            userAgent: request.userAgent,
            ip: request.ip
        };
        
        // Store response metric with memory management
        this.metrics.responses.push(responseMetric);
        
        // Keep only last N responses (memory-bounded)
        if (this.metrics.responses.length > this.limits.maxResponses) {
            // Remove oldest 25% to avoid frequent array operations
            const removeCount = Math.floor(this.limits.maxResponses * 0.25);
            this.metrics.responses.splice(0, removeCount);
        }
        
        // Check for slow requests
        if (duration > this.thresholds.slowRequest) {
            this.emit('slowRequest', responseMetric);
        }
        
        // Remove from active requests
        this.metrics.requests.delete(requestId);
        
        return responseMetric;
    }
    
    /**
     * Record database query performance
     */
    recordQuery(query, duration, rows = 0) {
        if (!this.isEnabled) {return;}
        
        const queryMetric = {
            query: query.substring(0, 100), // Truncate long queries
            duration,
            rows,
            timestamp: Date.now()
        };
        
        this.metrics.database.queries.push(queryMetric);
        
        // Keep only last N queries (memory-bounded)
        if (this.metrics.database.queries.length > this.limits.maxQueries) {
            const removeCount = Math.floor(this.limits.maxQueries * 0.25);
            this.metrics.database.queries.splice(0, removeCount);
        }
        
        // Check for slow queries
        if (duration > this.thresholds.slowQuery) {
            this.metrics.database.slowQueries.push(queryMetric);
            
            // Limit slow queries storage
            if (this.metrics.database.slowQueries.length > this.limits.maxSlowQueries) {
                const removeCount = Math.floor(this.limits.maxSlowQueries * 0.25);
                this.metrics.database.slowQueries.splice(0, removeCount);
            }
            
            this.emit('slowQuery', queryMetric);
        }
    }
    
    /**
     * Record cache operation
     */
    recordCache(operation, key, hit = false) {
        if (!this.isEnabled) {return;}
        
        if (hit) {
            this.metrics.cache.hits++;
        } else {
            this.metrics.cache.misses++;
        }
        
        if (operation === 'eviction') {
            this.metrics.cache.evictions++;
        }
    }
    
    /**
     * Record WebSocket activity
     */
    recordWebSocket(event, data = {}) {
        if (!this.isEnabled) {return;}
        
        switch (event) {
            case 'connection':
                this.metrics.websocket.connections++;
                break;
            case 'disconnection':
                this.metrics.websocket.connections = Math.max(0, this.metrics.websocket.connections - 1);
                break;
            case 'message':
                this.metrics.websocket.messages++;
                break;
            case 'error':
                this.metrics.websocket.errors++;
                break;
        }
    }
    
    /**
     * Get current performance statistics
     */
    getStats() {
        const now = Date.now();
        const responses = this.metrics.responses;
        const recentResponses = responses.filter(r => now - r.timestamp < 300000); // Last 5 minutes
        
        return {
            uptime: process.uptime(),
            timestamp: now,
            requests: {
                total: responses.length,
                active: this.metrics.requests.size,
                recent: recentResponses.length,
                averageResponseTime: this.calculateAverage(recentResponses.map(r => r.duration)),
                slowRequests: responses.filter(r => r.duration > this.thresholds.slowRequest).length
            },
            database: {
                totalQueries: this.metrics.database.queries.length,
                slowQueries: this.metrics.database.slowQueries.length,
                averageQueryTime: this.calculateAverage(this.metrics.database.queries.map(q => q.duration)),
                activeConnections: this.metrics.database.connections
            },
            cache: {
                hits: this.metrics.cache.hits,
                misses: this.metrics.cache.misses,
                hitRate: this.calculateHitRate(),
                evictions: this.metrics.cache.evictions
            },
            websocket: this.metrics.websocket,
            system: {
                memory: process.memoryUsage(),
                cpu: process.cpuUsage(),
                uptime: process.uptime(),
                loadAverage: require('os').loadavg(),
                freeMemory: require('os').freemem(),
                totalMemory: require('os').totalmem()
            }
        };
    }
    
    /**
     * Get performance trends over time
     */
    getTrends() {
        const now = Date.now();
        const responses = this.metrics.responses;
        
        // Group responses by time periods
        const hourlyData = this.groupByTime(responses, 3600000); // 1 hour
        const dailyData = this.groupByTime(responses, 86400000); // 1 day
        
        return {
            hourly: hourlyData,
            daily: dailyData,
            trends: {
                responseTime: this.calculateTrend(responses.map(r => r.duration)),
                requestVolume: this.calculateTrend(hourlyData.map(h => h.count)),
                errorRate: this.calculateTrend(hourlyData.map(h => h.errorRate))
            }
        };
    }
    
    /**
     * Get detailed performance report
     */
    getDetailedReport() {
        const stats = this.getStats();
        const trends = this.getTrends();
        const alerts = this.checkAlerts();
        
        return {
            summary: stats,
            trends,
            alerts,
            topEndpoints: this.getTopEndpoints(),
            slowQueries: this.metrics.database.slowQueries.slice(-10),
            systemHealth: this.assessSystemHealth(stats)
        };
    }
    
    /**
     * Check for performance alerts
     */
    checkAlerts() {
        const stats = this.getStats();
        const alerts = [];
        
        // Check response time
        if (stats.requests.averageResponseTime > this.thresholds.slowRequest) {
            alerts.push({
                type: 'performance',
                severity: 'warning',
                message: `Average response time (${stats.requests.averageResponseTime.toFixed(2)}ms) exceeds threshold`,
                threshold: this.thresholds.slowRequest
            });
        }
        
        // Check memory usage
        const memoryUsage = stats.system.memory.heapUsed / stats.system.memory.heapTotal;
        if (memoryUsage > this.thresholds.highMemory) {
            alerts.push({
                type: 'memory',
                severity: 'critical',
                message: `Memory usage (${(memoryUsage * 100).toFixed(1)}%) exceeds threshold`,
                threshold: this.thresholds.highMemory
            });
        }
        
        // Check cache hit rate
        const hitRate = this.calculateHitRate();
        if (hitRate < 0.5 && (this.metrics.cache.hits + this.metrics.cache.misses) > 100) {
            alerts.push({
                type: 'cache',
                severity: 'info',
                message: `Cache hit rate (${(hitRate * 100).toFixed(1)}%) is low`,
                threshold: 0.5
            });
        }
        
        return alerts;
    }
    
    /**
     * Start system resource monitoring
     */
    startSystemMonitoring() {
        const interval = 30000; // 30 seconds
        
        setInterval(() => {
            if (!this.isEnabled) {return;}
            
            const memory = process.memoryUsage();
            const cpu = process.cpuUsage();
            
            this.metrics.system.memory.push({
                timestamp: Date.now(),
                ...memory
            });
            
            this.metrics.system.cpu.push({
                timestamp: Date.now(),
                ...cpu
            });
            
            // Keep only last N system metrics (memory-bounded)
            if (this.metrics.system.memory.length > this.limits.maxSystemMetrics) {
                const removeCount = Math.floor(this.limits.maxSystemMetrics * 0.25);
                this.metrics.system.memory.splice(0, removeCount);
                this.metrics.system.cpu.splice(0, removeCount);
            }
            
            // Check system health
            const memoryUsage = memory.heapUsed / memory.heapTotal;
            if (memoryUsage > this.thresholds.highMemory) {
                this.emit('highMemoryUsage', { usage: memoryUsage, memory });
            }
        }, interval);
    }
    
    /**
     * Start periodic memory cleanup
     */
    startMemoryCleanup() {
        const cleanupInterval = 300000; // 5 minutes
        
        setInterval(() => {
            if (!this.isEnabled) {return;}
            
            const now = Date.now();
            const maxAge = 1800000; // 30 minutes
            
            // Clean up old responses
            this.metrics.responses = this.metrics.responses.filter(r => 
                now - r.timestamp < maxAge
            );
            
            // Clean up old queries
            this.metrics.database.queries = this.metrics.database.queries.filter(q => 
                now - q.timestamp < maxAge
            );
            
            // Clean up old slow queries
            this.metrics.database.slowQueries = this.metrics.database.slowQueries.filter(q => 
                now - q.timestamp < maxAge
            );
            
            // Clean up stale active requests
            const staleRequestCutoff = now - 300000; // 5 minutes
            for (const [id, request] of this.metrics.requests.entries()) {
                if (request.startTimestamp < staleRequestCutoff) {
                    this.metrics.requests.delete(id);
                }
            }
            
            // Clean up old system metrics
            this.metrics.system.memory = this.metrics.system.memory.filter(m => 
                now - m.timestamp < maxAge
            );
            this.metrics.system.cpu = this.metrics.system.cpu.filter(c => 
                now - c.timestamp < maxAge
            );
            
            // Force garbage collection if available
            if (global.gc && this.metrics.responses.length % 100 === 0) {
                global.gc();
            }
        }, cleanupInterval);
    }
    
    /**
     * Helper: Calculate average of array
     */
    calculateAverage(values) {
        if (!values.length) {return 0;}
        return values.reduce((sum, val) => sum + val, 0) / values.length;
    }
    
    /**
     * Helper: Calculate cache hit rate
     */
    calculateHitRate() {
        const total = this.metrics.cache.hits + this.metrics.cache.misses;
        return total > 0 ? this.metrics.cache.hits / total : 0;
    }
    
    /**
     * Helper: Group data by time periods
     */
    groupByTime(data, periodMs) {
        const groups = new Map();
        
        data.forEach(item => {
            const period = Math.floor(item.timestamp / periodMs) * periodMs;
            if (!groups.has(period)) {
                groups.set(period, {
                    timestamp: period,
                    count: 0,
                    totalDuration: 0,
                    errors: 0
                });
            }
            
            const group = groups.get(period);
            group.count++;
            group.totalDuration += item.duration;
            if (item.statusCode >= 400) {
                group.errors++;
            }
        });
        
        // Calculate derived metrics
        return Array.from(groups.values()).map(group => ({
            ...group,
            averageDuration: group.count > 0 ? group.totalDuration / group.count : 0,
            errorRate: group.count > 0 ? group.errors / group.count : 0
        }));
    }
    
    /**
     * Helper: Calculate trend (simple linear regression)
     */
    calculateTrend(values) {
        if (values.length < 2) {return 0;}
        
        const n = values.length;
        const sumX = (n * (n + 1)) / 2;
        const sumY = values.reduce((sum, val) => sum + val, 0);
        const sumXY = values.reduce((sum, val, idx) => sum + val * (idx + 1), 0);
        const sumX2 = (n * (n + 1) * (2 * n + 1)) / 6;
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        return slope;
    }
    
    /**
     * Get top endpoints by request volume
     */
    getTopEndpoints() {
        const endpointStats = new Map();
        
        this.metrics.responses.forEach(response => {
            const key = `${response.method} ${response.route}`;
            if (!endpointStats.has(key)) {
                endpointStats.set(key, {
                    endpoint: key,
                    count: 0,
                    totalDuration: 0,
                    errors: 0
                });
            }
            
            const stats = endpointStats.get(key);
            stats.count++;
            stats.totalDuration += response.duration;
            if (response.statusCode >= 400) {
                stats.errors++;
            }
        });
        
        return Array.from(endpointStats.values())
            .map(stats => ({
                ...stats,
                averageDuration: stats.totalDuration / stats.count,
                errorRate: stats.errors / stats.count
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
    }
    
    /**
     * Assess overall system health
     */
    assessSystemHealth(stats) {
        let score = 100;
        const issues = [];
        
        // Response time health (0-30 points)
        if (stats.requests.averageResponseTime > 2000) {
            score -= 30;
            issues.push('Very slow response times');
        } else if (stats.requests.averageResponseTime > 1000) {
            score -= 15;
            issues.push('Slow response times');
        }
        
        // Memory health (0-25 points)
        const memoryUsage = stats.system.memory.heapUsed / stats.system.memory.heapTotal;
        if (memoryUsage > 0.9) {
            score -= 25;
            issues.push('Critical memory usage');
        } else if (memoryUsage > 0.8) {
            score -= 15;
            issues.push('High memory usage');
        }
        
        // Error rate health (0-20 points)
        const recentResponses = this.metrics.responses.filter(r => Date.now() - r.timestamp < 300000);
        const errorRate = recentResponses.filter(r => r.statusCode >= 400).length / recentResponses.length;
        if (errorRate > 0.1) {
            score -= 20;
            issues.push('High error rate');
        } else if (errorRate > 0.05) {
            score -= 10;
            issues.push('Elevated error rate');
        }
        
        // Cache health (0-15 points)
        const hitRate = this.calculateHitRate();
        if (hitRate < 0.3 && (this.metrics.cache.hits + this.metrics.cache.misses) > 100) {
            score -= 15;
            issues.push('Poor cache performance');
        } else if (hitRate < 0.5) {
            score -= 8;
            issues.push('Low cache hit rate');
        }
        
        // Database health (0-10 points)
        if (stats.database.slowQueries > stats.database.totalQueries * 0.1) {
            score -= 10;
            issues.push('Many slow database queries');
        }
        
        return {
            score: Math.max(0, score),
            status: score >= 80 ? 'healthy' : score >= 60 ? 'degraded' : 'unhealthy',
            issues
        };
    }
    
    /**
     * Reset all metrics
     */
    reset() {
        this.metrics.requests.clear();
        this.metrics.responses = [];
        this.metrics.database.queries = [];
        this.metrics.database.slowQueries = [];
        this.metrics.cache = { hits: 0, misses: 0, evictions: 0 };
        this.metrics.websocket = { connections: 0, messages: 0, errors: 0 };
        this.metrics.system.memory = [];
        this.metrics.system.cpu = [];
    }
    
    /**
     * Enable/disable monitoring
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
    }
}

// Singleton instance
const performanceMonitor = new PerformanceMonitor();

module.exports = performanceMonitor;