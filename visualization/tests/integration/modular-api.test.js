// Integration tests for modular API architecture
const { describe, test, expect, beforeAll, afterAll } = require('@jest/globals');
const request = require('supertest');

// Mock the database service to avoid file system dependencies
jest.mock('../../src/services/database', () => ({
    connect: jest.fn().mockResolvedValue(),
    disconnect: jest.fn().mockResolvedValue(),
    query: jest.fn().mockResolvedValue([]),
    queryOne: jest.fn().mockResolvedValue(null),
    run: jest.fn().mockResolvedValue({ lastID: 1, changes: 1 }),
    isConnected: true
}));

// Mock WebSocket service
jest.mock('../../src/websocket', () => ({
    initialize: jest.fn(),
    shutdown: jest.fn(),
    broadcast: jest.fn()
}));

describe('Modular API Integration Tests', () => {
    let app;
    
    beforeAll(async () => {
        // Import the modular server after mocks are set up
        const { app: testApp } = require('../../server-new');
        app = testApp;
    });

    describe('Health Check', () => {
        test('GET /api/health should return comprehensive status', async () => {
            const response = await request(app)
                .get('/api/health')
                .expect(200);
            
            expect(response.body).toMatchObject({
                status: 'ok',
                version: '2.5.0',
                environment: expect.any(String),
                timestamp: expect.any(String),
                uptime: expect.any(Number)
            });
        });

        test('should return valid ISO timestamp', async () => {
            const response = await request(app)
                .get('/api/health')
                .expect(200);
            
            const timestamp = new Date(response.body.timestamp);
            expect(timestamp).toBeInstanceOf(Date);
            expect(timestamp.getTime()).not.toBeNaN();
        });
    });

    describe('Authentication Routes', () => {
        test('POST /api/auth/login should validate required fields', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({})
                .expect(400);
            
            expect(response.body).toHaveProperty('error');
            expect(response.body.error).toContain('Username and password are required');
        });

        test('POST /api/auth/login should handle database user lookup', async () => {
            // Mock database to return no user
            const databaseService = require('../../src/services/database');
            databaseService.queryOne.mockResolvedValueOnce(null);

            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    username: 'testuser',
                    password: 'testpass'
                })
                .expect(401);
            
            expect(response.body).toHaveProperty('error', 'Invalid credentials');
        });
    });

    describe('Albums Routes', () => {
        test('GET /api/albums should return paginated results', async () => {
            // Mock database to return sample albums
            const databaseService = require('../../src/services/database');
            databaseService.query.mockResolvedValueOnce([
                {
                    id: 1,
                    album_title: 'Test Album',
                    album_artist: 'Test Artist',
                    album_year: 2023,
                    genre: 'Electronic',
                    quality: 'Lossless',
                    track_count: 10,
                    total_duration: 3600
                }
            ]);
            databaseService.queryOne.mockResolvedValueOnce({ total: 1 });

            const response = await request(app)
                .get('/api/albums')
                .expect(200);
            
            expect(response.body).toHaveProperty('albums');
            expect(response.body).toHaveProperty('pagination');
            expect(response.body.pagination).toMatchObject({
                page: 1,
                pageSize: 20,
                total: 1,
                totalPages: 1,
                hasNext: false,
                hasPrev: false
            });
        });

        test('GET /api/albums should handle search parameter', async () => {
            const databaseService = require('../../src/services/database');
            databaseService.query.mockResolvedValueOnce([]);
            databaseService.queryOne.mockResolvedValueOnce({ total: 0 });

            const response = await request(app)
                .get('/api/albums?search=electronic')
                .expect(200);
            
            expect(response.body.filters.search).toBe('electronic');
        });

        test('GET /api/albums/:id should return 404 for non-existent album', async () => {
            const databaseService = require('../../src/services/database');
            databaseService.queryOne.mockResolvedValueOnce(null);

            const response = await request(app)
                .get('/api/albums/999')
                .expect(404);
            
            expect(response.body).toHaveProperty('error', 'Album not found');
        });
    });

    describe('Statistics Routes', () => {
        test('GET /api/stats should return collection statistics', async () => {
            const databaseService = require('../../src/services/database');
            databaseService.query.mockResolvedValueOnce([
                {
                    total_albums: 100,
                    total_artists: 50,
                    total_genres: 10,
                    total_tracks: 1000,
                    total_duration_seconds: 360000,
                    average_year: 2020,
                    quality: 'ALL',
                    quality_count: 0
                }
            ]);

            const response = await request(app)
                .get('/api/stats')
                .expect(200);
            
            expect(response.body).toHaveProperty('stats');
            expect(response.body.stats).toMatchObject({
                totalAlbums: expect.any(Number),
                totalArtists: expect.any(Number),
                totalGenres: expect.any(Number),
                totalTracks: expect.any(Number),
                totalDurationHours: expect.any(Number),
                averageYear: expect.any(Number)
            });
        });

        test('GET /api/artists should return artists list', async () => {
            const databaseService = require('../../src/services/database');
            databaseService.query.mockResolvedValueOnce([
                {
                    name: 'Test Artist',
                    album_count: 5,
                    first_year: 2020,
                    last_year: 2023,
                    genres: 'Electronic,House'
                }
            ]);

            const response = await request(app)
                .get('/api/artists')
                .expect(200);
            
            expect(response.body).toHaveProperty('artists');
            expect(Array.isArray(response.body.artists)).toBe(true);
        });
    });

    describe('SPA Support', () => {
        test('Non-API routes should serve index.html', async () => {
            const response = await request(app)
                .get('/dashboard')
                .expect(200);
            
            // Should serve HTML content (mocked static files)
            expect(response.type).toBe('text/html');
        });

        test('Non-existent API routes should return 404 JSON', async () => {
            const response = await request(app)
                .get('/api/non-existent')
                .expect(404);
            
            expect(response.body).toHaveProperty('error', 'API endpoint not found');
        });
    });

    describe('Error Handling', () => {
        test('should handle database errors gracefully', async () => {
            const databaseService = require('../../src/services/database');
            databaseService.query.mockRejectedValueOnce(new Error('Database error'));

            const response = await request(app)
                .get('/api/albums')
                .expect(500);
            
            expect(response.body).toHaveProperty('error');
            expect(response.body.error).toContain('Internal server error');
        });
    });
});