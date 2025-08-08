const express = require('express');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Production optimizations
if (NODE_ENV === 'production') {
    app.set('trust proxy', 1); // Trust reverse proxy
    console.log('🚀 Running in production mode');
} else {
    console.log('🔧 Running in development mode');
}

// Create HTTP server for both Express and WebSocket
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// WebSocket connection handling
const clients = new Set();

wss.on('connection', (ws, req) => {
    console.log('WebSocket client connected from:', req.socket.remoteAddress);
    clients.add(ws);
    
    // Send initial connection message
    ws.send(JSON.stringify({
        type: 'connection',
        message: 'Connected to ordr.fm real-time updates',
        timestamp: new Date().toISOString()
    }));
    
    // Handle client messages
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            console.log('WebSocket message received:', message);
            
            // Handle different message types
            switch (message.type) {
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
                    break;
                    
                case 'subscribe':
                    // Client wants to subscribe to specific updates
                    ws.subscriptions = new Set(message.channels || []);
                    ws.send(JSON.stringify({
                        type: 'subscribed',
                        channels: Array.from(ws.subscriptions),
                        timestamp: new Date().toISOString()
                    }));
                    break;
                    
                default:
                    console.log('Unknown message type:', message.type);
            }
        } catch (error) {
            console.error('WebSocket message parse error:', error);
        }
    });
    
    // Handle client disconnect
    ws.on('close', () => {
        console.log('WebSocket client disconnected');
        clients.delete(ws);
    });
    
    // Handle errors
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });
});

// Broadcast message to all connected clients
function broadcast(message, channel = null) {
    const payload = JSON.stringify({
        ...message,
        timestamp: new Date().toISOString()
    });
    
    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            // Check if client is subscribed to this channel
            if (!channel || !ws.subscriptions || ws.subscriptions.has(channel)) {
                try {
                    ws.send(payload);
                } catch (error) {
                    console.error('Error sending WebSocket message:', error);
                    clients.delete(ws);
                }
            }
        } else {
            clients.delete(ws);
        }
    });
}

// Send periodic stats updates to subscribers
setInterval(async () => {
    if (clients.size === 0) return;
    
    try {
        // Get quick stats for real-time updates
        const db = getDb();
        db.get('SELECT COUNT(*) as albums FROM albums', (err, albumRow) => {
            if (err) return;
            
            db.get('SELECT COUNT(*) as tracks FROM tracks', (err, trackRow) => {
                if (!err) {
                    broadcast({
                        type: 'stats_update',
                        data: {
                            totalAlbums: albumRow?.albums || 0,
                            totalTracks: trackRow?.tracks || 0,
                            lastUpdate: new Date().toISOString()
                        }
                    }, 'stats');
                }
                db.close();
            });
        });
    } catch (error) {
        console.error('Error in periodic stats update:', error);
    }
}, 30000); // Every 30 seconds

// Database path from environment or default
const DB_PATH = process.env.ORDRFM_DB || path.join(__dirname, '..', 'ordr.fm.metadata.db');

// Rate limiting configuration
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX) || 500, // Increased from 100 to 500 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000) / 1000)
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    skip: (req) => {
        // Skip rate limiting for local development
        const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || 
                       req.ip.startsWith('192.168.') || req.ip.startsWith('10.') ||
                       req.hostname === 'localhost';
        return NODE_ENV === 'development' && isLocal;
    }
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

// General API limiter for search and other endpoints
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.API_RATE_LIMIT_MAX) || 300, // limit each IP to 300 requests per windowMs
    message: {
        error: 'Too many API requests from this IP, please try again later.',
        retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000) / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for local development
        const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || 
                       req.ip.startsWith('192.168.') || req.ip.startsWith('10.') ||
                       req.hostname === 'localhost';
        return NODE_ENV === 'development' && isLocal;
    }
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
            db.get('SELECT COUNT(DISTINCT artist) as count FROM albums WHERE artist IS NOT NULL', (err, row) => {
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
        query += ' AND artist LIKE ?';
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
    
    query += ' ORDER BY processing_date DESC LIMIT ? OFFSET ?';
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
        SELECT artist as name, 
               COUNT(*) as release_count,
               COUNT(DISTINCT label) as label_count
        FROM albums 
        WHERE artist IS NOT NULL
        GROUP BY artist
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
               COUNT(DISTINCT artist) as artist_count,
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
        SELECT DATE(processing_date) as date,
               COUNT(*) as albums_processed,
               SUM(CASE WHEN quality = 'Lossless' THEN 1 ELSE 0 END) as lossless,
               SUM(CASE WHEN quality = 'Lossy' THEN 1 ELSE 0 END) as lossy,
               SUM(CASE WHEN quality = 'Mixed' THEN 1 ELSE 0 END) as mixed
        FROM albums
        WHERE processing_date IS NOT NULL
        GROUP BY DATE(processing_date)
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
// Version endpoint for app updates
app.get('/api/version', (req, res) => {
    const packageJson = require('./package.json');
    res.json({
        version: packageJson.version,
        name: packageJson.name,
        description: packageJson.description,
        node_env: NODE_ENV,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Discogs enrichment endpoints
app.get('/api/enrichment/discogs/search', async (req, res) => {
    const { artist, album, label, year } = req.query;
    
    if (!artist || !album) {
        return res.status(400).json({ error: 'Artist and album are required' });
    }
    
    try {
        // Construct search query
        let query = `${artist} - ${album}`;
        if (year) query += ` year:${year}`;
        if (label) query += ` label:"${label}"`;
        
        const response = await fetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=album`, {
            headers: {
                'User-Agent': 'ordr.fm/1.0 +https://github.com/adrianwedd/ordr.fm',
                'Authorization': process.env.DISCOGS_TOKEN ? `Discogs token=${process.env.DISCOGS_TOKEN}` : undefined
            }
        });
        
        if (!response.ok) {
            throw new Error(`Discogs API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Filter and score results
        const scoredResults = data.results
            .filter(result => result.type === 'release')
            .slice(0, 10)
            .map(result => ({
                id: result.id,
                title: result.title,
                artist: result.artist || '',
                label: result.label?.[0] || '',
                catno: result.catno,
                year: result.year,
                genre: result.genre || [],
                style: result.style || [],
                format: result.format || [],
                thumb: result.thumb,
                confidence: calculateDiscogsConfidence(result, { artist, album, label, year })
            }))
            .sort((a, b) => b.confidence - a.confidence);
        
        res.json({
            query: query,
            total_results: data.pagination?.items || 0,
            results: scoredResults
        });
        
    } catch (error) {
        console.error('Discogs search error:', error);
        res.status(500).json({ error: 'Failed to search Discogs', details: error.message });
    }
});

app.get('/api/enrichment/discogs/release/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const response = await fetch(`https://api.discogs.com/releases/${id}`, {
            headers: {
                'User-Agent': 'ordr.fm/1.0 +https://github.com/adrianwedd/ordr.fm',
                'Authorization': process.env.DISCOGS_TOKEN ? `Discogs token=${process.env.DISCOGS_TOKEN}` : undefined
            }
        });
        
        if (!response.ok) {
            throw new Error(`Discogs API error: ${response.status}`);
        }
        
        const release = await response.json();
        
        // Extract and format data
        const enrichedData = {
            discogs_id: release.id,
            title: release.title,
            artists: release.artists?.map(a => a.name) || [],
            labels: release.labels?.map(l => ({ name: l.name, catno: l.catno })) || [],
            year: release.year,
            released: release.released,
            genres: release.genres || [],
            styles: release.styles || [],
            formats: release.formats || [],
            tracklist: release.tracklist || [],
            notes: release.notes,
            country: release.country,
            images: release.images || [],
            videos: release.videos || [],
            companies: release.companies || [],
            credits: release.extraartists || []
        };
        
        res.json(enrichedData);
        
    } catch (error) {
        console.error('Discogs release error:', error);
        res.status(500).json({ error: 'Failed to fetch Discogs release', details: error.message });
    }
});

// MusicBrainz enrichment endpoints
app.get('/api/enrichment/musicbrainz/search', async (req, res) => {
    const { artist, album } = req.query;
    
    if (!artist || !album) {
        return res.status(400).json({ error: 'Artist and album are required' });
    }
    
    try {
        const query = `artist:"${artist}" AND release:"${album}"`;
        const response = await fetch(`https://musicbrainz.org/ws/2/release?query=${encodeURIComponent(query)}&fmt=json&limit=10`, {
            headers: {
                'User-Agent': 'ordr.fm/1.0 ( https://github.com/adrianwedd/ordr.fm )'
            }
        });
        
        if (!response.ok) {
            throw new Error(`MusicBrainz API error: ${response.status}`);
        }
        
        const data = await response.json();
        
        const enrichedResults = data.releases?.map(release => ({
            id: release.id,
            title: release.title,
            artist: release['artist-credit']?.[0]?.name || '',
            date: release.date,
            country: release.country,
            barcode: release.barcode,
            status: release.status,
            packaging: release.packaging,
            disambiguation: release.disambiguation,
            confidence: calculateMusicBrainzConfidence(release, { artist, album })
        })).sort((a, b) => b.confidence - a.confidence) || [];
        
        res.json({
            query: query,
            total_results: data.count || 0,
            results: enrichedResults
        });
        
    } catch (error) {
        console.error('MusicBrainz search error:', error);
        res.status(500).json({ error: 'Failed to search MusicBrainz', details: error.message });
    }
});

app.get('/api/enrichment/musicbrainz/release/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const response = await fetch(`https://musicbrainz.org/ws/2/release/${id}?inc=artist-credits+labels+recordings+release-groups&fmt=json`, {
            headers: {
                'User-Agent': 'ordr.fm/1.0 ( https://github.com/adrianwedd/ordr.fm )'
            }
        });
        
        if (!response.ok) {
            throw new Error(`MusicBrainz API error: ${response.status}`);
        }
        
        const release = await response.json();
        
        const enrichedData = {
            mbid: release.id,
            title: release.title,
            artists: release['artist-credit']?.map(ac => ac.name) || [],
            date: release.date,
            country: release.country,
            barcode: release.barcode,
            status: release.status,
            packaging: release.packaging,
            labels: release['label-info']?.map(li => ({
                name: li.label?.name,
                catalog_number: li['catalog-number']
            })) || [],
            media: release.media?.map(medium => ({
                position: medium.position,
                title: medium.title,
                format: medium.format,
                tracks: medium.tracks?.map(track => ({
                    position: track.position,
                    title: track.title,
                    length: track.length,
                    artist: track['artist-credit']?.[0]?.name
                })) || []
            })) || [],
            release_group: release['release-group']
        };
        
        res.json(enrichedData);
        
    } catch (error) {
        console.error('MusicBrainz release error:', error);
        res.status(500).json({ error: 'Failed to fetch MusicBrainz release', details: error.message });
    }
});

