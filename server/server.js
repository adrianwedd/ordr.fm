#!/usr/bin/env node

/**
 * ordr.fm Node.js Server
 * 
 * Provides REST API and WebSocket endpoints for music metadata visualization
 * and relationship mapping. Integrates with existing SQLite databases from
 * the bash-based ordr.fm system.
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

// Import our custom modules
const DatabaseManager = require('./lib/database');
const MusicBrainzClient = require('./lib/musicbrainz');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuration
const PORT = process.env.PORT || 3000;
const METADATA_DB = process.env.METADATA_DB || path.join(__dirname, '../ordr.fm.metadata.db');
const STATE_DB = process.env.STATE_DB || path.join(__dirname, '../ordr.fm.state.db');

// Initialize services
const dbManager = new DatabaseManager({
  metadataDb: METADATA_DB,
  stateDb: STATE_DB
});

const musicBrainzClient = new MusicBrainzClient({
  cacheDir: path.join(__dirname, 'cache/musicbrainz'),
  rateLimit: 1000 // 1 second between requests
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "https://d3js.org", "https://cdn.jsdelivr.net"],
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));
app.use(compression());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use('/static', express.static(path.join(__dirname, 'public')));

/**
 * Initialize database and services
 */
async function initializeServices() {
  try {
    // Initialize database
    await dbManager.initialize();
    
    // Check if database files exist
    if (!fs.existsSync(METADATA_DB)) {
      console.warn(`Warning: Metadata database not found at ${METADATA_DB}`);
      console.log('Run the bash script first to create the database, or use npm run seed');
    }

    console.log('All services initialized successfully');
    return true;
  } catch (err) {
    console.error('Service initialization failed:', err);
    throw err;
  }
}

/**
 * API Routes
 */

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    databases: {
      metadata: dbManager.metadataDb ? 'connected' : 'disconnected',
      state: dbManager.stateDb ? 'connected' : 'disconnected'
    },
    services: {
      musicbrainz: 'ready'
    }
  });
});

// Get all albums with relationships
app.get('/api/albums', (req, res) => {
  const { limit = 100, offset = 0, quality, genre, label, artist } = req.query;
  
  let query = `
    SELECT 
      a.*,
      COUNT(t.id) as actual_track_count,
      GROUP_CONCAT(DISTINCT t.format) as actual_formats
    FROM albums a
    LEFT JOIN tracks t ON a.id = t.album_id
    WHERE 1=1
  `;
  
  const params = [];
  
  if (quality) {
    query += ' AND a.quality_type = ?';
    params.push(quality);
  }
  
  if (genre) {
    query += ' AND a.genre LIKE ?';
    params.push(`%${genre}%`);
  }
  
  if (label) {
    query += ' AND a.label LIKE ?';
    params.push(`%${label}%`);
  }
  
  if (artist) {
    query += ' AND a.album_artist LIKE ?';
    params.push(`%${artist}%`);
  }
  
  query += `
    GROUP BY a.id
    ORDER BY a.processed_date DESC
    LIMIT ? OFFSET ?
  `;
  
  params.push(parseInt(limit), parseInt(offset));
  
  metadataDb.all(query, params, (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: 'Database error' });
      return;
    }
    
    res.json({
      albums: rows,
      total: rows.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  });
});

