// Albums controller for music collection API
const databaseService = require('../services/database');
const cacheManager = require('../utils/cache');

class AlbumsController {
    /**
     * @swagger
     * /api/albums:
     *   get:
     *     summary: Get albums with pagination and filtering
     *     description: Retrieve a paginated list of albums from the music collection with optional filtering by artist, genre, year, quality, and search term.
     *     tags: [Albums]
     *     parameters:
     *       - in: query
     *         name: page
     *         schema:
     *           type: integer
     *           minimum: 1
     *           default: 1
     *         description: Page number for pagination
     *       - in: query
     *         name: pageSize
     *         schema:
     *           type: integer
     *           minimum: 1
     *           maximum: 100
     *           default: 20
     *         description: Number of albums per page
     *       - in: query
     *         name: sortBy
     *         schema:
     *           type: string
     *           enum: [album_title, album_artist, album_year, genre, quality, track_count, total_duration, created_at]
     *           default: album_title
     *         description: Field to sort by
     *       - in: query
     *         name: sortOrder
     *         schema:
     *           type: string
     *           enum: [ASC, DESC]
     *           default: ASC
     *         description: Sort order
     *       - in: query
     *         name: artist
     *         schema:
     *           type: string
     *         description: Filter by album artist (partial match)
     *       - in: query
     *         name: genre
     *         schema:
     *           type: string
     *         description: Filter by genre (partial match)
     *       - in: query
     *         name: year
     *         schema:
     *           type: integer
     *         description: Filter by release year (exact match)
     *       - in: query
     *         name: quality
     *         schema:
     *           type: string
     *           enum: [Lossless, Lossy, Mixed]
     *         description: Filter by audio quality
     *       - in: query
     *         name: search
     *         schema:
     *           type: string
     *         description: Search across album title, artist, and genre
     *     responses:
     *       200:
     *         description: Albums retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               allOf:
     *                 - $ref: '#/components/schemas/PaginatedResponse'
     *                 - type: object
     *                   properties:
     *                     albums:
     *                       type: array
     *                       items:
     *                         $ref: '#/components/schemas/Album'
     *                     filters:
     *                       type: object
     *                       properties:
     *                         artist:
     *                           type: string
     *                         genre:
     *                           type: string
     *                         year:
     *                           type: integer
     *                         quality:
     *                           type: string
     *                         search:
     *                           type: string
     *                         sortBy:
     *                           type: string
     *                         sortOrder:
     *                           type: string
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *     security: []
     */
    async getAlbums(req, res) {
        try {
            const {
                page = 1,
                pageSize = 20,
                sortBy = 'album_title',
                sortOrder = 'ASC',
                artist,
                genre,
                year,
                quality,
                search
            } = req.query;

            // Validate pagination
            const limit = Math.min(parseInt(pageSize), 100); // Max 100 per page
            const offset = (parseInt(page) - 1) * limit;

            // Build WHERE clause
            const conditions = [];
            const params = [];

            if (artist) {
                conditions.push('album_artist LIKE ?');
                params.push(`%${artist}%`);
            }

            if (genre) {
                conditions.push('genre LIKE ?');
                params.push(`%${genre}%`);
            }

            if (year) {
                conditions.push('album_year = ?');
                params.push(parseInt(year));
            }

            if (quality) {
                conditions.push('quality = ?');
                params.push(quality);
            }

            if (search) {
                conditions.push(
                    '(album_title LIKE ? OR album_artist LIKE ? OR genre LIKE ?)'
                );
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }

            const whereClause = conditions.length > 0 ? 
                `WHERE ${conditions.join(' AND ')}` : '';

            // Validate sort column to prevent SQL injection
            const validSortColumns = [
                'album_title', 'album_artist', 'album_year', 'genre', 
                'quality', 'track_count', 'total_duration', 'created_at'
            ];
            const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'album_title';
            const sortDirection = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

            // Get albums
            const albums = await databaseService.query(`
                SELECT 
                    id, album_title, album_artist, album_year, genre, 
                    quality, track_count, total_duration, file_path,
                    created_at, last_modified
                FROM albums 
                ${whereClause}
                ORDER BY ${sortColumn} ${sortDirection}
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]);

            // Get total count
            const totalResult = await databaseService.queryOne(`
                SELECT COUNT(*) as total FROM albums ${whereClause}
            `, params);

            const total = totalResult?.total || 0;
            const totalPages = Math.ceil(total / limit);

            res.json({
                albums,
                pagination: {
                    page: parseInt(page),
                    pageSize: limit,
                    total,
                    totalPages,
                    hasNext: parseInt(page) < totalPages,
                    hasPrev: parseInt(page) > 1
                },
                filters: {
                    artist,
                    genre,
                    year,
                    quality,
                    search,
                    sortBy: sortColumn,
                    sortOrder: sortDirection
                }
            });

        } catch (error) {
            console.error('Get albums error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching albums'
            });
        }
    }

    /**
     * @swagger
     * /api/albums/{id}:
     *   get:
     *     summary: Get single album by ID
     *     description: Retrieve detailed information about a specific album including its tracks.
     *     tags: [Albums]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: integer
     *         description: Album ID
     *     responses:
     *       200:
     *         description: Album retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 album:
     *                   allOf:
     *                     - $ref: '#/components/schemas/Album'
     *                     - type: object
     *                       properties:
     *                         tracks:
     *                           type: array
     *                           items:
     *                             $ref: '#/components/schemas/Track'
     *       404:
     *         description: Album not found
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
    async getAlbum(req, res) {
        try {
            const { id } = req.params;

            const album = await databaseService.queryOne(`
                SELECT 
                    id, album_title, album_artist, album_year, genre, 
                    quality, track_count, total_duration, file_path,
                    created_at, last_modified, catalog_number, label,
                    discogs_id, discogs_confidence
                FROM albums 
                WHERE id = ?
            `, [id]);

            if (!album) {
                return res.status(404).json({
                    error: 'Album not found'
                });
            }

            // Get tracks for this album
            const tracks = await databaseService.query(`
                SELECT 
                    id, track_number, track_title, track_artist, duration,
                    file_name, file_format, quality, disc_number
                FROM tracks 
                WHERE album_id = ?
                ORDER BY disc_number, track_number
            `, [id]);

            res.json({
                album: {
                    ...album,
                    tracks
                }
            });

        } catch (error) {
            console.error('Get album error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching album'
            });
        }
    }

    /**
     * Update album metadata
     */
    async updateAlbum(req, res) {
        try {
            const { id } = req.params;
            const updates = req.body;

            // Validate album exists
            const album = await databaseService.queryOne(
                'SELECT id FROM albums WHERE id = ?',
                [id]
            );

            if (!album) {
                return res.status(404).json({
                    error: 'Album not found'
                });
            }

            // Build update query
            const allowedFields = [
                'album_title', 'album_artist', 'album_year', 'genre',
                'catalog_number', 'label'
            ];

            const updateFields = [];
            const params = [];

            for (const field of allowedFields) {
                if (updates[field] !== undefined) {
                    updateFields.push(`${field} = ?`);
                    params.push(updates[field]);
                }
            }

            if (updateFields.length === 0) {
                return res.status(400).json({
                    error: 'No valid fields to update'
                });
            }

            // Add timestamp and ID
            updateFields.push('last_modified = CURRENT_TIMESTAMP');
            params.push(id);

            await databaseService.run(`
                UPDATE albums 
                SET ${updateFields.join(', ')}
                WHERE id = ?
            `, params);

            // Clear cache for updated album
            cacheManager.clearCache(`album:${id}`);
            cacheManager.clearCache('albums');

            res.json({
                message: 'Album updated successfully'
            });

        } catch (error) {
            console.error('Update album error:', error);
            res.status(500).json({
                error: 'Internal server error while updating album'
            });
        }
    }

    /**
     * Get album statistics
     */
    async getStats(req, res) {
        try {
            const stats = await databaseService.query(`
                SELECT 
                    COUNT(*) as total_albums,
                    COUNT(DISTINCT album_artist) as total_artists,
                    COUNT(DISTINCT genre) as total_genres,
                    SUM(track_count) as total_tracks,
                    SUM(CAST(total_duration AS INTEGER)) as total_duration_seconds,
                    AVG(album_year) as average_year,
                    quality,
                    COUNT(*) as quality_count
                FROM albums
                WHERE quality IS NOT NULL
                GROUP BY quality
                UNION ALL
                SELECT 
                    COUNT(*) as total_albums,
                    COUNT(DISTINCT album_artist) as total_artists,
                    COUNT(DISTINCT genre) as total_genres,
                    SUM(track_count) as total_tracks,
                    SUM(CAST(total_duration AS INTEGER)) as total_duration_seconds,
                    AVG(album_year) as average_year,
                    'ALL' as quality,
                    0 as quality_count
                FROM albums
            `, [], true); // Use cache

            // Process results
            const qualityBreakdown = {};
            let overallStats = null;

            stats.forEach(stat => {
                if (stat.quality === 'ALL') {
                    overallStats = {
                        totalAlbums: stat.total_albums || 0,
                        totalArtists: stat.total_artists || 0,
                        totalGenres: stat.total_genres || 0,
                        totalTracks: stat.total_tracks || 0,
                        totalDurationHours: Math.round((stat.total_duration_seconds || 0) / 3600),
                        averageYear: Math.round(stat.average_year || 0)
                    };
                } else {
                    qualityBreakdown[stat.quality] = stat.quality_count || 0;
                }
            });

            res.json({
                stats: overallStats,
                qualityBreakdown
            });

        } catch (error) {
            console.error('Get album stats error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching statistics'
            });
        }
    }

    /**
     * Get artists list
     */
    async getArtists(req, res) {
        try {
            const { limit = 100 } = req.query;

            const artists = await databaseService.query(`
                SELECT 
                    album_artist as name,
                    COUNT(*) as album_count,
                    MIN(album_year) as first_year,
                    MAX(album_year) as last_year,
                    GROUP_CONCAT(DISTINCT genre) as genres
                FROM albums 
                WHERE album_artist IS NOT NULL AND album_artist != ''
                GROUP BY album_artist
                ORDER BY album_count DESC, album_artist
                LIMIT ?
            `, [parseInt(limit)]);

            res.json({
                artists: artists.map(artist => ({
                    name: artist.name,
                    albumCount: artist.album_count,
                    firstYear: artist.first_year,
                    lastYear: artist.last_year,
                    genres: artist.genres ? artist.genres.split(',') : []
                }))
            });

        } catch (error) {
            console.error('Get artists error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching artists'
            });
        }
    }
}

module.exports = new AlbumsController();