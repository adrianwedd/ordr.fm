// Centralized security middleware configuration
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { getSecurityConfig, getMiddlewareConfig, validateSecurityConfig } = require('../config/security');

/**
 * Configure Helmet security headers with centralized configuration
 */
function configureSecurityHeaders() {
    // Validate security configuration on startup
    const validation = validateSecurityConfig();
    if (!validation.valid) {
        console.warn('⚠️ Security configuration issues found:', validation.issues);
    }

    // Get helmet configuration from centralized security config
    const helmetConfig = getMiddlewareConfig('helmet');
    
    // Development-specific adjustments
    if (config.isDevelopment()) {
        helmetConfig.contentSecurityPolicy.directives.upgradeInsecureRequests = null;
        helmetConfig.hsts = false; // Disable HSTS for local HTTP development
    }

    return helmet(helmetConfig);
}

/**
 * General API rate limiter with centralized configuration
 */
const rateLimitConfig = getSecurityConfig('rateLimit');
const generalApiLimiter = rateLimit({
    windowMs: rateLimitConfig.general.windowMs,
    max: rateLimitConfig.general.max,
    message: {
        error: rateLimitConfig.general.message,
        retryAfter: Math.ceil(rateLimitConfig.general.windowMs / 1000)
    },
    standardHeaders: rateLimitConfig.general.standardHeaders,
    legacyHeaders: rateLimitConfig.general.legacyHeaders,
    skip: (req) => {
        // Skip rate limiting for health checks in development
        return config.isDevelopment() && req.path === '/api/health';
    }
});

/**
 * Authentication rate limiter (stricter)
 */
const authApiLimiter = rateLimit({
    windowMs: rateLimitConfig.auth.windowMs,
    max: rateLimitConfig.auth.max,
    message: {
        error: rateLimitConfig.auth.message,
        retryAfter: Math.ceil(rateLimitConfig.auth.windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: rateLimitConfig.auth.skipSuccessfulRequests
});

/**
 * Search rate limiter
 */
const searchApiLimiter = rateLimit({
    windowMs: rateLimitConfig.search.windowMs,
    max: rateLimitConfig.search.max,
    message: {
        error: rateLimitConfig.search.message,
        retryAfter: Math.ceil(rateLimitConfig.search.windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Export/backup rate limiter (very strict)
 */
const exportApiLimiter = rateLimit({
    windowMs: rateLimitConfig.export.windowMs,
    max: rateLimitConfig.export.max,
    message: {
        error: rateLimitConfig.export.message,
        retryAfter: Math.ceil(rateLimitConfig.export.windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Request logging middleware
 */
function requestLogger(req, res, next) {
    const start = Date.now();
    const { method, url, ip } = req;
    const userAgent = req.get('User-Agent') || 'Unknown';
    
    // Log request
    console.log(`${new Date().toISOString()} - ${method} ${url} - ${ip} - ${userAgent}`);
    
    // Log response when finished
    res.on('finish', () => {
        const duration = Date.now() - start;
        const { statusCode } = res;
        console.log(`${new Date().toISOString()} - ${method} ${url} - ${statusCode} - ${duration}ms`);
    });
    
    next();
}

/**
 * Enhanced error handling middleware with security logging
 */
function errorHandler(err, req, res, next) {
    const securityConfig = getSecurityConfig('security');
    
    // Log security events if enabled
    if (securityConfig.logSecurityEvents) {
        console.error(`[SECURITY] Error occurred: ${err.message}`, {
            timestamp: new Date().toISOString(),
            method: req.method,
            url: req.url,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            error: err.message,
            stack: config.isDevelopment() ? err.stack : undefined
        });
    } else {
        console.error('Error occurred:', err);
    }
    
    // Don't leak error details in production
    if (config.isProduction()) {
        res.status(500).json({
            error: 'Internal server error'
        });
    } else {
        res.status(500).json({
            error: err.message,
            stack: err.stack
        });
    }
}

/**
 * Suspicious activity detection middleware
 */
function suspiciousActivityDetector(req, res, next) {
    const securityConfig = getSecurityConfig('security');
    const { body, query, params } = req;
    const userContent = JSON.stringify({ body, query, params });
    
    // Check for suspicious patterns
    for (const pattern of securityConfig.monitorPatterns) {
        if (pattern.test(userContent)) {
            console.warn(`[SECURITY] Suspicious activity detected from ${req.ip}`, {
                timestamp: new Date().toISOString(),
                method: req.method,
                url: req.url,
                pattern: pattern.source,
                userAgent: req.get('User-Agent')
            });
            
            // Log but don't block - just monitor
            break;
        }
    }
    
    next();
}

/**
 * CORS configuration middleware
 */
function configureCors() {
    const corsConfig = getMiddlewareConfig('cors');
    return require('cors')(corsConfig);
}

module.exports = {
    configureSecurityHeaders,
    configureCors,
    generalApiLimiter,
    authApiLimiter,
    searchApiLimiter,
    exportApiLimiter,
    requestLogger,
    errorHandler,
    suspiciousActivityDetector,
    validateSecurityConfig
};