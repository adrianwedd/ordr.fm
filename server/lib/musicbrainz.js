/**
 * MusicBrainz API Client and Relationship Processor
 * 
 * Provides comprehensive MusicBrainz integration with focus on relationship
 * mapping and metadata enrichment for the ordr.fm system.
 */

const https = require('https');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class MusicBrainzClient {
  constructor(options = {}) {
    this.baseUrl = 'https://musicbrainz.org/ws/2';
    this.userAgent = options.userAgent || 'ordr.fm/2.1.0 (https://github.com/adrianwedd/ordr.fm)';
    this.rateLimit = options.rateLimit || 1000; // milliseconds between requests
    this.cacheDir = options.cacheDir || path.join(__dirname, '../cache/musicbrainz');
    this.cacheExpiry = options.cacheExpiry || 7 * 24 * 60 * 60 * 1000; // 7 days
    this.lastRequestTime = 0;
    
    // Ensure cache directory exists
    this.initializeCache();
  }

  async initializeCache() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (err) {
      console.warn('Could not create MusicBrainz cache directory:', err.message);
    }
  }

  /**
   * Rate limiting to respect MusicBrainz guidelines (1 request per second)
   */
  async rateLimitDelay() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimit) {
      const delay = this.rateLimit - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Generate cache key for requests
   */
  generateCacheKey(endpoint, params = {}) {
    const key = endpoint + JSON.stringify(params);
    return crypto.createHash('md5').update(key).digest('hex');
  }

  /**
   * Check if cached response is valid
   */
  async getCachedResponse(cacheKey) {
    try {
      const cacheFile = path.join(this.cacheDir, `${cacheKey}.json`);
      const stats = await fs.stat(cacheFile);
      
      if (Date.now() - stats.mtime.getTime() > this.cacheExpiry) {
        // Cache expired, remove it
        await fs.unlink(cacheFile);
        return null;
      }
      
      const data = await fs.readFile(cacheFile, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      return null;
    }
  }

  /**
   * Cache API response
   */
  async setCachedResponse(cacheKey, data) {
    try {
      const cacheFile = path.join(this.cacheDir, `${cacheKey}.json`);
      await fs.writeFile(cacheFile, JSON.stringify(data, null, 2));
    } catch (err) {
      console.warn('Could not cache MusicBrainz response:', err.message);
    }
  }

  /**
   * Make HTTP request to MusicBrainz API
   */
  async makeRequest(endpoint, params = {}) {
    const cacheKey = this.generateCacheKey(endpoint, params);
    
    // Try cache first
    const cachedResponse = await this.getCachedResponse(cacheKey);
    if (cachedResponse) {
      console.log(`Using cached MusicBrainz response for ${endpoint}`);
      return cachedResponse;
    }

    await this.rateLimitDelay();

    return new Promise((resolve, reject) => {
      // Build URL with parameters
      const url = new URL(endpoint, this.baseUrl);
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, value);
        }
      });

      const options = {
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json'
        }
      };

      console.log(`Making MusicBrainz request: ${url}`);

      const req = https.request(url, options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', async () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`MusicBrainz API error: ${res.statusCode} ${res.statusMessage}`));
              return;
            }

            const parsedData = JSON.parse(data);
            
            // Cache successful response
            await this.setCachedResponse(cacheKey, parsedData);
            
            resolve(parsedData);
          } catch (err) {
            reject(new Error(`Failed to parse MusicBrainz response: ${err.message}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`MusicBrainz request failed: ${err.message}`));
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('MusicBrainz request timeout'));
      });

      req.end();
    });
  }

  /**
   * Search for releases by artist and title
   */
  async searchReleases(artist, title, options = {}) {
    const query = `release:"${title}" AND artist:"${artist}"`;
    
    const params = {
      query: query,
      limit: options.limit || 10,
      offset: options.offset || 0,
      fmt: 'json'
    };

    if (options.year) {
      params.query += ` AND date:${options.year}*`;
    }

    try {
      const response = await this.makeRequest('/release', params);
      return {
        releases: response.releases || [],
        count: response.count || 0,
        offset: response.offset || 0
      };
    } catch (err) {
      console.error('MusicBrainz release search failed:', err);
      return { releases: [], count: 0, offset: 0 };
    }
  }

  /**
   * Get detailed release information
   */
  async getRelease(mbid, includes = ['artists', 'labels', 'recordings']) {
    const params = {
      fmt: 'json'
    };

    if (includes.length > 0) {
      params.inc = includes.join('+');
    }

    try {
      return await this.makeRequest(`/release/${mbid}`, params);
    } catch (err) {
      console.error(`Failed to get MusicBrainz release ${mbid}:`, err);
      return null;
    }
  }

  /**
   * Get artist information with relationships
   */
  async getArtist(mbid, includes = ['aliases', 'relationships']) {
    const params = {
      fmt: 'json'
    };

    if (includes.length > 0) {
      params.inc = includes.join('+');
    }

    try {
      return await this.makeRequest(`/artist/${mbid}`, params);
    } catch (err) {
      console.error(`Failed to get MusicBrainz artist ${mbid}:`, err);
      return null;
    }
  }

  /**
   * Get work (composition) information
   */
  async getWork(mbid, includes = ['relationships']) {
    const params = {
      fmt: 'json'
    };

    if (includes.length > 0) {
      params.inc = includes.join('+');
    }

    try {
      return await this.makeRequest(`/work/${mbid}`, params);
    } catch (err) {
      console.error(`Failed to get MusicBrainz work ${mbid}:`, err);
      return null;
    }
  }

  /**
   * Extract and normalize artist relationships
   */
  extractArtistRelationships(artistData) {
    if (!artistData.relations) {
      return [];
    }

    return artistData.relations.map(relation => ({
      type: relation.type,
      direction: relation.direction,
      targetType: relation['target-type'],
      targetId: relation[relation['target-type']]?.id,
      targetName: relation[relation['target-type']]?.name || relation[relation['target-type']]?.title,
      attributes: relation.attributes || [],
      begin: relation.begin,
      end: relation.end,
      ended: relation.ended
    })).filter(rel => rel.targetId); // Only include relationships with valid targets
  }

  /**
   * Calculate confidence score for release match
   */
  calculateMatchConfidence(release, originalArtist, originalTitle, originalYear) {
    let confidence = 0;
    
    // Artist name similarity (40% weight)
    const releaseArtist = release['artist-credit']?.[0]?.name || '';
    const artistSimilarity = this.calculateStringSimilarity(
      releaseArtist.toLowerCase(), 
      originalArtist.toLowerCase()
    );
    confidence += artistSimilarity * 0.4;

    // Title similarity (40% weight)
    const titleSimilarity = this.calculateStringSimilarity(
      release.title.toLowerCase(),
      originalTitle.toLowerCase()
    );
    confidence += titleSimilarity * 0.4;

    // Year match (20% weight)
    if (originalYear && release.date) {
      const releaseYear = new Date(release.date).getFullYear();
      if (releaseYear === parseInt(originalYear)) {
        confidence += 0.2;
      } else {
        // Partial credit for close years
        const yearDiff = Math.abs(releaseYear - parseInt(originalYear));
        if (yearDiff <= 2) {
          confidence += 0.1 * (1 - yearDiff / 2);
        }
      }
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Simple string similarity using Levenshtein distance
   */
  calculateStringSimilarity(str1, str2) {
    const matrix = [];
    const len1 = str1.length;
    const len2 = str2.length;

    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;

    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[len1][len2];
    const maxLength = Math.max(len1, len2);
    return (maxLength - distance) / maxLength;
  }

  /**
   * Find best release match with confidence scoring
   */
  async findBestReleaseMatch(artist, title, year = null) {
    const searchResults = await this.searchReleases(artist, title, { year });
    
    if (searchResults.releases.length === 0) {
      return null;
    }

    let bestMatch = null;
    let bestConfidence = 0;

    for (const release of searchResults.releases) {
      const confidence = this.calculateMatchConfidence(release, artist, title, year);
      
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestMatch = {
          ...release,
          confidence: confidence
        };
      }
    }

    // Only return matches with reasonable confidence
    if (bestConfidence >= 0.6) {
      return bestMatch;
    }

    return null;
  }

  /**
   * Enrich album metadata with MusicBrainz data
   */
  async enrichAlbumMetadata(albumData) {
    const { album_artist, album_title, album_year } = albumData;
    
    try {
      // Find best matching release
      const match = await this.findBestReleaseMatch(album_artist, album_title, album_year);
      
      if (!match) {
        return null;
      }

      // Get detailed release information
      const detailedRelease = await this.getRelease(match.id);
      
      if (!detailedRelease) {
        return null;
      }

      // Extract relevant metadata
      const enrichedData = {
        musicbrainz_release_id: match.id,
        confidence: match.confidence,
        barcode: detailedRelease.barcode,
        country: detailedRelease.country,
        date: detailedRelease.date,
        disambiguation: detailedRelease.disambiguation,
        packaging: detailedRelease.packaging,
        status: detailedRelease.status,
        artist_credit: detailedRelease['artist-credit'],
        label_info: detailedRelease['label-info'],
        media: detailedRelease.media,
        relationships: []
      };

      // Get artist relationships if available
      if (detailedRelease['artist-credit']?.[0]?.artist?.id) {
        const artistId = detailedRelease['artist-credit'][0].artist.id;
        const artistData = await this.getArtist(artistId);
        
        if (artistData) {
          enrichedData.relationships = this.extractArtistRelationships(artistData);
          enrichedData.artist_mbid = artistId;
          enrichedData.artist_aliases = artistData.aliases || [];
        }
      }

      return enrichedData;
    } catch (err) {
      console.error('Failed to enrich album with MusicBrainz data:', err);
      return null;
    }
  }

  /**
   * Build relationship network data for visualization
   */
  async buildRelationshipNetwork(artistMbids, maxDepth = 2) {
    const nodes = new Map();
    const links = [];
    const processed = new Set();

    const processArtist = async (mbid, depth = 0) => {
      if (depth > maxDepth || processed.has(mbid)) {
        return;
      }

      processed.add(mbid);
      const artistData = await this.getArtist(mbid);
      
      if (!artistData) {
        return;
      }

      // Add artist node
      nodes.set(mbid, {
        id: mbid,
        name: artistData.name,
        type: 'artist',
        sortName: artistData['sort-name'],
        disambiguation: artistData.disambiguation,
        lifeSpan: artistData['life-span'],
        aliases: artistData.aliases || []
      });

      // Process relationships
      const relationships = this.extractArtistRelationships(artistData);
      
      for (const relation of relationships) {
        if (relation.targetType === 'artist' && relation.targetId) {
          // Add relationship link
          links.push({
            source: mbid,
            target: relation.targetId,
            type: relation.type,
            direction: relation.direction,
            attributes: relation.attributes,
            begin: relation.begin,
            end: relation.end
          });

          // Recursively process related artist
          if (depth < maxDepth) {
            await processArtist(relation.targetId, depth + 1);
          }
        }
      }
    };

    // Process all starting artists
    for (const mbid of artistMbids) {
      await processArtist(mbid);
    }

    return {
      nodes: Array.from(nodes.values()),
      links: links
    };
  }

  /**
   * Get statistics about MusicBrainz data coverage
   */
  getStatistics() {
    // This would integrate with the database to show coverage stats
    return {
      cacheSize: 0, // To be implemented
      requestCount: 0, // To be implemented
      lastRequest: this.lastRequestTime,
      rateLimitDelay: this.rateLimit
    };
  }
}

module.exports = MusicBrainzClient;