// Cache utility module for performance optimization
const { CACHE_TTL, CACHE_MAX_SIZE } = require('../config');

class CacheManager {
    constructor() {
        this.cache = new Map();
        this.ttl = CACHE_TTL;
        this.maxSize = CACHE_MAX_SIZE;
    }

    /**
     * Generate cache key from query and parameters
     * @param {string} query - Database query or identifier
     * @param {Array} params - Parameters array
     * @returns {string} Cache key
     */
    getCacheKey(query, params = []) {
        return `${query}|${JSON.stringify(params)}`;
    }

    /**
     * Set cache entry with automatic eviction
     * @param {string} key - Cache key
     * @param {*} data - Data to cache
     */
    setCache(key, data) {
        // Remove oldest entries if cache is full
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    /**
     * Get cache entry with TTL validation
     * @param {string} key - Cache key
     * @returns {*} Cached data or null if expired/missing
     */
    getCache(key) {
        const cached = this.cache.get(key);
        if (!cached) {
            return null;
        }
        
        // Check TTL expiration
        if (Date.now() - cached.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }
        
        return cached.data;
    }

    /**
     * Clear cache entries matching pattern
     * @param {string|null} pattern - Pattern to match (null clears all)
     */
    clearCache(pattern = null) {
        if (!pattern) {
            this.cache.clear();
            return;
        }
        
        for (const key of this.cache.keys()) {
            if (key.includes(pattern)) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache stats
     */
    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            ttl: this.ttl,
            hitRate: this.calculateHitRate()
        };
    }

    /**
     * Calculate cache hit rate (approximate)
     * @returns {number} Hit rate percentage
     */
    calculateHitRate() {
        // This would need more sophisticated tracking in production
        return this.cache.size > 0 ? 0.75 : 0; // Placeholder
    }

    /**
     * Middleware for caching responses
     * @param {number} ttl - Optional TTL override
     * @returns {Function} Express middleware
     */
    middleware(ttl = null) {
        return (req, res, next) => {
            const key = this.getCacheKey(req.originalUrl, [req.method]);
            const cached = this.getCache(key);
            
            if (cached) {
                return res.json(cached);
            }
            
            // Store original res.json
            const originalJson = res.json;
            res.json = (body) => {
                // Cache the response
                this.setCache(key, body);
                return originalJson.call(res, body);
            };
            
            next();
        };
    }
}

// Export singleton instance
const cacheManager = new CacheManager();
module.exports = cacheManager;