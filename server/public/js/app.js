/**
 * ordr.fm Web Interface
 * 
 * Provides interactive visualization of music metadata relationships
 * using D3.js force-directed graphs and real-time WebSocket updates.
 */

class OrdrFMApp {
    constructor() {
        this.websocket = null;
        this.simulation = null;
        this.svg = null;
        this.g = null;
        this.nodes = [];
        this.links = [];
        this.isPaused = false;
        
        this.initializeWebSocket();
        this.initializeSVG();
        this.loadInitialData();
    }

    initializeWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.websocket = new WebSocket(wsUrl);
        
        this.websocket.onopen = () => {
            console.log('WebSocket connected');
            this.websocket.send(JSON.stringify({
                type: 'subscribe',
                subscriptions: ['album_enriched', 'batch_enrichment_complete']
            }));
        };
        
        this.websocket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
        };
        
        this.websocket.onclose = () => {
            console.log('WebSocket disconnected');
            setTimeout(() => this.initializeWebSocket(), 5000);
        };
        
        this.websocket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'batch_progress':
                this.updateProgress(data.processed, data.total, data.successful);
                break;
            case 'batch_enrichment_complete':
                this.showStatus('Batch enrichment completed!', 'success');
                this.hideProgress();
                this.loadStats();
                break;
            case 'album_enriched':
                this.showStatus('Album enriched with MusicBrainz data', 'success');
                this.loadStats();
                break;
            case 'update_available':
                this.showStatus(`New ${data.dataType} data available`, 'info');
                break;
        }
    }

    initializeSVG() {
        this.svg = d3.select('#network-svg');
        this.g = this.svg.append('g');
        
        // Add zoom behavior
        const zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                this.g.attr('transform', event.transform);
            });
        
        this.svg.call(zoom);
        
        // Store zoom for reset functionality
        this.zoom = zoom;
    }

    async loadInitialData() {
        await this.loadStats();
        await this.loadRecentAlbums();
    }

    async loadStats() {
        try {
            const response = await fetch('/api/musicbrainz/stats');
            const stats = await response.json();
            
            document.getElementById('stat-albums').textContent = stats.database.totalAlbums || '0';
            document.getElementById('stat-artists').textContent = stats.database.mbArtists || '0';
            document.getElementById('stat-mapped').textContent = stats.database.mappedAlbums || '0';
        } catch (error) {
            console.error('Failed to load stats:', error);
            this.showStatus('Failed to load statistics', 'error');
        }
    }

    async loadRecentAlbums() {
        try {
            const response = await fetch('/api/albums?limit=20');
            const data = await response.json();
            
            const albumList = document.getElementById('album-list');
            albumList.innerHTML = '';
            
            data.albums.forEach(album => {
                const item = document.createElement('div');
                item.className = 'album-item';
                item.innerHTML = `
                    <div class="album-title">${album.album_title || 'Unknown Title'}</div>
                    <div class="album-artist">${album.album_artist || 'Unknown Artist'}</div>
                `;
                item.onclick = () => this.enrichAlbum(album.id);
                albumList.appendChild(item);
            });
        } catch (error) {
            console.error('Failed to load albums:', error);
            document.getElementById('album-list').innerHTML = '<div style="color: #f44;">Failed to load albums</div>';
        }
    }

    async enrichAlbum(albumId) {
        this.showStatus(`Enriching album ${albumId}...`, 'info');
        
        try {
            const response = await fetch(`/api/musicbrainz/enrich-album/${albumId}`, {
                method: 'POST'
            });
            const result = await response.json();
            
            if (result.success) {
                this.showStatus(`Album enriched successfully! Confidence: ${(result.confidence * 100).toFixed(1)}%`, 'success');
            } else {
                this.showStatus(result.message || 'No suitable match found', 'warning');
            }
        } catch (error) {
            console.error('Enrichment failed:', error);
            this.showStatus('Enrichment failed', 'error');
        }
    }

    async startBatchEnrichment() {
        this.showStatus('Starting batch enrichment...', 'info');
        this.showProgress();
        
        try {
            const response = await fetch('/api/musicbrainz/batch-enrich', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ limit: 20 })
            });
            
            const result = await response.json();
            this.showStatus(`Batch enrichment: ${result.successful}/${result.processed} successful`, 'success');
        } catch (error) {
            console.error('Batch enrichment failed:', error);
            this.showStatus('Batch enrichment failed', 'error');
        } finally {
            this.hideProgress();
        }
    }

    async loadNetworkVisualization() {
        this.showStatus('Loading relationship network...', 'info');
        
        try {
            const response = await fetch('/api/visualization/network?type=artist');
            const data = await response.json();
            
            this.renderNetwork(data.nodes, data.links);
            this.showStatus(`Network loaded: ${data.nodes.length} nodes, ${data.links.length} connections`, 'success');
        } catch (error) {
            console.error('Failed to load network:', error);
            this.showStatus('Failed to load network visualization', 'error');
        }
    }

    renderNetwork(nodes, links) {
        // Clear existing visualization
        this.g.selectAll('*').remove();
        
        if (nodes.length === 0) {
            this.showStatus('No relationship data available yet. Try enriching some albums first.', 'warning');
            return;
        }

        this.nodes = nodes;
        this.links = links;

        // Create force simulation
        this.simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id(d => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(400, 300))
            .force('collision', d3.forceCollide().radius(30));

        // Create links
        const link = this.g.append('g')
            .selectAll('line')
            .data(links)
            .enter().append('line')
            .attr('class', 'link')
            .attr('stroke-width', d => Math.sqrt(d.weight || 1));

        // Create nodes
        const node = this.g.append('g')
            .selectAll('circle')
            .data(nodes)
            .enter().append('circle')
            .attr('class', d => `node ${d.type}`)
            .attr('r', d => Math.max(8, Math.min(20, (d.connections || 1) * 2)))
            .call(this.drag());

        // Add labels
        const labels = this.g.append('g')
            .selectAll('text')
            .data(nodes)
            .enter().append('text')
            .attr('class', 'node-label')
            .attr('dy', -25)
            .text(d => d.name.length > 20 ? d.name.substring(0, 17) + '...' : d.name);

        // Add tooltips
        node.append('title')
            .text(d => `${d.name}\nType: ${d.type}\nConnections: ${d.connections || 0}`);

        // Update positions on simulation tick
        this.simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            node
                .attr('cx', d => d.x)
                .attr('cy', d => d.y);

            labels
                .attr('x', d => d.x)
                .attr('y', d => d.y);
        });

        // Handle node clicks
        node.on('click', (event, d) => {
            this.showNodeDetails(d);
        });
    }

    drag() {
        function dragstarted(event) {
            if (!event.active) this.simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }

        function dragged(event) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }

        function dragended(event) {
            if (!event.active) this.simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
        }

        return d3.drag()
            .on('start', dragstarted.bind(this))
            .on('drag', dragged)
            .on('end', dragended.bind(this));
    }

    showNodeDetails(node) {
        this.showStatus(`${node.type}: ${node.name} (${node.connections || 0} connections)`, 'info');
    }

    resetZoom() {
        this.svg.transition().duration(750).call(
            this.zoom.transform,
            d3.zoomIdentity
        );
    }

    pauseSimulation() {
        if (this.simulation) {
            if (this.isPaused) {
                this.simulation.restart();
                this.isPaused = false;
                document.querySelector('.viz-controls button.secondary').textContent = 'Pause';
            } else {
                this.simulation.stop();
                this.isPaused = true;
                document.querySelector('.viz-controls button.secondary').textContent = 'Resume';
            }
        }
    }

    showStatus(message, type = 'info') {
        const statusEl = document.getElementById('status-message');
        statusEl.textContent = message;
        statusEl.className = `status-message ${type}`;
        statusEl.style.display = 'block';
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 5000);
    }

    showProgress() {
        document.getElementById('progress-bar').style.display = 'block';
    }

    hideProgress() {
        document.getElementById('progress-bar').style.display = 'none';
        document.getElementById('progress-fill').style.width = '0%';
    }

    updateProgress(processed, total, successful) {
        const percentage = (processed / total) * 100;
        document.getElementById('progress-fill').style.width = `${percentage}%`;
        this.showStatus(`Processing: ${processed}/${total} (${successful} successful)`, 'info');
    }
}

// Global functions for HTML onclick handlers
let app;

function loadNetworkVisualization() {
    app.loadNetworkVisualization();
}

function startBatchEnrichment() {
    app.startBatchEnrichment();
}

function loadStats() {
    app.loadStats();
}

function resetZoom() {
    app.resetZoom();
}

function pauseSimulation() {
    app.pauseSimulation();
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    app = new OrdrFMApp();
});