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
const {
    performanceTracking,
    performanceHeaders,
    setupPerformanceAlerts,
    createDatabaseMonitor,
    createWebSocketMonitor
} = require('./src/middleware/performance');

// Import controllers
const authController = require('./src/controllers/auth');
const albumsController = require('./src/controllers/albums');
const searchController = require('./src/controllers/search');
const backupController = require('./src/controllers/backup');
const processingController = require('./src/controllers/processing');
const tracksController = require('./src/controllers/tracks');
const systemController = require('./src/controllers/system');
const performanceController = require('./src/controllers/performance');

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

// Performance monitoring
app.use(performanceTracking);
app.use(performanceHeaders);

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
 *   - name: Performance
 *     description: Performance monitoring and metrics
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
app.get('/api/health', async (req, res) => {
    try {
        // Calculate real metadata completeness
        const metadataStats = await databaseService.queryOne(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN artist IS NOT NULL AND artist != '' THEN 1 ELSE 0 END) as has_artist,
                SUM(CASE WHEN album_title IS NOT NULL AND album_title != '' THEN 1 ELSE 0 END) as has_title,
                SUM(CASE WHEN year IS NOT NULL THEN 1 ELSE 0 END) as has_year,
                SUM(CASE WHEN label IS NOT NULL AND label != '' THEN 1 ELSE 0 END) as has_label,
                SUM(CASE WHEN catalog_number IS NOT NULL AND catalog_number != '' THEN 1 ELSE 0 END) as has_catalog,
                SUM(CASE WHEN genre IS NOT NULL AND genre != '' THEN 1 ELSE 0 END) as has_genre
            FROM albums
        `);
        
        // Get quality breakdown
        const qualityStats = await databaseService.query(`
            SELECT quality, COUNT(*) as count
            FROM albums
            GROUP BY quality
        `);
        
        // Calculate organization efficiency based on actual file paths
        const orgStats = await databaseService.queryOne(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN path LIKE '%/Lossless/%' OR path LIKE '%/Lossy/%' OR path LIKE '%/Mixed/%' THEN 1 ELSE 0 END) as organized
            FROM albums
        `);
        
        const organizationEfficiency = orgStats && orgStats.total > 0 
            ? Math.round((orgStats.organized / orgStats.total) * 100)
            : 0;
        
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: '2.5.0',
            environment: config.NODE_ENV,
            uptime: process.uptime(),
            metadata_completeness: metadataStats || {},
            overview: {
                total_albums: metadataStats?.total || 0,
                lossless: qualityStats.find(q => q.quality === 'Lossless')?.count || 0,
                lossy: qualityStats.find(q => q.quality === 'Lossy')?.count || 0,
                mixed: qualityStats.find(q => q.quality === 'Mixed')?.count || 0
            },
            organization_efficiency: organizationEfficiency
        });
    } catch (error) {
        console.error('Health check error:', error);
        // Fallback to basic health check if database query fails
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: '2.5.0',
            environment: config.NODE_ENV,
            uptime: process.uptime()
        });
    }
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
app.get('/api/search', searchApiLimiter, searchController.searchAlbums.bind(searchController));
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
app.get('/api/actions/backup-status', backupController.getStatus.bind(backupController)); // Alias for compatibility
app.post('/api/backup/start', authenticateToken, backupController.startBackup.bind(backupController));
app.get('/api/backup/logs/:filename', authenticateToken, backupController.getBackupLogs.bind(backupController));
app.post('/api/actions/backup-cancel', authenticateToken, backupController.cancelBackup.bind(backupController));
app.post('/api/actions/backup-cloud', backupController.startCloudBackup.bind(backupController));
app.post('/api/actions/backup-database', backupController.backupDatabase.bind(backupController));

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

// Real implementation of data endpoints
app.get('/api/duplicates', async (req, res) => {
    try {
        // Find duplicate albums by artist + album name
        const duplicates = await databaseService.query(`
            SELECT artist, album_title, COUNT(*) as count, 
                   GROUP_CONCAT(path) as paths,
                   GROUP_CONCAT(quality) as qualities
            FROM albums 
            WHERE artist IS NOT NULL AND album_title IS NOT NULL
            GROUP BY LOWER(artist), LOWER(album_title)
            HAVING COUNT(*) > 1
        `);
        
        res.json({ 
            duplicates: duplicates || [],
            groups: duplicates.length 
        });
    } catch (error) {
        console.error('Duplicates error:', error);
        res.status(500).json({ error: 'Failed to detect duplicates' });
    }
});

app.get('/api/labels', async (req, res) => {
    try {
        const labels = await databaseService.query(`
            SELECT label, 
                   COUNT(*) as release_count,
                   COUNT(DISTINCT artist) as artist_count,
                   MIN(year) as first_release,
                   MAX(year) as latest_release
            FROM albums 
            WHERE label IS NOT NULL AND label != ''
            GROUP BY label
            ORDER BY release_count DESC
        `);
        
        res.json({ labels: labels || [] });
    } catch (error) {
        console.error('Labels error:', error);
        res.status(500).json({ error: 'Failed to get labels' });
    }
});

