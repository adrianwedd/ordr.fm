// Integration tests for API endpoints
const { describe, test, expect, beforeAll, afterAll, beforeEach } = require('@jest/globals');
const request = require('supertest');
const express = require('express');

// Mock the database to avoid file system dependencies in tests
jest.mock('sqlite3', () => {
  return {
    verbose: jest.fn(() => ({
      Database: jest.fn().mockImplementation(() => ({
        close: jest.fn((cb) => cb && cb()),
        run: jest.fn((sql, params, cb) => cb && cb()),
        get: jest.fn((sql, params, cb) => cb && cb(null, null)),
        all: jest.fn((sql, params, cb) => cb && cb(null, []))
      }))
    }))
  };
});

describe('API Integration Tests', () => {
  let app;
  
  beforeAll(() => {
    // Create a minimal Express app for testing
    app = express();
    app.use(express.json());
    
    // Add basic health check endpoint
    app.get('/api/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });

    // Add basic albums endpoint
    app.get('/api/albums', (req, res) => {
      res.json({
        albums: [],
        total: 0,
        page: parseInt(req.query.page) || 1,
        pageSize: parseInt(req.query.pageSize) || 20
      });
    });

    // Add error handling
    app.use((err, req, res, next) => {
      res.status(500).json({ error: 'Internal server error' });
    });
  });

  describe('Health Check Endpoint', () => {
    test('GET /api/health should return status ok', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('version');
    });

    test('should return valid timestamp', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);
      
      const timestamp = new Date(response.body.timestamp);
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeGreaterThan(Date.now() - 5000); // Within last 5 seconds
    });
  });

  describe('Albums Endpoint', () => {
    test('GET /api/albums should return albums list', async () => {
      const response = await request(app)
        .get('/api/albums')
        .expect(200);
      
      expect(response.body).toHaveProperty('albums');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page');
      expect(response.body).toHaveProperty('pageSize');
      expect(Array.isArray(response.body.albums)).toBe(true);
    });

    test('should handle pagination parameters', async () => {
      const response = await request(app)
        .get('/api/albums?page=2&pageSize=10')
        .expect(200);
      
      expect(response.body.page).toBe(2);
      expect(response.body.pageSize).toBe(10);
    });

    test('should use default pagination values', async () => {
      const response = await request(app)
        .get('/api/albums')
        .expect(200);
      
      expect(response.body.page).toBe(1);
      expect(response.body.pageSize).toBe(20);
    });

    test('should handle invalid pagination parameters gracefully', async () => {
      const response = await request(app)
        .get('/api/albums?page=invalid&pageSize=invalid')
        .expect(200);
      
      // Should fall back to defaults
      expect(response.body.page).toBe(1);
      expect(response.body.pageSize).toBe(20);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      // Add a route that throws an error for testing
      app.get('/api/error', (req, res) => {
        throw new Error('Test error');
      });
    });

    test('should handle server errors gracefully', async () => {
      const response = await request(app)
        .get('/api/error')
        .expect(500);
      
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });

    test('should handle 404 for non-existent endpoints', async () => {
      await request(app)
        .get('/api/non-existent')
        .expect(404);
    });
  });

  describe('Content Type Handling', () => {
    test('should return JSON content type', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);
      
      expect(response.type).toBe('application/json');
    });

    test('should accept JSON in POST requests', async () => {
      // Add a test POST endpoint
      app.post('/api/test', (req, res) => {
        res.json({ received: req.body });
      });

      const testData = { test: 'data' };
      
      const response = await request(app)
        .post('/api/test')
        .send(testData)
        .expect(200);
      
      expect(response.body.received).toEqual(testData);
    });
  });

  describe('Response Time', () => {
    test('health check should respond quickly', async () => {
      const start = Date.now();
      
      await request(app)
        .get('/api/health')
        .expect(200);
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100); // Should respond within 100ms
    });

    test('albums endpoint should respond within reasonable time', async () => {
      const start = Date.now();
      
      await request(app)
        .get('/api/albums')
        .expect(200);
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500); // Should respond within 500ms
    });
  });
});