// Get artist relationships and aliases
app.get('/api/artists/relationships', (req, res) => {
  const query = `
    WITH artist_stats AS (
      SELECT 
        a.album_artist,
        COUNT(*) as album_count,
        GROUP_CONCAT(DISTINCT a.label) as labels,
        GROUP_CONCAT(DISTINCT a.genre) as genres,
        AVG(a.discogs_confidence) as avg_confidence
      FROM albums a
      WHERE a.album_artist IS NOT NULL
      GROUP BY a.album_artist
    ),
    alias_relationships AS (
      SELECT 
        aa.primary_artist,
        aa.alias_name,
        aa.confidence,
        aa.source
      FROM artist_aliases aa
    )
    SELECT 
      ast.*,
      ar.primary_artist,
      ar.alias_name,
      ar.confidence as alias_confidence,
      ar.source as alias_source
    FROM artist_stats ast
    LEFT JOIN alias_relationships ar ON ast.album_artist = ar.alias_name
    ORDER BY ast.album_count DESC
  `;
  
  metadataDb.all(query, [], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: 'Database error' });
      return;
    }
    
    // Transform data for visualization
    const artists = new Map();
    const relationships = [];
    
    rows.forEach(row => {
      const artistName = row.album_artist;
      
      if (!artists.has(artistName)) {
        artists.set(artistName, {
          id: artistName,
          name: artistName,
          albumCount: row.album_count,
          labels: row.labels ? row.labels.split(',') : [],
          genres: row.genres ? row.genres.split(',') : [],
          avgConfidence: row.avg_confidence,
          isPrimary: row.primary_artist === artistName,
          primaryArtist: row.primary_artist
        });
      }
      
      if (row.alias_name && row.primary_artist) {
        relationships.push({
          source: row.alias_name,
          target: row.primary_artist,
          type: 'alias',
          confidence: row.alias_confidence,
          source_type: row.alias_source
        });
      }
    });
    
    res.json({
      artists: Array.from(artists.values()),
      relationships: relationships
    });
  });
});

// Get label relationships
app.get('/api/labels/relationships', (req, res) => {
  const query = `
    SELECT 
      l.label_name,
      l.release_count,
      l.primary_genre,
      l.is_electronic,
      COUNT(a.id) as actual_releases,
      GROUP_CONCAT(DISTINCT a.album_artist) as artists,
      AVG(a.discogs_confidence) as avg_confidence
    FROM labels l
    LEFT JOIN albums a ON l.label_name = a.label
    GROUP BY l.id, l.label_name
    ORDER BY actual_releases DESC
  `;
  
  metadataDb.all(query, [], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: 'Database error' });
      return;
    }
    
    res.json({
      labels: rows.map(row => ({
        ...row,
        artists: row.artists ? row.artists.split(',') : []
      }))
    });
  });
});

// Get genre distribution and relationships
app.get('/api/genres/distribution', (req, res) => {
  const query = `
    SELECT 
      a.genre,
      a.quality_type,
      COUNT(*) as count,
      AVG(a.track_count) as avg_tracks,
      GROUP_CONCAT(DISTINCT a.label) as labels
    FROM albums a
    WHERE a.genre IS NOT NULL
    GROUP BY a.genre, a.quality_type
    ORDER BY count DESC
  `;
  
  metadataDb.all(query, [], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: 'Database error' });
      return;
    }
    
    res.json({ genres: rows });
  });
});

// Get visualization data for D3.js force graph
app.get('/api/visualization/network', (req, res) => {
  const { type = 'artist' } = req.query;
  
  let query;
  switch (type) {
    case 'label':
      query = `
        SELECT DISTINCT
          a.label as source,
          a.album_artist as target,
          COUNT(*) as weight,
          'artist-label' as relationship_type
        FROM albums a
        WHERE a.label IS NOT NULL AND a.album_artist IS NOT NULL
        GROUP BY a.label, a.album_artist
        HAVING weight > 0
        ORDER BY weight DESC
        LIMIT 200
      `;
      break;
      
    case 'genre':
      query = `
        SELECT DISTINCT
          a.genre as source,
          a.album_artist as target,
          COUNT(*) as weight,
          'artist-genre' as relationship_type
        FROM albums a
        WHERE a.genre IS NOT NULL AND a.album_artist IS NOT NULL
        GROUP BY a.genre, a.album_artist
        HAVING weight > 0
        ORDER BY weight DESC
        LIMIT 200
      `;
      break;
      
    default: // artist
      query = `
        SELECT DISTINCT
          aa.primary_artist as source,
          aa.alias_name as target,
          aa.confidence as weight,
          'alias' as relationship_type
        FROM artist_aliases aa
        UNION ALL
        SELECT DISTINCT
          a1.album_artist as source,
          a2.album_artist as target,
          1.0 as weight,
          'same-label' as relationship_type
        FROM albums a1
        JOIN albums a2 ON a1.label = a2.label 
        WHERE a1.album_artist != a2.album_artist
          AND a1.label IS NOT NULL
        GROUP BY a1.album_artist, a2.album_artist
        LIMIT 100
      `;
  }
  
  metadataDb.all(query, [], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      res.status(500).json({ error: 'Database error' });
      return;
    }
    
    // Create nodes and links for D3.js
    const nodeMap = new Map();
    const links = [];
    
    rows.forEach(row => {
      // Add source node
      if (!nodeMap.has(row.source)) {
        nodeMap.set(row.source, {
          id: row.source,
          name: row.source,
          type: type === 'label' ? 'label' : type === 'genre' ? 'genre' : 'artist',
          connections: 0
        });
      }
      
      // Add target node
      if (!nodeMap.has(row.target)) {
        nodeMap.set(row.target, {
          id: row.target,
          name: row.target,
          type: 'artist',
          connections: 0
        });
      }
      
      // Add link
      links.push({
        source: row.source,
        target: row.target,
        weight: row.weight,
        type: row.relationship_type
      });
      
      // Update connection counts
      nodeMap.get(row.source).connections++;
      nodeMap.get(row.target).connections++;
    });
    
    res.json({
      nodes: Array.from(nodeMap.values()),
      links: links
    });
  });
});