app.get('/api/timeline', async (req, res) => {
    try {
        const timeline = await databaseService.query(`
            SELECT year,
                   COUNT(*) as albums_added,
                   SUM(CASE WHEN quality = 'Lossless' THEN 1 ELSE 0 END) as lossless,
                   SUM(CASE WHEN quality = 'Lossy' THEN 1 ELSE 0 END) as lossy,
                   SUM(CASE WHEN quality = 'Mixed' THEN 1 ELSE 0 END) as mixed
            FROM albums 
            WHERE year IS NOT NULL
            GROUP BY year
            ORDER BY year
        `);
        
        res.json({ timeline: timeline || [] });
    } catch (error) {
        console.error('Timeline error:', error);
        res.status(500).json({ error: 'Failed to get timeline' });
    }
});

app.get('/api/moves', async (req, res) => {
    try {
        // Get recent album additions as "moves" (since we don't have a separate moves table yet)
        const moves = await databaseService.query(`
            SELECT created_at as move_date,
                   path as destination_path,
                   artist || ' - ' || album_title as source_path,
                   'import' as move_type
            FROM albums 
            ORDER BY created_at DESC
            LIMIT 50
        `);
        
        res.json({ moves: moves || [] });
    } catch (error) {
        console.error('Moves error:', error);
        res.status(500).json({ error: 'Failed to get moves' });
    }
});

// File browser endpoint
app.get('/api/browse', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const dirPath = req.query.path || '/home/plex/Music';
    
    try {
        // Security check - only allow browsing under specific directories
        const allowedPaths = ['/home/plex/Music', '/home/pi/Music', '/tmp'];
        const resolvedPath = path.resolve(dirPath);
        
        if (!allowedPaths.some(allowed => resolvedPath.startsWith(allowed))) {
            return res.status(403).json({ error: 'Access denied to this path' });
        }
        
        // Check if path exists
        if (!fs.existsSync(resolvedPath)) {
            return res.status(404).json({ error: 'Path not found' });
        }
        
        // Read directory
        const items = fs.readdirSync(resolvedPath, { withFileTypes: true });
        const result = {
            path: resolvedPath,
            parent: path.dirname(resolvedPath),
            items: items.map(item => ({
                name: item.name,
                type: item.isDirectory() ? 'directory' : 'file',
                path: path.join(resolvedPath, item.name)
            })).filter(item => {
                // Filter to show only directories and audio files
                if (item.type === 'directory') {return true;}
                const ext = path.extname(item.name).toLowerCase();
                return ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac', '.ape', '.aiff', '.alac', '.opus', '.wma', '.mp4', '.mkv', '.avi', '.mov', '.webm', '.nfo', '.m3u', '.log', '.cue', '.jpg', '.png', '.pdf'].includes(ext);
            })
        };
        
        res.json(result);
    } catch (error) {
        console.error('Browse error:', error);
        res.status(500).json({ error: 'Failed to browse directory' });
    }
});

/**
 * @swagger
 * /api/performance/health:
 *   get:
 *     summary: Get system health status
 *     description: Returns overall system health assessment and performance score
 *     tags: [Performance]
 *     responses:
 *       200:
 *         description: System health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     score:
 *                       type: number
 *                       description: Health score (0-100)
 *                     status:
 *                       type: string
 *                       enum: [healthy, degraded, unhealthy]
 *                     issues:
 *                       type: array
 *                       items:
 *                         type: string
 *                     uptime:
 *                       type: number
 *     security: []
 */

// Performance monitoring routes
app.get('/api/performance', authenticateToken, performanceController.getStats.bind(performanceController));
app.get('/api/performance/stats', authenticateToken, performanceController.getStats.bind(performanceController));
app.get('/api/performance/trends', authenticateToken, performanceController.getTrends.bind(performanceController));
app.get('/api/performance/report', authenticateToken, requireRole('admin'), performanceController.getDetailedReport.bind(performanceController));
app.get('/api/performance/alerts', authenticateToken, performanceController.getAlerts.bind(performanceController));
app.get('/api/performance/health', performanceController.getSystemHealth.bind(performanceController));
app.get('/api/performance/metrics', authenticateToken, performanceController.getMetricsRange.bind(performanceController));
app.get('/api/performance/endpoints', authenticateToken, performanceController.getEndpointPerformance.bind(performanceController));
app.get('/api/performance/config', authenticateToken, requireRole('admin'), performanceController.getConfig.bind(performanceController));
app.get('/api/performance/export', exportApiLimiter, authenticateToken, requireRole('admin'), performanceController.exportData.bind(performanceController));
app.post('/api/performance/reset', authenticateToken, requireRole('admin'), performanceController.resetMetrics.bind(performanceController));
app.post('/api/performance/config', authenticateToken, requireRole('admin'), performanceController.updateConfig.bind(performanceController));

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

        // Initialize database with performance monitoring
        await databaseService.connect();
        createDatabaseMonitor(databaseService);

        // Initialize WebSocket service with performance monitoring
        webSocketService.initialize(server);
        createWebSocketMonitor(webSocketService.io);

        // Setup performance alerting
        setupPerformanceAlerts();

        // Start HTTP server
        server.listen(config.PORT, () => {
            console.log(`✅ Server running on port ${config.PORT}`);
            console.log(`📊 Environment: ${config.NODE_ENV}`);
            console.log('🔗 WebSocket: enabled');
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