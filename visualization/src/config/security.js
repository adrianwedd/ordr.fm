// Security configuration for ordr.fm
const config = require('./index');

/**
 * Comprehensive security configuration
 * Centralizes all security-related settings for the application
 */
const securityConfig = {
    // JWT Configuration
    jwt: {
        secret: config.JWT_SECRET,
        expiresIn: config.JWT_EXPIRES_IN || '24h',
        algorithm: 'HS256',
        issuer: 'ordr.fm',
        audience: 'ordr.fm-users',
        // JWT Security best practices
        clockTolerance: 60, // 60 seconds
        ignoreExpiration: false,
        ignoreNotBefore: false
    },

    // Password Security
    password: {
        saltRounds: config.BCRYPT_ROUNDS || 12,
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumbers: true,
        requireSpecialChars: false,
        // Common password validation regex
        strongPasswordRegex: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/
    },

    // Rate Limiting Configuration
    rateLimit: {
        // General API rate limiting (relaxed for development)
        general: {
            windowMs: 1 * 60 * 1000, // 1 minute (was 15 minutes)
            max: 1000, // 1000 requests per window (was 100)
            message: 'Too many requests from this IP, please try again later.',
            standardHeaders: true,
            legacyHeaders: false
        },
        
        // Authentication endpoints (stricter)
        auth: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 10, // 10 login attempts per window
            message: 'Too many authentication attempts, please try again later.',
            skipSuccessfulRequests: true
        },
        
        // Search endpoints
        search: {
            windowMs: 60 * 1000, // 1 minute
            max: 30, // 30 searches per minute
            message: 'Search rate limit exceeded, please slow down.'
        },
        
        // Export/backup endpoints (very strict)
        export: {
            windowMs: 60 * 60 * 1000, // 1 hour
            max: 5, // 5 exports per hour
            message: 'Export rate limit exceeded, please try again later.'
        }
    },

    // Security Headers Configuration
    headers: {
        // Content Security Policy - Temporarily relaxed for development
        contentSecurityPolicy: false, // Disable CSP temporarily to fix CDN issues
        
        // HTTP Strict Transport Security
        hsts: {
            maxAge: 31536000, // 1 year
            includeSubDomains: true,
            preload: true
        },
        
        // Additional security headers
        noSniff: true,
        frameguard: { action: 'deny' },
        xssFilter: true,
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        permittedCrossDomainPolicies: false,
        hidePoweredBy: true
    },

    // CORS Configuration
    cors: {
        origin: config.isProduction() 
            ? ['https://ordr-fm.example.com'] 
            : ['http://localhost:3847', 'http://127.0.0.1:3847'],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Origin',
            'X-Requested-With',
            'Content-Type',
            'Accept',
            'Authorization',
            'X-API-Key'
        ],
        credentials: true,
        optionsSuccessStatus: 200,
        maxAge: 86400 // 24 hours
    },

    // File Upload Security
    upload: {
        maxFileSize: 10 * 1024 * 1024, // 10MB
        allowedMimeTypes: [
            'audio/mpeg',
            'audio/flac',
            'audio/wav',
            'audio/ogg',
            'audio/m4a',
            'audio/aac',
            'audio/aiff'
        ],
        maxFiles: 100,
        preservePath: false,
        safeFileNames: /^[a-zA-Z0-9\-_\. ]+$/
    },

    // API Security
    api: {
        // Maximum request body size
        maxRequestSize: '10mb',
        
        // Allowed HTTP methods
        allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
        
        // Request timeout
        requestTimeout: 30000, // 30 seconds
        
        // Parameter pollution prevention
        parameterLimit: 20,
        
        // Query depth limitation (for nested objects)
        maxQueryDepth: 5
    },

    // Database Security
    database: {
        // Connection settings
        maxConnections: 10,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
        
        // Query security
        maxQueryLength: 10000,
        preventSqlInjection: true,
        
        // SQLite specific security
        enableWAL: true,
        enableForeignKeys: true,
        journalMode: 'WAL',
        synchronous: 'NORMAL'
    },

    // Session Security
    session: {
        secure: config.isProduction(),
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        rolling: true
    },

    // Logging and Monitoring
    security: {
        // Log security events
        logSecurityEvents: true,
        logLevel: config.isDevelopment() ? 'debug' : 'info',
        
        // Failed authentication tracking
        maxFailedAttempts: 5,
        lockoutDuration: 15 * 60 * 1000, // 15 minutes
        
        // Suspicious activity detection
        monitorPatterns: [
            /(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)/i,
            /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
            /(\b(?:union|select|insert|delete|drop|create|update|alter)\b.*?)+/i
        ]
    },

    // Production-specific security
    production: {
        // Disable debug routes
        disableDebugRoutes: true,
        
        // Enable additional monitoring
        enableAdvancedLogging: true,
        
        // Require HTTPS
        forceHttps: true,
        
        // Additional headers for production
        additionalHeaders: {
            'Expect-CT': 'max-age=86400, enforce',
            'Feature-Policy': "geolocation 'none'; camera 'none'; microphone 'none'",
            'Permissions-Policy': 'geolocation=(), camera=(), microphone=()'
        }
    }
};

/**
 * Get security configuration for specific context
 */
function getSecurityConfig(context = 'default') {
    switch (context) {
        case 'jwt':
            return securityConfig.jwt;
        case 'rateLimit':
            return securityConfig.rateLimit;
        case 'headers':
            return securityConfig.headers;
        case 'cors':
            return securityConfig.cors;
        case 'api':
            return securityConfig.api;
        case 'database':
            return securityConfig.database;
        default:
            return securityConfig;
    }
}

/**
 * Validate security configuration
 */
function validateSecurityConfig() {
    const issues = [];
    
    // Check JWT secret strength
    if (!securityConfig.jwt.secret || securityConfig.jwt.secret.length < 32) {
        issues.push('JWT secret should be at least 32 characters long');
    }
    
    if (securityConfig.jwt.secret === 'ordr-fm-default-secret-change-in-production') {
        issues.push('JWT secret is using default value - CHANGE IN PRODUCTION');
    }
    
    // Check password requirements
    if (securityConfig.password.saltRounds < 10) {
        issues.push('Password salt rounds should be at least 10');
    }
    
    // Check production settings
    if (config.isProduction()) {
        if (!securityConfig.session.secure) {
            issues.push('Session cookies should be secure in production');
        }
        
        if (!securityConfig.production.forceHttps) {
            issues.push('HTTPS should be enforced in production');
        }
    }
    
    return {
        valid: issues.length === 0,
        issues
    };
}

/**
 * Security middleware configuration helper
 */
function getMiddlewareConfig(middlewareType) {
    switch (middlewareType) {
        case 'helmet':
            return {
                contentSecurityPolicy: securityConfig.headers.contentSecurityPolicy,
                hsts: securityConfig.headers.hsts,
                noSniff: securityConfig.headers.noSniff,
                frameguard: securityConfig.headers.frameguard,
                xssFilter: securityConfig.headers.xssFilter,
                referrerPolicy: securityConfig.headers.referrerPolicy,
                permittedCrossDomainPolicies: securityConfig.headers.permittedCrossDomainPolicies,
                hidePoweredBy: securityConfig.headers.hidePoweredBy
            };
        case 'rateLimit':
            return securityConfig.rateLimit;
        case 'cors':
            return securityConfig.cors;
        default:
            return null;
    }
}

module.exports = {
    securityConfig,
    getSecurityConfig,
    validateSecurityConfig,
    getMiddlewareConfig
};