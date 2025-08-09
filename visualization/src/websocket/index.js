// WebSocket service for real-time communication
const WebSocket = require('ws');
const jobManager = require('./jobManager');

class WebSocketService {
    constructor() {
        this.wss = null;
        this.clients = new Set();
        this.channels = new Map(); // channel -> Set of clients
    }

    /**
     * Initialize WebSocket server
     * @param {http.Server} server - HTTP server instance
     */
    initialize(server) {
        this.wss = new WebSocket.Server({ server });
        
        this.wss.on('connection', (ws, req) => {
            this.handleConnection(ws, req);
        });

        // Send periodic stats updates
        this.startStatsUpdater();

        console.log('WebSocket server initialized');
    }

    /**
     * Handle new WebSocket connection
     * @param {WebSocket} ws - WebSocket connection
     * @param {http.IncomingMessage} req - HTTP request
     */
    handleConnection(ws, req) {
        const clientIp = req.socket.remoteAddress;
        console.log('WebSocket client connected from:', clientIp);
        
        this.clients.add(ws);

        // Send initial connection message
        ws.send(JSON.stringify({
            type: 'connection',
            message: 'Connected to ordr.fm real-time updates',
            timestamp: Date.now(),
            activeJobs: jobManager.getActiveJobs(),
            recentJobs: jobManager.getJobHistory(5)
        }));

        // Handle incoming messages
        ws.on('message', (message) => {
            this.handleMessage(ws, message);
        });

        // Handle client disconnect
        ws.on('close', () => {
            console.log('WebSocket client disconnected from:', clientIp);
            this.clients.delete(ws);
            
            // Remove from all channels
            for (const [channel, channelClients] of this.channels.entries()) {
                channelClients.delete(ws);
                if (channelClients.size === 0) {
                    this.channels.delete(channel);
                }
            }
        });

        // Handle errors
        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            this.clients.delete(ws);
        });
    }

    /**
     * Handle incoming WebSocket messages
     * @param {WebSocket} ws - WebSocket connection
     * @param {Buffer} message - Raw message
     */
    handleMessage(ws, message) {
        try {
            const data = JSON.parse(message.toString());
            
            switch (data.type) {
                case 'subscribe':
                    this.subscribeToChannel(ws, data.channel);
                    break;
                
                case 'unsubscribe':
                    this.unsubscribeFromChannel(ws, data.channel);
                    break;
                
                case 'getJobStatus':
                    this.sendJobStatus(ws, data.jobId);
                    break;
                
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                    break;
                
                default:
                    console.warn('Unknown WebSocket message type:', data.type);
            }
        } catch (error) {
            console.error('Error handling WebSocket message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid message format'
            }));
        }
    }

    /**
     * Subscribe client to a channel
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} channel - Channel name
     */
    subscribeToChannel(ws, channel) {
        if (!this.channels.has(channel)) {
            this.channels.set(channel, new Set());
        }
        
        this.channels.get(channel).add(ws);
        
        ws.send(JSON.stringify({
            type: 'subscribed',
            channel,
            timestamp: Date.now()
        }));
    }

    /**
     * Unsubscribe client from a channel
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} channel - Channel name
     */
    unsubscribeFromChannel(ws, channel) {
        if (this.channels.has(channel)) {
            this.channels.get(channel).delete(ws);
            
            if (this.channels.get(channel).size === 0) {
                this.channels.delete(channel);
            }
        }

        ws.send(JSON.stringify({
            type: 'unsubscribed',
            channel,
            timestamp: Date.now()
        }));
    }

    /**
     * Send job status to specific client
     * @param {WebSocket} ws - WebSocket connection
     * @param {string} jobId - Job ID
     */
    sendJobStatus(ws, jobId) {
        const job = jobManager.getJob(jobId);
        
        ws.send(JSON.stringify({
            type: 'jobStatus',
            job,
            timestamp: Date.now()
        }));
    }

    /**
     * Broadcast message to all connected clients
     * @param {Object} message - Message to broadcast
     * @param {string} channel - Optional channel filter
     */
    broadcast(message, channel = null) {
        const jsonMessage = JSON.stringify({
            ...message,
            timestamp: Date.now()
        });

        let targetClients = this.clients;
        
        if (channel && this.channels.has(channel)) {
            targetClients = this.channels.get(channel);
        }

        for (const client of targetClients) {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(jsonMessage);
                } catch (error) {
                    console.error('Error broadcasting message:', error);
                    this.clients.delete(client);
                }
            }
        }
    }

    /**
     * Broadcast job update
     * @param {Object} job - Job object
     * @param {boolean} isCompleted - Whether job is completed
     */
    broadcastJobUpdate(job, isCompleted = false) {
        this.broadcast({
            type: 'jobUpdate',
            job,
            isCompleted
        }, 'jobs');
    }

    /**
     * Broadcast stats update
     * @param {Object} stats - Statistics object
     */
    broadcastStats(stats) {
        this.broadcast({
            type: 'statsUpdate',
            stats
        }, 'stats');
    }

    /**
     * Start periodic stats updater
     */
    startStatsUpdater() {
        setInterval(() => {
            if (this.clients.size > 0) {
                const stats = {
                    activeJobs: jobManager.getStats(),
                    connections: this.clients.size,
                    channels: Array.from(this.channels.keys()),
                    uptime: process.uptime(),
                    memory: process.memoryUsage()
                };

                this.broadcastStats(stats);
            }
        }, 30000); // Every 30 seconds
    }

    /**
     * Get service statistics
     * @returns {Object} WebSocket service stats
     */
    getStats() {
        return {
            connectedClients: this.clients.size,
            activeChannels: this.channels.size,
            channels: Array.from(this.channels.keys()).map(channel => ({
                name: channel,
                subscribers: this.channels.get(channel).size
            }))
        };
    }

    /**
     * Shutdown WebSocket server
     */
    shutdown() {
        if (this.wss) {
            this.wss.close();
        }
        this.clients.clear();
        this.channels.clear();
    }
}

// Export singleton instance
const webSocketService = new WebSocketService();
module.exports = webSocketService;