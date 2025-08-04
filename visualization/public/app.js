// Global variables
let charts = {};
let data = {};

// API base URL (adjust if running on different port)
const API_BASE = '';

// Initialize the dashboard
async function init() {
    try {
        // Check health
        const health = await fetchAPI('/api/health');
        if (health.status === 'healthy') {
            document.getElementById('status').textContent = `Connected (${health.albumCount} albums)`;
            document.getElementById('status').classList.add('connected');
        }
        
        // Load initial data
        await loadOverview();
        
    } catch (error) {
        showError('Failed to connect to server: ' + error.message);
    }
}

// Fetch wrapper with error handling
async function fetchAPI(endpoint) {
    try {
        const response = await fetch(API_BASE + endpoint);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('API fetch error:', error);
        throw error;
    }
}

// Show error message
function showError(message) {
    const container = document.getElementById('error-container');
    container.innerHTML = `<div class="error">⚠️ ${message}</div>`;
}

// Tab switching
function showTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');
    
    // Load tab data
    switch(tabName) {
        case 'overview':
            loadOverview();
            break;
        case 'albums':
            loadAlbums();
            break;
        case 'artists':
            loadArtists();
            break;
        case 'labels':
            loadLabels();
            break;
        case 'timeline':
            loadTimeline();
            break;
        case 'moves':
            loadMoves();
            break;
    }
}

// Load overview data and charts
async function loadOverview() {
    try {
        const stats = await fetchAPI('/api/stats');
        data.stats = stats;
        
        // Update statistics
        document.getElementById('stat-albums').textContent = stats.totalAlbums || 0;
        document.getElementById('stat-tracks').textContent = stats.totalTracks || 0;
        document.getElementById('stat-artists').textContent = stats.totalArtists || 0;
        document.getElementById('stat-labels').textContent = stats.totalLabels || 0;
        
        // Quality distribution chart
        if (charts.quality) charts.quality.destroy();
        const qualityCtx = document.getElementById('quality-chart').getContext('2d');
        charts.quality = new Chart(qualityCtx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(stats.qualityDistribution || {}),
                datasets: [{
                    data: Object.values(stats.qualityDistribution || {}),
                    backgroundColor: [
                        '#667eea',
                        '#764ba2',
                        '#f093fb',
                        '#fccb90'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
        
        // Organization mode chart
        if (charts.mode) charts.mode.destroy();
        const modeCtx = document.getElementById('mode-chart').getContext('2d');
        charts.mode = new Chart(modeCtx, {
            type: 'bar',
            data: {
                labels: Object.keys(stats.organizationModes || {}),
                datasets: [{
                    label: 'Albums',
                    data: Object.values(stats.organizationModes || {}),
                    backgroundColor: '#667eea'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                }
            }
        });
        
    } catch (error) {
        showError('Failed to load overview data: ' + error.message);
    }
}

// Load albums list
async function loadAlbums() {
    try {
        const albums = await fetchAPI('/api/albums?limit=100');
        const tbody = document.getElementById('albums-tbody');
        
        if (albums.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No albums found</td></tr>';
            return;
        }
        
        tbody.innerHTML = albums.map(album => `
            <tr>
                <td>${album.album_artist || 'Unknown'}</td>
                <td>${album.album_title || 'Unknown'}</td>
                <td>${album.year || '-'}</td>
                <td>${album.label || '-'}</td>
                <td>${album.quality || '-'}</td>
                <td>${album.organization_mode || 'artist'}</td>
            </tr>
        `).join('');
        
    } catch (error) {
        showError('Failed to load albums: ' + error.message);
    }
}

// Load artists data
async function loadArtists() {
    try {
        const artistData = await fetchAPI('/api/artists');
        const tbody = document.getElementById('artists-tbody');
        
        if (!artistData.artists || artistData.artists.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3">No artists found</td></tr>';
            return;
        }
        
        tbody.innerHTML = artistData.artists.map(artist => `
            <tr>
                <td>${artist.name}</td>
                <td>${artist.release_count}</td>
                <td>${artist.label_count}</td>
            </tr>
        `).join('');
        
        // Draw alias network if we have alias data
        if (artistData.aliases && artistData.aliases.length > 0) {
            drawAliasNetwork(artistData);
        }
        
    } catch (error) {
        showError('Failed to load artists: ' + error.message);
    }
}

// Draw artist alias network using D3
function drawAliasNetwork(artistData) {
    const container = document.getElementById('alias-network');
    container.innerHTML = ''; // Clear previous
    
    // Prepare nodes and links
    const nodes = [];
    const links = [];
    const nodeMap = {};
    
    // Create nodes for primary artists
    artistData.aliases.forEach(alias => {
        if (!nodeMap[alias.primary_artist]) {
            nodeMap[alias.primary_artist] = {
                id: alias.primary_artist,
                name: alias.primary_artist,
                group: 'primary',
                radius: 10
            };
            nodes.push(nodeMap[alias.primary_artist]);
        }
    });
    
    // Create nodes for aliases and links
    artistData.aliases.forEach(alias => {
        if (alias.alias_name !== alias.primary_artist) {
            if (!nodeMap[alias.alias_name]) {
                nodeMap[alias.alias_name] = {
                    id: alias.alias_name,
                    name: alias.alias_name,
                    group: 'alias',
                    radius: 6
                };
                nodes.push(nodeMap[alias.alias_name]);
            }
            
            links.push({
                source: alias.primary_artist,
                target: alias.alias_name
            });
        }
    });
    
    // Create D3 force simulation
    const width = container.offsetWidth;
    const height = 500;
    
    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);
    
    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(50))
        .force('charge', d3.forceManyBody().strength(-100))
        .force('center', d3.forceCenter(width / 2, height / 2));
    
    // Draw links
    const link = svg.append('g')
        .selectAll('line')
        .data(links)
        .enter().append('line')
        .style('stroke', '#999')
        .style('stroke-opacity', 0.6)
        .style('stroke-width', 2);
    
    // Draw nodes
    const node = svg.append('g')
        .selectAll('circle')
        .data(nodes)
        .enter().append('circle')
        .attr('r', d => d.radius)
        .style('fill', d => d.group === 'primary' ? '#667eea' : '#764ba2')
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));
    
    // Add labels
    const label = svg.append('g')
        .selectAll('text')
        .data(nodes)
        .enter().append('text')
        .text(d => d.name)
        .style('font-size', '10px')
        .style('fill', '#333');
    
    // Update positions on simulation tick
    simulation.on('tick', () => {
        link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);
        
        node
            .attr('cx', d => d.x)
            .attr('cy', d => d.y);
        
        label
            .attr('x', d => d.x + 12)
            .attr('y', d => d.y + 3);
    });
    
    // Drag functions
    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }
    
    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }
    
    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }
}

