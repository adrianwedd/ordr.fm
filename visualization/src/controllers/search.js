// Search controller for advanced music discovery features
const databaseService = require('../services/database');
const cacheManager = require('../utils/cache');

class SearchController {
    /**
     * @swagger
     * /api/search/fuzzy:
     *   get:
     *     summary: Fuzzy search across albums and tracks
     *     description: Perform intelligent fuzzy search across album titles, artists, track titles with relevance scoring.
     *     tags: [Search]
     *     parameters:
     *       - in: query
     *         name: q
     *         required: true
     *         schema:
     *           type: string
     *           minLength: 2
     *         description: Search query (minimum 2 characters)
     *         example: "aphex twin"
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           minimum: 1
     *           maximum: 100
     *           default: 20
     *         description: Maximum number of results
     *     responses:
     *       200:
     *         description: Search results with relevance scoring
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 query:
     *                   type: string
     *                   description: Original search query
     *                 results:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       type:
     *                         type: string
     *                         enum: [album, track]
     *                         description: Result type
     *                       id:
     *                         type: integer
     *                         description: Item ID
     *                       title:
     *                         type: string
     *                         description: Album or track title
     *                       artist:
     *                         type: string
     *                         description: Artist name
     *                       year:
     *                         type: integer
     *                         description: Release year
     *                       genre:
     *                         type: string
     *                         description: Genre
     *                       quality:
     *                         type: string
     *                         description: Audio quality
     *                       relevance_score:
     *                         type: integer
     *                         description: Relevance score (1-10)
     *                 total:
     *                   type: integer
     *                   description: Total number of results
     *       400:
     *         description: Invalid search query
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *     security: []
     */
    async fuzzySearch(req, res) {
        try {
            const { q: query, limit = 20 } = req.query;
            
            if (!query || query.trim().length < 2) {
                return res.status(400).json({
                    error: 'Query must be at least 2 characters long'
                });
            }

            const searchTerm = `%${query.toLowerCase().trim()}%`;
            const maxResults = Math.min(parseInt(limit), 100);

            // Search albums and tracks with fuzzy matching
            const results = await databaseService.query(`
                SELECT 
                    'album' as type,
                    id,
                    album_title as title,
                    album_artist as artist,
                    album_year as year,
                    genre,
                    quality,
                    file_path,
                    CASE 
                        WHEN LOWER(album_title) LIKE ? THEN 10
                        WHEN LOWER(album_artist) LIKE ? THEN 8
                        WHEN LOWER(genre) LIKE ? THEN 5
                        ELSE 1
                    END as relevance_score
                FROM albums 
                WHERE LOWER(album_title) LIKE ? 
                   OR LOWER(album_artist) LIKE ?
                   OR LOWER(genre) LIKE ?
                
                UNION ALL
                
                SELECT 
                    'track' as type,
                    t.id,
                    t.track_title as title,
                    COALESCE(t.track_artist, a.album_artist) as artist,
                    a.album_year as year,
                    a.genre,
                    t.quality,
                    t.file_path,
                    CASE 
                        WHEN LOWER(t.track_title) LIKE ? THEN 10
                        WHEN LOWER(t.track_artist) LIKE ? THEN 8
                        WHEN LOWER(a.album_title) LIKE ? THEN 6
                        ELSE 1
                    END as relevance_score
                FROM tracks t
                JOIN albums a ON t.album_id = a.id
                WHERE LOWER(t.track_title) LIKE ?
                   OR LOWER(t.track_artist) LIKE ?
                   OR LOWER(a.album_title) LIKE ?
                
                ORDER BY relevance_score DESC, title
                LIMIT ?
            `, [
                searchTerm, searchTerm, searchTerm,  // Album scoring
                searchTerm, searchTerm, searchTerm,  // Album matching
                searchTerm, searchTerm, searchTerm,  // Track scoring
                searchTerm, searchTerm, searchTerm,  // Track matching
                maxResults
            ], true); // Use cache

            res.json({
                query,
                results,
                total: results.length
            });

        } catch (error) {
            console.error('Fuzzy search error:', error);
            res.status(500).json({
                error: 'Internal server error during search'
            });
        }
    }

