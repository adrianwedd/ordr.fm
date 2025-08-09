// Performance monitoring controller
const performanceMonitor = require('../services/performance');

/**
 * Performance monitoring controller
 * Handles API endpoints for performance metrics, monitoring, and analysis
 */
class PerformanceController {
    
    /**
     * Get current performance statistics
     * GET /api/performance/stats
     */
    async getStats(req, res) {
        try {
            const stats = performanceMonitor.getStats();
            
            res.json({
                success: true,
                timestamp: Date.now(),
                data: stats
            });
        } catch (error) {
            console.error('Error retrieving performance stats:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve performance statistics'
            });
        }
    }
    
    /**
     * Get performance trends over time
     * GET /api/performance/trends
     */
    async getTrends(req, res) {
        try {
            const trends = performanceMonitor.getTrends();
            
            res.json({
                success: true,
                timestamp: Date.now(),
                data: trends
            });
        } catch (error) {
            console.error('Error retrieving performance trends:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve performance trends'
            });
        }
    }
    
    /**
     * Get detailed performance report
     * GET /api/performance/report
     */
    async getDetailedReport(req, res) {
        try {
            const report = performanceMonitor.getDetailedReport();
            
            res.json({
                success: true,
                timestamp: Date.now(),
                data: report
            });
        } catch (error) {
            console.error('Error generating performance report:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate performance report'
            });
        }
    }
    
    /**
     * Get current performance alerts
     * GET /api/performance/alerts
     */
    async getAlerts(req, res) {
        try {
            const alerts = performanceMonitor.checkAlerts();
            
            res.json({
                success: true,
                timestamp: Date.now(),
                data: {
                    alerts,
                    count: alerts.length,
                    severity: {
                        critical: alerts.filter(a => a.severity === 'critical').length,
                        warning: alerts.filter(a => a.severity === 'warning').length,
                        info: alerts.filter(a => a.severity === 'info').length
                    }
                }
            });
        } catch (error) {
            console.error('Error retrieving performance alerts:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve performance alerts'
            });
        }
    }
    
    /**
     * Get system health assessment
     * GET /api/performance/health
     */
    async getSystemHealth(req, res) {
        try {
            const stats = performanceMonitor.getStats();
            const health = performanceMonitor.assessSystemHealth(stats);
            const alerts = performanceMonitor.checkAlerts();
            
            res.json({
                success: true,
                timestamp: Date.now(),
                data: {
                    ...health,
                    alerts: alerts.length,
                    uptime: process.uptime(),
                    version: require('../../package.json').version
                }
            });
        } catch (error) {
            console.error('Error assessing system health:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to assess system health'
            });
        }
    }
    
    /**
     * Get performance metrics for specific time range
     * GET /api/performance/metrics?from=timestamp&to=timestamp
     */
    async getMetricsRange(req, res) {
        try {
            const { from, to } = req.query;
            const fromTime = from ? parseInt(from) : Date.now() - 3600000; // Default: last hour
            const toTime = to ? parseInt(to) : Date.now();
            
            if (isNaN(fromTime) || isNaN(toTime) || fromTime >= toTime) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid time range parameters'
                });
            }
            
            const stats = performanceMonitor.getStats();
            
            // Filter metrics by time range
            const filteredResponses = performanceMonitor.metrics.responses.filter(r => 
                r.timestamp >= fromTime && r.timestamp <= toTime
            );
            
            const filteredQueries = performanceMonitor.metrics.database.queries.filter(q => 
                q.timestamp >= fromTime && q.timestamp <= toTime
            );
            
            res.json({
                success: true,
                timestamp: Date.now(),
                timeRange: { from: fromTime, to: toTime },
                data: {
                    requests: {
                        count: filteredResponses.length,
                        averageResponseTime: filteredResponses.length > 0 ? 
                            filteredResponses.reduce((sum, r) => sum + r.duration, 0) / filteredResponses.length : 0,
                        errorRate: filteredResponses.length > 0 ? 
                            filteredResponses.filter(r => r.statusCode >= 400).length / filteredResponses.length : 0
                    },
                    database: {
                        queryCount: filteredQueries.length,
                        averageQueryTime: filteredQueries.length > 0 ? 
                            filteredQueries.reduce((sum, q) => sum + q.duration, 0) / filteredQueries.length : 0,
                        slowQueries: filteredQueries.filter(q => q.duration > 500).length
                    },
                    system: stats.system
                }
            });
        } catch (error) {
            console.error('Error retrieving metrics for time range:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve metrics for specified time range'
            });
        }
    }
    
    /**
     * Get top performing/underperforming endpoints
     * GET /api/performance/endpoints?sort=duration|requests|errors&order=asc|desc&limit=10
     */
    async getEndpointPerformance(req, res) {
        try {
            const { sort = 'duration', order = 'desc', limit = 10 } = req.query;
            const limitNum = Math.min(parseInt(limit) || 10, 100);
            
            const endpoints = performanceMonitor.getTopEndpoints();
            
            // Sort endpoints
            endpoints.sort((a, b) => {
                let aVal, bVal;
                switch (sort) {
                    case 'requests':
                        aVal = a.count;
                        bVal = b.count;
                        break;
                    case 'errors':
                        aVal = a.errorRate;
                        bVal = b.errorRate;
                        break;
                    case 'duration':
                    default:
                        aVal = a.averageDuration;
                        bVal = b.averageDuration;
                }
                
                return order === 'asc' ? aVal - bVal : bVal - aVal;
            });
            
            res.json({
                success: true,
                timestamp: Date.now(),
                data: {
                    endpoints: endpoints.slice(0, limitNum),
                    sortBy: sort,
                    order,
                    total: endpoints.length
                }
            });
        } catch (error) {
            console.error('Error retrieving endpoint performance:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve endpoint performance data'
            });
        }
    }
    
    /**
     * Reset performance metrics (admin only)
     * POST /api/performance/reset
     */
    async resetMetrics(req, res) {
        try {
            performanceMonitor.reset();
            
            res.json({
                success: true,
                message: 'Performance metrics have been reset',
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error resetting performance metrics:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to reset performance metrics'
            });
        }
    }
    
    /**
     * Configure performance monitoring settings (admin only)
     * POST /api/performance/config
     */
    async updateConfig(req, res) {
        try {
            const { thresholds, enabled } = req.body;
            
            if (thresholds) {
                // Validate thresholds
                const validThresholds = ['slowRequest', 'slowQuery', 'highMemory', 'highCpu'];
                const updates = {};
                
                for (const [key, value] of Object.entries(thresholds)) {
                    if (validThresholds.includes(key) && typeof value === 'number' && value > 0) {
                        updates[key] = value;
                    }
                }
                
                // Update thresholds
                Object.assign(performanceMonitor.thresholds, updates);
            }
            
            if (typeof enabled === 'boolean') {
                performanceMonitor.setEnabled(enabled);
            }
            
            res.json({
                success: true,
                message: 'Performance monitoring configuration updated',
                config: {
                    thresholds: performanceMonitor.thresholds,
                    enabled: performanceMonitor.isEnabled
                }
            });
        } catch (error) {
            console.error('Error updating performance config:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update performance monitoring configuration'
            });
        }
    }
    
    /**
     * Get performance monitoring configuration
     * GET /api/performance/config
     */
    async getConfig(req, res) {
        try {
            res.json({
                success: true,
                timestamp: Date.now(),
                data: {
                    thresholds: performanceMonitor.thresholds,
                    enabled: performanceMonitor.isEnabled,
                    uptime: process.uptime()
                }
            });
        } catch (error) {
            console.error('Error retrieving performance config:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to retrieve performance monitoring configuration'
            });
        }
    }
    
    /**
     * Export performance data (admin only)
     * GET /api/performance/export?format=json|csv&from=timestamp&to=timestamp
     */
    async exportData(req, res) {
        try {
            const { format = 'json', from, to } = req.query;
            const fromTime = from ? parseInt(from) : Date.now() - 86400000; // Default: last 24 hours
            const toTime = to ? parseInt(to) : Date.now();
            
            const report = performanceMonitor.getDetailedReport();
            
            if (format === 'csv') {
                // Convert to CSV format
                const csvData = this.convertToCSV(report);
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename=performance-report-${Date.now()}.csv`);
                res.send(csvData);
            } else {
                // JSON format
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename=performance-report-${Date.now()}.json`);
                res.json({
                    exportTime: Date.now(),
                    timeRange: { from: fromTime, to: toTime },
                    ...report
                });
            }
        } catch (error) {
            console.error('Error exporting performance data:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to export performance data'
            });
        }
    }
    
    /**
     * Helper: Convert report data to CSV format
     */
    convertToCSV(report) {
        const lines = [];
        
        // Summary data
        lines.push('Type,Metric,Value');
        lines.push(`Summary,Uptime,${report.summary.uptime}`);
        lines.push(`Summary,Total Requests,${report.summary.requests.total}`);
        lines.push(`Summary,Average Response Time,${report.summary.requests.averageResponseTime}`);
        lines.push(`Summary,Cache Hit Rate,${(report.summary.cache.hitRate * 100).toFixed(2)}%`);
        lines.push(`Summary,System Health Score,${report.systemHealth.score}`);
        
        // Top endpoints
        lines.push('');
        lines.push('Endpoint,Request Count,Average Duration,Error Rate');
        report.topEndpoints.forEach(endpoint => {
            lines.push(`${endpoint.endpoint},${endpoint.count},${endpoint.averageDuration.toFixed(2)},${(endpoint.errorRate * 100).toFixed(2)}%`);
        });
        
        return lines.join('\n');
    }
}

module.exports = new PerformanceController();