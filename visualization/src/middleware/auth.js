// Authentication middleware
const { verifyToken, extractToken } = require('../utils/auth');

/**
 * Middleware to authenticate JWT tokens
 */
function authenticateToken(req, res, next) {
    const token = extractToken(req.headers.authorization);
    
    if (!token) {
        return res.status(401).json({ 
            error: 'Access denied. No token provided.' 
        });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(403).json({ 
            error: 'Invalid token.' 
        });
    }

    req.user = decoded;
    next();
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