    /**
     * Get search suggestions based on query
     */
    getSuggestions(req, res) {
        try {
            const { q: query } = req.query;
            
            if (!query || query.trim().length === 0) {
                return res.json({ suggestions: [] });
            }

            // Simple implementation - would be enhanced with ML/analytics in production
            const suggestions = [
                `${query} electronic`,
                `${query} house`,
                `${query} ambient`,
                `${query} 2023`,
                `artist:${query}`
            ].filter(s => s.toLowerCase() !== query.toLowerCase());

            res.json({
                suggestions: suggestions.slice(0, 5)
            });

        } catch (error) {
            console.error('Search suggestions error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching suggestions'
            });
        }
    }

    /**
     * Get popular search terms
     */
    getPopularSearches(req, res) {
        try {
            // Mock popular searches - would be tracked from actual usage
            const popular = [
                'electronic',
                'house',
                'techno',
                'ambient',
                'drum and bass',
                '2023',
                '2024',
                'compilation',
                'various artists',
                'remix'
            ];

            res.json({
                popular: popular.slice(0, 10)
            });

        } catch (error) {
            console.error('Popular searches error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching popular searches'
            });
        }
    }

    /**
     * Get search analytics (admin only)
     */
    getAnalytics(req, res) {
        try {
            // Mock analytics data - would track real search patterns
            const analytics = {
                totalSearches: 12847,
                uniqueQueries: 3429,
                avgResultsPerQuery: 7.3,
                topQueries: [
                    { query: 'electronic', count: 324 },
                    { query: 'house', count: 298 },
                    { query: 'techno', count: 267 }
                ],
                searchTrends: {
                    daily: [45, 67, 89, 123, 156, 134, 98],
                    weekly: [890, 1200, 1450, 1234]
                }
            };

            res.json({ analytics });

        } catch (error) {
            console.error('Search analytics error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching analytics'
            });
        }
    }

    /**
     * Advanced search with multiple criteria
     */
    async advancedSearch(req, res) {
        try {
            const {
                query,
                artist,
                genre,
                year_start,
                year_end,
                quality,
                min_duration,
                max_duration,
                label,
                catalog,
                limit = 50,
                offset = 0
            } = req.query;

            const conditions = [];
            const params = [];

            // Build dynamic WHERE clause
            if (query) {
                conditions.push(`(
                    LOWER(album_title) LIKE ? OR 
                    LOWER(album_artist) LIKE ? OR 
                    LOWER(genre) LIKE ?
                )`);
                const searchTerm = `%${query.toLowerCase()}%`;
                params.push(searchTerm, searchTerm, searchTerm);
            }

            if (artist) {
                conditions.push('LOWER(album_artist) LIKE ?');
                params.push(`%${artist.toLowerCase()}%`);
            }

            if (genre) {
                conditions.push('LOWER(genre) LIKE ?');
                params.push(`%${genre.toLowerCase()}%`);
            }

            if (year_start) {
                conditions.push('album_year >= ?');
                params.push(parseInt(year_start));
            }

            if (year_end) {
                conditions.push('album_year <= ?');
                params.push(parseInt(year_end));
            }

            if (quality) {
                conditions.push('quality = ?');
                params.push(quality);
            }

            if (min_duration) {
                conditions.push('total_duration >= ?');
                params.push(parseInt(min_duration));
            }

            if (max_duration) {
                conditions.push('total_duration <= ?');
                params.push(parseInt(max_duration));
            }

            if (label) {
                conditions.push('LOWER(label) LIKE ?');
                params.push(`%${label.toLowerCase()}%`);
            }

            if (catalog) {
                conditions.push('LOWER(catalog_number) LIKE ?');
                params.push(`%${catalog.toLowerCase()}%`);
            }

            const whereClause = conditions.length > 0 ? 
                `WHERE ${conditions.join(' AND ')}` : '';

            const maxResults = Math.min(parseInt(limit), 100);
            const searchOffset = Math.max(parseInt(offset), 0);

            const albums = await databaseService.query(`
                SELECT 
                    id, album_title, album_artist, album_year, genre,
                    quality, track_count, total_duration, label,
                    catalog_number, file_path
                FROM albums 
                ${whereClause}
                ORDER BY album_artist, album_year DESC, album_title
                LIMIT ? OFFSET ?
            `, [...params, maxResults, searchOffset]);

            // Get total count
            const totalResult = await databaseService.queryOne(`
                SELECT COUNT(*) as total FROM albums ${whereClause}
            `, params);

            res.json({
                results: albums,
                total: totalResult?.total || 0,
                offset: searchOffset,
                limit: maxResults,
                filters: {
                    query, artist, genre, year_start, year_end,
                    quality, min_duration, max_duration, label, catalog
                }
            });

        } catch (error) {
            console.error('Advanced search error:', error);
            res.status(500).json({
                error: 'Internal server error during advanced search'
            });
        }
    }

    /**
     * Get search facets for filtering
     */
    async getFacets(req, res) {
        try {
            const facets = await databaseService.query(`
                SELECT 
                    'genre' as facet_type,
                    genre as value,
                    COUNT(*) as count
                FROM albums 
                WHERE genre IS NOT NULL AND genre != ''
                GROUP BY genre
                HAVING COUNT(*) > 1
                
                UNION ALL
                
                SELECT 
                    'quality' as facet_type,
                    quality as value,
                    COUNT(*) as count
                FROM albums 
                WHERE quality IS NOT NULL
                GROUP BY quality
                
                UNION ALL
                
                SELECT 
                    'year_decade' as facet_type,
                    CAST((album_year / 10) * 10 AS TEXT) || 's' as value,
                    COUNT(*) as count
                FROM albums 
                WHERE album_year IS NOT NULL AND album_year > 1950
                GROUP BY (album_year / 10)
                HAVING COUNT(*) > 2
                
                ORDER BY facet_type, count DESC
            `, [], true); // Use cache

            // Group facets by type
            const groupedFacets = facets.reduce((acc, facet) => {
                if (!acc[facet.facet_type]) {
                    acc[facet.facet_type] = [];
                }
                acc[facet.facet_type].push({
                    value: facet.value,
                    count: facet.count
                });
                return acc;
            }, {});

            res.json({ facets: groupedFacets });

        } catch (error) {
            console.error('Get facets error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching facets'
            });
        }
    }

    /**
     * Search albums with basic filtering
     */
    async searchAlbums(req, res) {
        try {
            const { q: query, limit = 20 } = req.query;

            if (!query || query.trim().length < 2) {
                return res.status(400).json({
                    error: 'Query must be at least 2 characters long'
                });
            }

            const searchTerm = `%${query.toLowerCase().trim()}%`;
            const maxResults = Math.min(parseInt(limit), 50);

            const albums = await databaseService.query(`
                SELECT 
                    id, album_title, album_artist, album_year, 
                    genre, quality, track_count
                FROM albums 
                WHERE LOWER(album_title) LIKE ? 
                   OR LOWER(album_artist) LIKE ?
                   OR LOWER(genre) LIKE ?
                ORDER BY 
                    CASE 
                        WHEN LOWER(album_title) LIKE ? THEN 1
                        WHEN LOWER(album_artist) LIKE ? THEN 2
                        ELSE 3
                    END,
                    album_title
                LIMIT ?
            `, [
                searchTerm, searchTerm, searchTerm,  // WHERE conditions
                searchTerm, searchTerm,              // ORDER conditions
                maxResults
            ], true);

            res.json({
                albums,
                query,
                total: albums.length
            });

        } catch (error) {
            console.error('Search albums error:', error);
            res.status(500).json({
                error: 'Internal server error during album search'
            });
        }
    }

    /**
     * Search tracks with track-specific metadata
     */
    async searchTracks(req, res) {
        try {
            const { q: query, limit = 30 } = req.query;

            if (!query || query.trim().length < 2) {
                return res.status(400).json({
                    error: 'Query must be at least 2 characters long'
                });
            }

            const searchTerm = `%${query.toLowerCase().trim()}%`;
            const maxResults = Math.min(parseInt(limit), 100);

            const tracks = await databaseService.query(`
                SELECT 
                    t.id, t.track_title, t.track_artist, t.track_number,
                    t.duration, t.file_format, t.quality,
                    a.album_title, a.album_artist, a.album_year
                FROM tracks t
                JOIN albums a ON t.album_id = a.id
                WHERE LOWER(t.track_title) LIKE ?
                   OR LOWER(t.track_artist) LIKE ?
                   OR LOWER(a.album_title) LIKE ?
                ORDER BY 
                    CASE 
                        WHEN LOWER(t.track_title) LIKE ? THEN 1
                        WHEN LOWER(t.track_artist) LIKE ? THEN 2
                        ELSE 3
                    END,
                    a.album_artist, a.album_year, t.track_number
                LIMIT ?
            `, [
                searchTerm, searchTerm, searchTerm,  // WHERE conditions
                searchTerm, searchTerm,              // ORDER conditions
                maxResults
            ], true);

            res.json({
                tracks,
                query,
                total: tracks.length
            });

        } catch (error) {
            console.error('Search tracks error:', error);
            res.status(500).json({
                error: 'Internal server error during track search'
            });
        }
    }
}

module.exports = new SearchController();