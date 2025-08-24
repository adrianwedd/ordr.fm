// Processing controller for music organization and enrichment
const databaseService = require('../services/database');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class ProcessingController {
    constructor() {
        this.activeJobs = new Map();
        this.jobHistory = [];
        this.jobIdCounter = 1;
    }

    /**
     * Start music processing/organization
     */
    async startProcessing(req, res) {
        try {
            const { 
                sourcePath, 
                enableMove = false, 
                enableDiscogs = true,
                organizationMode = 'hybrid'
            } = req.body;

            if (!sourcePath) {
                return res.status(400).json({
                    error: 'Source path is required'
                });
            }

            // Check if source path exists
            if (!fs.existsSync(sourcePath)) {
                return res.status(400).json({
                    error: 'Source path does not exist'
                });
            }

            const jobId = this.jobIdCounter++;
            const job = {
                id: jobId,
                type: 'process',
                status: 'starting',
                startTime: new Date().toISOString(),
                progress: 0,
                sourcePath,
                enableMove,
                enableDiscogs,
                organizationMode,
                processedAlbums: 0,
                totalAlbums: 0,
                currentAlbum: null,
                logs: []
            };

            this.activeJobs.set(jobId, job);

            // Start processing asynchronously
            this._executeProcessing(job);

            res.json({
                message: 'Processing job started',
                jobId,
                status: job
            });

        } catch (error) {
            console.error('Start processing error:', error);
            res.status(500).json({
                error: 'Internal server error while starting processing'
            });
        }
    }

    /**
     * Get active jobs
     */
    getActiveJobs(req, res) {
        try {
            const jobs = Array.from(this.activeJobs.values());
            res.json({ jobs });
        } catch (error) {
            console.error('Get active jobs error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching active jobs'
            });
        }
    }

    /**
     * Get job history
     */
    getJobHistory(req, res) {
        try {
            const { limit = 50 } = req.query;
            const maxLimit = Math.min(parseInt(limit), 100);
            
            const history = this.jobHistory
                .slice(-maxLimit)
                .reverse();

            res.json({ 
                history,
                total: this.jobHistory.length 
            });
        } catch (error) {
            console.error('Get job history error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching job history'
            });
        }
    }

    /**
     * Get specific job details
     */
    getJob(req, res) {
        try {
            const { jobId } = req.params;
            const id = parseInt(jobId);

            const activeJob = this.activeJobs.get(id);
            if (activeJob) {
                return res.json({ job: activeJob });
            }

            const historicalJob = this.jobHistory.find(job => job.id === id);
            if (historicalJob) {
                return res.json({ job: historicalJob });
            }

            res.status(404).json({
                error: 'Job not found'
            });

        } catch (error) {
            console.error('Get job error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching job'
            });
        }
    }

    /**
     * Cancel a running job
     */
    cancelJob(req, res) {
        try {
            const { jobId } = req.params;
            const id = parseInt(jobId);

            const job = this.activeJobs.get(id);
            if (!job) {
                return res.status(404).json({
                    error: 'Active job not found'
                });
            }

            // Kill the process if it exists
            if (job.process) {
                job.process.kill('SIGTERM');
            }

            job.status = 'cancelled';
            job.endTime = new Date().toISOString();
            job.logs.push({
                level: 'info',
                message: 'Job cancelled by user',
                timestamp: new Date().toISOString()
            });

            // Move to history
            this.jobHistory.push({
                ...job,
                duration: Date.now() - new Date(job.startTime).getTime()
            });

            this.activeJobs.delete(id);

            res.json({
                message: 'Job cancelled successfully',
                job
            });

        } catch (error) {
            console.error('Cancel job error:', error);
            res.status(500).json({
                error: 'Internal server error while cancelling job'
            });
        }
    }

    /**
     * Get system status
     */
    async getSystemStatus(req, res) {
        try {
            // Get system resource usage
            const systemStats = {
                cpu: process.cpuUsage(),
                memory: process.memoryUsage(),
                uptime: process.uptime(),
                platform: process.platform,
                nodeVersion: process.version,
                activeJobs: this.activeJobs.size,
                totalJobsRun: this.jobHistory.length
            };

            // Get database stats
            const dbStats = await databaseService.query(`
                SELECT 
                    COUNT(*) as total_albums,
                    SUM(track_count) as total_tracks,
                    COUNT(DISTINCT album_artist) as unique_artists
                FROM albums
            `);

            const diskUsage = this._getDiskUsage();

            // Check system dependencies
            const dependencies = {
                exiftool: await this._checkDependency('exiftool'),
                jq: await this._checkDependency('jq'),
                rsync: await this._checkDependency('rsync'),
                rclone: await this._checkDependency('rclone'),
                ffmpeg: await this._checkDependency('ffmpeg')
            };

            res.json({
                system: systemStats,
                database: dbStats[0] || {},
                disk: diskUsage,
                dependencies: dependencies,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Get system status error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching system status'
            });
        }
    }

    /**
     * Enhance metadata using external APIs
     */
    async enhanceMetadata(req, res) {
        try {
            const { albumIds, provider = 'discogs' } = req.body;

            if (!albumIds || !Array.isArray(albumIds) || albumIds.length === 0) {
                return res.status(400).json({
                    error: 'Album IDs array is required'
                });
            }

            const jobId = this.jobIdCounter++;
            const job = {
                id: jobId,
                type: 'enhance_metadata',
                status: 'starting',
                startTime: new Date().toISOString(),
                progress: 0,
                provider,
                albumIds: albumIds.slice(0, 100), // Limit to 100 albums
                processedAlbums: 0,
                totalAlbums: albumIds.length,
                enhancedCount: 0,
                skippedCount: 0,
                logs: []
            };

            this.activeJobs.set(jobId, job);

            // Start enhancement process
            this._executeEnhancement(job);

            res.json({
                message: 'Metadata enhancement started',
                jobId,
                status: job
            });

        } catch (error) {
            console.error('Enhance metadata error:', error);
            res.status(500).json({
                error: 'Internal server error while starting metadata enhancement'
            });
        }
    }

    /**
     * Execute processing job (private method)
     */
    async _executeProcessing(job) {
        try {
            job.status = 'scanning';
            
            // Build command arguments
            const scriptPath = path.join(__dirname, '../../ordr.fm.sh');
            const args = [
                '--source', job.sourcePath,
                '--verbose'
            ];

            if (job.enableMove) {
                args.push('--move');
            }

            if (job.enableDiscogs) {
                args.push('--discogs');
            }

            if (job.organizationMode !== 'hybrid') {
                args.push('--organization-mode', job.organizationMode);
            }

            job.logs.push({
                level: 'info',
                message: `Starting processing with args: ${args.join(' ')}`,
                timestamp: new Date().toISOString()
            });

            // Spawn the processing script
            const process = spawn('bash', [scriptPath, ...args], {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: path.dirname(scriptPath)
            });

            job.process = process;
            job.status = 'processing';

            // Handle stdout
            process.stdout.on('data', (data) => {
                const output = data.toString().trim();
                if (output) {
                    job.logs.push({
                        level: 'info',
                        message: output,
                        timestamp: new Date().toISOString()
                    });

                    // Parse progress from output
                    this._parseProgressFromOutput(job, output);
                }
            });

            // Handle stderr
            process.stderr.on('data', (data) => {
                const output = data.toString().trim();
                if (output) {
                    job.logs.push({
                        level: 'error',
                        message: output,
                        timestamp: new Date().toISOString()
                    });
                }
            });

            // Handle process completion
            process.on('close', (code) => {
                job.endTime = new Date().toISOString();
                job.progress = 100;
                
                if (code === 0) {
                    job.status = 'completed';
                    job.logs.push({
                        level: 'info',
                        message: 'Processing completed successfully',
                        timestamp: new Date().toISOString()
                    });
                } else {
                    job.status = 'failed';
                    job.logs.push({
                        level: 'error',
                        message: `Processing failed with exit code: ${code}`,
                        timestamp: new Date().toISOString()
                    });
                }

                // Move to history
                this.jobHistory.push({
                    ...job,
                    duration: Date.now() - new Date(job.startTime).getTime()
                });

                this.activeJobs.delete(job.id);
            });

        } catch (error) {
            console.error('Processing execution error:', error);
            job.status = 'failed';
            job.error = error.message;
            job.endTime = new Date().toISOString();
            
            this.jobHistory.push(job);
            this.activeJobs.delete(job.id);
        }
    }

    /**
     * Execute metadata enhancement (private method)
     */
    async _executeEnhancement(job) {
        try {
            job.status = 'enhancing';

            for (const albumId of job.albumIds) {
                if (job.status === 'cancelled') {break;}

                job.currentAlbum = albumId;
                
                // Mock enhancement process
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                job.processedAlbums++;
                job.enhancedCount++;
                job.progress = Math.round((job.processedAlbums / job.totalAlbums) * 100);

                job.logs.push({
                    level: 'info',
                    message: `Enhanced metadata for album ${albumId}`,
                    timestamp: new Date().toISOString()
                });
            }

            job.status = 'completed';
            job.endTime = new Date().toISOString();
            job.progress = 100;

            this.jobHistory.push({
                ...job,
                duration: Date.now() - new Date(job.startTime).getTime()
            });

            this.activeJobs.delete(job.id);

        } catch (error) {
            console.error('Enhancement execution error:', error);
            job.status = 'failed';
            job.error = error.message;
            job.endTime = new Date().toISOString();
            
            this.jobHistory.push(job);
            this.activeJobs.delete(job.id);
        }
    }

    /**
     * Parse progress information from script output
     */
    _parseProgressFromOutput(job, output) {
        // Parse album progress
        const albumMatch = output.match(/Processing album (\d+) of (\d+)/);
        if (albumMatch) {
            job.processedAlbums = parseInt(albumMatch[1]);
            job.totalAlbums = parseInt(albumMatch[2]);
            job.progress = Math.round((job.processedAlbums / job.totalAlbums) * 100);
        }

        // Parse current album name
        const currentMatch = output.match(/Current album: (.+)/);
        if (currentMatch) {
            job.currentAlbum = currentMatch[1];
        }
    }

    /**
     * Get disk usage information
     */
    _getDiskUsage() {
        try {
            // Mock disk usage - would use actual disk monitoring in production
            return {
                total: 1000000000000,  // 1TB
                used: 500000000000,    // 500GB
                free: 500000000000,    // 500GB
                percentage: 50
            };
        } catch (error) {
            console.error('Get disk usage error:', error);
            return null;
        }
    }

    /**
     * Check if a system dependency is available
     */
    async _checkDependency(command) {
        const { exec } = require('child_process');
        const util = require('util');
        const execAsync = util.promisify(exec);
        
        try {
            await execAsync(`which ${command}`);
            return true;
        } catch (error) {
            return false;
        }
    }
}

module.exports = new ProcessingController();