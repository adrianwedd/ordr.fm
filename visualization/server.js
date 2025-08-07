const express = require('express');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Database path from environment or default
const DB_PATH = process.env.ORDRFM_DB || path.join(__dirname, '..', 'ordr.fm.metadata.db');

// Rate limiting configuration
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // limit each IP to 100 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000) / 1000)
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Stricter rate limit for resource-intensive endpoints
const exportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: parseInt(process.env.EXPORT_RATE_LIMIT_MAX) || 10, // limit to 10 exports per hour
    message: {
        error: 'Export rate limit exceeded. Please try again later.',
        retryAfter: 3600
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Health check has higher limits for monitoring
const healthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Allow many health checks for monitoring systems
    standardHeaders: true,
    legacyHeaders: false,
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// CORS headers for development
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Apply rate limiting to API routes (exclude export which has its own limiter)
app.use('/api/', (req, res, next) => {
    if (req.path === '/export' || req.path === '/health') {
        return next(); // Skip general limiter for export and health
    }
    return limiter(req, res, next);
});

// Database connection helper
function getDb() {
    return new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.error('Error opening database:', err);
        }
    });
}

// API Routes

// Get overall statistics
app.get('/api/stats', (req, res) => {
    const db = getDb();
    const stats = {};
    
    // Get album count
    db.get('SELECT COUNT(*) as count FROM albums', (err, row) => {
        if (err) {
            console.error('Error getting album count:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        stats.totalAlbums = row ? row.count : 0;
        
        // Get track count
        db.get('SELECT COUNT(*) as count FROM tracks', (err, row) => {
            stats.totalTracks = row ? row.count : 0;
            
            // Get artist count (unique)
            db.get('SELECT COUNT(DISTINCT album_artist) as count FROM albums WHERE album_artist IS NOT NULL', (err, row) => {
                stats.totalArtists = row ? row.count : 0;
                
                // Get label count
                db.get('SELECT COUNT(DISTINCT label) as count FROM albums WHERE label IS NOT NULL', (err, row) => {
                    stats.totalLabels = row ? row.count : 0;
                    
                    // Get quality distribution
                    db.all('SELECT quality, COUNT(*) as count FROM albums GROUP BY quality', (err, rows) => {
                        stats.qualityDistribution = {};
                        if (rows) {
                            rows.forEach(row => {
                                stats.qualityDistribution[row.quality || 'Unknown'] = row.count;
                            });
                        }
                        
                        // Get organization mode distribution
                        db.all('SELECT organization_mode, COUNT(*) as count FROM albums GROUP BY organization_mode', (err, rows) => {
                            stats.organizationModes = {};
                            if (rows) {
                                rows.forEach(row => {
                                    stats.organizationModes[row.organization_mode || 'artist'] = row.count;
                                });
                            }
                            
                            db.close();
                            res.json(stats);
                        });
                    });
                });
            });
        });
    });
});

// Get albums with filtering
app.get('/api/albums', (req, res) => {
    const db = getDb();
    const { limit = 100, offset = 0, artist, label, quality, mode } = req.query;
    
    let query = 'SELECT * FROM albums WHERE 1=1';
    const params = [];
    
    if (artist) {
        query += ' AND album_artist LIKE ?';
        params.push(`%${artist}%`);
    }
    if (label) {
        query += ' AND label LIKE ?';
        params.push(`%${label}%`);
    }
    if (quality) {
        query += ' AND quality = ?';
        params.push(quality);
    }
    if (mode) {
        query += ' AND organization_mode = ?';
        params.push(mode);
    }
    
    query += ' ORDER BY processed_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Error fetching albums:', err);
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        db.close();
        res.json(rows || []);
    });
});

