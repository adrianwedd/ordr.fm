// Performance monitoring middleware
const { v4: uuidv4 } = require('uuid');
const performanceMonitor = require('../services/performance');

/**
 * Express middleware to track request performance
 */
function performanceTracking(req, res, next) {
    const requestId = uuidv4();
    const startTime = Date.now();
    
    // Add request ID to request object
    req.requestId = requestId;
    req.startTime = startTime;
    
    // Start tracking this request
    performanceMonitor.startRequest(requestId, {
        method: req.method,
        route: req.route ? req.route.path : req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        contentLength: req.get('Content-Length') || 0
    });
    
    // Track response
    const originalSend = res.send;
    res.send = function(data) {
        // Calculate response size
        const responseSize = Buffer.isBuffer(data) ? data.length : 
                           (typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : 0);
        
        // End request tracking
        performanceMonitor.endRequest(requestId, res.statusCode, responseSize);
        
        // Call original send
        return originalSend.call(this, data);
    };
    
    next();
}

/**
 * Middleware to add performance headers to responses
 */
function performanceHeaders(req, res, next) {
    // Set headers before response is sent
    const originalSend = res.send;
    res.send = function(data) {
        if (req.startTime) {
            const duration = Date.now() - req.startTime;
            res.set('X-Response-Time', `${duration}ms`);
        }
        
        // Add request ID header for tracking
        if (req.requestId) {
            res.set('X-Request-ID', req.requestId);
        }
        
        originalSend.call(this, data);
    };
    
    next();
}

/**
 * Middleware to monitor database queries
 * This should be used with the database service
 */
function createDatabaseMonitor(db) {
    const originalQuery = db.query || db.all || db.get;
    
    if (originalQuery) {
        const monitoredQuery = async function(sql, params = [], callback) {
            const startTime = process.hrtime.bigint();
            
            try {
                let result;
                if (typeof params === 'function') {
                    callback = params;
                    params = [];
                    result = await originalQuery.call(this, sql, callback);
                } else {
                    result = await originalQuery.call(this, sql, params, callback);
                }
                
                const endTime = process.hrtime.bigint();
                const duration = Number(endTime - startTime) / 1000000;
                
                // Record query performance
                const rows = Array.isArray(result) ? result.length : (result ? 1 : 0);
                performanceMonitor.recordQuery(sql, duration, rows);
                
                return result;
            } catch (error) {
                const endTime = process.hrtime.bigint();
                const duration = Number(endTime - startTime) / 1000000;
                
                // Record failed query
                performanceMonitor.recordQuery(sql, duration, 0);
                throw error;
            }
        };
        
        // Replace the original query method
        if (db.query) db.query = monitoredQuery;
        if (db.all) db.all = monitoredQuery;
        if (db.get) db.get = monitoredQuery;
    }
    
    return db;
}

/**
 * Middleware to monitor cache operations
 */
function createCacheMonitor(cache) {
    if (!cache) return cache;
    
    const originalGet = cache.get;
    const originalSet = cache.set;
    const originalDel = cache.del || cache.delete;
    
    if (originalGet) {
        cache.get = function(key, callback) {
            const result = originalGet.call(this, key, callback);
            const hit = result !== undefined && result !== null;
            performanceMonitor.recordCache('get', key, hit);
            return result;
        };
    }
    
    if (originalSet) {
        cache.set = function(key, value, ttl, callback) {
            const result = originalSet.call(this, key, value, ttl, callback);
            performanceMonitor.recordCache('set', key);
            return result;
        };
    }
    
    if (originalDel) {
        cache.del = function(key, callback) {
            const result = originalDel.call(this, key, callback);
            performanceMonitor.recordCache('eviction', key);
            return result;
        };
    }
    
    return cache;
}

/**
 * WebSocket performance monitoring
 */
function createWebSocketMonitor(io) {
    if (!io) return io;
    
    io.on('connection', (socket) => {
        performanceMonitor.recordWebSocket('connection');
        
        socket.on('disconnect', () => {
            performanceMonitor.recordWebSocket('disconnection');
        });
        
        socket.on('message', (data) => {
            performanceMonitor.recordWebSocket('message', { size: JSON.stringify(data).length });
        });
        
        socket.on('error', (error) => {
            performanceMonitor.recordWebSocket('error', { error: error.message });
        });
    });
    
    return io;
}

/**
 * Performance alert handler
 */
function setupPerformanceAlerts() {
    performanceMonitor.on('slowRequest', (metric) => {
        console.warn(`[PERFORMANCE] Slow request detected: ${metric.method} ${metric.route} took ${metric.duration.toFixed(2)}ms`, {
            requestId: metric.requestId,
            statusCode: metric.statusCode,
            userAgent: metric.userAgent,
            ip: metric.ip
        });
    });
    
    performanceMonitor.on('slowQuery', (metric) => {
        console.warn(`[PERFORMANCE] Slow database query detected: ${metric.duration.toFixed(2)}ms`, {
            query: metric.query,
            rows: metric.rows
        });
    });
    
    performanceMonitor.on('highMemoryUsage', (data) => {
        console.warn(`[PERFORMANCE] High memory usage detected: ${(data.usage * 100).toFixed(1)}%`, {
            heapUsed: `${(data.memory.heapUsed / 1024 / 1024).toFixed(2)}MB`,
            heapTotal: `${(data.memory.heapTotal / 1024 / 1024).toFixed(2)}MB`
        });
    });
}

/**
 * Performance reporting middleware
 */
function performanceReporting(req, res, next) {
    // Only enable detailed reporting for admin users or in development
    if (req.path === '/api/performance' || req.path === '/api/performance/detailed') {
        // Add CORS headers for API access
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        
        if (req.method === 'OPTIONS') {
            return res.sendStatus(200);
        }
    }
    
    next();
}

/**
 * Get performance metrics endpoint handler
 */
function getPerformanceMetrics(req, res) {
    try {
        const detailed = req.query.detailed === 'true';
        const metrics = detailed ? 
            performanceMonitor.getDetailedReport() : 
            performanceMonitor.getStats();
        
        res.json({
            success: true,
            timestamp: Date.now(),
            data: metrics
        });
    } catch (error) {
        console.error('Error getting performance metrics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve performance metrics'
        });
    }
}

/**
 * Get performance trends endpoint handler
 */
function getPerformanceTrends(req, res) {
    try {
        const trends = performanceMonitor.getTrends();
        
        res.json({
            success: true,
            timestamp: Date.now(),
            data: trends
        });
    } catch (error) {
        console.error('Error getting performance trends:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve performance trends'
        });
    }
}

/**
 * Reset performance metrics endpoint handler
 */
function resetPerformanceMetrics(req, res) {
    try {
        performanceMonitor.reset();
        
        res.json({
            success: true,
            message: 'Performance metrics have been reset'
        });
    } catch (error) {
        console.error('Error resetting performance metrics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset performance metrics'
        });
    }
}

module.exports = {
    performanceTracking,
    performanceHeaders,
    performanceReporting,
    createDatabaseMonitor,
    createCacheMonitor,
    createWebSocketMonitor,
    setupPerformanceAlerts,
    getPerformanceMetrics,
    getPerformanceTrends,
    resetPerformanceMetrics
};