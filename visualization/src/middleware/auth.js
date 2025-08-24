// Authentication middleware with centralized security configuration
const { verifyToken, extractToken } = require('../utils/auth');
const { getSecurityConfig } = require('../config/security');

// Track failed authentication attempts
const failedAttempts = new Map();

/**
 * Middleware to authenticate JWT tokens with enhanced security
 */
function authenticateToken(req, res, next) {
    // Skip authentication in development mode
    if (process.env.NODE_ENV === 'development') {
        // Create a mock user for development
        req.user = {
            id: 1,
            username: 'dev-user',
            role: 'admin'
        };
        return next();
    }
    
    const securityConfig = getSecurityConfig('security');
    const clientIp = req.ip;
    
    const token = extractToken(req.headers.authorization);
    
    if (!token) {
        logFailedAuthentication(clientIp, 'No token provided', req);
        return res.status(401).json({ 
            error: 'Access denied. No token provided.' 
        });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
        logFailedAuthentication(clientIp, 'Invalid token', req);
        
        // Check if IP should be temporarily blocked
        const attempts = failedAttempts.get(clientIp) || 0;
        if (attempts >= securityConfig.maxFailedAttempts) {
            return res.status(429).json({ 
                error: 'Too many failed authentication attempts. Please try again later.' 
            });
        }
        
        return res.status(403).json({ 
            error: 'Invalid token.' 
        });
    }

    // Clear failed attempts on successful authentication
    if (failedAttempts.has(clientIp)) {
        failedAttempts.delete(clientIp);
    }

    req.user = decoded;
    next();
}

/**
 * Log failed authentication attempts
 */
function logFailedAuthentication(clientIp, reason, req) {
    const securityConfig = getSecurityConfig('security');
    
    if (securityConfig.logSecurityEvents) {
        console.warn(`[SECURITY] Failed authentication attempt from ${clientIp}`, {
            timestamp: new Date().toISOString(),
            reason,
            method: req.method,
            url: req.url,
            userAgent: req.get('User-Agent')
        });
    }
    
    // Track failed attempts
    const attempts = failedAttempts.get(clientIp) || 0;
    failedAttempts.set(clientIp, attempts + 1);
    
    // Cleanup old attempts
    setTimeout(() => {
        if (failedAttempts.has(clientIp)) {
            failedAttempts.delete(clientIp);
        }
    }, securityConfig.lockoutDuration);
}

/**
 * Middleware to require specific role
 * @param {string} requiredRole - Required user role
 */
function requireRole(requiredRole) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                error: 'Authentication required.' 
            });
        }

        if (req.user.role !== requiredRole) {
            return res.status(403).json({ 
                error: `Access denied. ${requiredRole} role required.` 
            });
        }

        next();
    };
}

/**
 * Middleware to require any of the specified roles
 * @param {Array} allowedRoles - Array of allowed roles
 */
function requireAnyRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                error: 'Authentication required.' 
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ 
                error: `Access denied. One of these roles required: ${allowedRoles.join(', ')}` 
            });
        }

        next();
    };
}

/**
 * Optional authentication - adds user to req if token is valid
 * but doesn't require it
 */
function optionalAuth(req, res, next) {
    const token = extractToken(req.headers.authorization);
    
    if (token) {
        const decoded = verifyToken(token);
        if (decoded) {
            req.user = decoded;
        }
    }
    
    next();
}

module.exports = {
    authenticateToken,
    requireRole,
    requireAnyRole,
    optionalAuth
};