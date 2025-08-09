// Security middleware configuration
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, isProduction } = require('../config');

/**
 * Configure Helmet security headers
 */
function configureSecurityHeaders() {
    const helmetConfig = {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https://cdnjs.cloudflare.com",
                    "https://cdn.jsdelivr.net"
                ],
                scriptSrc: [
                    "'self'",
                    "'unsafe-inline'",
                    "https://cdnjs.cloudflare.com",
                    "https://cdn.jsdelivr.net"
                ],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'", "ws:", "wss:"],
                fontSrc: ["'self'", "https:", "data:"],
                objectSrc: ["'none'"],
                mediaSrc: ["'self'"],
                frameSrc: ["'none'"]
            }
        },
        crossOriginEmbedderPolicy: false,
        crossOriginOpenerPolicy: false,
        originAgentCluster: false
    };

    // Development-specific adjustments
    if (!isProduction()) {
        helmetConfig.contentSecurityPolicy.directives.upgradeInsecureRequests = null;
        helmetConfig.hsts = false; // Disable HSTS for local HTTP development
    }

    return helmet(helmetConfig);
}

/**
 * General API rate limiter
 */
const generalApiLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for health checks in development
        return !isProduction() && req.path === '/api/health';
    }
});

/**
 * Strict rate limiter for resource-intensive endpoints
 */
const strictApiLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: 50, // Much lower limit for intensive operations
    message: {
        error: 'Too many resource-intensive requests. Please wait before trying again.',
        retryAfter: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Lenient rate limiter for health checks
 */
const healthCheckLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute for health checks
    message: {
        error: 'Health check rate limit exceeded.',
        retryAfter: 60
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
 * Error handling middleware
 */
function errorHandler(err, req, res, next) {
    console.error('Error occurred:', err);
    
    // Don't leak error details in production
    if (isProduction()) {
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

module.exports = {
    configureSecurityHeaders,
    generalApiLimiter,
    strictApiLimiter,
    healthCheckLimiter,
    requestLogger,
    errorHandler
};