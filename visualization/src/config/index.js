// Configuration module for ordr.fm visualization server
const path = require('path');

// Environment configuration
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || 3847;

// Security configuration
const JWT_SECRET = process.env.JWT_SECRET || 'ordr-fm-default-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const BCRYPT_ROUNDS = 12;

// Cache configuration
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 1000;

// Database configuration
const DB_PATH = process.env.METADATA_DB || 
               process.env.ORDRFM_DB || 
               path.join(__dirname, '../../ordr.fm.metadata.db');

// Rate limiting configuration  
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 500;

// Security warning for production
if (NODE_ENV === 'production' && JWT_SECRET === 'ordr-fm-default-secret-change-in-production') {
    console.warn('⚠️  WARNING: Using default JWT secret in production! Set JWT_SECRET environment variable.');
}

// Log current environment
if (NODE_ENV === 'production') {
    console.log('🚀 Running in production mode');
} else {
    console.log('🔧 Running in development mode');
}

module.exports = {
    NODE_ENV,
    PORT,
    JWT_SECRET,
    JWT_EXPIRES_IN,
    BCRYPT_ROUNDS,
    CACHE_TTL,
    CACHE_MAX_SIZE,
    DB_PATH,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX,
    
    // Helper functions
    isProduction: () => NODE_ENV === 'production',
    isDevelopment: () => NODE_ENV === 'development',
    isTest: () => NODE_ENV === 'test'
};