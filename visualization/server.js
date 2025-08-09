const express = require('express');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3847;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Security and Authentication Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'ordr-fm-default-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const BCRYPT_ROUNDS = 12;

// Security: Warn about default JWT secret in production
if (NODE_ENV === 'production' && JWT_SECRET === 'ordr-fm-default-secret-change-in-production') {
    console.warn('⚠️  WARNING: Using default JWT secret in production! Set JWT_SECRET environment variable.');
}

// Performance monitoring and caching
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 1000;

// Cache helper functions
function getCacheKey(query, params) {
    return `${query}|${JSON.stringify(params || [])}`;
}

function setCache(key, data) {
    if (cache.size >= CACHE_MAX_SIZE) {
        // Remove oldest entries
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
    
    cache.set(key, {
        data,
        timestamp: Date.now()
    });
}

function getCache(key) {
    const cached = cache.get(key);
    if (!cached) {return null;}
    
    if (Date.now() - cached.timestamp > CACHE_TTL) {
        cache.delete(key);
        return null;
    }
    
    return cached.data;
}

function clearCache(pattern = null) {
    if (!pattern) {
        cache.clear();
        return;
    }
    
    for (const key of cache.keys()) {
        if (key.includes(pattern)) {
            cache.delete(key);
        }
    }
}

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

// WebSocket connection handling with progress tracking
const clients = new Set();
const activeJobs = new Map(); // jobId -> { id, type, status, progress, startTime, details }
const jobHistory = []; // Recent completed jobs

wss.on('connection', (ws, req) => {
    console.log('WebSocket client connected from:', req.socket.remoteAddress);
    clients.add(ws);
    
    // Send initial connection message with active jobs
    ws.send(JSON.stringify({
        type: 'connection',
        message: 'Connected to ordr.fm real-time updates',
        timestamp: new Date().toISOString(),
        activeJobs: Array.from(activeJobs.values()),
        recentJobs: jobHistory.slice(-5)
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
                    
                case 'cancel_job':
                    if (message.jobId && activeJobs.has(message.jobId)) {
                        const job = activeJobs.get(message.jobId);
                        job.status = 'cancelled';
                        job.cancelled = true;
                        broadcastJobUpdate(job);
                        ws.send(JSON.stringify({
                            type: 'job_cancelled',
                            jobId: message.jobId,
                            timestamp: new Date().toISOString()
                        }));
                    }
                    break;
                    
                case 'get_job_status':
                    if (message.jobId && activeJobs.has(message.jobId)) {
                        ws.send(JSON.stringify({
                            type: 'job_status',
                            job: activeJobs.get(message.jobId),
                            timestamp: new Date().toISOString()
                        }));
                    }
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

// Progress tracking functions for real-time job monitoring
function createJob(type, totalItems = 0, details = {}) {
    const jobId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const job = {
        id: jobId,
        type,
        status: 'starting',
        progress: 0,
        totalItems,
        processedItems: 0,
        startTime: new Date().toISOString(),
        details,
        errors: [],
        warnings: []
    };
    
    activeJobs.set(jobId, job);
    broadcastJobUpdate(job);
    console.log(`🎯 Created job: ${jobId} (${type})`);
    return jobId;
}

function updateJobProgress(jobId, processedItems, status = 'running', details = {}) {
    const job = activeJobs.get(jobId);
    if (!job || job.cancelled) {return false;}
    
    job.processedItems = processedItems;
    job.progress = job.totalItems > 0 ? Math.round((processedItems / job.totalItems) * 100) : 0;
    job.status = status;
    job.lastUpdate = new Date().toISOString();
    job.details = { ...job.details, ...details };
    
    broadcastJobUpdate(job);
    return true;
}

function addJobError(jobId, error) {
    const job = activeJobs.get(jobId);
    if (job) {
        job.errors.push({
            message: error,
            timestamp: new Date().toISOString()
        });
        broadcastJobUpdate(job);
    }
}

function addJobWarning(jobId, warning) {
    const job = activeJobs.get(jobId);
    if (job) {
        job.warnings.push({
            message: warning,
            timestamp: new Date().toISOString()
        });
        broadcastJobUpdate(job);
    }
}

function completeJob(jobId, status = 'completed', summary = {}) {
    const job = activeJobs.get(jobId);
    if (!job) {return;}
    
    job.status = status;
    job.endTime = new Date().toISOString();
    job.duration = new Date(job.endTime) - new Date(job.startTime);
    job.summary = summary;
    
    if (status === 'completed') {
        job.progress = 100;
        job.processedItems = job.totalItems;
    }
    
    // Move to history and clean up
    jobHistory.push({ ...job });
    if (jobHistory.length > 50) {jobHistory.shift();} // Keep last 50 jobs
    
    activeJobs.delete(jobId);
    broadcastJobUpdate(job, true);
    
    console.log(`✅ Completed job: ${jobId} (${status}) in ${job.duration}ms`);
}

// Broadcast job updates to all connected clients
function broadcastJobUpdate(job, isCompleted = false) {
    broadcast({
        type: 'job_update',
        job,
        isCompleted,
        activeJobsCount: activeJobs.size
    }, 'jobs');
}

// Search Analytics Functions
function trackSearchQuery(query, userId, resultCount, searchType, responseTime, ipAddress, userAgent) {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE);
    
    db.run(
        'INSERT INTO search_analytics (query, user_id, result_count, search_type, response_time, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [query.trim().toLowerCase(), userId, resultCount, searchType, responseTime, ipAddress, userAgent],
        (err) => {
            db.close();
            if (err) {
                console.error('Search analytics error:', err.message);
            }
        }
    );
}

// Advanced Search System with Fuzzy Matching
function levenshteinDistance(str1, str2) {
    const matrix = Array(str2.length + 1).fill().map(() => Array(str1.length + 1).fill(0));
    
    for (let i = 0; i <= str1.length; i++) {matrix[0][i] = i;}
    for (let j = 0; j <= str2.length; j++) {matrix[j][0] = j;}
    
    for (let j = 1; j <= str2.length; j++) {
        for (let i = 1; i <= str1.length; i++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(
                matrix[j - 1][i] + 1,     // deletion
                matrix[j][i - 1] + 1,     // insertion
                matrix[j - 1][i - 1] + cost // substitution
            );
        }
    }
    
    return matrix[str2.length][str1.length];
}

function calculateSimilarity(str1, str2) {
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) {return 1.0;}
    
    const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
    return (maxLength - distance) / maxLength;
}

function fuzzyMatch(query, text, threshold = 0.6) {
    if (!query || !text) {return { matches: false, similarity: 0 };}
    
    const queryLower = query.toLowerCase().trim();
    const textLower = text.toLowerCase().trim();
    
    // Exact match gets highest score
    if (textLower === queryLower) {
        return { matches: true, similarity: 1.0, matchType: 'exact' };
    }
    
    // Contains match
    if (textLower.includes(queryLower)) {
        const similarity = Math.max(0.8, queryLower.length / textLower.length);
        return { matches: true, similarity, matchType: 'contains' };
    }
    
    // Word boundary matches
    const queryWords = queryLower.split(/\s+/);
    const textWords = textLower.split(/\s+/);
    
    let wordMatches = 0;
    let totalSimilarity = 0;
    
    for (const queryWord of queryWords) {
        let bestWordSimilarity = 0;
        
        for (const textWord of textWords) {
            const wordSimilarity = calculateSimilarity(queryWord, textWord);
            if (wordSimilarity > bestWordSimilarity) {
                bestWordSimilarity = wordSimilarity;
            }
        }
        
        if (bestWordSimilarity >= threshold) {
            wordMatches++;
        }
        totalSimilarity += bestWordSimilarity;
    }
    
    const avgSimilarity = totalSimilarity / queryWords.length;
    const wordMatchRatio = wordMatches / queryWords.length;
    
    // Require at least 50% of words to match above threshold
    if (wordMatchRatio >= 0.5 || avgSimilarity >= threshold) {
        return { 
            matches: true, 
            similarity: Math.max(avgSimilarity, wordMatchRatio * 0.8),
            matchType: 'fuzzy',
            wordMatchRatio
        };
    }
    
    // Full string similarity as fallback
    const stringSimilarity = calculateSimilarity(queryLower, textLower);
    if (stringSimilarity >= threshold) {
        return { matches: true, similarity: stringSimilarity, matchType: 'fuzzy_full' };
    }
    
    return { matches: false, similarity: stringSimilarity };
}

function rankSearchResults(results, query) {
    return results.map(item => {
        let totalScore = 0;
        const matchDetails = {};
        
        // Artist matching (weight: 0.4)
        if (item.album_artist) {
            const artistMatch = fuzzyMatch(query, item.album_artist);
            matchDetails.artist = artistMatch;
            totalScore += artistMatch.similarity * 0.4;
        }
        
        // Album title matching (weight: 0.4)
        if (item.album_title) {
            const albumMatch = fuzzyMatch(query, item.album_title);
            matchDetails.album = albumMatch;
            totalScore += albumMatch.similarity * 0.4;
        }
        
        // Label matching (weight: 0.15)
        if (item.label) {
            const labelMatch = fuzzyMatch(query, item.label);
            matchDetails.label = labelMatch;
            totalScore += labelMatch.similarity * 0.15;
        }
        
        // Catalog number matching (weight: 0.05)
        if (item.catalog_number) {
            const catalogMatch = fuzzyMatch(query, item.catalog_number);
            matchDetails.catalog = catalogMatch;
            totalScore += catalogMatch.similarity * 0.05;
        }
        
        return {
            ...item,
            searchScore: Math.round(totalScore * 100) / 100,
            matchDetails,
            relevance: totalScore > 0.6 ? 'high' : totalScore > 0.3 ? 'medium' : 'low'
        };
    }).sort((a, b) => b.searchScore - a.searchScore);
}

// Advanced Search API Endpoint
app.get('/api/search/fuzzy', async (req, res) => {
    const { q: query, limit = 50, threshold = 0.4, include_low_relevance = false } = req.query;
    const startTime = Date.now();
    
    if (!query || query.trim().length < 2) {
        return res.status(400).json({ 
            error: 'Query must be at least 2 characters long',
            code: 'INVALID_QUERY'
        });
    }
    
    const safeLimit = Math.min(parseInt(limit) || 50, 200);
    const searchThreshold = Math.max(0.1, Math.min(1.0, parseFloat(threshold) || 0.4));
    
    // Create cache key for search results
    const cacheKey = getCacheKey('fuzzy_search', { query: query.trim(), limit: safeLimit, threshold: searchThreshold });
    const cached = getCache(cacheKey);
    
    if (cached) {
        cached.performance.cacheHit = true;
        cached.performance.queryTime = Date.now() - startTime;
        return res.json(cached);
    }
    
    try {
        const db = getDbSync();
        
        // Get all albums for fuzzy matching (can be optimized with pre-filtering for large DBs)
        const albums = await new Promise((resolve, reject) => {
            db.all(`
                SELECT id, album_artist, album_title, album_year as year, label, 
                       quality_type as quality, organization_mode, catalog_number, 
                       processed_date as created_at
                FROM albums 
                WHERE album_artist IS NOT NULL OR album_title IS NOT NULL
                LIMIT 2000
            `, (err, rows) => {
                if (err) {reject(err);}
                else {resolve(rows || []);}
            });
        });
        
        db.close();
        
        // Perform fuzzy matching and ranking
        const rankedResults = rankSearchResults(albums, query.trim());
        
        // Filter results based on relevance
        let filteredResults = rankedResults.filter(item => {
            if (include_low_relevance === 'true') {return item.searchScore > 0.1;}
            return item.searchScore >= searchThreshold;
        });
        
        // Apply limit
        filteredResults = filteredResults.slice(0, safeLimit);
        
        const response = {
            query: query.trim(),
            results: filteredResults,
            total: filteredResults.length,
            totalScanned: albums.length,
            threshold: searchThreshold,
            performance: {
                queryTime: Date.now() - startTime,
                algorithmsUsed: ['levenshtein', 'fuzzy_matching', 'relevance_ranking'],
                cacheHit: false
            },
            suggestions: {
                tryLowerThreshold: filteredResults.length === 0 && searchThreshold > 0.3,
                includeLowRelevance: filteredResults.length < 5 && !include_low_relevance
            }
        };
        
        // Cache results for 5 minutes
        setCache(cacheKey, response);
        
        // Track search analytics (async)
        trackSearchQuery(
            query.trim(), 
            req.user?.id || null, 
            filteredResults.length, 
            'fuzzy', 
            Date.now() - startTime,
            req.ip || req.connection.remoteAddress,
            req.headers['user-agent']
        );
        
        res.json(response);
        
    } catch (error) {
        console.error('Fuzzy search error:', error);
        res.status(500).json({
            error: 'Search operation failed',
            code: 'SEARCH_ERROR',
            details: error.message
        });
    }
});

// Search suggestions API
app.get('/api/search/suggestions', (req, res) => {
    const { q: query, limit = 10 } = req.query;
    
    if (!query || query.trim().length < 1) {
        return res.json({ suggestions: [] });
    }
    
    const db = getDbSync();
    const queryTerm = `%${query.trim()}%`;
    
    // Get suggestions from different fields
    const suggestions = [];
    
    db.all(`
        SELECT DISTINCT album_artist as suggestion, 'artist' as type, COUNT(*) as count
        FROM albums 
        WHERE album_artist LIKE ? 
        GROUP BY album_artist 
        ORDER BY count DESC 
        LIMIT ?
    `, [queryTerm, Math.ceil(limit / 3)], (err, artists) => {
        if (!err && artists) {suggestions.push(...artists);}
        
        db.all(`
            SELECT DISTINCT album_title as suggestion, 'album' as type, COUNT(*) as count
            FROM albums 
            WHERE album_title LIKE ? 
            GROUP BY album_title 
            ORDER BY count DESC 
            LIMIT ?
        `, [queryTerm, Math.ceil(limit / 3)], (err, albums) => {
            if (!err && albums) {suggestions.push(...albums);}
            
            db.all(`
                SELECT DISTINCT label as suggestion, 'label' as type, COUNT(*) as count
                FROM albums 
                WHERE label LIKE ? 
                GROUP BY label 
                ORDER BY count DESC 
                LIMIT ?
            `, [queryTerm, Math.ceil(limit / 3)], (err, labels) => {
                db.close();
                
                if (!err && labels) {suggestions.push(...labels);}
                
                // Sort by relevance and limit
                const sortedSuggestions = suggestions
                    .sort((a, b) => b.count - a.count)
                    .slice(0, limit);
                
                res.json({
                    query: query.trim(),
                    suggestions: sortedSuggestions
                });
            });
        });
    });
});

// Popular queries and search analytics
app.get('/api/search/popular', (req, res) => {
    const { limit = 10, timeframe = '7d' } = req.query;
    const safeLimit = Math.min(parseInt(limit) || 10, 50);
    
    // Calculate timeframe
    let dateFilter = '';
    switch (timeframe) {
        case '1d':
            dateFilter = "AND timestamp >= datetime('now', '-1 day')";
            break;
        case '7d':
            dateFilter = "AND timestamp >= datetime('now', '-7 days')";
            break;
        case '30d':
            dateFilter = "AND timestamp >= datetime('now', '-30 days')";
            break;
        case 'all':
        default:
            dateFilter = '';
            break;
    }
    
    const db = getDbSync();
    
    db.all(`
        SELECT 
            query,
            COUNT(*) as search_count,
            AVG(result_count) as avg_results,
            AVG(response_time) as avg_response_time,
            MAX(timestamp) as last_searched
        FROM search_analytics 
        WHERE query IS NOT NULL ${dateFilter}
        GROUP BY query 
        ORDER BY search_count DESC, last_searched DESC
        LIMIT ?
    `, [safeLimit], (err, popularQueries) => {
        if (err) {
            db.close();
            console.error('Popular queries error:', err);
            return res.status(500).json({ error: 'Failed to fetch popular queries' });
        }
        
        // Get search statistics
        db.get(`
            SELECT 
                COUNT(*) as total_searches,
                COUNT(DISTINCT query) as unique_queries,
                AVG(result_count) as avg_results_per_search,
                AVG(response_time) as avg_response_time
            FROM search_analytics 
            WHERE query IS NOT NULL ${dateFilter}
        `, (err, stats) => {
            db.close();
            
            res.json({
                timeframe,
                popularQueries: popularQueries || [],
                statistics: stats || {
                    total_searches: 0,
                    unique_queries: 0,
                    avg_results_per_search: 0,
                    avg_response_time: 0
                }
            });
        });
    });
});

// Search analytics endpoint (admin only)
app.get('/api/search/analytics', authenticateToken, requireRole('admin'), (req, res) => {
    const { limit = 100, offset = 0 } = req.query;
    const safeLimit = Math.min(parseInt(limit) || 100, 500);
    const safeOffset = Math.max(parseInt(offset) || 0, 0);
    
    const db = getDbSync();
    
    db.all(`
        SELECT 
            s.query,
            s.result_count,
            s.search_type,
            s.response_time,
            s.timestamp,
            s.ip_address,
            u.username
        FROM search_analytics s
        LEFT JOIN users u ON s.user_id = u.id
        ORDER BY s.timestamp DESC
        LIMIT ? OFFSET ?
    `, [safeLimit, safeOffset], (err, searches) => {
        if (err) {
            db.close();
            console.error('Search analytics error:', err);
            return res.status(500).json({ error: 'Failed to fetch search analytics' });
        }
        
        // Get total count
        db.get('SELECT COUNT(*) as total FROM search_analytics', (err, countResult) => {
            db.close();
            
            res.json({
                searches: searches || [],
                total: countResult?.total || 0,
                limit: safeLimit,
                offset: safeOffset
            });
        });
    });
});

// Advanced Multi-Field Search with Filters
app.get('/api/search/advanced', async (req, res) => {
    const { 
        q: query, 
        artist, 
        album, 
        label, 
        year_min, 
        year_max, 
        quality, 
        organization_mode,
        limit = 50, 
        offset = 0,
        sort_by = 'relevance',
        sort_order = 'desc'
    } = req.query;
    
    const startTime = Date.now();
    const safeLimit = Math.min(parseInt(limit) || 50, 200);
    const safeOffset = Math.max(parseInt(offset) || 0, 0);
    
    // Build dynamic query with filters
    let sqlQuery = `
        SELECT id, album_artist, album_title, album_year as year, label, 
               quality_type as quality, organization_mode, catalog_number, 
               processed_date as created_at
        FROM albums WHERE 1=1
    `;
    const params = [];
    
    // Text search filters
    if (query && query.trim()) {
        sqlQuery += ` AND (
            album_artist LIKE ? OR 
            album_title LIKE ? OR 
            label LIKE ? OR 
            catalog_number LIKE ?
        )`;
        const searchTerm = `%${query.trim()}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    // Specific field filters
    if (artist && artist.trim()) {
        sqlQuery += ' AND album_artist LIKE ?';
        params.push(`%${artist.trim()}%`);
    }
    
    if (album && album.trim()) {
        sqlQuery += ' AND album_title LIKE ?';
        params.push(`%${album.trim()}%`);
    }
    
    if (label && label.trim()) {
        sqlQuery += ' AND label LIKE ?';
        params.push(`%${label.trim()}%`);
    }
    
    // Year range filter
    if (year_min && !isNaN(year_min)) {
        sqlQuery += ' AND album_year >= ?';
        params.push(parseInt(year_min));
    }
    
    if (year_max && !isNaN(year_max)) {
        sqlQuery += ' AND album_year <= ?';
        params.push(parseInt(year_max));
    }
    
    // Quality filter
    if (quality && ['Lossless', 'Lossy', 'Mixed'].includes(quality)) {
        sqlQuery += ' AND quality_type = ?';
        params.push(quality);
    }
    
    // Organization mode filter
    if (organization_mode) {
        sqlQuery += ' AND organization_mode = ?';
        params.push(organization_mode);
    }
    
    // Sorting
    let orderBy = 'processed_date DESC';
    switch (sort_by) {
        case 'artist':
            orderBy = `album_artist ${sort_order.toUpperCase()}, album_title ASC`;
            break;
        case 'album':
            orderBy = `album_title ${sort_order.toUpperCase()}, album_artist ASC`;
            break;
        case 'year':
            orderBy = `album_year ${sort_order.toUpperCase()}, album_artist ASC`;
            break;
        case 'label':
            orderBy = `label ${sort_order.toUpperCase()}, album_artist ASC`;
            break;
        case 'date_added':
            orderBy = `processed_date ${sort_order.toUpperCase()}`;
            break;
        case 'relevance':
        default:
            if (query && query.trim()) {
                // Use relevance scoring when there's a search query
                orderBy = 'processed_date DESC'; // Will be overridden by fuzzy ranking
            } else {
                orderBy = 'processed_date DESC';
            }
            break;
    }
    
    sqlQuery += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    params.push(safeLimit, safeOffset);
    
    try {
        const db = getDbSync();
        
        const results = await new Promise((resolve, reject) => {
            db.all(sqlQuery, params, (err, rows) => {
                if (err) {reject(err);}
                else {resolve(rows || []);}
            });
        });
        
        // Get total count with same filters (without LIMIT/OFFSET)
        const countQuery = sqlQuery.replace(/ORDER BY.*$/, '').replace(/LIMIT.*$/, '');
        const countParams = params.slice(0, -2); // Remove limit and offset params
        
        const totalCount = await new Promise((resolve, reject) => {
            db.get(countQuery.replace(/SELECT.*?FROM/, 'SELECT COUNT(*) as total FROM'), countParams, (err, row) => {
                if (err) {reject(err);}
                else {resolve(row?.total || 0);}
            });
        });
        
        db.close();
        
        // Apply fuzzy ranking if there's a search query
        let finalResults = results;
        if (query && query.trim() && sort_by === 'relevance') {
            finalResults = rankSearchResults(results, query.trim());
        }
        
        const response = {
            query: query?.trim() || '',
            filters: {
                artist: artist?.trim() || '',
                album: album?.trim() || '',
                label: label?.trim() || '',
                year_min: year_min ? parseInt(year_min) : null,
                year_max: year_max ? parseInt(year_max) : null,
                quality,
                organization_mode
            },
            results: finalResults,
            total: totalCount,
            limit: safeLimit,
            offset: safeOffset,
            sort_by,
            sort_order,
            performance: {
                queryTime: Date.now() - startTime,
                sqlQuery: sqlQuery.substring(0, 100) + '...',
                cacheHit: false
            }
        };
        
        // Track search analytics
        trackSearchQuery(
            JSON.stringify({
                query: query?.trim() || '',
                filters: response.filters
            }),
            req.user?.id || null,
            finalResults.length,
            'advanced',
            Date.now() - startTime,
            req.ip || req.connection.remoteAddress,
            req.headers['user-agent']
        );
        
        res.json(response);
        
    } catch (error) {
        console.error('Advanced search error:', error);
        res.status(500).json({
            error: 'Advanced search operation failed',
            code: 'ADVANCED_SEARCH_ERROR',
            details: error.message
        });
    }
});

// Search facets for filter UI
app.get('/api/search/facets', (req, res) => {
    const db = getDbSync();
    const facets = {};
    
    // Get quality distribution
    db.all(`
        SELECT quality_type as quality, COUNT(*) as count 
        FROM albums 
        WHERE quality_type IS NOT NULL 
        GROUP BY quality_type 
        ORDER BY count DESC
    `, (err, qualityFacets) => {
        if (!err && qualityFacets) {facets.quality = qualityFacets;}
        
        // Get organization modes
        db.all(`
            SELECT organization_mode, COUNT(*) as count 
            FROM albums 
            WHERE organization_mode IS NOT NULL 
            GROUP BY organization_mode 
            ORDER BY count DESC
        `, (err, modeFacets) => {
            if (!err && modeFacets) {facets.organization_mode = modeFacets;}
            
            // Get year range
            db.get(`
                SELECT 
                    MIN(album_year) as min_year,
                    MAX(album_year) as max_year,
                    COUNT(DISTINCT album_year) as unique_years
                FROM albums 
                WHERE album_year IS NOT NULL AND album_year > 1900
            `, (err, yearStats) => {
                if (!err && yearStats) {facets.year_range = yearStats;}
                
                // Get top labels
                db.all(`
                    SELECT label, COUNT(*) as count 
                    FROM albums 
                    WHERE label IS NOT NULL 
                    GROUP BY label 
                    ORDER BY count DESC 
                    LIMIT 20
                `, (err, labelFacets) => {
                    db.close();
                    
                    if (!err && labelFacets) {facets.top_labels = labelFacets;}
                    
                    res.json({
                        facets,
                        generated_at: new Date().toISOString()
                    });
                });
            });
        });
    });
});

// Send periodic stats updates to subscribers
setInterval(async () => {
    if (clients.size === 0) {return;}
    
    try {
        // Get quick stats for real-time updates
        const db = getDbSync();
        db.get('SELECT COUNT(*) as albums FROM albums', (err, albumRow) => {
            if (err) {return;}
            
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
    legacyHeaders: false
});

// Health check has higher limits for monitoring
const healthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Allow many health checks for monitoring systems
    standardHeaders: true,
    legacyHeaders: false
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

// Security Headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
            scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
            scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", 'ws:', 'wss:'],
            fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
            upgradeInsecureRequests: null // Disable HTTPS upgrade for local development
        }
    },
    crossOriginEmbedderPolicy: false, // Allow for local development
    crossOriginOpenerPolicy: false,   // Fix COOP header warning
    originAgentCluster: false,        // Disable Origin-Agent-Cluster header from helmet
    hsts: false                       // Disable HSTS for local HTTP development
}));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Enhanced CORS handling with security considerations
app.use((req, res, next) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'];
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin || '*');
    }
    
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // Fix Origin-Agent-Cluster header consistency
    res.header('Origin-Agent-Cluster', '?0');
    
    // Add cache-busting headers for development
    if (NODE_ENV !== 'production') {
        res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.header('Pragma', 'no-cache');
        res.header('Expires', '0');
    }
    
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Apply rate limiting to API routes (exclude export which has its own limiter)
app.use('/api/', (req, res, next) => {
    if (req.path === '/export' || req.path === '/health') {
        return next(); // Skip general limiter for export and health
    }
    return limiter(req, res, next);
});

// Connection pooling for better concurrent performance
class DatabasePool {
    constructor(path, maxConnections = 10) {
        this.path = path;
        this.maxConnections = maxConnections;
        this.pool = [];
        this.inUse = new Set();
        this.waitQueue = [];
    }
    
    getConnection() {
        return new Promise((resolve, reject) => {
            // Reuse available connection
            if (this.pool.length > 0) {
                const conn = this.pool.pop();
                this.inUse.add(conn);
                return resolve(conn);
            }
            
            // Create new connection if under limit
            if (this.inUse.size < this.maxConnections) {
                const conn = new sqlite3.Database(this.path, sqlite3.OPEN_READONLY, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        this.inUse.add(conn);
                        resolve(conn);
                    }
                });
            } else {
                // Queue request if at max connections
                this.waitQueue.push({ resolve, reject });
            }
        });
    }
    
    releaseConnection(conn) {
        this.inUse.delete(conn);
        
        if (this.waitQueue.length > 0) {
            const { resolve } = this.waitQueue.shift();
            this.inUse.add(conn);
            resolve(conn);
        } else {
            this.pool.push(conn);
        }
    }
    
    close() {
        [...this.pool, ...this.inUse].forEach(conn => {
            try {
                conn.close();
            } catch (err) {
                console.warn('Error closing connection:', err.message);
            }
        });
        this.pool.length = 0;
        this.inUse.clear();
        
        // Reject any waiting requests
        this.waitQueue.forEach(({ reject }) => {
            reject(new Error('Database pool closing'));
        });
        this.waitQueue.length = 0;
    }
}

// Initialize connection pool
const dbPool = new DatabasePool(DB_PATH, 10);

// Database connection helper with connection pooling
async function getDb() {
    return await dbPool.getConnection();
}

// Legacy sync version (for backward compatibility)
function getDbSync() {
    return new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.error('Error opening database:', err);
        }
    });
}

// Helper for releasing database connections
function releaseDb(db) {
    if (dbPool) {
        dbPool.releaseConnection(db);
    } else {
        db.close();
    }
}

// Authentication and User Management Functions
function initializeUserDatabase() {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
        if (err) {
            console.error('Error opening database for user initialization:', err);
            return;
        }
    });
    
    console.log('🔐 Initializing user authentication system...');
    
    const userTables = [
        `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME,
            is_active BOOLEAN DEFAULT 1,
            failed_login_attempts INTEGER DEFAULT 0,
            locked_until DATETIME
        )`,
        
        `CREATE TABLE IF NOT EXISTS user_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            user_agent TEXT,
            ip_address TEXT,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`,
        
        `CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            resource TEXT,
            ip_address TEXT,
            user_agent TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            details TEXT,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`,
        
        // Indexes for performance
        'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
        'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
        'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',
        'CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash)',
        'CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)',
        
        // Search analytics table
        `CREATE TABLE IF NOT EXISTS search_analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query TEXT NOT NULL,
            user_id INTEGER,
            result_count INTEGER DEFAULT 0,
            search_type TEXT DEFAULT 'fuzzy',
            response_time INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            ip_address TEXT,
            user_agent TEXT,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`,
        
        'CREATE INDEX IF NOT EXISTS idx_search_query ON search_analytics(query)',
        'CREATE INDEX IF NOT EXISTS idx_search_timestamp ON search_analytics(timestamp)',
        'CREATE INDEX IF NOT EXISTS idx_search_user ON search_analytics(user_id)'
    ];
    
    let tablesCreated = 0;
    let tableErrors = 0;
    
    const createNextTable = (i) => {
        if (i >= userTables.length) {
            db.close();
            console.log(`✅ User database complete: ${tablesCreated} created, ${tableErrors} errors`);
            
            // Create default admin user if none exists
            createDefaultAdminUser();
            return;
        }
        
        db.run(userTables[i], (err) => {
            if (err) {
                console.warn(`⚠️ User table creation failed: ${err.message}`);
                tableErrors++;
            } else {
                tablesCreated++;
            }
            createNextTable(i + 1);
        });
    };
    
    createNextTable(0);
}

// Create default admin user if none exists
async function createDefaultAdminUser() {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE);
    
    db.get('SELECT COUNT(*) as count FROM users WHERE role = ?', ['admin'], async (err, row) => {
        if (err || row.count > 0) {
            db.close();
            return;
        }
        
        // Create default admin user
        const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'ordr-fm-admin-change-me';
        const passwordHash = await bcrypt.hash(defaultPassword, BCRYPT_ROUNDS);
        
        db.run(
            'INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, ?)',
            ['admin', passwordHash, 'admin', 1],
            function(err) {
                db.close();
                if (err) {
                    console.error('Failed to create default admin user:', err.message);
                } else {
                    console.log('🔐 Created default admin user (username: admin)');
                    if (defaultPassword === 'ordr-fm-admin-change-me') {
                        console.warn('⚠️  WARNING: Using default admin password! Change it immediately.');
                    }
                    
                    // Log admin user creation
                    logAuditEvent(this.lastID, 'user_created', 'users', '127.0.0.1', 'system', {
                        username: 'admin',
                        role: 'admin',
                        created_by: 'system'
                    });
                }
            }
        );
    });
}

// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
        return res.status(401).json({ 
            error: 'Access denied. No token provided.',
            code: 'NO_TOKEN'
        });
    }
    
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ 
                error: 'Invalid or expired token.',
                code: 'INVALID_TOKEN'
            });
        }
        
        // Check if user is active and not locked
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
        db.get(
            'SELECT id, username, role, is_active, locked_until FROM users WHERE id = ?',
            [decoded.userId],
            (err, user) => {
                db.close();
                
                if (err || !user) {
                    return res.status(403).json({ 
                        error: 'User not found.',
                        code: 'USER_NOT_FOUND'
                    });
                }
                
                if (!user.is_active) {
                    return res.status(403).json({ 
                        error: 'Account is disabled.',
                        code: 'ACCOUNT_DISABLED'
                    });
                }
                
                if (user.locked_until && new Date(user.locked_until) > new Date()) {
                    return res.status(403).json({ 
                        error: 'Account is temporarily locked.',
                        code: 'ACCOUNT_LOCKED'
                    });
                }
                
                req.user = user;
                next();
            }
        );
    });
}

// Role-based access control middleware
function requireRole(role) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        
        if (req.user.role !== role && req.user.role !== 'admin') {
            return res.status(403).json({ 
                error: `Access denied. ${role} role required.`,
                code: 'INSUFFICIENT_PRIVILEGES'
            });
        }
        
        next();
    };
}

// Audit logging function
function logAuditEvent(userId, action, resource, ipAddress, userAgent, details = {}) {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE);
    
    db.run(
        'INSERT INTO audit_log (user_id, action, resource, ip_address, user_agent, details) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, action, resource, ipAddress, userAgent, JSON.stringify(details)],
        (err) => {
            db.close();
            if (err) {
                console.error('Audit log error:', err.message);
            }
        }
    );
}

// Performance optimization: Create database indexes for frequently queried columns
function createPerformanceIndexes() {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
        if (err) {
            console.error('Error opening database for indexing:', err);
            return;
        }
    });
    
    console.log('🚀 Creating performance indexes for large music collections...');
    
    const indexes = [
        // Primary search indexes (corrected column names)
        'CREATE INDEX IF NOT EXISTS idx_albums_artist_v2 ON albums(album_artist)',
        'CREATE INDEX IF NOT EXISTS idx_albums_label_v2 ON albums(label)',
        'CREATE INDEX IF NOT EXISTS idx_albums_quality_v2 ON albums(quality_type)',
        'CREATE INDEX IF NOT EXISTS idx_albums_mode_v2 ON albums(organization_mode)',
        
        // Composite indexes for common filter combinations
        'CREATE INDEX IF NOT EXISTS idx_albums_artist_label_v2 ON albums(album_artist, label)',
        'CREATE INDEX IF NOT EXISTS idx_albums_quality_mode_v2 ON albums(quality_type, organization_mode)',
        
        // Sorting and pagination indexes (corrected column names)
        'CREATE INDEX IF NOT EXISTS idx_albums_processed_date ON albums(processed_date)',
        'CREATE INDEX IF NOT EXISTS idx_albums_id_v2 ON albums(id)',
        
        // Additional performance indexes (corrected column names)
        'CREATE INDEX IF NOT EXISTS idx_albums_album_year ON albums(album_year)',
        'CREATE INDEX IF NOT EXISTS idx_albums_catalog_v2 ON albums(catalog_number)',
        'CREATE INDEX IF NOT EXISTS idx_albums_directory ON albums(directory_path)',
        'CREATE INDEX IF NOT EXISTS idx_albums_discogs ON albums(discogs_release_id)'
    ];
    
    let indexesCreated = 0;
    let indexErrors = 0;
    
    const createNextIndex = (i) => {
        if (i >= indexes.length) {
            db.close();
            console.log(`✅ Performance indexes complete: ${indexesCreated} created, ${indexErrors} errors`);
            return;
        }
        
        db.run(indexes[i], (err) => {
            if (err) {
                console.warn(`⚠️ Index creation failed: ${err.message}`);
                indexErrors++;
            } else {
                indexesCreated++;
            }
            createNextIndex(i + 1);
        });
    };
    
    createNextIndex(0);
}

// Authentication API Routes
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required.' });
    }
    
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE);
    
    db.get(
        'SELECT * FROM users WHERE username = ? AND is_active = 1',
        [username],
        async (err, user) => {
            if (err) {
                db.close();
                console.error('Database error during login:', err);
                return res.status(500).json({ error: 'Internal server error.' });
            }
            
            if (!user) {
                db.close();
                logAuditEvent(null, 'login_failed', 'auth', ip, userAgent, { username, reason: 'user_not_found' });
                return res.status(401).json({ error: 'Invalid credentials.' });
            }
            
            // Check if account is locked
            if (user.locked_until && new Date(user.locked_until) > new Date()) {
                db.close();
                logAuditEvent(user.id, 'login_failed', 'auth', ip, userAgent, { username, reason: 'account_locked' });
                return res.status(423).json({ error: 'Account is temporarily locked.' });
            }
            
            // Check password
            const passwordMatch = await bcrypt.compare(password, user.password_hash);
            
            if (!passwordMatch) {
                // Increment failed login attempts
                const newFailedAttempts = user.failed_login_attempts + 1;
                let lockUntil = null;
                
                // Lock account after 5 failed attempts for 15 minutes
                if (newFailedAttempts >= 5) {
                    lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
                }
                
                db.run(
                    'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
                    [newFailedAttempts, lockUntil, user.id],
                    () => {
                        db.close();
                        logAuditEvent(user.id, 'login_failed', 'auth', ip, userAgent, { 
                            username, 
                            reason: 'wrong_password',
                            failed_attempts: newFailedAttempts
                        });
                        
                        if (lockUntil) {
                            return res.status(423).json({ error: 'Too many failed attempts. Account locked for 15 minutes.' });
                        } else {
                            return res.status(401).json({ error: 'Invalid credentials.' });
                        }
                    }
                );
                return;
            }
            
            // Successful login - reset failed attempts and update last login
            db.run(
                'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login = CURRENT_TIMESTAMP WHERE id = ?',
                [user.id],
                (err) => {
                    if (err) {
                        db.close();
                        console.error('Error updating user login info:', err);
                        return res.status(500).json({ error: 'Internal server error.' });
                    }
                    
                    // Generate JWT token
                    const token = jwt.sign(
                        { 
                            userId: user.id, 
                            username: user.username, 
                            role: user.role 
                        },
                        JWT_SECRET,
                        { expiresIn: JWT_EXPIRES_IN }
                    );
                    
                    // Store session
                    const tokenHash = bcrypt.hashSync(token, 10);
                    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
                    
                    db.run(
                        'INSERT INTO user_sessions (user_id, token_hash, expires_at, user_agent, ip_address) VALUES (?, ?, ?, ?, ?)',
                        [user.id, tokenHash, expiresAt, userAgent, ip],
                        function(sessionErr) {
                            db.close();
                            
                            if (sessionErr) {
                                console.error('Error creating session:', sessionErr);
                                // Continue anyway, just log the error
                            }
                            
                            logAuditEvent(user.id, 'login_success', 'auth', ip, userAgent, { username });
                            
                            res.json({
                                token,
                                user: {
                                    id: user.id,
                                    username: user.username,
                                    email: user.email,
                                    role: user.role,
                                    last_login: user.last_login
                                },
                                expires_in: JWT_EXPIRES_IN
                            });
                        }
                    );
                }
            );
        }
    );
});

app.post('/api/auth/logout', authenticateToken, (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (token) {
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE);
        const tokenHash = bcrypt.hashSync(token, 10);
        
        db.run('DELETE FROM user_sessions WHERE token_hash = ?', [tokenHash], () => {
            db.close();
        });
    }
    
    logAuditEvent(req.user.id, 'logout', 'auth', req.ip, req.headers['user-agent'], {
        username: req.user.username
    });
    
    res.json({ message: 'Logged out successfully' });
});

app.get('/api/auth/profile', authenticateToken, (req, res) => {
    res.json({
        user: {
            id: req.user.id,
            username: req.user.username,
            role: req.user.role
        }
    });
});

// User Management API (Admin only)
app.get('/api/users', authenticateToken, requireRole('admin'), (req, res) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
    
    db.all(
        'SELECT id, username, email, role, created_at, last_login, is_active FROM users ORDER BY created_at DESC',
        (err, users) => {
            db.close();
            
            if (err) {
                console.error('Error fetching users:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            res.json({ users });
        }
    );
});

app.post('/api/users', authenticateToken, requireRole('admin'), async (req, res) => {
    const { username, email, password, role = 'user' } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    
    if (!['admin', 'user'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role. Must be admin or user' });
    }
    
    try {
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE);
        
        db.run(
            'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
            [username, email, passwordHash, role],
            function(err) {
                db.close();
                
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(409).json({ error: 'Username or email already exists' });
                    }
                    console.error('Error creating user:', err);
                    return res.status(500).json({ error: 'Database error' });
                }
                
                logAuditEvent(req.user.id, 'user_created', 'users', req.ip, req.headers['user-agent'], {
                    created_username: username,
                    created_role: role,
                    created_by: req.user.username
                });
                
                res.status(201).json({ 
                    message: 'User created successfully',
                    userId: this.lastID 
                });
            }
        );
    } catch (err) {
        console.error('Error hashing password:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API Routes

// Get overall statistics
// Optimized stats endpoint with caching
app.get('/api/stats', (req, res) => {
    const cacheKey = 'stats:all';
    const cached = getCache(cacheKey);
    
    if (cached) {
        return res.json(cached);
    }
    
    const db = getDbSync();
    
    // Use a single optimized query instead of multiple nested queries
    const query = `
        SELECT 
            (SELECT COUNT(*) FROM albums) as totalAlbums,
            (SELECT COUNT(*) FROM tracks) as totalTracks,
            (SELECT COUNT(DISTINCT album_artist) FROM albums WHERE album_artist IS NOT NULL) as totalArtists,
            (SELECT COUNT(DISTINCT label) FROM albums WHERE label IS NOT NULL) as totalLabels
    `;
    
    db.get(query, (err, mainStats) => {
        if (err) {
            console.error('Error getting stats:', err);
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Get quality distribution
        db.all('SELECT quality_type as quality, COUNT(*) as count FROM albums GROUP BY quality_type', (err, qualityRows) => {
            if (err) {
                console.error('Error getting quality distribution:', err);
                db.close();
                return res.status(500).json({ error: 'Database error' });
            }
            
            // Get organization mode distribution
            db.all('SELECT organization_mode, COUNT(*) as count FROM albums GROUP BY organization_mode', (err, modeRows) => {
                db.close();
                
                if (err) {
                    console.error('Error getting organization modes:', err);
                    return res.status(500).json({ error: 'Database error' });
                }
                
                // Build response object
                const stats = {
                    totalAlbums: mainStats?.totalAlbums || 0,
                    totalTracks: mainStats?.totalTracks || 0,
                    totalArtists: mainStats?.totalArtists || 0,
                    totalLabels: mainStats?.totalLabels || 0,
                    qualityDistribution: {},
                    organizationModes: {}
                };
                
                // Process quality distribution
                if (qualityRows) {
                    qualityRows.forEach(row => {
                        stats.qualityDistribution[row.quality || 'Unknown'] = row.count;
                    });
                }
                
                // Process organization modes
                if (modeRows) {
                    modeRows.forEach(row => {
                        stats.organizationModes[row.organization_mode || 'artist'] = row.count;
                    });
                }
                
                // Cache the results
                setCache(cacheKey, stats);
                
                res.json(stats);
            });
        });
    });
});

// Get albums with filtering (performance optimized with caching and indexing)
app.get('/api/albums', async (req, res) => {
    const startTime = Date.now();
    const { limit = 50, offset = 0, artist, label, quality, mode } = req.query;
    
    // Validate and limit parameters for performance
    const safeLimit = Math.min(parseInt(limit) || 50, 200); // Max 200 per request
    const safeOffset = Math.max(parseInt(offset) || 0, 0);
    
    // Create cache key based on query parameters
    const cacheKey = getCacheKey('albums', { limit: safeLimit, offset: safeOffset, artist, label, quality, mode });
    const cached = getCache(cacheKey);
    
    if (cached) {
        // Add cache hit performance info
        cached.performance = { ...cached.performance, cacheHit: true, queryTime: Date.now() - startTime };
        return res.json(cached);
    }
    
    let db;
    try {
        db = await getDb();
    } catch (err) {
        console.error('Failed to get database connection:', err);
        return res.status(500).json({ error: 'Database connection failed' });
    }
    
    // Build optimized query with proper indexing hints (corrected column names)
    let query = `
        SELECT id, album_artist, album_title, album_year as year, label, 
               quality_type as quality, 
               organization_mode, catalog_number, processed_date as created_at,
               processed_date as sort_date
        FROM albums 
        WHERE 1=1
    `;
    const params = [];
    
    // Add optimized filters with index usage
    if (artist) {
        query += ' AND (album_artist = ? OR album_artist LIKE ?)';
        params.push(artist, `%${artist}%`);
    }
    
    if (label) {
        query += ' AND label LIKE ?';
        params.push(`%${label}%`);
    }
    
    if (quality) {
        query += ' AND (quality_type = ? OR quality_type LIKE ?)';
        params.push(quality, `%${quality}%`);
    }
    
    if (mode) {
        query += ' AND organization_mode = ?';
        params.push(mode);
    }
    
    // Optimized ordering with computed sort_date
    query += ' ORDER BY sort_date DESC, id DESC LIMIT ? OFFSET ?';
    params.push(safeLimit, safeOffset);
    
    db.all(query, params, (err, albums) => {
        if (err) {
            console.error('Database error in /api/albums:', err.message);
            releaseDb(db);
            return res.status(500).json({ 
                error: 'Failed to fetch albums', 
                details: err.message,
                query: query.substring(0, 100) + '...'
            });
        }
        
        // Get total count for pagination (optimized with same filters)
        let countQuery = 'SELECT COUNT(*) as total FROM albums WHERE 1=1';
        const countParams = [];
        
        if (artist) {
            countQuery += ' AND (album_artist = ? OR album_artist LIKE ?)';
            countParams.push(artist, `%${artist}%`);
        }
        
        if (label) {
            countQuery += ' AND label LIKE ?';
            countParams.push(`%${label}%`);
        }
        
        if (quality) {
            countQuery += ' AND (quality_type = ? OR quality_type LIKE ?)';
            countParams.push(quality, `%${quality}%`);
        }
        
        if (mode) {
            countQuery += ' AND organization_mode = ?';
            countParams.push(mode);
        }
        
        db.get(countQuery, countParams, (countErr, countResult) => {
            releaseDb(db); // Return connection to pool
            const queryTime = Date.now() - startTime;
            
            if (countErr) {
                console.warn('Count query failed:', countErr.message);
                const result = { 
                    albums, 
                    total: albums.length,
                    limit: safeLimit,
                    offset: safeOffset,
                    performance: { 
                        queryTime, 
                        albumsReturned: albums.length, 
                        warning: 'Count unavailable',
                        cacheHit: false,
                        connectionPooled: true
                    }
                };
                
                // Cache partial results
                if (!safeOffset) {
                    setCache(cacheKey, result);
                }
                
                return res.json(result);
            }
            
            const result = { 
                albums, 
                total: countResult.total,
                limit: safeLimit,
                offset: safeOffset,
                performance: {
                    queryTime,
                    albumsReturned: albums.length,
                    totalInDb: countResult.total,
                    hasMore: countResult.total > (safeOffset + albums.length),
                    cacheHit: false,
                    connectionPooled: true
                }
            };
            
            // Cache the results (shorter TTL for paginated results)
            if (!safeOffset || safeOffset === 0) {
                setCache(cacheKey, result);
            }
            
            res.json(result);
        });
    });
});

// Get artist data including aliases
// Get all artists (optimized with caching)
app.get('/api/artists', (req, res) => {
    const cacheKey = 'artists:all';
    const cached = getCache(cacheKey);
    
    if (cached) {
        return res.json(cached);
    }
    
    const db = getDbSync();
    
    // Get all artists with their release counts - Fixed schema compatibility
    const artistQuery = `
        SELECT COALESCE(album_artist, artist) as name, 
               COUNT(*) as release_count,
               COUNT(DISTINCT label) as label_count
        FROM albums 
        WHERE COALESCE(album_artist, artist) IS NOT NULL
        GROUP BY COALESCE(album_artist, artist)
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
            
            if (err) {
                console.error('Error fetching artist aliases:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            const result = {
                artists: artists || [],
                aliases: aliases || []
            };
            
            // Cache the results
            setCache(cacheKey, result);
            
            res.json(result);
        });
    });
});

// Get label statistics (optimized with caching)
app.get('/api/labels', (req, res) => {
    const cacheKey = 'labels:all';
    const cached = getCache(cacheKey);
    
    if (cached) {
        return res.json(cached);
    }
    
    const db = getDbSync();
    
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
        
        const result = rows || [];
        
        // Cache the results
        setCache(cacheKey, result);
        
        res.json(result);
    });
});

