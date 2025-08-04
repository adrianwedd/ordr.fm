const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Database path from environment or default
const DB_PATH = process.env.ORDRFM_DB || path.join(__dirname, '..', 'ordr.fm.metadata.db');

// Middleware
app.use(express.json());
app.use(express.static('public'));

// CORS headers for development
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
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

// Export data as JSON
app.get('/api/export', (req, res) => {
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
app.get('/api/health', (req, res) => {
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