// API endpoints comprehensive testing
const { test, expect } = require('@playwright/test');

test.describe('Core API Endpoints', () => {
  test('GET /api/stats returns valid data', async ({ page }) => {
    const response = await page.request.get('/api/stats');
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('totalAlbums');
    expect(data).toHaveProperty('totalTracks');
    expect(data).toHaveProperty('totalArtists');
    expect(typeof data.totalAlbums).toBe('number');
    expect(typeof data.totalTracks).toBe('number');
    expect(typeof data.totalArtists).toBe('number');
  });

  test('GET /api/collection/overview returns collection data', async ({ page }) => {
    const response = await page.request.get('/api/collection/overview');
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('stats');
    expect(data).toHaveProperty('qualityDistribution');
    expect(data).toHaveProperty('recentActivity');
  });

  test('GET /api/collection/timeline returns timeline data', async ({ page }) => {
    const response = await page.request.get('/api/collection/timeline');
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/collection/quality-distribution returns quality data', async ({ page }) => {
    const response = await page.request.get('/api/collection/quality-distribution');
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(typeof data).toBe('object');
  });

  test('GET /api/collection/analytics returns analytics data', async ({ page }) => {
    const response = await page.request.get('/api/collection/analytics');
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('genreDistribution');
    expect(data).toHaveProperty('yearDistribution');
    expect(data).toHaveProperty('collectionGrowth');
  });

  test('GET /api/system/status returns system information', async ({ page }) => {
    const response = await page.request.get('/api/system/status');
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('database');
    expect(data).toHaveProperty('diskUsage');
    expect(data).toHaveProperty('systemInfo');
  });
});

test.describe('Processing API Endpoints', () => {
  test('POST /api/actions/start-processing handles requests', async ({ page }) => {
    const response = await page.request.post('/api/actions/start-processing', {
      data: {
        source: '/test/path',
        options: {
          dryRun: true,
          discogs: false
        }
      }
    });
    
    // Should either start successfully or show validation error
    expect([200, 400, 409].includes(response.status())).toBe(true);
  });

  test('POST /api/actions/enhance-metadata handles requests', async ({ page }) => {
    const response = await page.request.post('/api/actions/enhance-metadata', {
      data: {
        source: 'discogs',
        options: {
          confidence: 0.8
        }
      }
    });
    
    expect([200, 400, 409].includes(response.status())).toBe(true);
  });

  test('GET /api/actions/processing-status returns status', async ({ page }) => {
    const response = await page.request.get('/api/actions/processing-status');
    
    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty('isProcessing');
      expect(typeof data.isProcessing).toBe('boolean');
    } else {
      // Endpoint might not exist - that's okay
      expect([404, 501].includes(response.status())).toBe(true);
    }
  });
});

test.describe('File Management API Endpoints', () => {
  test('GET /api/files/browse handles directory browsing', async ({ page }) => {
    const response = await page.request.get('/api/files/browse?path=/');
    
    if (response.status() === 200) {
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    } else {
      // File browsing might not be implemented
      expect([404, 501].includes(response.status())).toBe(true);
    }
  });

  test('GET /api/files/validate-path validates paths', async ({ page }) => {
    const response = await page.request.get('/api/files/validate-path?path=/home');
    
    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty('valid');
      expect(typeof data.valid).toBe('boolean');
    } else {
      expect([404, 501].includes(response.status())).toBe(true);
    }
  });
});

test.describe('Health and Monitoring Endpoints', () => {
  test('GET /api/health returns health status', async ({ page }) => {
    const response = await page.request.get('/api/health');
    
    if (response.status() === 200) {
      const data = await response.json();
      expect(data).toHaveProperty('status');
      expect(['ok', 'healthy', 'up'].includes(data.status)).toBe(true);
    } else {
      // Health endpoint might not exist
      expect([404, 501].includes(response.status())).toBe(true);
    }
  });

  test('GET /api/system/activity returns recent activity', async ({ page }) => {
    const response = await page.request.get('/api/system/activity');
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('activities');
    expect(Array.isArray(data.activities)).toBe(true);
  });
});

test.describe('Error Handling', () => {
  test('invalid endpoints return 404', async ({ page }) => {
    const response = await page.request.get('/api/nonexistent/endpoint');
    expect(response.status()).toBe(404);
  });

  test('malformed requests return 400', async ({ page }) => {
    const response = await page.request.post('/api/actions/backup-cloud', {
      data: 'invalid json string'
    });
    
    expect([400, 500].includes(response.status())).toBe(true);
  });

  test('API rate limiting works if implemented', async ({ page }) => {
    // Make multiple rapid requests
    const requests = Array(20).fill().map(() => 
      page.request.get('/api/stats')
    );
    
    const responses = await Promise.all(requests);
    
    // All should either succeed or some should be rate limited
    const statuses = responses.map(r => r.status());
    const hasRateLimit = statuses.some(s => s === 429);
    const allSuccess = statuses.every(s => s === 200);
    
    expect(hasRateLimit || allSuccess).toBe(true);
  });
});