// Get move history for undo functionality
app.get('/api/moves', (req, res) => {
    const db = getDbSync();
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
    const db = getDbSync();
    
    const query = `
        SELECT DATE(processed_date) as date,
               COUNT(*) as albums_processed,
               SUM(CASE WHEN quality_type = 'Lossless' THEN 1 ELSE 0 END) as lossless,
               SUM(CASE WHEN quality_type = 'Lossy' THEN 1 ELSE 0 END) as lossy,
               SUM(CASE WHEN quality_type = 'Mixed' THEN 1 ELSE 0 END) as mixed
        FROM albums
        WHERE processed_date IS NOT NULL
        GROUP BY DATE(processed_date)
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

// Metadata editing endpoints
// Get single album details for editing
app.get('/api/albums/:id', (req, res) => {
    const db = getDbSync();
    const albumId = parseInt(req.params.id);
    
    if (isNaN(albumId)) {
        return res.status(400).json({ error: 'Invalid album ID' });
    }
    
    db.get('SELECT * FROM albums WHERE id = ?', [albumId], (err, row) => {
        if (err) {
            console.error('Error fetching album:', err);
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!row) {
            db.close();
            return res.status(404).json({ error: 'Album not found' });
        }
        
        // Also get tracks for this album
        db.all('SELECT * FROM tracks WHERE album_id = ? ORDER BY disc_number, track_number', [albumId], (trackErr, tracks) => {
            db.close();
            
            if (trackErr) {
                console.error('Error fetching tracks:', trackErr);
                return res.status(500).json({ error: 'Database error' });
            }
            
            res.json({ 
                album: row, 
                tracks: tracks || [] 
            });
        });
    });
});

// Update album metadata
app.put('/api/albums/:id', (req, res) => {
    const db = getDbSync();
    const albumId = parseInt(req.params.id);
    const { album_artist, album_title, album_year, label, catalog_number, genre } = req.body;
    
    if (isNaN(albumId)) {
        return res.status(400).json({ error: 'Invalid album ID' });
    }
    
    // Validate required fields
    if (!album_artist || !album_title) {
        return res.status(400).json({ error: 'Album artist and title are required' });
    }
    
    const query = `
        UPDATE albums 
        SET album_artist = ?, album_title = ?, album_year = ?, 
            label = ?, catalog_number = ?, genre = ?
        WHERE id = ?
    `;
    
    db.run(query, [album_artist, album_title, album_year || null, label || null, 
                   catalog_number || null, genre || null, albumId], function(err) {
        if (err) {
            console.error('Error updating album:', err);
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (this.changes === 0) {
            db.close();
            return res.status(404).json({ error: 'Album not found' });
        }
        
        // Get the updated album data
        db.get('SELECT * FROM albums WHERE id = ?', [albumId], (fetchErr, row) => {
            db.close();
            
            if (fetchErr) {
                console.error('Error fetching updated album:', fetchErr);
                return res.status(500).json({ error: 'Database error' });
            }
            
            // Clear relevant caches when album data changes
            clearCache('stats');
            clearCache('albums');
            clearCache('artists');
            clearCache('labels');
            
            res.json(row);
        });
    });
});

// Update track metadata
app.put('/api/tracks/:id', (req, res) => {
    const db = getDbSync();
    const trackId = parseInt(req.params.id);
    const { title, artist, track_number, disc_number } = req.body;
    
    if (isNaN(trackId)) {
        return res.status(400).json({ error: 'Invalid track ID' });
    }
    
    const query = `
        UPDATE tracks 
        SET title = ?, artist = ?, track_number = ?, disc_number = ?
        WHERE id = ?
    `;
    
    db.run(query, [title || null, artist || null, track_number || null, 
                   disc_number || null, trackId], function(err) {
        if (err) {
            console.error('Error updating track:', err);
            db.close();
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (this.changes === 0) {
            db.close();
            return res.status(404).json({ error: 'Track not found' });
        }
        
        // Get the updated track data
        db.get('SELECT * FROM tracks WHERE id = ?', [trackId], (fetchErr, row) => {
            db.close();
            
            if (fetchErr) {
                console.error('Error fetching updated track:', fetchErr);
                return res.status(500).json({ error: 'Database error' });
            }
            
            res.json(row);
        });
    });
});

// Audio playback endpoints
// Serve audio files (with range support for streaming)
app.get('/api/audio/:albumId/:trackId', (req, res) => {
    const db = getDbSync();
    const albumId = parseInt(req.params.albumId);
    const trackId = parseInt(req.params.trackId);
    
    if (isNaN(albumId) || isNaN(trackId)) {
        return res.status(400).json({ error: 'Invalid album or track ID' });
    }
    
    // Get track file path
    db.get(`
        SELECT t.file_path, a.directory_path 
        FROM tracks t 
        JOIN albums a ON t.album_id = a.id 
        WHERE t.id = ? AND a.id = ?
    `, [trackId, albumId], (err, row) => {
        db.close();
        
        if (err) {
            console.error('Error fetching track:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!row) {
            return res.status(404).json({ error: 'Track not found' });
        }
        
        const filePath = row.file_path;
        
        // Check if file exists
        const fs = require('fs');
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Audio file not found on disk' });
        }
        
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;
        
        // Set content type based on file extension
        const path = require('path');
        const ext = path.extname(filePath).toLowerCase();
        const contentTypes = {
            '.mp3': 'audio/mpeg',
            '.m4a': 'audio/mp4',
            '.aac': 'audio/aac',
            '.flac': 'audio/flac',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg'
        };
        const contentType = contentTypes[ext] || 'audio/mpeg';
        
        if (range) {
            // Handle range requests for streaming
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            // Send entire file
            const head = {
                'Content-Length': fileSize,
                'Content-Type': contentType
            };
            res.writeHead(200, head);
            fs.createReadStream(filePath).pipe(res);
        }
    });
});

// Get waveform data for a track (placeholder - would need audio analysis)
app.get('/api/audio/:albumId/:trackId/waveform', (req, res) => {
    // For now, return mock waveform data
    // In production, this would analyze the audio file and return actual waveform data
    const mockWaveform = Array.from({ length: 200 }, (_, i) => Math.sin(i / 10) * 0.5 + Math.random() * 0.5);
    
    res.json({
        duration: 240, // 4 minutes in seconds
        sampleRate: 44100,
        waveform: mockWaveform
    });
});

// Backup management endpoints
// Get backup status and recent logs
app.get('/api/backup/status', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    
    try {
        // Check for running backup process
        const lockFile = '/tmp/ordr_fm_backup_gdrive.lock';
        const pidFile = '/tmp/ordr_fm_backup_gdrive.pid';
        
        let isRunning = false;
        let currentPid = null;
        
        if (fs.existsSync(lockFile) && fs.existsSync(pidFile)) {
            const pid = fs.readFileSync(pidFile, 'utf8').trim();
            try {
                process.kill(pid, 0); // Test if process is alive
                isRunning = true;
                currentPid = pid;
            } catch (e) {
                // Process is dead, cleanup stale files
                try {
                    fs.unlinkSync(lockFile);
                    fs.unlinkSync(pidFile);
                } catch (cleanupErr) {
                    console.warn('Failed to cleanup stale lock files:', cleanupErr);
                }
            }
        }
        
        // Get recent backup logs
        const backupLogPattern = /^backup_gdrive_\d{8}_\d{6}\.log$/;
        const logFiles = fs.readdirSync('../')
            .filter(file => backupLogPattern.test(file))
            .map(file => {
                const stat = fs.statSync(path.join('..', file));
                return {
                    filename: file,
                    modified: stat.mtime,
                    size: stat.size
                };
            })
            .sort((a, b) => b.modified - a.modified)
            .slice(0, 10);
        
        // Get last backup info if available
        let lastBackupInfo = null;
        if (logFiles.length > 0) {
            const lastLogPath = path.join('..', logFiles[0].filename);
            try {
                const lastLogLines = fs.readFileSync(lastLogPath, 'utf8').split('\n').slice(-20);
                lastBackupInfo = {
                    filename: logFiles[0].filename,
                    modified: logFiles[0].modified,
                    size: logFiles[0].size,
                    recentLines: lastLogLines.filter(line => line.trim())
                };
            } catch (logErr) {
                console.warn('Failed to read last backup log:', logErr);
            }
        }
        
        res.json({
            isRunning,
            currentPid,
            recentLogs: logFiles,
            lastBackup: lastBackupInfo
        });
        
    } catch (error) {
        console.error('Error getting backup status:', error);
        res.status(500).json({ error: 'Failed to get backup status' });
    }
});

// Start backup process
app.post('/api/backup/start', (req, res) => {
    const { spawn } = require('child_process');
    const path = require('path');
    
    try {
        // Check if backup is already running
        const fs = require('fs');
        const lockFile = '/tmp/ordr_fm_backup_gdrive.lock';
        
        if (fs.existsSync(lockFile)) {
            return res.status(409).json({ error: 'Backup already running' });
        }
        
        // Start backup process
        const backupScript = path.join('..', 'backup_to_gdrive.sh');
        const backupProcess = spawn('bash', [backupScript], {
            detached: true,
            stdio: 'ignore'
        });
        
        backupProcess.unref(); // Allow parent process to exit
        
        res.json({ 
            message: 'Backup started successfully',
            pid: backupProcess.pid
        });
        
    } catch (error) {
        console.error('Error starting backup:', error);
        res.status(500).json({ error: 'Failed to start backup: ' + error.message });
    }
});

// Get backup log content
app.get('/api/backup/logs/:filename', (req, res) => {
    const fs = require('fs');
    const path = require('path');
    
    const filename = req.params.filename;
    
    // Validate filename for security
    if (!/^backup_gdrive_\d{8}_\d{6}\.log$/.test(filename)) {
        return res.status(400).json({ error: 'Invalid log filename' });
    }
    
    try {
        const logPath = path.join('..', filename);
        
        if (!fs.existsSync(logPath)) {
            return res.status(404).json({ error: 'Log file not found' });
        }
        
        const content = fs.readFileSync(logPath, 'utf8');
        const lines = content.split('\n');
        
        // Get last 500 lines to avoid overwhelming the browser
        const recentLines = lines.slice(-500);
        
        res.json({
            filename,
            totalLines: lines.length,
            content: recentLines.join('\n'),
            isPartial: lines.length > 500
        });
        
    } catch (error) {
        console.error('Error reading backup log:', error);
        res.status(500).json({ error: 'Failed to read backup log' });
    }
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
        if (year) {query += ` year:${year}`;}
        if (label) {query += ` label:"${label}"`;}
        
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
    
    const db = getDbSync();
    
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
    const db = getDbSync(); // Use sync version for health endpoint
    
    const healthMetrics = {};
    
    // Quality distribution - Fixed schema compatibility
    db.get(`
        SELECT 
            COUNT(*) as total_albums,
            SUM(CASE WHEN COALESCE(quality_type, quality) = 'Lossless' THEN 1 ELSE 0 END) as lossless,
            SUM(CASE WHEN COALESCE(quality_type, quality) = 'Mixed' THEN 1 ELSE 0 END) as mixed,
            SUM(CASE WHEN COALESCE(quality_type, quality) = 'Lossy' THEN 1 ELSE 0 END) as lossy,
            0 as avg_tracks_per_album,
            COUNT(DISTINCT COALESCE(album_artist, artist)) as unique_artists,
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
            message: 'No duplicate analysis available. Run duplicate detection first.'
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
    const db = getDbSync();
    const insights = {};
    
    // Artist productivity analysis - Fixed schema compatibility
    db.all(`
        SELECT 
            COALESCE(album_artist, artist) as artist,
            COUNT(*) as release_count,
            MIN(year) as first_release,
            MAX(year) as latest_release,
            COUNT(DISTINCT year) as active_years,
            COUNT(DISTINCT label) as labels_worked_with,
            GROUP_CONCAT(DISTINCT label) as label_list,
            0 as avg_tracks_per_album
        FROM albums
        WHERE COALESCE(album_artist, artist) IS NOT NULL
        GROUP BY COALESCE(album_artist, artist)
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
                    SUM(CASE WHEN COALESCE(quality_type, quality) = 'Lossless' THEN 1 ELSE 0 END) as lossless_count
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
    const db = getDbSync();
    
    // Processing performance analysis
    db.all(`
        SELECT 
            DATE(processed_date) as date,
            COUNT(*) as albums_processed,
            0 as avg_duration_ms,
            0 as min_duration_ms,
            0 as max_duration_ms,
            COUNT(CASE WHEN discogs_confidence > 0 THEN 1 END) as discogs_enriched
        FROM albums
        WHERE processed_date IS NOT NULL
        GROUP BY DATE(processed_date)
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
    const db = getDbSync();
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
    const db = getDbSync();
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
        query += ' AND a.album_title LIKE ?';
        params.push(`%${album}%`);
    }
    
    if (artist) {
        query += ' AND a.album_artist LIKE ?';
        params.push(`%${artist}%`);
    }
    
    if (label) {
        query += ' AND a.label LIKE ?';
        params.push(`%${label}%`);
    }
    
    if (year_from) {
        query += ' AND a.year >= ?';
        params.push(parseInt(year_from));
    }
    
    if (year_to) {
        query += ' AND a.year <= ?';
        params.push(parseInt(year_to));
    }
    
    if (quality) {
        query += ' AND COALESCE(a.quality_type, a.quality) = ?';
        params.push(quality);
    }
    
    if (org_mode) {
        query += ' AND a.organization_mode = ?';
        params.push(org_mode);
    }
    
    // Add ordering and pagination
    query += ' ORDER BY a.id DESC LIMIT ? OFFSET ?';
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
            countQuery += ' AND a.album_title LIKE ?';
            countParams.push(`%${album}%`);
        }
        
        if (artist) {
            countQuery += ' AND a.album_artist LIKE ?';
            countParams.push(`%${artist}%`);
        }
        
        if (label) {
            countQuery += ' AND a.label LIKE ?';
            countParams.push(`%${label}%`);
        }
        
        if (year_from) {
            countQuery += ' AND a.year >= ?';
            countParams.push(parseInt(year_from));
        }
        
        if (year_to) {
            countQuery += ' AND a.year <= ?';
            countParams.push(parseInt(year_to));
        }
        
        if (quality) {
            countQuery += ' AND COALESCE(a.quality_type, a.quality) = ?';
            countParams.push(quality);
        }
        
        if (org_mode) {
            countQuery += ' AND a.organization_mode = ?';
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
        const db = getDbSync();
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
    
    const db = getDbSync();
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
    
    const db = getDbSync();
    
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
            const parts = range.replace(/bytes=/, '').split('-');
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
    const db = getDbSync();
    
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
    const db = getDbSync();
    
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
    // Initialize performance indexes on startup for large music collections
    createPerformanceIndexes();
    
    // Initialize user authentication system
    initializeUserDatabase();
    
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
        if (localIP !== 'localhost') {break;}
    }
    
    console.log('🎵 ordr.fm visualization server running on:');
    console.log(`   • Local:    http://localhost:${PORT}`);
    console.log(`   • Network:  http://${localIP}:${PORT}`);
    console.log('🔌 WebSocket server ready for real-time updates');
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

// Start music processing with real-time progress tracking (requires authentication)
app.post('/api/actions/process', authenticateToken, (req, res) => {
    const { sourceDirectory, dryRun = true, enableDiscogs = true, electronicMode = false } = req.body;
    
    if (!sourceDirectory) {
        return res.status(400).json({ error: 'Source directory is required' });
    }
    
    // 🔒 Security: Validate source directory to prevent command injection
    if (!/^[a-zA-Z0-9\s\/\.\-\_]+$/.test(sourceDirectory)) {
        return res.status(400).json({ 
            error: 'Invalid characters in source directory. Only alphanumeric characters, spaces, forward slashes, dots, hyphens, and underscores are allowed.' 
        });
    }
    
    // Additional security: Check if path exists and is a directory
    if (!fs.existsSync(sourceDirectory) || !fs.statSync(sourceDirectory).isDirectory()) {
        return res.status(400).json({ error: 'Source directory does not exist or is not a directory' });
    }
    
    // Count total items for progress tracking
    let totalItems = 0;
    try {
        const items = fs.readdirSync(sourceDirectory, { withFileTypes: true });
        totalItems = items.filter(item => item.isDirectory()).length; // Album directories
    } catch (err) {
        console.warn('Could not count directories for progress tracking:', err.message);
    }
    
    // Create progress tracking job
    const jobId = createJob('music_processing', totalItems, {
        sourceDirectory,
        dryRun,
        enableDiscogs,
        electronicMode
    });
    
    // Build command arguments securely using array-based spawn
    const args = ['../ordr.fm.sh', '--source', sourceDirectory];
    if (!dryRun) {
        args.push('--move');
    }
    if (enableDiscogs) {
        args.push('--discogs');
    }
    if (electronicMode) {
        args.push('--enable-electronic');
    }
    
    console.log('Starting processing with args:', args);
    
    // Execute the command securely without shell interpolation
    const { spawn } = require('child_process');
    const process = spawn('bash', args, {
        cwd: '..',  // Change working directory to parent
        stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let output = '';
    let errorOutput = '';
    let processedItems = 0;
    
    // Update job status to running
    updateJobProgress(jobId, 0, 'running', { pid: process.pid });
    
    process.stdout.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        
        // Parse progress from output
        const albumMatches = chunk.match(/Processing album directory: (.+)/g);
        if (albumMatches) {
            processedItems += albumMatches.length;
            updateJobProgress(jobId, processedItems, 'running', { 
                currentAlbum: albumMatches[albumMatches.length - 1].replace('Processing album directory: ', '').trim()
            });
        }
        
        // Check for warnings and errors in output
        const warningMatches = chunk.match(/WARNING: (.+)/g);
        if (warningMatches) {
            warningMatches.forEach(warning => {
                addJobWarning(jobId, warning.replace('WARNING: ', '').trim());
            });
        }
        
        const errorMatches = chunk.match(/ERROR: (.+)/g);
        if (errorMatches) {
            errorMatches.forEach(error => {
                addJobError(jobId, error.replace('ERROR: ', '').trim());
            });
        }
        
        // Enhanced WebSocket broadcast with progress info
        broadcast({
            type: 'processing_update',
            data: {
                jobId,
                status: 'running',
                output: chunk,
                progress: totalItems > 0 ? Math.round((processedItems / totalItems) * 100) : 0,
                processedItems,
                totalItems,
                timestamp: new Date().toISOString()
            }
        }, 'processing');
    });
    
    process.stderr.on('data', (data) => {
        errorOutput += data.toString();
    });
    
    process.on('close', (code) => {
        const status = code === 0 ? 'completed' : 'failed';
        const result = {
            success: code === 0,
            exitCode: code,
            output: output,
            error: errorOutput,
            timestamp: new Date().toISOString(),
            finalProgress: processedItems,
            totalItems: totalItems
        };
        
        // Complete the job with appropriate status
        completeJob(jobId, status, {
            exitCode: code,
            processedAlbums: processedItems,
            totalAlbums: totalItems,
            hasErrors: errorOutput.length > 0,
            outputLength: output.length
        });
        
        // Enhanced completion broadcast
        broadcast({
            type: 'processing_complete',
            data: {
                ...result,
                jobId,
                status
            }
        }, 'processing');
        
        console.log(`Processing completed with exit code: ${code}, processed: ${processedItems}/${totalItems}`);
    });
    
    // Handle process errors
    process.on('error', (err) => {
        console.error('Process spawn error:', err);
        addJobError(jobId, `Process spawn error: ${err.message}`);
        completeJob(jobId, 'error', { spawnError: err.message });
        
        broadcast({
            type: 'processing_error',
            data: {
                jobId,
                error: err.message,
                timestamp: new Date().toISOString()
            }
        }, 'processing');
    });
    
    res.json({ 
        message: 'Processing started with real-time progress tracking', 
        jobId,
        command: `bash ${args.join(' ')}`,
        dryRun: dryRun,
        enableDiscogs: enableDiscogs,
        electronicMode: electronicMode,
        totalItems,
        progressTracking: true,
        timestamp: new Date().toISOString() 
    });
});

// Jobs API for progress tracking
app.get('/api/jobs/active', (req, res) => {
    res.json({
        activeJobs: Array.from(activeJobs.values()),
        count: activeJobs.size
    });
});

app.get('/api/jobs/history', (req, res) => {
    const { limit = 10 } = req.query;
    const limitNum = Math.min(parseInt(limit) || 10, 50);
    
    res.json({
        recentJobs: jobHistory.slice(-limitNum),
        count: jobHistory.length
    });
});

app.get('/api/jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    
    if (activeJobs.has(jobId)) {
        res.json({ job: activeJobs.get(jobId), active: true });
    } else {
        const historyJob = jobHistory.find(job => job.id === jobId);
        if (historyJob) {
            res.json({ job: historyJob, active: false });
        } else {
            res.status(404).json({ error: 'Job not found' });
        }
    }
});