// Statistics endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await dbManager.getMBStatistics();
    res.json(stats);
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

/**
 * MusicBrainz API Endpoints
 */

// Search MusicBrainz for releases
app.get('/api/musicbrainz/search/releases', async (req, res) => {
  const { artist, title, year, limit = 10 } = req.query;
  
  if (!artist || !title) {
    return res.status(400).json({ error: 'Artist and title are required' });
  }

  try {
    const results = await musicBrainzClient.searchReleases(artist, title, { year, limit });
    res.json(results);
  } catch (err) {
    console.error('MusicBrainz search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get MusicBrainz release details
app.get('/api/musicbrainz/release/:mbid', async (req, res) => {
  const { mbid } = req.params;
  const { includes } = req.query;
  
  try {
    const includeList = includes ? includes.split(',') : ['artists', 'labels', 'recordings'];
    const release = await musicBrainzClient.getRelease(mbid, includeList);
    
    if (!release) {
      return res.status(404).json({ error: 'Release not found' });
    }
    
    res.json(release);
  } catch (err) {
    console.error('MusicBrainz release error:', err);
    res.status(500).json({ error: 'Failed to get release' });
  }
});

// Get MusicBrainz artist details
app.get('/api/musicbrainz/artist/:mbid', async (req, res) => {
  const { mbid } = req.params;
  const { includes } = req.query;
  
  try {
    const includeList = includes ? includes.split(',') : ['aliases', 'relationships'];
    const artist = await musicBrainzClient.getArtist(mbid, includeList);
    
    if (!artist) {
      return res.status(404).json({ error: 'Artist not found' });
    }
    
    res.json(artist);
  } catch (err) {
    console.error('MusicBrainz artist error:', err);
    res.status(500).json({ error: 'Failed to get artist' });
  }
});

// Enrich album with MusicBrainz data
app.post('/api/musicbrainz/enrich-album/:albumId', async (req, res) => {
  const { albumId } = req.params;
  
  try {
    // Get album data
    const album = await dbManager.get(
      'SELECT * FROM albums WHERE id = ?', 
      [albumId]
    );
    
    if (!album) {
      return res.status(404).json({ error: 'Album not found' });
    }

    // Enrich with MusicBrainz
    const mbData = await musicBrainzClient.enrichAlbumMetadata(album);
    
    if (!mbData) {
      return res.json({ success: false, message: 'No suitable MusicBrainz match found' });
    }

    // Store the enriched data
    await dbManager.beginTransaction();
    
    try {
      // Store MusicBrainz release
      await dbManager.storeMBRelease({
        id: mbData.musicbrainz_release_id,
        title: mbData.mb_title || album.album_title,
        date: mbData.date,
        country: mbData.country,
        barcode: mbData.barcode,
        status: mbData.status,
        packaging: mbData.packaging
      });

      // Store artist if available
      if (mbData.artist_mbid) {
        const artistData = await musicBrainzClient.getArtist(mbData.artist_mbid);
        if (artistData) {
          await dbManager.storeMBArtist(artistData);
          const relationships = musicBrainzClient.extractArtistRelationships(artistData);
          await dbManager.storeMBArtistRelationships(mbData.artist_mbid, relationships);
        }
      }

      // Create album mapping
      await dbManager.createAlbumMBMapping(
        albumId, 
        mbData.musicbrainz_release_id, 
        mbData.confidence, 
        'auto'
      );

      await dbManager.commitTransaction();
      
      res.json({
        success: true,
        mbid: mbData.musicbrainz_release_id,
        confidence: mbData.confidence,
        data: mbData
      });
      
      // Broadcast update to WebSocket clients
      broadcastUpdate('album_enriched');
      
    } catch (err) {
      await dbManager.rollbackTransaction();
      throw err;
    }
  } catch (err) {
    console.error('Album enrichment error:', err);
    res.status(500).json({ error: 'Enrichment failed' });
  }
});

// Batch enrich albums
app.post('/api/musicbrainz/batch-enrich', async (req, res) => {
  const { limit = 10 } = req.body;
  
  try {
    const unmappedAlbums = await dbManager.getUnmappedAlbums(limit);
    
    if (unmappedAlbums.length === 0) {
      return res.json({ message: 'No albums need enrichment', processed: 0 });
    }

    let processed = 0;
    let successful = 0;
    
    for (const album of unmappedAlbums) {
      try {
        const mbData = await musicBrainzClient.enrichAlbumMetadata(album);
        
        if (mbData && mbData.confidence >= 0.7) {
          // Store the data (simplified version)
          await dbManager.createAlbumMBMapping(
            album.id,
            mbData.musicbrainz_release_id,
            mbData.confidence,
            'batch'
          );
          successful++;
        }
        
        processed++;
        
        // Update progress via WebSocket
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'batch_progress',
              processed: processed,
              total: unmappedAlbums.length,
              successful: successful
            }));
          }
        });
        
      } catch (err) {
        console.warn(`Failed to enrich album ${album.id}:`, err.message);
        processed++;
      }
    }
    
    res.json({
      message: 'Batch enrichment completed',
      processed: processed,
      successful: successful,
      total: unmappedAlbums.length
    });
    
    broadcastUpdate('batch_enrichment_complete');
    
  } catch (err) {
    console.error('Batch enrichment error:', err);
    res.status(500).json({ error: 'Batch enrichment failed' });
  }
});

