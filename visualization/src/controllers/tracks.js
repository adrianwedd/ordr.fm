// Tracks controller for track-specific operations and audio streaming
const databaseService = require('../services/database');
const path = require('path');
const fs = require('fs');
const { createReadStream } = require('fs');

class TracksController {
    /**
     * Update track metadata
     */
    async updateTrack(req, res) {
        try {
            const { id } = req.params;
            const updates = req.body;

            // Validate track exists
            const track = await databaseService.queryOne(
                'SELECT id, album_id FROM tracks WHERE id = ?',
                [id]
            );

            if (!track) {
                return res.status(404).json({
                    error: 'Track not found'
                });
            }

            // Build update query
            const allowedFields = [
                'track_title', 'track_artist', 'track_number', 'disc_number'
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
                UPDATE tracks 
                SET ${updateFields.join(', ')}
                WHERE id = ?
            `, params);

            res.json({
                message: 'Track updated successfully'
            });

        } catch (error) {
            console.error('Update track error:', error);
            res.status(500).json({
                error: 'Internal server error while updating track'
            });
        }
    }

    /**
     * Stream audio file with range support
     */
    async streamAudio(req, res) {
        try {
            const { albumId, trackId } = req.params;

            // Get track and album information
            const track = await databaseService.queryOne(`
                SELECT t.file_path, t.track_title, t.file_format,
                       a.album_title, a.album_artist, a.file_path as album_path
                FROM tracks t
                JOIN albums a ON t.album_id = a.id
                WHERE t.id = ? AND a.id = ?
            `, [trackId, albumId]);

            if (!track) {
                return res.status(404).json({
                    error: 'Track not found'
                });
            }

            // Construct full file path
            const filePath = path.resolve(track.file_path);

            // Check if file exists
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({
                    error: 'Audio file not found on disk'
                });
            }

            const stat = fs.statSync(filePath);
            const fileSize = stat.size;

            // Handle range requests for streaming
            const range = req.headers.range;
            if (range) {
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunksize = (end - start) + 1;

                const stream = createReadStream(filePath, { start, end });

                res.status(206).set({
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': this._getAudioMimeType(track.file_format)
                });

                stream.pipe(res);
            } else {
                // Full file streaming
                res.set({
                    'Content-Length': fileSize,
                    'Content-Type': this._getAudioMimeType(track.file_format),
                    'Accept-Ranges': 'bytes'
                });

                const stream = createReadStream(filePath);
                stream.pipe(res);
            }

        } catch (error) {
            console.error('Stream audio error:', error);
            res.status(500).json({
                error: 'Internal server error while streaming audio'
            });
        }
    }

    /**
     * Get audio stream (alternative endpoint)
     */
    async getAudioStream(req, res) {
        try {
            const { trackId } = req.params;

            const track = await databaseService.queryOne(`
                SELECT file_path, track_title, file_format, duration
                FROM tracks 
                WHERE id = ?
            `, [trackId]);

            if (!track) {
                return res.status(404).json({
                    error: 'Track not found'
                });
            }

            const filePath = path.resolve(track.file_path);

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({
                    error: 'Audio file not found'
                });
            }

            const stat = fs.statSync(filePath);
            const range = req.headers.range;

            if (range) {
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
                const chunksize = (end - start) + 1;

                const stream = createReadStream(filePath, { start, end });

                res.status(206).set({
                    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize,
                    'Content-Type': this._getAudioMimeType(track.file_format)
                });

                stream.pipe(res);
            } else {
                res.set({
                    'Content-Length': stat.size,
                    'Content-Type': this._getAudioMimeType(track.file_format)
                });

                const stream = createReadStream(filePath);
                stream.pipe(res);
            }

        } catch (error) {
            console.error('Get audio stream error:', error);
            res.status(500).json({
                error: 'Internal server error while streaming audio'
            });
        }
    }

    /**
     * Get track metadata
     */
    async getTrackMetadata(req, res) {
        try {
            const { trackId } = req.params;

            const track = await databaseService.queryOne(`
                SELECT t.*, a.album_title, a.album_artist, a.album_year
                FROM tracks t
                JOIN albums a ON t.album_id = a.id
                WHERE t.id = ?
            `, [trackId]);

            if (!track) {
                return res.status(404).json({
                    error: 'Track not found'
                });
            }

            res.json({
                track: {
                    id: track.id,
                    title: track.track_title,
                    artist: track.track_artist,
                    trackNumber: track.track_number,
                    discNumber: track.disc_number,
                    duration: track.duration,
                    fileFormat: track.file_format,
                    quality: track.quality,
                    albumTitle: track.album_title,
                    albumArtist: track.album_artist,
                    albumYear: track.album_year
                }
            });

        } catch (error) {
            console.error('Get track metadata error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching track metadata'
            });
        }
    }

    /**
     * Get tracks for specific album
     */
    async getAlbumTracks(req, res) {
        try {
            const { albumId } = req.params;
            const { orderBy = 'track_number' } = req.query;

            // Validate album exists
            const album = await databaseService.queryOne(
                'SELECT id, album_title FROM albums WHERE id = ?',
                [albumId]
            );

            if (!album) {
                return res.status(404).json({
                    error: 'Album not found'
                });
            }

            // Validate order by field
            const validOrderFields = ['track_number', 'track_title', 'duration', 'disc_number'];
            const orderField = validOrderFields.includes(orderBy) ? orderBy : 'track_number';

            const tracks = await databaseService.query(`
                SELECT 
                    id, track_title, track_artist, track_number, disc_number,
                    duration, file_format, quality, file_name
                FROM tracks 
                WHERE album_id = ?
                ORDER BY disc_number, ${orderField}
            `, [albumId]);

            res.json({
                albumTitle: album.album_title,
                tracks: tracks.map(track => ({
                    id: track.id,
                    title: track.track_title,
                    artist: track.track_artist,
                    trackNumber: track.track_number,
                    discNumber: track.disc_number,
                    duration: track.duration,
                    fileFormat: track.file_format,
                    quality: track.quality,
                    fileName: track.file_name
                }))
            });

        } catch (error) {
            console.error('Get album tracks error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching album tracks'
            });
        }
    }

    /**
     * Generate waveform data for track (mock implementation)
     */
    async getWaveform(req, res) {
        try {
            const { albumId, trackId } = req.params;

            // Validate track exists
            const track = await databaseService.queryOne(`
                SELECT t.id, t.track_title, t.duration
                FROM tracks t
                JOIN albums a ON t.album_id = a.id
                WHERE t.id = ? AND a.id = ?
            `, [trackId, albumId]);

            if (!track) {
                return res.status(404).json({
                    error: 'Track not found'
                });
            }

            // Mock waveform data - would generate real waveform in production
            const duration = track.duration || 300; // Default 5 minutes
            const samples = Math.min(1000, Math.floor(duration)); // Max 1000 samples
            
            const waveformData = [];
            for (let i = 0; i < samples; i++) {
                // Generate mock waveform with some variation
                const amplitude = Math.random() * 0.8 + 0.2;
                const smoothed = amplitude * (1 - Math.abs(i - samples / 2) / (samples / 2)) * 0.3 + amplitude * 0.7;
                waveformData.push(Math.round(smoothed * 100) / 100);
            }

            res.json({
                trackId: track.id,
                title: track.track_title,
                duration,
                samples,
                waveform: waveformData
            });

        } catch (error) {
            console.error('Get waveform error:', error);
            res.status(500).json({
                error: 'Internal server error while generating waveform'
            });
        }
    }

    /**
     * Get audio MIME type based on file format
     */
    _getAudioMimeType(format) {
        const mimeTypes = {
            'mp3': 'audio/mpeg',
            'flac': 'audio/flac',
            'wav': 'audio/wav',
            'ogg': 'audio/ogg',
            'm4a': 'audio/mp4',
            'aac': 'audio/aac',
            'aiff': 'audio/aiff'
        };

        return mimeTypes[format?.toLowerCase()] || 'audio/mpeg';
    }
}

module.exports = new TracksController();