// Load labels data
async function loadLabels() {
    try {
        const labels = await fetchAPI('/api/labels');
        const tbody = document.getElementById('labels-tbody');
        
        if (labels.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5">No labels found</td></tr>';
            return;
        }
        
        tbody.innerHTML = labels.map(label => `
            <tr>
                <td>${label.label}</td>
                <td>${label.release_count}</td>
                <td>${label.artist_count}</td>
                <td>${label.first_release || '-'}</td>
                <td>${label.latest_release || '-'}</td>
            </tr>
        `).join('');
        
    } catch (error) {
        showError('Failed to load labels: ' + error.message);
    }
}

// Load timeline data
async function loadTimeline() {
    try {
        const timeline = await fetchAPI('/api/timeline');
        
        if (timeline.length === 0) {
            document.getElementById('timeline-chart').parentElement.innerHTML = '<p>No timeline data available</p>';
            return;
        }
        
        // Prepare data for chart
        const labels = timeline.map(t => t.date).reverse();
        const datasets = [
            {
                label: 'Lossless',
                data: timeline.map(t => t.lossless).reverse(),
                backgroundColor: '#667eea',
                stack: 'Stack 0'
            },
            {
                label: 'Lossy',
                data: timeline.map(t => t.lossy).reverse(),
                backgroundColor: '#764ba2',
                stack: 'Stack 0'
            },
            {
                label: 'Mixed',
                data: timeline.map(t => t.mixed).reverse(),
                backgroundColor: '#f093fb',
                stack: 'Stack 0'
            }
        ];
        
        // Create timeline chart
        if (charts.timeline) charts.timeline.destroy();
        const ctx = document.getElementById('timeline-chart').getContext('2d');
        charts.timeline = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                },
                scales: {
                    x: {
                        stacked: true
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true
                    }
                }
            }
        });
        
    } catch (error) {
        showError('Failed to load timeline: ' + error.message);
    }
}

// Load move history
async function loadMoves() {
    try {
        const moves = await fetchAPI('/api/moves?limit=50');
        const tbody = document.getElementById('moves-tbody');
        
        if (moves.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4">No moves recorded</td></tr>';
            return;
        }
        
        tbody.innerHTML = moves.map(move => `
            <tr>
                <td>${new Date(move.move_date).toLocaleString()}</td>
                <td>${move.source_path}</td>
                <td>${move.destination_path}</td>
                <td>${move.move_type || 'move'}</td>
            </tr>
        `).join('');
        
    } catch (error) {
        showError('Failed to load moves: ' + error.message);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);