// Get artist relationship network
app.get('/api/musicbrainz/network/:mbid', async (req, res) => {
  const { mbid } = req.params;
  const { depth = 2 } = req.query;
  
  try {
    const network = await musicBrainzClient.buildRelationshipNetwork([mbid], parseInt(depth));
    res.json(network);
  } catch (err) {
    console.error('Network building error:', err);
    res.status(500).json({ error: 'Failed to build network' });
  }
});

// Get MusicBrainz statistics
app.get('/api/musicbrainz/stats', async (req, res) => {
  try {
    const stats = await dbManager.getMBStatistics();
    const clientStats = musicBrainzClient.getStatistics();
    
    res.json({
      database: stats,
      client: clientStats
    });
  } catch (err) {
    console.error('MusicBrainz stats error:', err);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

/**
 * WebSocket handling for real-time updates
 */
wss.on('connection', (ws, req) => {
  console.log('WebSocket client connected');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'subscribe':
          // Subscribe to updates for specific data types
          ws.subscriptions = data.subscriptions || [];
          ws.send(JSON.stringify({ type: 'subscribed', subscriptions: ws.subscriptions }));
          break;
          
        case 'request_update':
          // Client requesting fresh data
          broadcastUpdate(data.dataType);
          break;
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

/**
 * Broadcast updates to subscribed WebSocket clients
 */
function broadcastUpdate(dataType) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && 
        client.subscriptions && 
        client.subscriptions.includes(dataType)) {
      client.send(JSON.stringify({ 
        type: 'update_available', 
        dataType: dataType,
        timestamp: new Date().toISOString()
      }));
    }
  });
}

/**
 * Error handling
 */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

/**
 * Server startup
 */
async function startServer() {
  try {
    await initializeServices();
    
    server.listen(PORT, () => {
      console.log(`
🎵 ordr.fm Server running at http://localhost:${PORT}
   
   Health:      http://localhost:${PORT}/health
   API:         http://localhost:${PORT}/api/*
   MusicBrainz: http://localhost:${PORT}/api/musicbrainz/*
   
   WebSocket: ws://localhost:${PORT}
      `);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  server.close(async () => {
    await dbManager.close();
    process.exit(0);
  });
});

startServer();