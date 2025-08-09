// Refactored ordr.fm visualization server - Modular architecture
const express = require('express');
const http = require('http');
const path = require('path');

// Import configuration
const config = require('./src/config');
const { swaggerSpec, swaggerOptions } = require('./src/config/swagger');

// Import services
const databaseService = require('./src/services/database');
const webSocketService = require('./src/websocket');

// Import middleware
const { 
    configureSecurityHeaders, 
    configureCors,
    generalApiLimiter,
    authApiLimiter,
    searchApiLimiter,
    exportApiLimiter,
    errorHandler, 
    requestLogger,
    suspiciousActivityDetector,
    validateSecurityConfig
} = require('./src/middleware/security');
const { authenticateToken, requireRole } = require('./src/middleware/auth');

// Import controllers
const authController = require('./src/controllers/auth');
const albumsController = require('./src/controllers/albums');
const searchController = require('./src/controllers/search');
const backupController = require('./src/controllers/backup');
const processingController = require('./src/controllers/processing');
const tracksController = require('./src/controllers/tracks');
const systemController = require('./src/controllers/system');

// Create Express app
const app = express();
const server = http.createServer(app);

// Validate security configuration on startup
const securityValidation = validateSecurityConfig();
if (!securityValidation.valid) {
    console.warn('⚠️ Security configuration validation failed:', securityValidation.issues);
    if (config.isProduction()) {
        console.error('❌ Security issues detected in production - exiting');
        process.exit(1);
    }
}

// Configure security headers and CORS
app.use(configureSecurityHeaders());
app.use(configureCors());

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Suspicious activity monitoring
app.use(suspiciousActivityDetector);

// Request logging in development
if (config.isDevelopment()) {
    app.use(requestLogger);
}

// Trust proxy in production
if (config.isProduction()) {
    app.set('trust proxy', 1);
}

// Rate limiting
app.use('/api/', generalApiLimiter);

// API Documentation
const swaggerUi = require('swagger-ui-express');
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerOptions));

/**
 * @swagger
 * tags:
 *   - name: Authentication
 *     description: User authentication and authorization endpoints
 *   - name: Albums
 *     description: Music album management and retrieval
 *   - name: Search
 *     description: Advanced search and discovery features
 *   - name: Tracks
 *     description: Individual track operations and audio streaming
 *   - name: Backup
 *     description: Backup and restore operations
 *   - name: Processing
 *     description: Music processing and organization jobs
 *   - name: System
 *     description: System information and configuration
 */

// API Routes

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: System health check
 *     description: Get current system health status and basic information
 *     tags: [System]
 *     responses:
 *       200:
 *         description: System is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [ok]
 *                   description: Health status
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   description: Current timestamp
 *                 version:
 *                   type: string
 *                   description: API version
 *                 environment:
 *                   type: string
 *                   description: Runtime environment
 *                 uptime:
 *                   type: number
 *                   description: Server uptime in seconds
 *               example:
 *                 status: ok
 *                 timestamp: "2024-01-15T10:30:00.000Z"
 *                 version: "2.5.0"
 *                 environment: development
 *                 uptime: 3600.5
 *     security: []
 */
// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '2.5.0',
        environment: config.NODE_ENV,
        uptime: process.uptime()
    });
});

// Authentication routes (with stricter rate limiting)
app.post('/api/auth/login', authApiLimiter, authController.login.bind(authController));
app.post('/api/auth/logout', authApiLimiter, authenticateToken, authController.logout.bind(authController));
app.get('/api/auth/profile', authenticateToken, authController.getProfile.bind(authController));

// User management routes (admin only)
app.get('/api/users', authenticateToken, requireRole('admin'), authController.getUsers.bind(authController));
app.post('/api/users', authenticateToken, requireRole('admin'), authController.createUser.bind(authController));

// Album routes
app.get('/api/albums', albumsController.getAlbums.bind(albumsController));
app.get('/api/albums/:id', albumsController.getAlbum.bind(albumsController));
app.put('/api/albums/:id', authenticateToken, albumsController.updateAlbum.bind(albumsController));

// Statistics routes
app.get('/api/stats', albumsController.getStats.bind(albumsController));
app.get('/api/artists', albumsController.getArtists.bind(albumsController));

