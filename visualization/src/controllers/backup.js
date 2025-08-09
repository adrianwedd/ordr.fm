// Backup controller for cloud backup and database operations
const databaseService = require('../services/database');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

class BackupController {
    constructor() {
        this.activeBackups = new Map();
        this.backupHistory = [];
    }

    /**
     * Get backup status
     */
    async getStatus(req, res) {
        try {
            // Check for active backup processes
            const activeBackup = Array.from(this.activeBackups.values())[0];
            
            if (activeBackup) {
                return res.json({
                    status: 'running',
                    progress: activeBackup.progress || 0,
                    startTime: activeBackup.startTime,
                    currentFile: activeBackup.currentFile,
                    totalFiles: activeBackup.totalFiles,
                    processedFiles: activeBackup.processedFiles,
                    estimatedTimeRemaining: activeBackup.estimatedTimeRemaining
                });
            }

            // Get last backup info from history
            const lastBackup = this.backupHistory[this.backupHistory.length - 1];
            
            res.json({
                status: 'idle',
                lastBackup: lastBackup || null,
                totalBackups: this.backupHistory.length,
                nextScheduled: null // Would implement scheduling
            });

        } catch (error) {
            console.error('Get backup status error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching backup status'
            });
        }
    }

    /**
     * Start a backup operation
     */
    async startBackup(req, res) {
        try {
            const { type = 'incremental', destination = 'gdrive' } = req.body;

            // Check if backup is already running
            if (this.activeBackups.size > 0) {
                return res.status(409).json({
                    error: 'Backup already in progress'
                });
            }

            const backupId = `backup_${Date.now()}`;
            const backupJob = {
                id: backupId,
                type,
                destination,
                startTime: new Date().toISOString(),
                progress: 0,
                status: 'starting',
                totalFiles: 0,
                processedFiles: 0
            };

            this.activeBackups.set(backupId, backupJob);

            // Start backup process asynchronously
            this._executeBackup(backupJob);

            res.json({
                message: 'Backup started successfully',
                backupId,
                status: backupJob
            });

        } catch (error) {
            console.error('Start backup error:', error);
            res.status(500).json({
                error: 'Internal server error while starting backup'
            });
        }
    }

    /**
     * Get backup logs
     */
    async getBackupLogs(req, res) {
        try {
            const { filename } = req.params;
            
            // Validate filename to prevent path traversal
            if (!filename || filename.includes('..') || filename.includes('/')) {
                return res.status(400).json({
                    error: 'Invalid log filename'
                });
            }

            const logPath = path.join(__dirname, '../../logs', filename);
            
            if (!fs.existsSync(logPath)) {
                return res.status(404).json({
                    error: 'Log file not found'
                });
            }

            const logContent = fs.readFileSync(logPath, 'utf8');
            const logLines = logContent.split('\n').slice(-1000); // Last 1000 lines

            res.json({
                filename,
                lines: logLines,
                total: logLines.length
            });

        } catch (error) {
            console.error('Get backup logs error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching logs'
            });
        }
    }

    /**
     * Cancel active backup
     */
    async cancelBackup(req, res) {
        try {
            const activeBackup = Array.from(this.activeBackups.values())[0];
            
            if (!activeBackup) {
                return res.status(404).json({
                    error: 'No active backup to cancel'
                });
            }

            // Kill the backup process
            if (activeBackup.process) {
                activeBackup.process.kill('SIGTERM');
            }

            // Update status
            activeBackup.status = 'cancelled';
            activeBackup.endTime = new Date().toISOString();

            // Move to history
            this.backupHistory.push({
                ...activeBackup,
                duration: Date.now() - new Date(activeBackup.startTime).getTime()
            });

            this.activeBackups.delete(activeBackup.id);

            res.json({
                message: 'Backup cancelled successfully',
                backup: activeBackup
            });

        } catch (error) {
            console.error('Cancel backup error:', error);
            res.status(500).json({
                error: 'Internal server error while cancelling backup'
            });
        }
    }

    /**
     * Start cloud backup to Google Drive
     */
    async startCloudBackup(req, res) {
        try {
            const { forceFullBackup = false } = req.body;

            if (this.activeBackups.size > 0) {
                return res.status(409).json({
                    error: 'Another backup is already in progress'
                });
            }

            const backupId = `cloud_backup_${Date.now()}`;
            const backupJob = {
                id: backupId,
                type: 'cloud',
                destination: 'google_drive',
                startTime: new Date().toISOString(),
                progress: 0,
                status: 'preparing',
                forceFullBackup
            };

            this.activeBackups.set(backupId, backupJob);

            // Execute cloud backup
            this._executeCloudBackup(backupJob);

            res.json({
                message: 'Cloud backup started',
                backupId,
                status: backupJob
            });

        } catch (error) {
            console.error('Start cloud backup error:', error);
            res.status(500).json({
                error: 'Internal server error while starting cloud backup'
            });
        }
    }

    /**
     * Backup database 
     */
    async backupDatabase(req, res) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(__dirname, '../../backups', `database_${timestamp}.sql`);

            // Create backup directory if it doesn't exist
            const backupDir = path.dirname(backupPath);
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            // Use sqlite3 to dump database
            const dbPath = path.join(__dirname, '../../data/metadata.db');
            const process = spawn('sqlite3', [dbPath, '.dump'], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            const writeStream = fs.createWriteStream(backupPath);
            process.stdout.pipe(writeStream);

            process.on('close', (code) => {
                if (code === 0) {
                    const stats = fs.statSync(backupPath);
                    res.json({
                        message: 'Database backup completed successfully',
                        backupFile: path.basename(backupPath),
                        size: stats.size,
                        timestamp
                    });
                } else {
                    res.status(500).json({
                        error: 'Database backup failed'
                    });
                }
            });

            process.on('error', (error) => {
                console.error('Database backup error:', error);
                res.status(500).json({
                    error: 'Failed to start database backup process'
                });
            });

        } catch (error) {
            console.error('Backup database error:', error);
            res.status(500).json({
                error: 'Internal server error during database backup'
            });
        }
    }

    /**
     * Execute backup process (private method)
     */
    async _executeBackup(backupJob) {
        try {
            backupJob.status = 'scanning';
            
            // Mock backup process - would implement real backup logic
            const totalSteps = 100;
            
            for (let step = 0; step < totalSteps; step++) {
                await new Promise(resolve => setTimeout(resolve, 100));
                
                backupJob.progress = Math.round((step / totalSteps) * 100);
                backupJob.processedFiles = step;
                backupJob.totalFiles = totalSteps;
                backupJob.currentFile = `file_${step}.mp3`;
                
                if (step === Math.floor(totalSteps / 3)) {
                    backupJob.status = 'uploading';
                }
                
                if (step === Math.floor(totalSteps * 2 / 3)) {
                    backupJob.status = 'finalizing';
                }
            }

            backupJob.status = 'completed';
            backupJob.endTime = new Date().toISOString();
            backupJob.progress = 100;

            // Move to history
            this.backupHistory.push({
                ...backupJob,
                duration: Date.now() - new Date(backupJob.startTime).getTime()
            });

            this.activeBackups.delete(backupJob.id);

        } catch (error) {
            console.error('Backup execution error:', error);
            backupJob.status = 'failed';
            backupJob.error = error.message;
            backupJob.endTime = new Date().toISOString();
            
            this.backupHistory.push(backupJob);
            this.activeBackups.delete(backupJob.id);
        }
    }

    /**
     * Execute cloud backup process (private method)
     */
    async _executeCloudBackup(backupJob) {
        try {
            backupJob.status = 'authenticating';
            await new Promise(resolve => setTimeout(resolve, 1000));

            backupJob.status = 'scanning';
            await new Promise(resolve => setTimeout(resolve, 2000));

            backupJob.status = 'uploading';
            
            // Simulate upload progress
            for (let progress = 0; progress <= 100; progress += 5) {
                backupJob.progress = progress;
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            backupJob.status = 'completed';
            backupJob.endTime = new Date().toISOString();
            backupJob.progress = 100;

            this.backupHistory.push({
                ...backupJob,
                duration: Date.now() - new Date(backupJob.startTime).getTime()
            });

            this.activeBackups.delete(backupJob.id);

        } catch (error) {
            console.error('Cloud backup execution error:', error);
            backupJob.status = 'failed';
            backupJob.error = error.message;
            backupJob.endTime = new Date().toISOString();
            
            this.backupHistory.push(backupJob);
            this.activeBackups.delete(backupJob.id);
        }
    }
}

module.exports = new BackupController();