// Get artist data including aliases
app.get('/api/artists', (req, res) => {
    const db = getDb();
    
    // Get all artists with their release counts
    const artistQuery = `
        SELECT album_artist as name, 
               COUNT(*) as release_count,
               COUNT(DISTINCT label) as label_count
        FROM albums 
        WHERE album_artist IS NOT NULL
        GROUP BY album_artist
        ORDER BY release_count DESC
        LIMIT 100
    `;
    
    db.all(artistQuery, (err, artists) => {
        if (err) {
            console.error('Error fetching artists:', err);
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Get alias relationships
        db.all('SELECT * FROM artist_aliases', (err, aliases) => {
            db.close();
            
            res.json({
                artists: artists || [],
                aliases: aliases || []
            });
        });
    });
});

// Get label statistics
app.get('/api/labels', (req, res) => {
    const db = getDb();
    
    const query = `
        SELECT label,
               COUNT(*) as release_count,
               COUNT(DISTINCT album_artist) as artist_count,
               MIN(year) as first_release,
               MAX(year) as latest_release
        FROM albums
        WHERE label IS NOT NULL
        GROUP BY label
        ORDER BY release_count DESC
        LIMIT 100
    `;
    
    db.all(query, (err, rows) => {
        db.close();
        
        if (err) {
            console.error('Error fetching labels:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        res.json(rows || []);
    });
});

// Get move history for undo functionality
app.get('/api/moves', (req, res) => {
    const db = getDb();
    const { limit = 50 } = req.query;
    
    const query = `
        SELECT * FROM moves
        ORDER BY move_date DESC
        LIMIT ?
    `;
    
    db.all(query, [parseInt(limit)], (err, rows) => {
        db.close();
        
        if (err) {
            console.error('Error fetching moves:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        res.json(rows || []);
    });
});

// Get processing timeline
app.get('/api/timeline', (req, res) => {
    const db = getDb();
    
    const query = `
        SELECT DATE(processed_at) as date,
               COUNT(*) as albums_processed,
               SUM(CASE WHEN quality = 'Lossless' THEN 1 ELSE 0 END) as lossless,
               SUM(CASE WHEN quality = 'Lossy' THEN 1 ELSE 0 END) as lossy,
               SUM(CASE WHEN quality = 'Mixed' THEN 1 ELSE 0 END) as mixed
        FROM albums
        WHERE processed_at IS NOT NULL
        GROUP BY DATE(processed_at)
        ORDER BY date DESC
        LIMIT 30
    `;
    
    db.all(query, (err, rows) => {
        db.close();
        
        if (err) {
            console.error('Error fetching timeline:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        res.json(rows || []);
    });
});

// Get collection health metrics
app.get('/api/health', (req, res) => {
    const db = getDb();
    
    const healthMetrics = {};
    
    // Quality distribution
    db.get(`
        SELECT 
            COUNT(*) as total_albums,
            SUM(CASE WHEN quality = 'Lossless' THEN 1 ELSE 0 END) as lossless,
            SUM(CASE WHEN quality = 'Mixed' THEN 1 ELSE 0 END) as mixed,
            SUM(CASE WHEN quality = 'Lossy' THEN 1 ELSE 0 END) as lossy,
            AVG(track_count) as avg_tracks_per_album,
            COUNT(DISTINCT album_artist) as unique_artists,
            COUNT(DISTINCT label) as unique_labels
        FROM albums
    `, (err, stats) => {
        if (err) {
            console.error('Error fetching health stats:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        healthMetrics.overview = stats;
        
        // Metadata completeness
        db.get(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN album_artist IS NOT NULL AND album_artist != '' THEN 1 ELSE 0 END) as has_artist,
                SUM(CASE WHEN album_title IS NOT NULL AND album_title != '' THEN 1 ELSE 0 END) as has_title,
                SUM(CASE WHEN year IS NOT NULL AND year > 0 THEN 1 ELSE 0 END) as has_year,
                SUM(CASE WHEN label IS NOT NULL AND label != '' THEN 1 ELSE 0 END) as has_label,
                SUM(CASE WHEN catalog_number IS NOT NULL AND catalog_number != '' THEN 1 ELSE 0 END) as has_catalog
            FROM albums
        `, (err, metadata) => {
            if (err) {
                console.error('Error fetching metadata completeness:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            healthMetrics.metadata_completeness = metadata;
            
            // Organization efficiency
            db.get(`
                SELECT 
                    organization_mode,
                    COUNT(*) as count,
                    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM albums), 2) as percentage
                FROM albums
                GROUP BY organization_mode
            `, (err, org) => {
                if (err) {
                    console.error('Error fetching organization stats:', err);
                    return res.status(500).json({ error: 'Database error' });
                }
                
                healthMetrics.organization = org;
                
                db.close();
                res.json(healthMetrics);
            });
        });
    });
});

// Get duplicate detection analytics
app.get('/api/duplicates', (req, res) => {
    // Try to connect to duplicates database
    const duplicateDbPath = process.env.DUPLICATES_DB || path.join(__dirname, '..', 'ordr.fm.duplicates.db');
    
    if (!fs.existsSync(duplicateDbPath)) {
        return res.json({
            analysis_available: false,
            message: "No duplicate analysis available. Run duplicate detection first."
        });
    }
    
    const db = new sqlite3.Database(duplicateDbPath);
    const duplicateMetrics = {};
    
    // Overall duplicate statistics
    db.get(`
        SELECT 
            COUNT(*) as total_albums,
            (SELECT COUNT(*) FROM duplicate_groups) as duplicate_groups,
            (SELECT COUNT(*) FROM duplicate_members) as albums_in_groups,
            (SELECT SUM(total_size) FROM audio_fingerprints WHERE id IN (
                SELECT fingerprint_id FROM duplicate_members WHERE is_recommended_keep = 0
            )) as potential_savings_bytes
        FROM audio_fingerprints
    `, (err, overview) => {
        if (err) {
            console.error('Error fetching duplicate overview:', err);
            db.close();
            return res.status(500).json({ error: 'Duplicate database error' });
        }
        
        duplicateMetrics.overview = overview;
        duplicateMetrics.analysis_available = true;
        
        // Top duplicate groups by size
        db.all(`
            SELECT 
                dg.id,
                dg.album_count,
                dg.duplicate_score,
                dg.total_size,
                af.album_path as best_album,
                af.quality_score as best_quality,
                af.format as best_format
            FROM duplicate_groups dg
            JOIN audio_fingerprints af ON dg.best_quality_id = af.id
            ORDER BY dg.total_size DESC
            LIMIT 10
        `, (err, topGroups) => {
            if (err) {
                console.error('Error fetching top duplicate groups:', err);
                db.close();
                return res.status(500).json({ error: 'Database error' });
            }
            
            duplicateMetrics.top_groups = topGroups || [];
            
            // Quality distribution of duplicates
            db.all(`
                SELECT 
                    af.format,
                    COUNT(*) as count,
                    AVG(af.quality_score) as avg_quality
                FROM audio_fingerprints af
                JOIN duplicate_members dm ON af.id = dm.fingerprint_id
                GROUP BY af.format
                ORDER BY avg_quality DESC
            `, (err, qualityDist) => {
                if (err) {
                    console.error('Error fetching quality distribution:', err);
                    db.close();
                    return res.status(500).json({ error: 'Database error' });
                }
                
                duplicateMetrics.quality_distribution = qualityDist || [];
                
                db.close();
                res.json(duplicateMetrics);
            });
        });
    });
});

// Get advanced collection insights
app.get('/api/insights', (req, res) => {
    const db = getDb();
    const insights = {};
    
    // Artist productivity analysis
    db.all(`
        SELECT 
            album_artist,
            COUNT(*) as release_count,
            MIN(year) as first_release,
            MAX(year) as latest_release,
            COUNT(DISTINCT year) as active_years,
            COUNT(DISTINCT label) as labels_worked_with,
            GROUP_CONCAT(DISTINCT label) as label_list,
            ROUND(AVG(track_count), 1) as avg_tracks_per_album
        FROM albums
        WHERE album_artist IS NOT NULL
        GROUP BY album_artist
        HAVING release_count >= 3
        ORDER BY release_count DESC, latest_release DESC
        LIMIT 50
    `, (err, artists) => {
        if (err) {
            console.error('Error fetching artist insights:', err);
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        insights.productive_artists = artists || [];
        
        // Label evolution analysis
        db.all(`
            SELECT 
                label,
                COUNT(*) as releases,
                MIN(year) as first_year,
                MAX(year) as latest_year,
                COUNT(DISTINCT album_artist) as artist_count,
                ROUND(AVG(track_count), 1) as avg_tracks,
                COUNT(DISTINCT quality) as quality_variety
            FROM albums
            WHERE label IS NOT NULL AND year IS NOT NULL
            GROUP BY label
            HAVING releases >= 5
            ORDER BY releases DESC
            LIMIT 30
        `, (err, labels) => {
            if (err) {
                console.error('Error fetching label insights:', err);
                db.close();
                return res.status(500).json({ error: 'Database error' });
            }
            
            insights.prolific_labels = labels || [];
            
            // Year-over-year analysis
            db.all(`
                SELECT 
                    year,
                    COUNT(*) as albums_added,
                    COUNT(DISTINCT album_artist) as new_artists,
                    COUNT(DISTINCT label) as labels_active,
                    ROUND(AVG(track_count), 1) as avg_tracks,
                    SUM(CASE WHEN quality = 'Lossless' THEN 1 ELSE 0 END) as lossless_count
                FROM albums
                WHERE year IS NOT NULL AND year >= 1990
                GROUP BY year
                ORDER BY year DESC
                LIMIT 35
            `, (err, timeline) => {
                if (err) {
                    console.error('Error fetching timeline insights:', err);
                    db.close();
                    return res.status(500).json({ error: 'Database error' });
                }
                
                insights.timeline_analysis = timeline || [];
                
                // Collection anomalies
                db.all(`
                    SELECT 
                        'unusually_long_album' as type,
                        album_artist || ' - ' || album_title as description,
                        track_count as value,
                        'tracks' as unit
                    FROM albums
                    WHERE track_count > 25
                    
                    UNION ALL
                    
                    SELECT 
                        'very_old_release' as type,
                        album_artist || ' - ' || album_title as description,
                        year as value,
                        'year' as unit
                    FROM albums
                    WHERE year < 1960 AND year > 0
                    
                    UNION ALL
                    
                    SELECT 
                        'future_release' as type,
                        album_artist || ' - ' || album_title as description,
                        year as value,
                        'year' as unit
                    FROM albums
                    WHERE year > strftime('%Y', 'now')
                    
                    ORDER BY type, value DESC
                    LIMIT 20
                `, (err, anomalies) => {
                    if (err) {
                        console.error('Error fetching anomalies:', err);
                        db.close();
                        return res.status(500).json({ error: 'Database error' });
                    }
                    
                    insights.anomalies = anomalies || [];
                    
                    db.close();
                    res.json(insights);
                });
            });
        });
    });
});

// Get performance metrics
app.get('/api/performance', (req, res) => {
    const db = getDb();
    
    // Processing performance analysis
    db.all(`
        SELECT 
            DATE(processed_at) as date,
            COUNT(*) as albums_processed,
            AVG(processing_duration_ms) as avg_duration_ms,
            MIN(processing_duration_ms) as min_duration_ms,
            MAX(processing_duration_ms) as max_duration_ms,
            COUNT(CASE WHEN discogs_enriched = 1 THEN 1 END) as discogs_enriched
        FROM albums
        WHERE processed_at IS NOT NULL
        GROUP BY DATE(processed_at)
        ORDER BY date DESC
        LIMIT 30
    `, (err, performance) => {
        db.close();
        
        if (err) {
            console.error('Error fetching performance metrics:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        res.json({ daily_performance: performance || [] });
    });
});

// Export data as JSON
app.get('/api/export', exportLimiter, (req, res) => {
    const db = getDb();
    const exportData = {};
    
    db.all('SELECT * FROM albums', (err, albums) => {
        exportData.albums = albums || [];
        
        db.all('SELECT * FROM tracks', (err, tracks) => {
            exportData.tracks = tracks || [];
            
            db.all('SELECT * FROM artist_aliases', (err, aliases) => {
                exportData.aliases = aliases || [];
                
                db.all('SELECT * FROM labels', (err, labels) => {
                    exportData.labels = labels || [];
                    
                    db.close();
                    
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Content-Disposition', 'attachment; filename="ordrfm-export.json"');
                    res.json(exportData);
                });
            });
        });
    });
});

// Health check
app.get('/api/health', healthLimiter, (req, res) => {
    // Check if database exists
    fs.access(DB_PATH, fs.constants.R_OK, (err) => {
        if (err) {
            return res.status(503).json({ 
                status: 'error', 
                message: 'Database not found',
                dbPath: DB_PATH 
            });
        }
        
        // Try to open database
        const db = getDb();
        db.get('SELECT COUNT(*) as count FROM albums', (err, row) => {
            db.close();
            
            if (err) {
                return res.status(503).json({ 
                    status: 'error', 
                    message: 'Database connection failed',
                    error: err.message 
                });
            }
            
            res.json({ 
                status: 'healthy',
                dbPath: DB_PATH,
                albumCount: row ? row.count : 0
            });
        });
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`ordr.fm visualization server running on http://localhost:${PORT}`);
    console.log(`Database path: ${DB_PATH}`);
    
    // Check if database exists
    fs.access(DB_PATH, fs.constants.R_OK, (err) => {
        if (err) {
            console.warn('⚠️  Database not found at:', DB_PATH);
            console.warn('   Set ORDRFM_DB environment variable to point to your database');
            console.warn('   Example: ORDRFM_DB=/path/to/ordr.fm.metadata.db npm start');
        } else {
            console.log('✅ Database found and accessible');
        }
    });
});