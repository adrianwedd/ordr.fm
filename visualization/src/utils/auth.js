// Authentication utilities with centralized security configuration
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const config = require('../config');
const { getSecurityConfig } = require('../config/security');

/**
 * Generate JWT token for user with centralized configuration
 * @param {Object} payload - User data to encode
 * @returns {string} JWT token
 */
function generateToken(payload) {
    const jwtConfig = getSecurityConfig('jwt');
    return jwt.sign(payload, jwtConfig.secret, {
        expiresIn: jwtConfig.expiresIn,
        algorithm: jwtConfig.algorithm,
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience
    });
}

/**
 * Verify JWT token with centralized configuration
 * @param {string} token - JWT token to verify
 * @returns {Object|null} Decoded payload or null if invalid
 */
function verifyToken(token) {
    try {
        const jwtConfig = getSecurityConfig('jwt');
        return jwt.verify(token, jwtConfig.secret, {
            algorithms: [jwtConfig.algorithm],
            issuer: jwtConfig.issuer,
            audience: jwtConfig.audience,
            clockTolerance: jwtConfig.clockTolerance,
            ignoreExpiration: jwtConfig.ignoreExpiration,
            ignoreNotBefore: jwtConfig.ignoreNotBefore
        });
    } catch (error) {
        return null;
    }
}

/**
 * Hash password using bcrypt with centralized configuration
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password
 */
async function hashPassword(password) {
    const passwordConfig = getSecurityConfig('password');
    return await bcrypt.hash(password, passwordConfig.saltRounds);
}

/**
 * Verify password against hash
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password
 * @returns {Promise<boolean>} True if password matches
 */
async function verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

/**
 * Extract token from Authorization header
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Token or null if not found
 */
function extractToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.substring(7);
}

/**
 * Validate password strength against security requirements
 * @param {string} password - Password to validate
 * @returns {Object} Validation result with isValid and issues
 */
function validatePasswordStrength(password) {
    const passwordConfig = getSecurityConfig('password');
    const issues = [];
    
    if (password.length < passwordConfig.minLength) {
        issues.push(`Password must be at least ${passwordConfig.minLength} characters long`);
    }
    
    if (passwordConfig.requireUppercase && !/[A-Z]/.test(password)) {
        issues.push('Password must contain at least one uppercase letter');
    }
    
    if (passwordConfig.requireLowercase && !/[a-z]/.test(password)) {
        issues.push('Password must contain at least one lowercase letter');
    }
    
    if (passwordConfig.requireNumbers && !/\d/.test(password)) {
        issues.push('Password must contain at least one number');
    }
    
    if (passwordConfig.requireSpecialChars && !/[^a-zA-Z0-9]/.test(password)) {
        issues.push('Password must contain at least one special character');
    }
    
    // Test against strong password regex if provided
    if (passwordConfig.strongPasswordRegex && !passwordConfig.strongPasswordRegex.test(password)) {
        issues.push('Password does not meet complexity requirements');
    }
    
    return {
        isValid: issues.length === 0,
        issues
    };
}

/**
 * Generate secure random password meeting security requirements
 * @param {number} length - Password length (default: 12)
 * @returns {string} Random password
 */
function generateRandomPassword(length = 12) {
    const passwordConfig = getSecurityConfig('password');
    length = Math.max(length, passwordConfig.minLength);
    
    let charset = '';
    if (passwordConfig.requireLowercase) {charset += 'abcdefghijklmnopqrstuvwxyz';}
    if (passwordConfig.requireUppercase) {charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';}
    if (passwordConfig.requireNumbers) {charset += '0123456789';}
    if (passwordConfig.requireSpecialChars) {charset += '!@#$%^&*';}
    
    if (!charset) {
        charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    }
    
    let password = '';
    
    // Ensure required character types are included
    if (passwordConfig.requireLowercase) {password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];}
    if (passwordConfig.requireUppercase) {password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];}
    if (passwordConfig.requireNumbers) {password += '0123456789'[Math.floor(Math.random() * 10)];}
    if (passwordConfig.requireSpecialChars) {password += '!@#$%^&*'[Math.floor(Math.random() * 8)];}
    
    // Fill remaining length
    for (let i = password.length; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    
    // Shuffle the password
    return password.split('').sort(() => 0.5 - Math.random()).join('');
}

module.exports = {
    generateToken,
    verifyToken,
    hashPassword,
    verifyPassword,
    extractToken,
    validatePasswordStrength,
    generateRandomPassword
};