// Apply enrichment to album
app.post('/api/enrichment/apply', async (req, res) => {
    const { album_id, source, enrichment_data } = req.body;
    
    if (!album_id || !source || !enrichment_data) {
        return res.status(400).json({ error: 'album_id, source, and enrichment_data are required' });
    }
    
    const db = getDb();
    
    try {
        // Update album with enrichment data
        const updateFields = [];
        const updateValues = [];
        
        if (source === 'discogs') {
            if (enrichment_data.discogs_id) {
                updateFields.push('discogs_id = ?');
                updateValues.push(enrichment_data.discogs_id);
            }
            if (enrichment_data.labels?.[0]) {
                updateFields.push('label = ?');
                updateValues.push(enrichment_data.labels[0].name);
            }
            if (enrichment_data.labels?.[0]?.catno) {
                updateFields.push('catalog_number = ?');
                updateValues.push(enrichment_data.labels[0].catno);
            }
            if (enrichment_data.genres?.length) {
                updateFields.push('genre = ?');
                updateValues.push(enrichment_data.genres.join(', '));
            }
            if (enrichment_data.styles?.length) {
                updateFields.push('style = ?');
                updateValues.push(enrichment_data.styles.join(', '));
            }
            if (enrichment_data.year) {
                updateFields.push('year = ?');
                updateValues.push(enrichment_data.year);
            }
            if (enrichment_data.country) {
                updateFields.push('country = ?');
                updateValues.push(enrichment_data.country);
            }
            
            updateFields.push('discogs_confidence = ?');
            updateValues.push(0.85); // High confidence for manual application
            
        } else if (source === 'musicbrainz') {
            if (enrichment_data.mbid) {
                updateFields.push('musicbrainz_id = ?');
                updateValues.push(enrichment_data.mbid);
            }
            if (enrichment_data.labels?.[0]) {
                updateFields.push('label = ?');
                updateValues.push(enrichment_data.labels[0].name);
            }
            if (enrichment_data.labels?.[0]?.catalog_number) {
                updateFields.push('catalog_number = ?');
                updateValues.push(enrichment_data.labels[0].catalog_number);
            }
            if (enrichment_data.date) {
                const year = enrichment_data.date.split('-')[0];
                updateFields.push('year = ?');
                updateValues.push(parseInt(year));
            }
            if (enrichment_data.country) {
                updateFields.push('country = ?');
                updateValues.push(enrichment_data.country);
            }
            if (enrichment_data.barcode) {
                updateFields.push('barcode = ?');
                updateValues.push(enrichment_data.barcode);
            }
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No valid enrichment data provided' });
        }
        
        updateFields.push('enrichment_date = ?');
        updateValues.push(new Date().toISOString());
        updateValues.push(album_id);
        
        const query = `UPDATE albums SET ${updateFields.join(', ')} WHERE rowid = ?`;
        
        db.run(query, updateValues, function(err) {
            db.close();
            
            if (err) {
                console.error('Error applying enrichment:', err);
                return res.status(500).json({ error: 'Failed to apply enrichment' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Album not found' });
            }
            
            res.json({ 
                success: true, 
                changes: this.changes,
                source: source,
                album_id: album_id
            });
        });
        
    } catch (error) {
        db.close();
        console.error('Enrichment application error:', error);
        res.status(500).json({ error: 'Failed to apply enrichment', details: error.message });
    }
});

// Helper functions
function calculateDiscogsConfidence(result, searchTerms) {
    let confidence = 0;
    
    // Exact title match
    if (result.title?.toLowerCase().includes(searchTerms.album?.toLowerCase())) {
        confidence += 0.4;
    }
    
    // Artist match
    if (result.artist?.toLowerCase().includes(searchTerms.artist?.toLowerCase())) {
        confidence += 0.3;
    }
    
    // Year match
    if (searchTerms.year && result.year === parseInt(searchTerms.year)) {
        confidence += 0.2;
    }
    
    // Label match
    if (searchTerms.label && result.label?.some(l => l?.toLowerCase().includes(searchTerms.label?.toLowerCase()))) {
        confidence += 0.1;
    }
    
    return Math.min(confidence, 1.0);
}

function calculateMusicBrainzConfidence(release, searchTerms) {
    let confidence = 0;
    
    // Title match
    if (release.title?.toLowerCase().includes(searchTerms.album?.toLowerCase())) {
        confidence += 0.5;
    }
    
    // Artist match
    const artistName = release['artist-credit']?.[0]?.name?.toLowerCase();
    if (artistName?.includes(searchTerms.artist?.toLowerCase())) {
        confidence += 0.5;
    }
    
    return Math.min(confidence, 1.0);
}

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
            0 as avg_tracks_per_album,
            COUNT(DISTINCT artist) as unique_artists,
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
                SUM(CASE WHEN artist IS NOT NULL AND artist != '' THEN 1 ELSE 0 END) as has_artist,
                SUM(CASE WHEN album IS NOT NULL AND album != '' THEN 1 ELSE 0 END) as has_title,
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
            artist,
            COUNT(*) as release_count,
            MIN(year) as first_release,
            MAX(year) as latest_release,
            COUNT(DISTINCT year) as active_years,
            COUNT(DISTINCT label) as labels_worked_with,
            GROUP_CONCAT(DISTINCT label) as label_list,
            0 as avg_tracks_per_album
        FROM albums
        WHERE artist IS NOT NULL
        GROUP BY artist
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
                COUNT(DISTINCT artist) as artist_count,
                0 as avg_tracks,
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
                    COUNT(DISTINCT artist) as new_artists,
                    COUNT(DISTINCT label) as labels_active,
                    0 as avg_tracks,
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
                        artist || ' - ' || album as description,
                        0 as value,
                        'tracks' as unit
                    FROM albums
                    WHERE 0 > 25
                    
                    UNION ALL
                    
                    SELECT 
                        'very_old_release' as type,
                        artist || ' - ' || album as description,
                        year as value,
                        'year' as unit
                    FROM albums
                    WHERE year < 1960 AND year > 0
                    
                    UNION ALL
                    
                    SELECT 
                        'future_release' as type,
                        artist || ' - ' || album as description,
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
            DATE(processing_date) as date,
            COUNT(*) as albums_processed,
            0 as avg_duration_ms,
            0 as min_duration_ms,
            0 as max_duration_ms,
            COUNT(CASE WHEN discogs_confidence > 0 THEN 1 END) as discogs_enriched
        FROM albums
        WHERE processing_date IS NOT NULL
        GROUP BY DATE(processing_date)
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

// Configuration Management API
app.get('/api/config', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(__dirname, '..', 'ordr.fm.conf');
    
    try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = parseConfigFile(configContent);
        res.json({
            config: config,
            configPath: configPath,
            lastModified: fs.statSync(configPath).mtime
        });
    } catch (error) {
        console.error('Config read error:', error);
        res.status(500).json({ 
            error: 'Failed to read configuration',
            details: error.message 
        });
    }
});