app.post('/api/jobs/:jobId/cancel', (req, res) => {
    const { jobId } = req.params;
    
    if (activeJobs.has(jobId)) {
        const job = activeJobs.get(jobId);
        job.status = 'cancelled';
        job.cancelled = true;
        job.cancelledAt = new Date().toISOString();
        
        broadcastJobUpdate(job);
        res.json({ message: 'Job cancellation requested', jobId });
    } else {
        res.status(404).json({ error: 'Active job not found' });
    }
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
app.post('/api/actions/backup-database', authenticateToken, (req, res) => {
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
const activeBackups = new Map(); // Map<backupId, {process, target, startTime, pid}>
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
app.post('/api/actions/backup-cancel', authenticateToken, async (req, res) => {
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
app.post('/api/actions/backup-cloud', authenticateToken, requireRole('admin'), (req, res) => {
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
app.post('/api/actions/enhance-metadata', authenticateToken, (req, res) => {
    const { force = false } = req.body;
    const { spawn } = require('child_process');
    
    // Build command to re-process existing organized music with Discogs enhancement
    let command = 'cd .. && find "/home/plex/Music/sorted_music" -type d -name "*(*)" | head -10 | while read dir; do echo "Enhancing: $dir"; ./ordr.fm.sh --source "$dir" --discogs --move; done';
    
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
    const db = getDbSync();
    
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
    const db = getDbSync();
    
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
    
    const db = getDbSync();
    
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
                                        
                                        // Clear relevant caches after metadata update
                                        clearCache('stats');
                                        clearCache('albums');
                                        clearCache('artists');
                                        clearCache('labels');
                                        
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
                            
                            // Clear relevant caches after album metadata update
                            clearCache('stats');
                            clearCache('albums');
                            clearCache('artists');
                            clearCache('labels');
                            
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
async function initMetadataHistoryTable() {
    let db;
    try {
        db = await getDb();
        
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
                console.log('✅ Metadata history table initialized');
            }
            releaseDb(db);
        });
    } catch (err) {
        console.error('Failed to initialize metadata history table:', err);
        if (db) {releaseDb(db);}
    }
}

// Initialize the metadata history table on server start
setTimeout(() => {
    initMetadataHistoryTable();
}, 1000);

// Export broadcast function for external use (if needed)
module.exports = { broadcast };