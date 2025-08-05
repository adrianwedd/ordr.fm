/**
 * Database manager for ordr.fm Node.js server
 * 
 * Handles SQLite database connections, schema initialization,  
 * and MusicBrainz integration queries.
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');

class DatabaseManager {
  constructor(options = {}) {
    this.metadataDbPath = options.metadataDb || path.join(__dirname, '../../ordr.fm.metadata.db');
    this.stateDbPath = options.stateDb || path.join(__dirname, '../../ordr.fm.state.db');
    this.schemaPath = options.schemaPath || path.join(__dirname, '../database/schema.sql');
    
    this.metadataDb = null;
    this.stateDb = null;
  }

  /**
   * Initialize database connections and schema
   */
  async initialize() {
    try {
      // Connect to metadata database
      this.metadataDb = await this.connectToDatabase(this.metadataDbPath);
      console.log(`Connected to metadata database: ${this.metadataDbPath}`);

      // Connect to state database (optional)
      try {
        this.stateDb = await this.connectToDatabase(this.stateDbPath);
        console.log(`Connected to state database: ${this.stateDbPath}`);
      } catch (err) {
        console.warn('Could not connect to state database (this is optional):', err.message);
      }

      // Initialize extended schema for MusicBrainz
      await this.initializeSchema();
      
      return true;
    } catch (err) {
      console.error('Database initialization failed:', err);
      throw err;
    }
  }

  /**
   * Connect to SQLite database
   */
  connectToDatabase(dbPath) {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          reject(new Error(`Could not connect to database ${dbPath}: ${err.message}`));
          return;
        }
        
        // Enable foreign keys and WAL mode for better performance
        db.exec(`
          PRAGMA foreign_keys = ON;
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = NORMAL;
          PRAGMA cache_size = 1000;
          PRAGMA temp_store = MEMORY;
        `, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(db);
          }
        });
      });
    });
  }

  /**
   * Initialize database schema for MusicBrainz integration
   */
  async initializeSchema() {
    try {
      const schema = await fs.readFile(this.schemaPath, 'utf8');
      
      return new Promise((resolve, reject) => {
        this.metadataDb.exec(schema, (err) => {
          if (err) {
            console.error('Schema initialization failed:', err);
            reject(err);
          } else {
            console.log('Database schema initialized successfully');
            resolve();
          }
        });
      });
    } catch (err) {
      console.error('Could not read schema file:', err);
      throw err;
    }
  }

  /**
   * Get database connection (metadata by default)
   */
  getDb(type = 'metadata') {
    return type === 'state' ? this.stateDb : this.metadataDb;
  }

  /**
   * Execute query with promise wrapper
   */
  query(sql, params = [], type = 'metadata') {
    const db = this.getDb(type);
    
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * Execute single row query
   */
  get(sql, params = [], type = 'metadata') {
    const db = this.getDb(type);
    
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * Execute insert/update/delete query
   */
  run(sql, params = [], type = 'metadata') {
    const db = this.getDb(type);
    
    return new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            id: this.lastID,
            changes: this.changes
          });
        }
      });
    });
  }

  /**
   * Begin transaction
   */
  beginTransaction(type = 'metadata') {
    return this.run('BEGIN TRANSACTION', [], type);
  }

  /**
   * Commit transaction
   */
  commitTransaction(type = 'metadata') {
    return this.run('COMMIT', [], type);
  }

  /**
   * Rollback transaction
   */
  rollbackTransaction(type = 'metadata') {
    return this.run('ROLLBACK', [], type);
  }

  /**
   * MusicBrainz-specific queries
   */

  /**
   * Store MusicBrainz artist data
   */
  async storeMBArtist(artistData) {
    const sql = `
      INSERT OR REPLACE INTO mb_artists 
      (mbid, name, sort_name, disambiguation, type, life_span_begin, life_span_end, life_span_ended)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      artistData.id,
      artistData.name,
      artistData['sort-name'],
      artistData.disambiguation || null,
      artistData.type || null,
      artistData['life-span']?.begin || null,
      artistData['life-span']?.end || null,
      artistData['life-span']?.ended || false
    ];

    await this.run(sql, params);

    // Store aliases
    if (artistData.aliases) {
      await this.storeMBArtistAliases(artistData.id, artistData.aliases);
    }

    return artistData.id;
  }

  /**
   * Store MusicBrainz artist aliases
   */
  async storeMBArtistAliases(artistMbid, aliases) {
    // Delete existing aliases
    await this.run('DELETE FROM mb_artist_aliases WHERE artist_mbid = ?', [artistMbid]);

    // Insert new aliases
    for (const alias of aliases) {
      const sql = `
        INSERT INTO mb_artist_aliases 
        (artist_mbid, alias_name, sort_name, type, locale, primary_alias, begin_date, end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const params = [
        artistMbid,
        alias.name,
        alias['sort-name'] || null,
        alias.type || null,
        alias.locale || null,
        alias.primary || false,
        alias['life-span']?.begin || null,
        alias['life-span']?.end || null
      ];

      await this.run(sql, params);
    }
  }

  /**
   * Store MusicBrainz release data
   */
  async storeMBRelease(releaseData) {
    const sql = `
      INSERT OR REPLACE INTO mb_releases 
      (mbid, title, disambiguation, date, country, barcode, status, packaging)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      releaseData.id,
      releaseData.title,
      releaseData.disambiguation || null,
      releaseData.date || null,
      releaseData.country || null,
      releaseData.barcode || null,
      releaseData.status || null,
      releaseData.packaging || null
    ];

    await this.run(sql, params);
    return releaseData.id;
  }

  /**
   * Store artist relationships
   */
  async storeMBArtistRelationships(artistMbid, relationships) {
    // Delete existing relationships for this artist
    await this.run('DELETE FROM mb_artist_relationships WHERE source_mbid = ?', [artistMbid]);

    for (const relation of relationships) {
      if (relation.targetType !== 'artist' || !relation.targetId) {
        continue;
      }

      const sql = `
        INSERT OR IGNORE INTO mb_artist_relationships 
        (source_mbid, target_mbid, relationship_type_id, direction, begin_date, end_date, ended, attributes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const params = [
        artistMbid,
        relation.targetId,
        relation.type, // This should be mapped to relationship type ID
        relation.direction,
        relation.begin || null,
        relation.end || null,
        relation.ended || false,
        JSON.stringify(relation.attributes || [])
      ];

      try {
        await this.run(sql, params);
      } catch (err) {
        console.warn(`Could not store relationship ${relation.type}:`, err.message);
      }
    }
  }

  /**
   * Create album to MusicBrainz mapping
   */
  async createAlbumMBMapping(albumId, mbReleaseId, confidence, source = 'auto') {
    const sql = `
      INSERT OR REPLACE INTO album_mb_mappings 
      (album_id, mb_release_mbid, confidence, mapping_source)
      VALUES (?, ?, ?, ?)
    `;
    
    return await this.run(sql, [albumId, mbReleaseId, confidence, source]);
  }

  /**
   * Get albums without MusicBrainz mappings
   */
  async getUnmappedAlbums(limit = 100) {
    const sql = `
      SELECT a.* 
      FROM albums a
      LEFT JOIN album_mb_mappings amm ON a.id = amm.album_id
      WHERE amm.album_id IS NULL
      AND a.album_artist IS NOT NULL 
      AND a.album_title IS NOT NULL
      ORDER BY a.processed_date DESC
      LIMIT ?
    `;
    
    return await this.query(sql, [limit]);
  }

  /**
   * Get artist relationship network data
   */
  async getArtistRelationshipNetwork(centerMbids, maxDepth = 2) {
    const placeholders = centerMbids.map(() => '?').join(',');
    
    const sql = `
      WITH RECURSIVE artist_network(mbid, depth, path) AS (
        -- Base case: starting artists
        SELECT mbid, 0, mbid
        FROM mb_artists 
        WHERE mbid IN (${placeholders})
        
        UNION ALL
        
        -- Recursive case: connected artists
        SELECT 
          CASE 
            WHEN ar.source_mbid = an.mbid THEN ar.target_mbid
            ELSE ar.source_mbid
          END,
          an.depth + 1,
          an.path || ',' || CASE 
            WHEN ar.source_mbid = an.mbid THEN ar.target_mbid
            ELSE ar.source_mbid
          END
        FROM artist_network an
        JOIN mb_artist_relationships ar ON (ar.source_mbid = an.mbid OR ar.target_mbid = an.mbid)
        WHERE an.depth < ? 
          AND instr(an.path, CASE 
            WHEN ar.source_mbid = an.mbid THEN ar.target_mbid
            ELSE ar.source_mbid
          END) = 0
      )
      SELECT DISTINCT
        a.mbid,
        a.name,
        a.sort_name,
        a.type,
        a.disambiguation,
        an.depth
      FROM artist_network an
      JOIN mb_artists a ON an.mbid = a.mbid
      ORDER BY an.depth, a.name
    `;
    
    const params = [...centerMbids, maxDepth];
    return await this.query(sql, params);
  }

  /**
   * Get relationship links for network visualization
   */
  async getRelationshipLinks(artistMbids) {
    const placeholders = artistMbids.map(() => '?').join(',');
    
    const sql = `
      SELECT 
        ar.source_mbid,
        ar.target_mbid,
        rt.name as relationship_type,
        rt.link_phrase,
        ar.direction,
        ar.begin_date,
        ar.end_date,
        ar.attributes
      FROM mb_artist_relationships ar
      JOIN mb_relationship_types rt ON ar.relationship_type_id = rt.id
      WHERE ar.source_mbid IN (${placeholders})
         OR ar.target_mbid IN (${placeholders})
    `;
    
    return await this.query(sql, artistMbids);
  }

  /**
   * Get statistics about MusicBrainz coverage
   */
  async getMBStatistics() {
    const queries = {
      totalAlbums: 'SELECT COUNT(*) as count FROM albums',
      mappedAlbums: 'SELECT COUNT(*) as count FROM album_mb_mappings',
      mbArtists: 'SELECT COUNT(*) as count FROM mb_artists',
      mbReleases: 'SELECT COUNT(*) as count FROM mb_releases',
      relationships: 'SELECT COUNT(*) as count FROM mb_artist_relationships',
      avgConfidence: 'SELECT AVG(confidence) as avg FROM album_mb_mappings'
    };

    const stats = {};
    
    for (const [key, sql] of Object.entries(queries)) {
      try {
        const result = await this.get(sql);
        stats[key] = result?.count || result?.avg || 0;
      } catch (err) {
        console.warn(`Failed to get ${key} statistic:`, err.message);
        stats[key] = 0;
      }
    }

    return stats;
  }

  /**
   * Close database connections
   */
  async close() {
    return new Promise((resolve) => {
      let closed = 0;
      const total = this.stateDb ? 2 : 1;

      const checkComplete = () => {
        closed++;
        if (closed === total) {
          resolve();
        }
      };

      if (this.metadataDb) {
        this.metadataDb.close((err) => {
          if (err) console.warn('Error closing metadata database:', err);
          checkComplete();
        });
      }

      if (this.stateDb) {
        this.stateDb.close((err) => {
          if (err) console.warn('Error closing state database:', err);
          checkComplete();
        });
      }
    });
  }
}

module.exports = DatabaseManager;