app.post('/api/config', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(__dirname, '..', 'ordr.fm.conf');
    
    try {
        const { config } = req.body;
        if (!config || typeof config !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration data' });
        }
        
        // Create backup of current config
        const backupPath = `${configPath}.backup.${Date.now()}`;
        fs.copyFileSync(configPath, backupPath);
        
        // Generate new config content
        const configContent = generateConfigFile(config);
        fs.writeFileSync(configPath, configContent, 'utf8');
        
        res.json({ 
            message: 'Configuration updated successfully',
            backupPath: backupPath,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Config write error:', error);
        res.status(500).json({ 
            error: 'Failed to write configuration',
            details: error.message 
        });
    }
});

// Parse configuration file into object
function parseConfigFile(content) {
    const config = {};
    const lines = content.split('\n');
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const [key, ...valueParts] = trimmed.split('=');
            let value = valueParts.join('=').trim();
            
            // Remove quotes
            if ((value.startsWith('"') && value.endsWith('"')) || 
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            
            config[key.trim()] = value;
        }
    }
    
    return config;
}

// Generate configuration file from object
function generateConfigFile(config) {
    const configSections = [
        {
            title: 'Basic Directory Settings',
            keys: ['SOURCE_DIR', 'DEST_DIR', 'UNSORTED_DIR_BASE', 'LOG_FILE', 'VERBOSITY']
        },
        {
            title: 'Incremental Processing Settings',
            keys: ['INCREMENTAL_MODE', 'STATE_DB', 'SINCE_DATE']
        },
        {
            title: 'Duplicate Detection Settings',
            keys: ['FIND_DUPLICATES', 'RESOLVE_DUPLICATES', 'DUPLICATES_DB']
        },
        {
            title: 'Automation and Batch Processing',
            keys: ['BATCH_MODE', 'NOTIFY_EMAIL', 'NOTIFY_WEBHOOK', 'LOCK_FILE']
        },
        {
            title: 'Discogs API Integration',
            keys: ['DISCOGS_ENABLED', 'DISCOGS_USER_TOKEN', 'DISCOGS_CONSUMER_KEY', 'DISCOGS_CONSUMER_SECRET', 
                   'DISCOGS_CACHE_DIR', 'DISCOGS_CACHE_EXPIRY', 'DISCOGS_RATE_LIMIT']
        },
        {
            title: 'Metadata Enrichment Preferences',
            keys: ['DISCOGS_CONFIDENCE_THRESHOLD', 'DISCOGS_CATALOG_NUMBERS', 'DISCOGS_REMIX_ARTISTS', 'DISCOGS_LABEL_SERIES']
        },
        {
            title: 'Electronic Music Organization',
            keys: ['ORGANIZATION_MODE', 'LABEL_PRIORITY_THRESHOLD', 'MIN_LABEL_RELEASES', 'SEPARATE_REMIXES',
                   'SEPARATE_COMPILATIONS', 'VINYL_SIDE_MARKERS', 'UNDERGROUND_DETECTION']
        },
        {
            title: 'Organization Patterns',
            keys: ['PATTERN_ARTIST', 'PATTERN_ARTIST_CATALOG', 'PATTERN_LABEL', 'PATTERN_SERIES', 
                   'PATTERN_REMIX', 'PATTERN_UNDERGROUND', 'PATTERN_COMPILATION']
        },
        {
            title: 'Artist and Content Detection',
            keys: ['REMIX_KEYWORDS', 'VA_ARTISTS', 'UNDERGROUND_PATTERNS', 'ARTIST_ALIAS_GROUPS',
                   'GROUP_ARTIST_ALIASES', 'USE_PRIMARY_ARTIST_NAME']
        },
        {
            title: 'Google Drive Backup Configuration',
            keys: ['ENABLE_GDRIVE_BACKUP', 'GDRIVE_BACKUP_DIR', 'GDRIVE_MOUNT_POINT', 'BACKUP_LOG',
                   'MAX_PARALLEL_UPLOADS', 'CHECKSUM_VERIFY', 'BACKUP_DB']
        },
        {
            title: 'Validation Configuration',
            keys: ['STRICT_MODE']
        }
    ];
    
    let content = '# ordr.fm Configuration File\n';
    content += '# Generated by the visualization dashboard\n';
    content += `# Last updated: ${new Date().toISOString()}\n\n`;
    
    for (const section of configSections) {
        content += `# ${section.title}\n`;
        for (const key of section.keys) {
            if (config.hasOwnProperty(key)) {
                const value = config[key];
                // Add quotes if value contains spaces or special characters
                const quotedValue = (value && (value.includes(' ') || value.includes('|') || value.includes(','))) 
                    ? `"${value}"` : value;
                content += `${key}=${quotedValue}\n`;
            }
        }
        content += '\n';
    }
    
    return content;
}

