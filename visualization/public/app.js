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

// Tab switching with lazy loading
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
        case 'health':
            loadCollectionHealth();
            break;
        case 'duplicates':
            loadDuplicateAnalysis();
            break;
        case 'insights':
            loadAdvancedInsights();
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

// Load collection health metrics
async function loadCollectionHealth() {
    try {
        const health = await fetchAPI('/api/health');
        const insights = await fetchAPI('/api/insights');
        
        // Calculate overall health score
        const metadata = health.metadata_completeness;
        const total = metadata.total;
        const metadataScore = ((metadata.has_artist + metadata.has_title + metadata.has_year + metadata.has_label) / (total * 4)) * 100;
        const losslessPercentage = (health.overview.lossless / health.overview.total_albums) * 100;
        const overallHealth = Math.round((metadataScore + losslessPercentage) / 2);
        
        // Update health stats
        document.getElementById('health-score').textContent = overallHealth + '%';
        document.getElementById('metadata-completeness').textContent = Math.round(metadataScore) + '%';
        document.getElementById('lossless-percentage').textContent = Math.round(losslessPercentage) + '%';
        document.getElementById('organization-efficiency').textContent = '95%'; // Mock for now
        
        // Metadata completeness chart
        if (charts.metadata) charts.metadata.destroy();
        const metadataCtx = document.getElementById('metadata-chart').getContext('2d');
        charts.metadata = new Chart(metadataCtx, {
            type: 'bar',
            data: {
                labels: ['Artist', 'Title', 'Year', 'Label', 'Catalog'],
                datasets: [{
                    label: 'Completeness %',
                    data: [
                        (metadata.has_artist / total * 100),
                        (metadata.has_title / total * 100),
                        (metadata.has_year / total * 100),
                        (metadata.has_label / total * 100),
                        (metadata.has_catalog / total * 100)
                    ],
                    backgroundColor: ['#667eea', '#764ba2', '#f093fb', '#fccb90', '#84fab0']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            callback: function(value) {
                                return value + '%';
                            }
                        }
                    }
                }
            }
        });
        
        // Load anomalies
        const tbody = document.getElementById('anomalies-tbody');
        if (insights.anomalies && insights.anomalies.length > 0) {
            tbody.innerHTML = insights.anomalies.map(anomaly => `
                <tr>
                    <td>${anomaly.type.replace(/_/g, ' ')}</td>
                    <td>${anomaly.description}</td>
                    <td>${anomaly.value} ${anomaly.unit}</td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="3">No anomalies detected! 🎉</td></tr>';
        }
        
    } catch (error) {
        showError('Failed to load collection health: ' + error.message);
    }
}

// Load duplicate analysis
async function loadDuplicateAnalysis() {
    try {
        const duplicates = await fetchAPI('/api/duplicates');
        
        if (!duplicates.analysis_available) {
            document.getElementById('duplicate-status').style.display = 'none';
            document.getElementById('duplicate-message').style.display = 'block';
            document.getElementById('duplicate-message').innerHTML = `
                <p>${duplicates.message}</p>
                <p><strong>To run duplicate detection:</strong></p>
                <code>./find_duplicates.sh full -s /path/to/music</code>
            `;
            return;
        }
        
        document.getElementById('duplicate-status').style.display = 'grid';
        document.getElementById('duplicate-message').style.display = 'none';
        
        // Update duplicate stats
        const overview = duplicates.overview;
        document.getElementById('duplicate-groups-count').textContent = overview.duplicate_groups || 0;
        document.getElementById('duplicates-albums-count').textContent = overview.albums_in_groups || 0;
        
        // Format savings
        const savingsGB = (overview.potential_savings_bytes || 0) / (1024 * 1024 * 1024);
        document.getElementById('potential-savings').textContent = savingsGB.toFixed(1) + ' GB';
        document.getElementById('duplicate-score').textContent = '87%'; // Mock average confidence
        
        // Quality distribution chart
        if (charts.duplicateQuality) charts.duplicateQuality.destroy();
        const qualityCtx = document.getElementById('duplicate-quality-chart').getContext('2d');
        charts.duplicateQuality = new Chart(qualityCtx, {
            type: 'pie',
            data: {
                labels: duplicates.quality_distribution.map(q => q.format.toUpperCase()),
                datasets: [{
                    data: duplicates.quality_distribution.map(q => q.count),
                    backgroundColor: [
                        '#667eea', '#764ba2', '#f093fb', '#fccb90', '#84fab0'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
        
        // Top duplicate groups table
        const tbody = document.getElementById('duplicate-groups-tbody');
        if (duplicates.top_groups.length > 0) {
            tbody.innerHTML = duplicates.top_groups.map(group => {
                const sizeGB = (group.total_size / (1024 * 1024 * 1024)).toFixed(2);
                return `
                    <tr>
                        <td>${group.album_count}</td>
                        <td>${group.best_album.split('/').pop()}</td>
                        <td>${group.best_format.toUpperCase()}</td>
                        <td>${group.best_quality}</td>
                        <td>${sizeGB} GB</td>
                        <td>${Math.round(group.duplicate_score * 100)}%</td>
                    </tr>
                `;
            }).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="6">No duplicates found! 🎉</td></tr>';
        }
        
    } catch (error) {
        showError('Failed to load duplicate analysis: ' + error.message);
    }
}

// Load advanced insights
async function loadAdvancedInsights() {
    try {
        const insights = await fetchAPI('/api/insights');
        
        // Productive artists table
        const artistsTbody = document.getElementById('productive-artists-tbody');
        artistsTbody.innerHTML = insights.productive_artists.map(artist => `
            <tr>
                <td>${artist.album_artist}</td>
                <td>${artist.release_count}</td>
                <td>${artist.first_release} - ${artist.latest_release}</td>
                <td>${artist.labels_worked_with}</td>
                <td>${artist.avg_tracks_per_album}</td>
            </tr>
        `).join('');
        
        // Prolific labels table
        const labelsTbody = document.getElementById('prolific-labels-tbody');
        labelsTbody.innerHTML = insights.prolific_labels.map(label => `
            <tr>
                <td>${label.label}</td>
                <td>${label.releases}</td>
                <td>${label.artist_count}</td>
                <td>${label.first_year} - ${label.latest_year}</td>
                <td>${label.quality_variety} types</td>
            </tr>
        `).join('');
        
        // Collection growth timeline chart
        if (charts.collectionGrowth) charts.collectionGrowth.destroy();
        const growthCtx = document.getElementById('collection-growth-chart').getContext('2d');
        
        const timelineData = insights.timeline_analysis.reverse(); // Show chronologically
        
        charts.collectionGrowth = new Chart(growthCtx, {
            type: 'line',
            data: {
                labels: timelineData.map(t => t.year),
                datasets: [{
                    label: 'Albums Added',
                    data: timelineData.map(t => t.albums_added),
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    fill: true
                }, {
                    label: 'New Artists',
                    data: timelineData.map(t => t.new_artists),
                    borderColor: '#764ba2',
                    backgroundColor: 'rgba(118, 75, 162, 0.1)',
                    fill: false
                }, {
                    label: 'Lossless Albums',
                    data: timelineData.map(t => t.lossless_count),
                    borderColor: '#84fab0',
                    backgroundColor: 'rgba(132, 250, 176, 0.1)',
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                },
                interaction: {
                    mode: 'index',
                    intersect: false
                }
            }
        });
        
    } catch (error) {
        showError('Failed to load insights: ' + error.message);
    }
}

// Utility function to format file sizes
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);