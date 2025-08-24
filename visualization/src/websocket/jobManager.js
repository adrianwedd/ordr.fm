// Job management and progress tracking for WebSocket updates
const { v4: uuidv4 } = require('uuid');

class JobManager {
    constructor() {
        this.activeJobs = new Map();
        this.jobHistory = [];
        this.maxHistorySize = 100;
    }

    /**
     * Create a new job
     * @param {string} type - Job type (e.g., 'search', 'backup', 'sync')
     * @param {number} totalItems - Total items to process
     * @param {Object} details - Additional job details
     * @returns {string} Job ID
     */
    createJob(type, totalItems = 0, details = {}) {
        const jobId = uuidv4();
        const job = {
            id: jobId,
            type,
            status: 'starting',
            progress: 0,
            totalItems,
            processedItems: 0,
            startTime: Date.now(),
            endTime: null,
            duration: null,
            errors: [],
            warnings: [],
            details
        };

        this.activeJobs.set(jobId, job);
        return jobId;
    }

    /**
     * Update job progress
     * @param {string} jobId - Job ID
     * @param {number} processedItems - Number of items processed
     * @param {string} status - Job status
     * @param {Object} details - Updated details
     */
    updateJobProgress(jobId, processedItems, status = 'running', details = {}) {
        const job = this.activeJobs.get(jobId);
        if (!job) {
            console.warn(`Job ${jobId} not found`);
            return null;
        }

        job.processedItems = processedItems;
        job.status = status;
        job.progress = job.totalItems > 0 ? 
            Math.round((processedItems / job.totalItems) * 100) : 0;
        
        // Merge details
        job.details = { ...job.details, ...details };

        return job;
    }

    /**
     * Add error to job
     * @param {string} jobId - Job ID
     * @param {string} error - Error message
     */
    addJobError(jobId, error) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            job.errors.push({
                message: error,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Add warning to job
     * @param {string} jobId - Job ID
     * @param {string} warning - Warning message
     */
    addJobWarning(jobId, warning) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            job.warnings.push({
                message: warning,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Complete a job
     * @param {string} jobId - Job ID
     * @param {string} status - Final status ('completed', 'failed', 'cancelled')
     * @param {Object} summary - Job completion summary
     */
    completeJob(jobId, status = 'completed', summary = {}) {
        const job = this.activeJobs.get(jobId);
        if (!job) {
            console.warn(`Job ${jobId} not found`);
            return null;
        }

        job.status = status;
        job.endTime = Date.now();
        job.duration = job.endTime - job.startTime;
        job.details = { ...job.details, ...summary };

        // If not explicitly failed, set progress to 100%
        if (status !== 'failed') {
            job.progress = 100;
            job.processedItems = job.totalItems;
        }

        // Move to history
        this.jobHistory.unshift(job);
        if (this.jobHistory.length > this.maxHistorySize) {
            this.jobHistory = this.jobHistory.slice(0, this.maxHistorySize);
        }

        // Remove from active jobs
        this.activeJobs.delete(jobId);

        return job;
    }

    /**
     * Get job by ID
     * @param {string} jobId - Job ID
     * @returns {Object|null} Job object or null
     */
    getJob(jobId) {
        const activeJob = this.activeJobs.get(jobId);
        if (activeJob) {return activeJob;}

        return this.jobHistory.find(job => job.id === jobId) || null;
    }

    /**
     * Get all active jobs
     * @returns {Array} Array of active job objects
     */
    getActiveJobs() {
        return Array.from(this.activeJobs.values());
    }

    /**
     * Get job history
     * @param {number} limit - Maximum number of jobs to return
     * @returns {Array} Array of completed job objects
     */
    getJobHistory(limit = 20) {
        return this.jobHistory.slice(0, limit);
    }

    /**
     * Get jobs statistics
     * @returns {Object} Job statistics
     */
    getStats() {
        const activeJobs = this.getActiveJobs();
        const recentJobs = this.getJobHistory();
        
        const completedJobs = recentJobs.filter(job => job.status === 'completed');
        const failedJobs = recentJobs.filter(job => job.status === 'failed');
        
        const avgDuration = completedJobs.length > 0 ?
            completedJobs.reduce((sum, job) => sum + (job.duration || 0), 0) / completedJobs.length :
            0;

        return {
            activeJobs: activeJobs.length,
            totalCompleted: completedJobs.length,
            totalFailed: failedJobs.length,
            averageDuration: Math.round(avgDuration),
            successRate: recentJobs.length > 0 ? 
                Math.round((completedJobs.length / recentJobs.length) * 100) : 0
        };
    }

    /**
     * Cancel a job
     * @param {string} jobId - Job ID
     * @param {string} reason - Cancellation reason
     */
    cancelJob(jobId, reason = 'Cancelled by user') {
        const job = this.activeJobs.get(jobId);
        if (job) {
            this.completeJob(jobId, 'cancelled', { reason });
            return true;
        }
        return false;
    }

    /**
     * Clean up old completed jobs
     * @param {number} maxAge - Maximum age in milliseconds
     */
    cleanupOldJobs(maxAge = 24 * 60 * 60 * 1000) { // 24 hours default
        const cutoff = Date.now() - maxAge;
        this.jobHistory = this.jobHistory.filter(job => 
            job.endTime && job.endTime > cutoff
        );
    }
}

// Export singleton instance
const jobManager = new JobManager();

// Clean up old jobs every hour
setInterval(() => {
    jobManager.cleanupOldJobs();
}, 60 * 60 * 1000);

module.exports = jobManager;