// Advanced Search API
app.get('/api/search/albums', generalLimiter, (req, res) => {
    console.log('=== SEARCH API CALLED ===');
    const db = getDb();
    const {
        album,
        artist,
        label,
        year_from,
        year_to,
        quality,
        org_mode,
        limit = 100,
        offset = 0
    } = req.query;
    
    let query = `
        SELECT 
            a.id,
            a.album_title as album,
            a.album_artist as artist,
            a.year,
            a.label,
            a.quality,
            a.organization_mode,
            a.catalog_number,
            a.album_path as path
        FROM albums a
        WHERE 1=1
    `;
    
    const params = [];
    
    // Build dynamic WHERE conditions
    if (album) {
        query += ` AND a.album_title LIKE ?`;
        params.push(`%${album}%`);
    }
    
    if (artist) {
        query += ` AND a.album_artist LIKE ?`;
        params.push(`%${artist}%`);
    }
    
    if (label) {
        query += ` AND a.label LIKE ?`;
        params.push(`%${label}%`);
    }
    
    if (year_from) {
        query += ` AND a.year >= ?`;
        params.push(parseInt(year_from));
    }
    
    if (year_to) {
        query += ` AND a.year <= ?`;
        params.push(parseInt(year_to));
    }
    
    if (quality) {
        query += ` AND a.quality = ?`;
        params.push(quality);
    }
    
    if (org_mode) {
        query += ` AND a.organization_mode = ?`;
        params.push(org_mode);
    }
    
    // Add ordering and pagination
    query += ` ORDER BY a.id DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    
    console.log('Executing search query:', query);
    console.log('With parameters:', params);
    
    db.all(query, params, (err, albums) => {
        if (err) {
            console.error('Search error:', err);
            console.error('Query was:', query);
            console.error('Params were:', params);
            db.close();
            return res.status(500).json({ error: 'Search failed', details: err.message });
        }
        
        // Get total count for pagination
        let countQuery = `
            SELECT COUNT(*) as total
            FROM albums a
            WHERE 1=1
        `;
        
        const countParams = [];
        
        // Apply same filters for count
        if (album) {
            countQuery += ` AND a.album_title LIKE ?`;
            countParams.push(`%${album}%`);
        }
        
        if (artist) {
            countQuery += ` AND a.album_artist LIKE ?`;
            countParams.push(`%${artist}%`);
        }
        
        if (label) {
            countQuery += ` AND a.label LIKE ?`;
            countParams.push(`%${label}%`);
        }
        
        if (year_from) {
            countQuery += ` AND a.year >= ?`;
            countParams.push(parseInt(year_from));
        }
        
        if (year_to) {
            countQuery += ` AND a.year <= ?`;
            countParams.push(parseInt(year_to));
        }
        
        if (quality) {
            countQuery += ` AND a.quality = ?`;
            countParams.push(quality);
        }
        
        if (org_mode) {
            countQuery += ` AND a.organization_mode = ?`;
            countParams.push(org_mode);
        }
        
        db.get(countQuery, countParams, (err, countResult) => {
            db.close();
            
            if (err) {
                console.error('Count error:', err);
                return res.status(500).json({ error: 'Count failed', details: err.message });
            }
            
            res.json({
                albums: albums || [],
                total: countResult?.total || 0,
                limit: parseInt(limit),
                offset: parseInt(offset),
                filters_applied: {
                    album: !!album,
                    artist: !!artist,
                    label: !!label,
                    year_range: !!(year_from || year_to),
                    quality: !!quality,
                    organization_mode: !!org_mode
                }
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

// Push notification subscription endpoint
app.post('/api/subscribe', (req, res) => {
    const subscription = req.body;
    
    console.log('Received push subscription:', {
        endpoint: subscription?.endpoint?.substring(0, 50) + '...',
        keys: subscription?.keys ? 'present' : 'missing'
    });
    
    // In a production app, you would:
    // 1. Store the subscription in a database
    // 2. Associate it with a user ID
    // 3. Use a proper VAPID key management system
    // 4. Implement subscription validation
    
    res.json({ 
        success: true, 
        message: 'Push subscription received',
        subscribed: true
    });
    
    // Send a test notification immediately (optional)
    // sendPushNotification(subscription, {
    //     title: 'ordr.fm Notifications',
    //     body: 'You will now receive real-time updates!',
    //     icon: '/icons/icon-192x192.png'
    // });
});

// =============================================================================
// AUDIO PLAYER API ENDPOINTS
// =============================================================================

// Search tracks for audio player
app.get('/api/search/tracks', (req, res) => {
    const { q: query } = req.query;
    
    // Input validation and sanitization
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
        return res.json({ tracks: [] });
    }
    
    const sanitizedQuery = query.trim().substring(0, 100); // Limit length
    if (!sanitizedQuery || sanitizedQuery.length < 2) {
        return res.json({ tracks: [] });
    }
    
    const db = getDb();
    const searchTerm = `%${sanitizedQuery}%`;
    
    // Search in tracks table with album and artist info
    const sql = `
        SELECT 
            t.id,
            t.title,
            t.artist,
            t.album_artist,
            t.duration,
            t.file_path,
            t.quality,
            a.title as album_title,
            a.artist as album_artist_name,
            a.year,
            a.label
        FROM tracks t
        LEFT JOIN albums a ON t.album_id = a.id
        WHERE 
            t.title LIKE ? OR 
            t.artist LIKE ? OR 
            t.album_artist LIKE ? OR 
            a.title LIKE ? OR 
            a.artist LIKE ?
        ORDER BY 
            CASE 
                WHEN t.title LIKE ? THEN 1
                WHEN t.artist LIKE ? THEN 2
                WHEN a.title LIKE ? THEN 3
                ELSE 4
            END,
            t.title
        LIMIT 50
    `;
    
    const params = [
        searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, // WHERE conditions
        searchTerm, searchTerm, searchTerm // ORDER BY conditions
    ];
    
    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Error searching tracks:', err);
            return res.status(500).json({ error: 'Search failed' });
        }
        
        const tracks = rows.map(row => ({
            id: row.id,
            title: row.title,
            artist: row.artist || row.album_artist_name || 'Unknown Artist',
            album: row.album_title || 'Unknown Album',
            duration: row.duration,
            year: row.year,
            quality: row.quality,
            label: row.label,
            file_path: row.file_path
        }));
        
        res.json({ tracks });
    });
});

// Stream audio file with enhanced security
app.get('/api/audio/stream/:trackId', (req, res) => {
    const { trackId } = req.params;
    
    // Validate track ID
    if (!trackId || typeof trackId !== 'string') {
        return res.status(400).json({ error: 'Invalid track ID' });
    }
    
    // Sanitize track ID (should be numeric or alphanumeric)
    const sanitizedTrackId = trackId.replace(/[^a-zA-Z0-9\-_]/g, '');
    if (!sanitizedTrackId || sanitizedTrackId !== trackId) {
        return res.status(400).json({ error: 'Invalid track ID format' });
    }
    
    const db = getDb();
    
    // Get track file path
    db.get('SELECT file_path, title, artist FROM tracks WHERE id = ?', [sanitizedTrackId], (err, track) => {
        if (err) {
            console.error('Error getting track:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!track) {
            return res.status(404).json({ error: 'Track not found' });
        }
        
        const filePath = track.file_path;
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            console.error('Audio file not found:', filePath);
            return res.status(404).json({ error: 'Audio file not found' });
        }
        
        // Get file stats
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;
        
        if (range) {
            // Handle range requests for seeking
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            
            const stream = fs.createReadStream(filePath, { start, end });
            
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': getAudioContentType(filePath),
                'Cache-Control': 'public, max-age=31536000', // 1 year cache
                'Access-Control-Allow-Origin': '*'
            });
            
            stream.pipe(res);
        } else {
            // Stream entire file
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': getAudioContentType(filePath),
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'public, max-age=31536000', // 1 year cache
                'Access-Control-Allow-Origin': '*'
            });
            
            fs.createReadStream(filePath).pipe(res);
        }
    });
});

// Get track metadata for audio player
app.get('/api/tracks/:trackId/metadata', (req, res) => {
    const { trackId } = req.params;
    const db = getDb();
    
    const sql = `
        SELECT 
            t.*,
            a.title as album_title,
            a.artist as album_artist,
            a.year,
            a.label,
            a.catalog_number,
            a.genre
        FROM tracks t
        LEFT JOIN albums a ON t.album_id = a.id
        WHERE t.id = ?
    `;
    
    db.get(sql, [trackId], (err, track) => {
        if (err) {
            console.error('Error getting track metadata:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!track) {
            return res.status(404).json({ error: 'Track not found' });
        }
        
        res.json({
            id: track.id,
            title: track.title,
            artist: track.artist || track.album_artist || 'Unknown Artist',
            album: track.album_title || 'Unknown Album',
            albumArtist: track.album_artist,
            year: track.year,
            genre: track.genre,
            label: track.label,
            catalogNumber: track.catalog_number,
            duration: track.duration,
            quality: track.quality,
            trackNumber: track.track_number,
            discNumber: track.disc_number,
            filePath: track.file_path
        });
    });
});

// Get album tracks for playlist building
app.get('/api/albums/:albumId/tracks', (req, res) => {
    const { albumId } = req.params;
    const db = getDb();
    
    const sql = `
        SELECT 
            t.*,
            a.title as album_title,
            a.artist as album_artist,
            a.year,
            a.label
        FROM tracks t
        LEFT JOIN albums a ON t.album_id = a.id
        WHERE t.album_id = ?
        ORDER BY 
            COALESCE(t.disc_number, 1), 
            COALESCE(t.track_number, 999), 
            t.title
    `;
    
    db.all(sql, [albumId], (err, tracks) => {
        if (err) {
            console.error('Error getting album tracks:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        const formattedTracks = tracks.map(track => ({
            id: track.id,
            title: track.title,
            artist: track.artist || track.album_artist || 'Unknown Artist',
            album: track.album_title || 'Unknown Album',
            duration: track.duration,
            year: track.year,
            quality: track.quality,
            trackNumber: track.track_number,
            discNumber: track.disc_number,
            label: track.label,
            filePath: track.file_path
        }));
        
        res.json({ tracks: formattedTracks });
    });
});

// Helper function to determine audio content type
function getAudioContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.mp3':
            return 'audio/mpeg';
        case '.flac':
            return 'audio/flac';
        case '.wav':
            return 'audio/wav';
        case '.m4a':
        case '.aac':
            return 'audio/aac';
        case '.ogg':
            return 'audio/ogg';
        case '.wma':
            return 'audio/x-ms-wma';
        default:
            return 'application/octet-stream';
    }
}

// Start server with WebSocket support
server.listen(PORT, '0.0.0.0', () => {
    // Get local IP address for network access
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let localIP = 'localhost';
    
    for (const interfaceName in interfaces) {
        for (const iface of interfaces[interfaceName]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                localIP = iface.address;
                break;
            }
        }
        if (localIP !== 'localhost') break;
    }
    
    console.log(`🎵 ordr.fm visualization server running on:`);
    console.log(`   • Local:    http://localhost:${PORT}`);
    console.log(`   • Network:  http://${localIP}:${PORT}`);
    console.log(`🔌 WebSocket server ready for real-time updates`);
    console.log(`💾 Database path: ${DB_PATH}`);
    
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

// Action API Endpoints

// Start music processing
app.post('/api/actions/process', (req, res) => {
    const { sourceDirectory, dryRun = true, enableDiscogs = true, electronicMode = false } = req.body;
    
    if (!sourceDirectory) {
        return res.status(400).json({ error: 'Source directory is required' });
    }
    
    // Build command arguments
    let command = `cd .. && ./ordr.fm.sh --source "${sourceDirectory}"`;
    if (!dryRun) {
        command += ' --move';
    }
    if (enableDiscogs) {
        command += ' --discogs';
    }
    if (electronicMode) {
        command += ' --enable-electronic';
    }
    
    console.log('Starting processing with command:', command);
    
    // Execute the command asynchronously
    const { spawn } = require('child_process');
    const process = spawn('bash', ['-c', command], {
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let output = '';
    let errorOutput = '';
    
    process.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        
        // Broadcast real-time updates to WebSocket clients
        broadcast({
            type: 'processing_update',
            data: {
                status: 'running',
                output: chunk,
                timestamp: new Date().toISOString()
            }
        }, 'processing');
    });
    
    process.stderr.on('data', (data) => {
        errorOutput += data.toString();
    });
    
    process.on('close', (code) => {
        const result = {
            success: code === 0,
            exitCode: code,
            output: output,
            error: errorOutput,
            timestamp: new Date().toISOString()
        };
        
        // Broadcast completion status
        broadcast({
            type: 'processing_complete',
            data: result
        }, 'processing');
        
        console.log('Processing completed with exit code:', code);
    });
    
    res.json({ 
        message: 'Processing started', 
        command: command.replace(/--source "[^"]*"/, '--source "[REDACTED]"'),
        timestamp: new Date().toISOString() 
    });
});

// System status check
app.get('/api/system/status', (req, res) => {
    const { exec } = require('child_process');
    const status = {
        dependencies: {},
        diskSpace: {},
        services: {},
        timestamp: new Date().toISOString()
    };
    
    // Check dependencies
    const dependencies = ['exiftool', 'jq', 'rsync', 'rclone'];
    let completedChecks = 0;
    
    dependencies.forEach(dep => {
        exec(`which ${dep}`, (error, stdout, stderr) => {
            status.dependencies[dep] = !error;
            completedChecks++;
            
            if (completedChecks === dependencies.length) {
                // Check disk space
                exec('df -h', (error, stdout, stderr) => {
                    if (!error) {
                        const lines = stdout.split('\n');
                        status.diskSpace.raw = stdout;
                        
                        // Parse specific directories
                        const parseUsage = (line) => {
                            const parts = line.split(/\s+/);
                            return {
                                total: parts[1],
                                used: parts[2],
                                available: parts[3],
                                usePercent: parts[4]
                            };
                        };
                        
                        lines.forEach(line => {
                            if (line.includes('/home')) {
                                status.diskSpace.home = parseUsage(line);
                            }
                            if (line.includes('/')) {
                                status.diskSpace.root = parseUsage(line);
                            }
                        });
                    }
                    
                    // Check if ordr.fm database exists and is accessible
                    const dbPath = DB_PATH;
                    fs.access(dbPath, fs.constants.R_OK, (err) => {
                        status.services.database = !err;
                        status.services.databasePath = dbPath;
                        
                        // Check if Discogs token is configured
                        status.services.discogs = process.env.DISCOGS_TOKEN || 'Not configured';
                        
                        res.json(status);
                    });
                });
            }
        });
    });
});

// Start database backup
app.post('/api/actions/backup-database', (req, res) => {
    const { exec } = require('child_process');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `./backups/metadata-backup-${timestamp}.db`;
    
    // Create backups directory if it doesn't exist
    exec('mkdir -p ./backups', (mkdirError) => {
        if (mkdirError) {
            return res.status(500).json({ error: 'Failed to create backup directory' });
        }
        
        // Copy database file
        exec(`cp "${DB_PATH}" "${backupPath}"`, (error, stdout, stderr) => {
            if (error) {
                console.error('Backup failed:', error);
                return res.status(500).json({ error: 'Backup failed', details: stderr });
            }
            
            // Get file size
            fs.stat(backupPath, (statError, stats) => {
                const result = {
                    success: true,
                    backupPath: backupPath,
                    timestamp: timestamp,
                    size: stats ? stats.size : 'unknown'
                };
                
                // Broadcast backup completion
                broadcast({
                    type: 'backup_complete',
                    data: result
                }, 'backup');
                
                res.json(result);
            });
        });
    });
});

// Global backup state tracking
let activeBackups = new Map(); // Map<backupId, {process, target, startTime, pid}>
let backupCounter = 0;

// Check if backup is already running
function isBackupRunning(target = null) {
    if (target) {
        return Array.from(activeBackups.values()).some(backup => backup.target === target);
    }
    return activeBackups.size > 0;
}

// Get running backup processes from system
function getSystemBackupProcesses() {
    const { execSync } = require('child_process');
    try {
        const result = execSync('ps aux | grep -E "(backup_to_gdrive|backup_unprocessed_to_gdrive|rclone)" | grep -v grep', 
                              { encoding: 'utf8' });
        return result.trim().split('\n').filter(line => line.length > 0);
    } catch (error) {
        return [];
    }
}

// Kill system backup processes
function killSystemBackupProcesses() {
    const { exec } = require('child_process');
    return new Promise((resolve) => {
        // Kill backup scripts first
        exec('pkill -f "backup.*gdrive"', (error1) => {
            // Then kill any remaining rclone processes
            exec('pkill -f "rclone.*gdrive:ordr.fm"', (error2) => {
                console.log('Killed system backup processes');
                resolve();
            });
        });
    });
}

// Get backup status
app.get('/api/actions/backup-status', (req, res) => {
    const systemProcesses = getSystemBackupProcesses();
    
    res.json({
        activeBackups: Array.from(activeBackups.entries()).map(([id, backup]) => ({
            id,
            target: backup.target,
            startTime: backup.startTime,
            pid: backup.pid
        })),
        systemProcesses: systemProcesses,
        hasRunning: activeBackups.size > 0 || systemProcesses.length > 0
    });
});

// Cancel backup
app.post('/api/actions/backup-cancel', async (req, res) => {
    const { backupId, killAll = false } = req.body;
    
    let cancelledCount = 0;
    
    if (killAll || !backupId) {
        // Cancel all backups
        for (const [id, backup] of activeBackups.entries()) {
            try {
                if (backup.process && !backup.process.killed) {
                    backup.process.kill('SIGTERM');
                    console.log(`Cancelled backup ${id}`);
                    cancelledCount++;
                }
            } catch (error) {
                console.error(`Error cancelling backup ${id}:`, error);
            }
        }
        
        // Also kill any system processes
        await killSystemBackupProcesses();
        
        activeBackups.clear();
        
        broadcast({
            type: 'backup_cancelled',
            data: {
                message: `Cancelled ${cancelledCount} backups and cleaned up system processes`,
                timestamp: new Date().toISOString()
            }
        }, 'backup');
        
        res.json({ 
            message: `Cancelled ${cancelledCount} backups`,
            killedAll: true 
        });
    } else {
        // Cancel specific backup
        const backup = activeBackups.get(backupId);
        if (backup) {
            try {
                if (backup.process && !backup.process.killed) {
                    backup.process.kill('SIGTERM');
                    console.log(`Cancelled backup ${backupId}`);
                    cancelledCount = 1;
                }
                activeBackups.delete(backupId);
                
                broadcast({
                    type: 'backup_cancelled',
                    data: {
                        backupId,
                        message: `Cancelled backup ${backupId}`,
                        timestamp: new Date().toISOString()
                    }
                }, 'backup');
                
                res.json({ 
                    message: `Cancelled backup ${backupId}`,
                    backupId 
                });
            } catch (error) {
                res.status(500).json({ error: `Failed to cancel backup: ${error.message}` });
            }
        } else {
            res.status(404).json({ error: 'Backup not found' });
        }
    }
});

// Start cloud backup
app.post('/api/actions/backup-cloud', (req, res) => {
    const { target = 'gdrive', force = false } = req.body;
    const { spawn } = require('child_process');
    
    // Check if backup is already running
    if (!force && (isBackupRunning(target) || getSystemBackupProcesses().length > 0)) {
        return res.status(409).json({ 
            error: 'Backup already running',
            suggestion: 'Cancel existing backup first or use force=true to override',
            runningBackups: Array.from(activeBackups.keys())
        });
    }
    
    let command;
    if (target === 'gdrive') {
        command = 'cd .. && ./backup_to_gdrive.sh';
    } else {
        return res.status(400).json({ error: 'Unsupported backup target' });
    }
    
    // Generate unique backup ID
    const backupId = `backup_${++backupCounter}_${Date.now()}`;
    
    console.log(`Starting cloud backup ${backupId} with command:`, command);
    
    const process = spawn('bash', ['-c', command], {
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Store process info
    activeBackups.set(backupId, {
        process: process,
        target: target,
        startTime: new Date().toISOString(),
        pid: process.pid
    });
    
    let output = '';
    let errorOutput = '';
    
    process.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        
        // Broadcast real-time backup updates
        broadcast({
            type: 'backup_update',
            data: {
                backupId,
                status: 'running',
                output: chunk,
                timestamp: new Date().toISOString()
            }
        }, 'backup');
    });
    
    process.stderr.on('data', (data) => {
        errorOutput += data.toString();
    });
    
    process.on('close', (code) => {
        const result = {
            backupId,
            success: code === 0,
            exitCode: code,
            output: output,
            error: errorOutput,
            timestamp: new Date().toISOString()
        };
        
        // Remove from active backups
        activeBackups.delete(backupId);
        
        // Broadcast completion status
        broadcast({
            type: 'backup_complete',
            data: result
        }, 'backup');
        
        console.log(`Cloud backup ${backupId} completed with exit code:`, code);
    });
    
    // Handle process errors
    process.on('error', (error) => {
        console.error(`Backup ${backupId} error:`, error);
        activeBackups.delete(backupId);
        
        broadcast({
            type: 'backup_error',
            data: {
                backupId,
                error: error.message,
                timestamp: new Date().toISOString()
            }
        }, 'backup');
    });
    
    res.json({ 
        message: 'Cloud backup started',
        backupId: backupId,
        target: target,
        timestamp: new Date().toISOString() 
    });
});

// Get recent activity log
app.get('/api/system/activity', (req, res) => {
    const { exec } = require('child_process');
    
    // Get recent log entries from ordr.fm.log
    exec('cd .. && tail -20 ordr.fm.log', (error, stdout, stderr) => {
        if (error) {
            return res.json({ activities: [] });
        }
        
        const lines = stdout.trim().split('\n');
        const activities = lines
            .filter(line => line.trim().length > 0)
            .map(line => {
                // Parse log lines for timestamp and message
                const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(.*)$/);
                if (match) {
                    return {
                        time: match[1],
                        description: match[2].substring(0, 100) // Truncate long messages
                    };
                }
                return {
                    time: 'Unknown',
                    description: line.substring(0, 100)
                };
            })
            .slice(-10); // Keep only last 10 activities
        
        res.json({ activities });
    });
});

// Enhance existing metadata with Discogs
app.post('/api/actions/enhance-metadata', (req, res) => {
    const { force = false } = req.body;
    const { spawn } = require('child_process');
    
    // Build command to re-process existing organized music with Discogs enhancement
    let command = `cd .. && find "/home/plex/Music/sorted_music" -type d -name "*(*)" | head -10 | while read dir; do echo "Enhancing: $dir"; ./ordr.fm.sh --source "$dir" --discogs --move; done`;
    
    if (force) {
        command += ' --force-refresh';
    }
    
    console.log('Starting metadata enhancement...');
    
    const process = spawn('bash', ['-c', command], {
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let output = '';
    let errorOutput = '';
    
    process.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        
        // Broadcast real-time updates
        broadcast({
            type: 'enhancement_update',
            data: {
                status: 'running',
                output: chunk,
                timestamp: new Date().toISOString()
            }
        }, 'processing');
    });
    
    process.stderr.on('data', (data) => {
        errorOutput += data.toString();
    });
    
    process.on('close', (code) => {
        const result = {
            success: code === 0,
            exitCode: code,
            output: output,
            error: errorOutput,
            timestamp: new Date().toISOString()
        };
        
        // Broadcast completion status
        broadcast({
            type: 'enhancement_complete',
            data: result
        }, 'processing');
        
        console.log('Metadata enhancement completed with exit code:', code);
    });
    
    res.json({ 
        message: 'Metadata enhancement started',
        description: 'Re-processing first 10 organized albums with Discogs enrichment',
        timestamp: new Date().toISOString() 
    });
});

// File browser endpoint for directory selection
app.get('/api/browse', (req, res) => {
    const { path: browsePath = '/home/plex/Music' } = req.query;
    const fs = require('fs');
    const path = require('path');
    
    try {
        // Security: Only allow browsing under certain directories
        const allowedPaths = [
            '/home/plex/Music',
            '/home/pi/repos/ordr.fm',
            '/media',
            '/mnt'
        ];
        
        const isAllowed = allowedPaths.some(allowedPath => 
            browsePath.startsWith(allowedPath)
        );
        
        if (!isAllowed) {
            return res.status(403).json({ error: 'Access denied to this directory' });
        }
        
        if (!fs.existsSync(browsePath)) {
            return res.status(404).json({ error: 'Directory not found' });
        }
        
        const stats = fs.statSync(browsePath);
        if (!stats.isDirectory()) {
            return res.status(400).json({ error: 'Path is not a directory' });
        }
        
        const items = fs.readdirSync(browsePath)
            .map(item => {
                const itemPath = path.join(browsePath, item);
                let itemStats;
                
                try {
                    itemStats = fs.statSync(itemPath);
                } catch (error) {
                    return null; // Skip items we can't read
                }
                
                // Only include directories and audio files
                const isDirectory = itemStats.isDirectory();
                const isAudioFile = /\.(mp3|flac|wav|aiff|alac|aac|m4a|ogg)$/i.test(item);
                
                if (!isDirectory && !isAudioFile) {
                    return null;
                }
                
                return {
                    name: item,
                    path: itemPath,
                    type: isDirectory ? 'directory' : 'file',
                    size: isDirectory ? null : itemStats.size,
                    modified: itemStats.mtime.toISOString(),
                    hasAudioFiles: isDirectory ? hasAudioFiles(itemPath) : null
                };
            })
            .filter(item => item !== null)
            .sort((a, b) => {
                // Directories first, then alphabetical
                if (a.type !== b.type) {
                    return a.type === 'directory' ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });
        
        // Get parent directory for navigation
        const parentDir = browsePath === '/' ? null : path.dirname(browsePath);
        
        res.json({
            currentPath: browsePath,
            parentPath: parentDir,
            items: items,
            totalItems: items.length
        });
        
    } catch (error) {
        console.error('File browser error:', error);
        res.status(500).json({ error: 'Failed to browse directory' });
    }
});

// Helper function to check if directory contains audio files
function hasAudioFiles(dirPath) {
    try {
        const items = fs.readdirSync(dirPath);
        return items.some(item => {
            if (/\.(mp3|flac|wav|aiff|alac|aac|m4a|ogg)$/i.test(item)) {
                return true;
            }
            // Check subdirectories (only one level deep for performance)
            const itemPath = path.join(dirPath, item);
            try {
                const stat = fs.statSync(itemPath);
                if (stat.isDirectory()) {
                    const subItems = fs.readdirSync(itemPath);
                    return subItems.some(subItem => 
                        /\.(mp3|flac|wav|aiff|alac|aac|m4a|ogg)$/i.test(subItem)
                    );
                }
            } catch (e) {
                return false;
            }
            return false;
        });
    } catch (error) {
        return false;
    }
}

// Metadata Editing API Endpoints

// Get album metadata for editing
app.get('/api/metadata/album/:id', (req, res) => {
    const { id } = req.params;
    const db = getDb();
    
    // Get album data
    db.get(`
        SELECT 
            a.id,
            a.album_title as title,
            a.album_artist as artist,
            a.year,
            a.genre,
            a.label,
            a.catalog_number,
            a.quality,
            a.organization_mode,
            a.album_path as path
        FROM albums a 
        WHERE a.id = ?
    `, [id], (err, album) => {
        if (err) {
            db.close();
            console.error('Album metadata error:', err);
            return res.status(500).json({ error: 'Failed to fetch album metadata' });
        }
        
        if (!album) {
            db.close();
            return res.status(404).json({ error: 'Album not found' });
        }
        
        // Get tracks for this album
        db.all(`
            SELECT 
                t.id,
                t.track_number,
                t.title,
                t.artist,
                t.duration,
                t.genre,
                t.file_path
            FROM tracks t 
            WHERE t.album_id = ?
            ORDER BY t.track_number ASC
        `, [id], (err, tracks) => {
            db.close();
            
            if (err) {
                console.error('Tracks fetch error:', err);
                return res.status(500).json({ error: 'Failed to fetch tracks' });
            }
            
            album.tracks = tracks || [];
            
            res.json({ album });
        });
    });
});

// Get metadata edit history
app.get('/api/metadata/history/:albumId', (req, res) => {
    const { albumId } = req.params;
    const db = getDb();
    
    db.all(`
        SELECT 
            timestamp,
            user_id,
            changes,
            metadata_version
        FROM metadata_history 
        WHERE album_id = ? 
        ORDER BY timestamp DESC 
        LIMIT 20
    `, [albumId], (err, history) => {
        db.close();
        
        if (err) {
            console.error('History fetch error:', err);
            return res.status(500).json({ error: 'Failed to fetch history' });
        }
        
        const parsedHistory = (history || []).map(entry => ({
            timestamp: entry.timestamp,
            user: entry.user_id || 'System',
            changes: JSON.parse(entry.changes || '[]'),
            version: entry.metadata_version
        }));
        
        res.json({ history: parsedHistory });
    });
});

// Save metadata changes
app.post('/api/metadata/save', (req, res) => {
    const { albumId, metadata, originalMetadata } = req.body;
    
    if (!albumId || !metadata) {
        return res.status(400).json({ error: 'Album ID and metadata are required' });
    }
    
    const db = getDb();
    
    // Begin transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        try {
            // Update album metadata
            db.run(`
                UPDATE albums SET
                    album_title = ?,
                    album_artist = ?,
                    year = ?,
                    genre = ?,
                    label = ?,
                    catalog_number = ?,
                    updated_at = datetime('now')
                WHERE id = ?
            `, [
                metadata.title || null,
                metadata.artist || null,
                metadata.year || null,
                metadata.genre || null,
                metadata.label || null,
                metadata.catalog_number || null,
                albumId
            ], function(err) {
                if (err) {
                    console.error('Album update error:', err);
                    db.run('ROLLBACK');
                    db.close();
                    return res.status(500).json({ error: 'Failed to update album metadata' });
                }
                
                // Update tracks if provided
                if (metadata.tracks && metadata.tracks.length > 0) {
                    let trackUpdateCount = 0;
                    const totalTracks = metadata.tracks.length;
                    
                    metadata.tracks.forEach((track, index) => {
                        db.run(`
                            UPDATE tracks SET
                                track_number = ?,
                                title = ?,
                                artist = ?,
                                duration = ?,
                                genre = ?,
                                updated_at = datetime('now')
                            WHERE album_id = ? AND (id = ? OR track_number = ?)
                        `, [
                            track.track_number || index + 1,
                            track.title || null,
                            track.artist || null,
                            track.duration || null,
                            track.genre || null,
                            albumId,
                            track.id || null,
                            index + 1  // Fallback to position-based matching
                        ], function(trackErr) {
                            trackUpdateCount++;
                            
                            if (trackErr) {
                                console.error('Track update error:', trackErr);
                            }
                            
                            // When all tracks are processed
                            if (trackUpdateCount === totalTracks) {
                                // Record metadata change in history
                                const changes = generateMetadataChanges(originalMetadata, metadata);
                                
                                db.run(`
                                    INSERT OR IGNORE INTO metadata_history 
                                    (album_id, timestamp, user_id, changes, metadata_version)
                                    VALUES (?, datetime('now'), ?, ?, ?)
                                `, [
                                    albumId,
                                    'webapp', // User identifier
                                    JSON.stringify(changes),
                                    Date.now() // Simple version number
                                ], function(historyErr) {
                                    if (historyErr) {
                                        console.warn('History insert warning:', historyErr);
                                    }
                                    
                                    // Commit transaction
                                    db.run('COMMIT', (commitErr) => {
                                        db.close();
                                        
                                        if (commitErr) {
                                            console.error('Commit error:', commitErr);
                                            return res.status(500).json({ error: 'Failed to save changes' });
                                        }
                                        
                                        // Broadcast metadata update
                                        broadcast({
                                            type: 'metadata_updated',
                                            data: {
                                                albumId: albumId,
                                                changes: changes.length,
                                                timestamp: new Date().toISOString()
                                            }
                                        }, 'metadata');
                                        
                                        res.json({ 
                                            success: true,
                                            message: 'Metadata saved successfully',
                                            changes: changes.length,
                                            timestamp: new Date().toISOString()
                                        });
                                    });
                                });
                            }
                        });
                    });
                } else {
                    // No tracks to update, just commit album changes
                    const changes = generateMetadataChanges(originalMetadata, metadata);
                    
                    db.run(`
                        INSERT OR IGNORE INTO metadata_history 
                        (album_id, timestamp, user_id, changes, metadata_version)
                        VALUES (?, datetime('now'), ?, ?, ?)
                    `, [
                        albumId,
                        'webapp',
                        JSON.stringify(changes),
                        Date.now()
                    ], function(historyErr) {
                        if (historyErr) {
                            console.warn('History insert warning:', historyErr);
                        }
                        
                        db.run('COMMIT', (commitErr) => {
                            db.close();
                            
                            if (commitErr) {
                                console.error('Commit error:', commitErr);
                                return res.status(500).json({ error: 'Failed to save changes' });
                            }
                            
                            broadcast({
                                type: 'metadata_updated',
                                data: {
                                    albumId: albumId,
                                    changes: changes.length,
                                    timestamp: new Date().toISOString()
                                }
                            }, 'metadata');
                            
                            res.json({ 
                                success: true,
                                message: 'Album metadata saved successfully',
                                changes: changes.length,
                                timestamp: new Date().toISOString()
                            });
                        });
                    });
                }
            });
            
        } catch (error) {
            db.run('ROLLBACK');
            db.close();
            console.error('Metadata save error:', error);
            res.status(500).json({ error: 'Failed to save metadata', details: error.message });
        }
    });
});