// Search routes (with search-specific rate limiting)
app.get('/api/search/fuzzy', searchApiLimiter, searchController.fuzzySearch.bind(searchController));
app.get('/api/search/suggestions', searchApiLimiter, searchController.getSuggestions.bind(searchController));
app.get('/api/search/popular', searchController.getPopularSearches.bind(searchController));
app.get('/api/search/analytics', authenticateToken, requireRole('admin'), searchController.getAnalytics.bind(searchController));
app.get('/api/search/advanced', searchApiLimiter, searchController.advancedSearch.bind(searchController));
app.get('/api/search/facets', searchController.getFacets.bind(searchController));
app.get('/api/search/albums', searchApiLimiter, searchController.searchAlbums.bind(searchController));
app.get('/api/search/tracks', searchApiLimiter, searchController.searchTracks.bind(searchController));

// Track routes
app.put('/api/tracks/:id', authenticateToken, tracksController.updateTrack.bind(tracksController));
app.get('/api/audio/:albumId/:trackId', tracksController.streamAudio.bind(tracksController));
app.get('/api/audio/:albumId/:trackId/waveform', tracksController.getWaveform.bind(tracksController));
app.get('/api/audio/stream/:trackId', tracksController.getAudioStream.bind(tracksController));
app.get('/api/tracks/:trackId/metadata', tracksController.getTrackMetadata.bind(tracksController));
app.get('/api/albums/:albumId/tracks', tracksController.getAlbumTracks.bind(tracksController));

// Backup routes
app.get('/api/backup/status', backupController.getStatus.bind(backupController));
app.post('/api/backup/start', authenticateToken, backupController.startBackup.bind(backupController));
app.get('/api/backup/logs/:filename', authenticateToken, backupController.getBackupLogs.bind(backupController));
app.post('/api/actions/backup-cancel', authenticateToken, backupController.cancelBackup.bind(backupController));
app.post('/api/actions/backup-cloud', authenticateToken, requireRole('admin'), backupController.startCloudBackup.bind(backupController));
app.post('/api/actions/backup-database', authenticateToken, backupController.backupDatabase.bind(backupController));

// Processing routes
app.post('/api/actions/process', authenticateToken, processingController.startProcessing.bind(processingController));
app.get('/api/jobs/active', processingController.getActiveJobs.bind(processingController));
app.get('/api/jobs/history', processingController.getJobHistory.bind(processingController));
app.get('/api/jobs/:jobId', processingController.getJob.bind(processingController));
app.post('/api/jobs/:jobId/cancel', authenticateToken, processingController.cancelJob.bind(processingController));
app.post('/api/actions/enhance-metadata', authenticateToken, processingController.enhanceMetadata.bind(processingController));

// System routes
app.get('/api/system/status', processingController.getSystemStatus.bind(processingController));
app.get('/api/system/activity', systemController.getActivity.bind(systemController));
app.get('/api/config', systemController.getConfig.bind(systemController));
app.post('/api/config', authenticateToken, requireRole('admin'), systemController.updateConfig.bind(systemController));
app.get('/api/export', exportApiLimiter, authenticateToken, systemController.exportCollection.bind(systemController));
app.get('/api/insights', systemController.getInsights.bind(systemController));
app.get('/api/performance', systemController.getPerformance.bind(systemController));

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, 'public/index.html'));
    } else {
        res.status(404).json({ error: 'API endpoint not found' });
    }
});

// Error handling middleware (must be last)
app.use(errorHandler);

/**
 * Initialize all services and start server
 */
async function startServer() {
    try {
        console.log('🚀 Starting ordr.fm visualization server...');

        // Initialize database
        await databaseService.connect();

        // Initialize WebSocket service
        webSocketService.initialize(server);

        // Start HTTP server
        server.listen(config.PORT, () => {
            console.log(`✅ Server running on port ${config.PORT}`);
            console.log(`📊 Environment: ${config.NODE_ENV}`);
            console.log(`🔗 WebSocket: enabled`);
            console.log(`💾 Database: ${databaseService.isConnected ? 'connected' : 'disconnected'}`);
        });

        // Graceful shutdown handling
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
    console.log('🛑 Shutting down server...');

    server.close(async () => {
        console.log('📡 HTTP server closed');

        // Close WebSocket connections
        webSocketService.shutdown();
        console.log('🔌 WebSocket connections closed');

        // Close database connection
        await databaseService.disconnect();
        console.log('💾 Database connection closed');

        console.log('✅ Server shutdown complete');
        process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
        console.log('⚠️ Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
}

// Start the server
if (require.main === module) {
    startServer();
}

module.exports = { app, server, startServer };