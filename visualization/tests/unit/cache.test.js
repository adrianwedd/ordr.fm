// Unit tests for caching functionality
const { describe, test, expect, beforeEach } = require('@jest/globals');

describe('Cache System', () => {
  let cache, CACHE_TTL, CACHE_MAX_SIZE;

  beforeEach(() => {
    // Reset cache system before each test
    cache = new Map();
    CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    CACHE_MAX_SIZE = 1000;
    
    jest.clearAllMocks();
  });

  // These functions would be extracted from server.js
  const getCacheKey = (query, params) => {
    return `${query}|${JSON.stringify(params || [])}`;
  };

  const setCache = (key, data) => {
    if (cache.size >= CACHE_MAX_SIZE) {
      // Remove oldest entries
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    
    cache.set(key, {
      data,
      timestamp: Date.now()
    });
  };

  const getCache = (key) => {
    const cached = cache.get(key);
    if (!cached) {return null;}
    
    // Check TTL
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      cache.delete(key);
      return null;
    }
    
    return cached.data;
  };

  describe('Cache Key Generation', () => {
    test('should generate consistent cache key', () => {
      const query = 'SELECT * FROM albums';
      const params = ['param1', 'param2'];
      
      const key1 = getCacheKey(query, params);
      const key2 = getCacheKey(query, params);
      
      expect(key1).toBe(key2);
      expect(key1).toBe('SELECT * FROM albums|["param1","param2"]');
    });

    test('should handle empty params', () => {
      const query = 'SELECT * FROM albums';
      
      const key = getCacheKey(query);
      
      expect(key).toBe('SELECT * FROM albums|[]');
    });

    test('should create different keys for different params', () => {
      const query = 'SELECT * FROM albums WHERE id = ?';
      
      const key1 = getCacheKey(query, [1]);
      const key2 = getCacheKey(query, [2]);
      
      expect(key1).not.toBe(key2);
    });
  });

  describe('Cache Storage and Retrieval', () => {
    test('should store and retrieve data', () => {
      const key = 'test-key';
      const data = { albums: ['album1', 'album2'] };
      
      setCache(key, data);
      const retrieved = getCache(key);
      
      expect(retrieved).toEqual(data);
    });

    test('should return null for non-existent key', () => {
      const retrieved = getCache('non-existent-key');
      
      expect(retrieved).toBeNull();
    });

    test('should respect TTL expiration', () => {
      const key = 'test-key';
      const data = { test: 'data' };
      
      // Mock Date.now to control time
      const originalNow = Date.now;
      let currentTime = 1000000;
      Date.now = jest.fn(() => currentTime);
      
      setCache(key, data);
      
      // Data should be available immediately
      expect(getCache(key)).toEqual(data);
      
      // Fast-forward past TTL
      currentTime += CACHE_TTL + 1;
      
      // Data should be expired
      expect(getCache(key)).toBeNull();
      expect(cache.has(key)).toBe(false);
      
      // Restore Date.now
      Date.now = originalNow;
    });

    test('should handle cache size limit', () => {
      // Temporarily reduce max size for testing
      CACHE_MAX_SIZE = 2;
      
      setCache('key1', 'data1');
      setCache('key2', 'data2');
      
      expect(cache.size).toBe(2);
      
      // Adding third item should remove first
      setCache('key3', 'data3');
      
      expect(cache.size).toBe(2);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
    });
  });

  describe('Cache Performance', () => {
    test('should handle rapid cache operations', () => {
      const iterations = 1000;
      
      const start = Date.now();
      
      for (let i = 0; i < iterations; i++) {
        const key = `key-${i}`;
        const data = { id: i, name: `item-${i}` };
        
        setCache(key, data);
        const retrieved = getCache(key);
        
        expect(retrieved).toEqual(data);
      }
      
      const duration = Date.now() - start;
      
      // Should complete rapidly (adjust threshold as needed)
      expect(duration).toBeLessThan(1000); // 1 second
    });

    test('should maintain performance under cache size pressure', () => {
      CACHE_MAX_SIZE = 100;
      
      // Fill cache beyond max size
      for (let i = 0; i < 150; i++) {
        setCache(`key-${i}`, `data-${i}`);
      }
      
      expect(cache.size).toBe(CACHE_MAX_SIZE);
      
      // Recent items should still be accessible
      expect(getCache('key-149')).toBe('data-149');
      expect(getCache('key-100')).toBe('data-100');
      
      // Oldest items should be evicted
      expect(getCache('key-0')).toBeNull();
    });
  });
});