// Generate metadata changes for history tracking
function generateMetadataChanges(original, updated) {
    const changes = [];
    
    // Compare album fields
    const albumFields = {
        title: 'Album Title',
        artist: 'Album Artist', 
        year: 'Release Year',
        genre: 'Genre',
        label: 'Record Label',
        catalog_number: 'Catalog Number'
    };
    
    Object.entries(albumFields).forEach(([field, displayName]) => {
        const oldValue = original?.[field] || '';
        const newValue = updated?.[field] || '';
        
        if (oldValue !== newValue) {
            changes.push({
                field: displayName,
                old_value: oldValue,
                new_value: newValue,
                type: 'album'
            });
        }
    });
    
    // Compare tracks
    const originalTracks = original?.tracks || [];
    const updatedTracks = updated?.tracks || [];
    const maxTracks = Math.max(originalTracks.length, updatedTracks.length);
    
    for (let i = 0; i < maxTracks; i++) {
        const oldTrack = originalTracks[i] || {};
        const newTrack = updatedTracks[i] || {};
        
        const trackFields = {
            title: 'Title',
            artist: 'Artist',
            track_number: 'Track Number',
            duration: 'Duration',
            genre: 'Genre'
        };
        
        Object.entries(trackFields).forEach(([field, displayName]) => {
            const oldValue = oldTrack[field] || '';
            const newValue = newTrack[field] || '';
            
            if (oldValue !== newValue) {
                changes.push({
                    field: `Track ${i + 1} ${displayName}`,
                    old_value: oldValue,
                    new_value: newValue,
                    type: 'track',
                    track_index: i + 1
                });
            }
        });
    }
    
    return changes;
}

// Initialize metadata_history table if it doesn't exist
function initMetadataHistoryTable() {
    const db = getDb();
    
    db.run(`
        CREATE TABLE IF NOT EXISTS metadata_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            album_id INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            user_id TEXT,
            changes TEXT NOT NULL,
            metadata_version INTEGER,
            FOREIGN KEY (album_id) REFERENCES albums (id)
        )
    `, (err) => {
        if (err) {
            console.error('Failed to create metadata_history table:', err);
        } else {
            console.log('Metadata history table initialized');
        }
        db.close();
    });
}

// Initialize the metadata history table on server start
setTimeout(() => {
    initMetadataHistoryTable();
}, 1000);

// Export broadcast function for external use (if needed)
module.exports = { broadcast };