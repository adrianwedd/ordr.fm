// Global variables
let charts = {};
let data = {};
let deferredPrompt = null;
let isInstalled = false;
let ws = null;
let wsReconnectAttempts = 0;
let wsMaxReconnectAttempts = 5;

// API base URL (adjust if running on different port)
const API_BASE = '';

// PWA Installation tracking
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                   window.navigator.standalone || 
                   document.referrer.includes('android-app://');

// Initialize the dashboard
async function init() {
    try {
        // Initialize theme first
        initTheme();
        
        // Initialize PWA features
        initPWA();
        
        // Initialize WebSocket connection
        initWebSocket();
        
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

// Initialize WebSocket connection for real-time updates
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('WebSocket connected');
            wsReconnectAttempts = 0;
            
            // Subscribe to stats updates
            ws.send(JSON.stringify({
                type: 'subscribe',
                channels: ['stats', 'processing', 'alerts']
            }));
            
            // Update connection indicator
            updateConnectionStatus('connected');
        };
        
        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (error) {
                console.error('WebSocket message parse error:', error);
            }
        };
        
        ws.onclose = (event) => {
            console.log('WebSocket disconnected');
            updateConnectionStatus('disconnected');
            
            // Attempt to reconnect
            if (wsReconnectAttempts < wsMaxReconnectAttempts) {
                wsReconnectAttempts++;
                console.log(`Attempting to reconnect... (${wsReconnectAttempts}/${wsMaxReconnectAttempts})`);
                setTimeout(initWebSocket, Math.pow(2, wsReconnectAttempts) * 1000);
            }
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            updateConnectionStatus('error');
        };
        
    } catch (error) {
        console.error('Failed to initialize WebSocket:', error);
        updateConnectionStatus('error');
    }
}

// Handle WebSocket messages
function handleWebSocketMessage(message) {
    console.log('WebSocket message:', message);
    
    switch (message.type) {
        case 'connection':
            console.log('WebSocket connection confirmed:', message.message);
            break;
            
        case 'stats_update':
            updateRealTimeStats(message.data);
            break;
            
        case 'processing_update':
        case 'processing_complete':
        case 'enhancement_update':
        case 'enhancement_complete':
            showProcessingNotification(message.data);
            handleProcessingUpdate(message);
            break;
            
        case 'backup_update':
        case 'backup_complete':
            handleBackupUpdate(message);
            break;
            
        case 'alert':
            showAlert(message.data);
            break;
            
        case 'subscribed':
            console.log('Subscribed to channels:', message.channels);
            break;
            
        case 'pong':
            console.log('WebSocket pong received');
            break;
            
        default:
            console.log('Unknown WebSocket message type:', message.type);
    }
}

// Update real-time statistics
function updateRealTimeStats(stats) {
    if (document.getElementById('stat-albums')) {
        document.getElementById('stat-albums').textContent = stats.totalAlbums || 0;
    }
    if (document.getElementById('stat-tracks')) {
        document.getElementById('stat-tracks').textContent = stats.totalTracks || 0;
    }
    
    // Update last update time indicator
    const statusEl = document.getElementById('status');
    if (statusEl && statusEl.classList.contains('connected')) {
        const time = new Date(stats.lastUpdate).toLocaleTimeString();
        statusEl.textContent = `Connected (Updated: ${time})`;
    }
}

// Update connection status indicator
function updateConnectionStatus(status) {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;
    
    statusEl.classList.remove('connected', 'disconnected', 'error');
    
    switch (status) {
        case 'connected':
            statusEl.textContent = 'Connected (Real-time)';
            statusEl.classList.add('connected');
            break;
            
        case 'disconnected':
            statusEl.textContent = 'Disconnected (Trying to reconnect...)';
            statusEl.classList.add('disconnected');
            break;
            
        case 'error':
            statusEl.textContent = 'Connection Error';
            statusEl.classList.add('error');
            break;
    }
}

// Show processing notifications
function showProcessingNotification(data) {
    const notification = document.createElement('div');
    notification.className = 'processing-notification';
    notification.innerHTML = `
        <div class="notification-content">
            <span>📊 ${data.message}</span>
            <button onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    
    // Add CSS for processing notification
    if (!document.getElementById('notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            .processing-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(102, 126, 234, 0.9);
                color: white;
                padding: 15px;
                border-radius: 8px;
                z-index: 1000;
                animation: slideIn 0.3s ease-out;
                max-width: 300px;
            }
            .notification-content {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
            }
            .notification-content button {
                background: none;
                border: none;
                color: white;
                cursor: pointer;
                font-size: 18px;
            }
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            .status.disconnected { background: #ffc107; color: #212529; }
            .status.error { background: #dc3545; color: white; }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
}

// Show alert messages
function showAlert(data) {
    const alert = document.createElement('div');
    alert.className = 'alert-notification';
    alert.innerHTML = `
        <div class="alert-content">
            <span>${data.icon || '⚠️'} ${data.message}</span>
            <button onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    
    document.body.appendChild(alert);
    
    // Auto-remove after 10 seconds for alerts
    setTimeout(() => {
        if (alert.parentNode) {
            alert.remove();
        }
    }, 10000);
}

// Send WebSocket ping to keep connection alive
setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
    }
}, 30000); // Every 30 seconds

// Initialize PWA features
function initPWA() {
    // Register service worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', async () => {
            try {
                const registration = await navigator.serviceWorker.register('sw.js');
                console.log('Service Worker registered:', registration);
                
                // Handle service worker updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                showUpdateAvailable();
                            }
                        });
                    }
                });
                
                // Initialize push notifications
                initPushNotifications(registration);
                
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        });
    }
    
    // Handle install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        showInstallButton();
    });
    
    // Handle successful installation
    window.addEventListener('appinstalled', () => {
        isInstalled = true;
        hideInstallButton();
        console.log('PWA was installed');
    });
    
    // Create install button if not already installed
    if (!isStandalone) {
        createInstallButton();
    }
}

// Show install button
function showInstallButton() {
    const installBtn = document.getElementById('install-button');
    if (installBtn) {
        installBtn.style.display = 'block';
    }
}

// Hide install button
function hideInstallButton() {
    const installBtn = document.getElementById('install-button');
    if (installBtn) {
        installBtn.style.display = 'none';
    }
}

// Create install button
function createInstallButton() {
    const header = document.querySelector('header');
    const installBtn = document.createElement('button');
    installBtn.id = 'install-button';
    installBtn.innerHTML = '📱 Install App';
    installBtn.className = 'install-btn';
    installBtn.style.display = 'none';
    installBtn.onclick = installPWA;
    
    // Add CSS for install button
    const style = document.createElement('style');
    style.textContent = `
        .install-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 20px;
            cursor: pointer;
            font-size: 14px;
            margin-left: 10px;
            transition: background 0.3s;
        }
        .install-btn:hover {
            background: #564bd6;
        }
    `;
    document.head.appendChild(style);
    header.appendChild(installBtn);
}

// Install PWA
async function installPWA() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const result = await deferredPrompt.userChoice;
        if (result.outcome === 'accepted') {
            console.log('User accepted the install prompt');
        }
        deferredPrompt = null;
        hideInstallButton();
    }
}

// Show update available notification
function showUpdateAvailable() {
    const updateBar = document.createElement('div');
    updateBar.className = 'update-bar';
    updateBar.innerHTML = `
        <span>🔄 New version available!</span>
        <button onclick="refreshApp()">Update</button>
        <button onclick="dismissUpdate(this)">×</button>
    `;
    
    // Add CSS for update bar
    const style = document.createElement('style');
    style.textContent = `
        .update-bar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #667eea;
            color: white;
            padding: 10px;
            text-align: center;
            z-index: 1000;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 10px;
        }
        .update-bar button {
            background: rgba(255,255,255,0.2);
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 3px;
            cursor: pointer;
        }
    `;
    document.head.appendChild(style);
    document.body.prepend(updateBar);
}

// Refresh app for updates
function refreshApp() {
    window.location.reload();
}

// Dismiss update notification
function dismissUpdate(element) {
    element.parentElement.remove();
}

// Initialize push notifications
async function initPushNotifications(registration) {
    if (!('PushManager' in window)) {
        console.warn('Push notifications not supported');
        return;
    }
    
    try {
        // Check current permission
        let permission = Notification.permission;
        
        if (permission === 'default') {
            // Show permission request UI
            showNotificationPermissionUI();
        } else if (permission === 'granted') {
            await subscribeToPush(registration);
        }
        
    } catch (error) {
        console.error('Push notification initialization failed:', error);
    }
}

// Show notification permission UI
function showNotificationPermissionUI() {
    const permissionBar = document.createElement('div');
    permissionBar.className = 'permission-bar';
    permissionBar.innerHTML = `
        <div class="permission-content">
            <span>🔔 Enable notifications to get real-time updates about your music processing</span>
            <div class="permission-actions">
                <button onclick="requestNotificationPermission(this.parentElement.parentElement.parentElement)">Enable</button>
                <button onclick="dismissNotificationPermission(this.parentElement.parentElement.parentElement)">Not Now</button>
            </div>
        </div>
    `;
    
    // Add CSS for permission bar
    const style = document.createElement('style');
    style.textContent = `
        .permission-bar {
            position: fixed;
            bottom: 20px;
            left: 20px;
            right: 20px;
            background: rgba(255, 255, 255, 0.95);
            border: 1px solid #667eea;
            border-radius: 10px;
            padding: 15px;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            backdrop-filter: blur(10px);
        }
        .permission-content {
            display: flex;
            flex-direction: column;
            gap: 10px;
            text-align: center;
        }
        .permission-actions {
            display: flex;
            gap: 10px;
            justify-content: center;
        }
        .permission-actions button {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
        }
        .permission-actions button:first-child {
            background: #667eea;
            color: white;
        }
        .permission-actions button:last-child {
            background: #f0f0f0;
            color: #666;
        }
        @media (max-width: 480px) {
            .permission-bar {
                left: 10px;
                right: 10px;
                bottom: 10px;
            }
            .permission-content span {
                font-size: 14px;
            }
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(permissionBar);
}

// Request notification permission
async function requestNotificationPermission(permissionElement) {
    try {
        const permission = await Notification.requestPermission();
        
        if (permission === 'granted') {
            console.log('Notification permission granted');
            
            // Get service worker registration
            const registration = await navigator.serviceWorker.ready;
            await subscribeToPush(registration);
            
            // Show success message
            showProcessingNotification({ 
                message: 'Notifications enabled! You\'ll receive updates about your music processing.' 
            });
        } else {
            console.log('Notification permission denied');
            showProcessingNotification({ 
                message: 'Notifications disabled. You can enable them later in browser settings.' 
            });
        }
        
        permissionElement.remove();
        
    } catch (error) {
        console.error('Error requesting notification permission:', error);
    }
}

// Dismiss notification permission
function dismissNotificationPermission(permissionElement) {
    permissionElement.remove();
    
    // Remember dismissal for this session
    sessionStorage.setItem('notificationsDismissed', 'true');
}

// Subscribe to push notifications
async function subscribeToPush(registration) {
    try {
        // Check if already subscribed
        const existingSubscription = await registration.pushManager.getSubscription();
        if (existingSubscription) {
            console.log('Already subscribed to push notifications');
            return;
        }
        
        // Generate VAPID key (in production, this should be stored securely)
        const publicVapidKey = 'BEl62iUYgUivxIkv69yViEuiBIa40HI80NM2N3FnFNdR-5QJU2X3NhWEaBXY5rCR6Q9TpDGa4rgtpH7pYF5MU3c';
        
        // Subscribe user
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8Array(publicVapidKey)
        });
        
        console.log('Push subscription successful:', subscription);
        
        // Send subscription to server (if server supports it)
        try {
            await fetch('/api/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(subscription)
            });
        } catch (error) {
            console.warn('Could not send subscription to server:', error);
        }
        
    } catch (error) {
        console.error('Push subscription failed:', error);
    }
}

// Convert VAPID key
function urlB64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Test push notification
function testPushNotification() {
    if (Notification.permission === 'granted') {
        new Notification('ordr.fm Test', {
            body: 'Push notifications are working!',
            icon: 'icons/icon-192x192.png',
            badge: 'icons/icon-72x72.png',
            tag: 'test-notification',
            requireInteraction: false,
            vibrate: [100, 50, 100]
        });
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
        case 'actions':
            initActionsTab();
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

// Touch interaction handlers
function initTouchInteractions() {
    // Add touch support for tab switching with swipe gestures
    let touchStartX = 0;
    let touchEndX = 0;
    let activeTabIndex = 0;
    
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // Track current active tab
    function updateActiveTabIndex() {
        tabs.forEach((tab, index) => {
            if (tab.classList.contains('active')) {
                activeTabIndex = index;
            }
        });
    }
    
    // Handle swipe gestures on main content area
    const container = document.querySelector('.container');
    if (container) {
        container.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        
        container.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleTabSwipe();
        }, { passive: true });
    }
    
    function handleTabSwipe() {
        const swipeThreshold = 50;
        const swipeDistance = touchEndX - touchStartX;
        
        if (Math.abs(swipeDistance) > swipeThreshold) {
            updateActiveTabIndex();
            
            if (swipeDistance > 0 && activeTabIndex > 0) {
                // Swipe right - previous tab
                tabs[activeTabIndex - 1].click();
            } else if (swipeDistance < 0 && activeTabIndex < tabs.length - 1) {
                // Swipe left - next tab
                tabs[activeTabIndex + 1].click();
            }
        }
    }
    
    // Add haptic feedback for supported devices
    function hapticFeedback() {
        if ('vibrate' in navigator) {
            navigator.vibrate(10); // Subtle haptic feedback
        }
    }
    
    // Add haptic feedback to buttons
    document.querySelectorAll('.tab, button, .card').forEach(element => {
        element.addEventListener('touchstart', () => {
            hapticFeedback();
        }, { passive: true });
    });
    
    // Handle pull-to-refresh gesture
    let pullToRefreshStartY = 0;
    let pullToRefreshDistance = 0;
    let isPulling = false;
    
    container.addEventListener('touchstart', (e) => {
        if (window.scrollY === 0) {
            pullToRefreshStartY = e.touches[0].clientY;
            isPulling = true;
        }
    }, { passive: true });
    
    container.addEventListener('touchmove', (e) => {
        if (isPulling && window.scrollY === 0) {
            pullToRefreshDistance = e.touches[0].clientY - pullToRefreshStartY;
            
            if (pullToRefreshDistance > 100) {
                // Visual feedback for pull-to-refresh
                showPullToRefreshIndicator();
            }
        }
    }, { passive: true });
    
    container.addEventListener('touchend', (e) => {
        if (isPulling && pullToRefreshDistance > 120) {
            // Trigger refresh
            refreshCurrentTab();
            hapticFeedback();
        }
        
        isPulling = false;
        pullToRefreshDistance = 0;
        hidePullToRefreshIndicator();
    }, { passive: true });
}

// Show pull-to-refresh indicator
function showPullToRefreshIndicator() {
    let indicator = document.getElementById('pull-refresh-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'pull-refresh-indicator';
        indicator.innerHTML = '🔄 Pull to refresh';
        indicator.style.cssText = `
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(102, 126, 234, 0.9);
            color: white;
            padding: 10px 20px;
            border-radius: 20px;
            z-index: 1000;
            font-size: 14px;
        `;
        document.body.appendChild(indicator);
    }
    indicator.style.display = 'block';
}

// Hide pull-to-refresh indicator
function hidePullToRefreshIndicator() {
    const indicator = document.getElementById('pull-refresh-indicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
}

// Refresh current tab data
function refreshCurrentTab() {
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) {
        const tabName = activeTab.textContent.toLowerCase().replace(/\s+/g, '');
        
        // Map tab names to their data loading functions
        const refreshFunctions = {
            'overview': loadOverview,
            'collectionhealth': loadCollectionHealth,
            'duplicates': loadDuplicateAnalysis,
            'insights': loadAdvancedInsights,
            'albums': loadAlbums,
            'artists': loadArtists,
            'labels': loadLabels,
            'timeline': loadTimeline,
            'movehistory': loadMoves
        };
        
        const refreshFunction = refreshFunctions[tabName];
        if (refreshFunction) {
            refreshFunction();
            showProcessingNotification({ message: 'Refreshed data' });
        }
    }
}

// Enhanced chart responsiveness for mobile
function makeChartsResponsive() {
    // Override Chart.js defaults for mobile
    if (window.Chart) {
        Chart.defaults.responsive = true;
        Chart.defaults.maintainAspectRatio = false;
        
        // Mobile-specific chart options
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
            Chart.defaults.plugins.legend.labels.boxWidth = 15;
            Chart.defaults.plugins.legend.labels.padding = 10;
            Chart.defaults.plugins.legend.labels.font = { size: 12 };
        }
    }
}

// Mobile UI component functions
function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    menu.classList.toggle('open');
}

function closeMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    menu.classList.remove('open');
}

// Show swipe indicators
function showSwipeIndicator(direction) {
    const indicator = document.getElementById(`swipe-${direction}`);
    if (indicator) {
        indicator.classList.add('show');
        setTimeout(() => {
            indicator.classList.remove('show');
        }, 1000);
    }
}

// Create mobile-optimized loading skeleton
function createMobileSkeleton(container) {
    const skeleton = document.createElement('div');
    skeleton.className = 'mobile-card';
    skeleton.innerHTML = `
        <div class="mobile-skeleton mobile-skeleton-text short"></div>
        <div class="mobile-skeleton mobile-skeleton-text long"></div>
        <div class="mobile-skeleton mobile-skeleton-text short"></div>
    `;
    
    container.innerHTML = '';
    for (let i = 0; i < 3; i++) {
        container.appendChild(skeleton.cloneNode(true));
    }
}

// Create mobile-optimized metric card
function createMobileMetricCard(title, metrics) {
    const card = document.createElement('div');
    card.className = 'mobile-card';
    
    let metricsHTML = '';
    metrics.forEach(metric => {
        metricsHTML += `
            <div class="mobile-metric">
                <span class="mobile-metric-label">${metric.label}</span>
                <span class="mobile-metric-value">${metric.value}</span>
            </div>
        `;
    });
    
    card.innerHTML = `
        <h3>${title}</h3>
        ${metricsHTML}
    `;
    
    return card;
}

// Create mobile progress indicator
function createMobileProgressBar(percentage) {
    const progressBar = document.createElement('div');
    progressBar.className = 'mobile-progress-bar';
    progressBar.innerHTML = `<div class="mobile-progress-fill" style="width: ${percentage}%"></div>`;
    return progressBar;
}

// Enhanced mobile touch feedback
function addMobileTouchFeedback() {
    // Add touch feedback to interactive elements
    const interactiveElements = document.querySelectorAll('.mobile-card, .tab, .mobile-fab');
    
    interactiveElements.forEach(element => {
        element.addEventListener('touchstart', function() {
            this.style.transform = 'scale(0.98)';
            this.style.transition = 'transform 0.1s ease';
        }, { passive: true });
        
        element.addEventListener('touchend', function() {
            this.style.transform = '';
            this.style.transition = '';
        }, { passive: true });
    });
}

// Mobile-specific loading states
function showMobileLoading(message = 'Loading...') {
    const loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'mobile-loading';
    loadingOverlay.innerHTML = `
        <div style="
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(255,255,255,0.9);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 2000;
            backdrop-filter: blur(4px);
        ">
            <div style="
                width: 40px;
                height: 40px;
                border: 3px solid #f0f0f0;
                border-top: 3px solid #667eea;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-bottom: 16px;
            "></div>
            <div style="color: #666; font-size: 16px;">${message}</div>
        </div>
    `;
    
    // Add spinner animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(loadingOverlay);
}

function hideMobileLoading() {
    const loadingOverlay = document.getElementById('mobile-loading');
    if (loadingOverlay) {
        loadingOverlay.remove();
    }
}

// Initialize mobile-specific features
function initMobileFeatures() {
    // Add touch feedback
    addMobileTouchFeedback();
    
    // Handle orientation changes
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            // Recalculate chart sizes after orientation change
            Object.values(charts).forEach(chart => {
                if (chart && typeof chart.resize === 'function') {
                    chart.resize();
                }
            });
        }, 100);
    });
    
    // Close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('mobile-menu');
        const fab = document.getElementById('mobile-fab');
        
        if (menu.classList.contains('open') && 
            !menu.contains(e.target) && 
            !fab.contains(e.target)) {
            closeMobileMenu();
        }
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    init();
    initTouchInteractions();
    makeChartsResponsive();
    initMobileFeatures();
    
    // Re-initialize touch interactions on window resize
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            makeChartsResponsive();
            
            // Redraw charts for new size
            Object.values(charts).forEach(chart => {
                if (chart && typeof chart.resize === 'function') {
                    chart.resize();
                }
            });
        }, 250);
    });
});

// ===== THEME FUNCTIONS =====

// Initialize theme based on localStorage or system preference
function initTheme() {
    const savedTheme = localStorage.getItem('ordr-fm-theme');
    const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Default to dark theme unless user explicitly chose light or system prefers light
    let isDark = true; // Default
    
    if (savedTheme) {
        isDark = savedTheme === 'dark';
    } else if (!systemPrefersDark) {
        // Only use light theme if system explicitly prefers light and no saved preference
        isDark = false;
    }
    
    if (isDark) {
        document.body.classList.remove('light-theme');
        updateThemeToggle(true);
    } else {
        document.body.classList.add('light-theme');
        updateThemeToggle(false);
    }
}

// Toggle between light and dark themes
function toggleTheme() {
    const isCurrentlyDark = !document.body.classList.contains('light-theme');
    
    if (isCurrentlyDark) {
        // Switch to light theme
        document.body.classList.add('light-theme');
        localStorage.setItem('ordr-fm-theme', 'light');
        updateThemeToggle(false);
    } else {
        // Switch to dark theme
        document.body.classList.remove('light-theme');
        localStorage.setItem('ordr-fm-theme', 'dark');
        updateThemeToggle(true);
    }
}

// Update theme toggle button text and icon
function updateThemeToggle(isDark) {
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
        toggle.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
    }
}

// Listen for system theme changes
if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addListener((e) => {
        if (!localStorage.getItem('ordr-fm-theme')) {
            // Only auto-switch if user hasn't manually set preference
            if (e.matches) {
                document.body.classList.remove('light-theme');
                updateThemeToggle(true);
            } else {
                document.body.classList.add('light-theme');
                updateThemeToggle(false);
            }
        }
    });
}

// ===== ACTION FUNCTIONS =====

// Handle source directory selection
function handleSourceDirectoryChange() {
    const select = document.getElementById('source-directory');
    const customInput = document.getElementById('custom-source');
    
    if (select.value === 'custom') {
        customInput.style.display = 'block';
        customInput.focus();
    } else if (select.value === 'browse') {
        customInput.style.display = 'none';
        openFileBrowser();
    } else {
        customInput.style.display = 'none';
    }
}

// File Browser functionality
let currentBrowsePath = '/home/plex/Music';
let selectedPath = null;

async function openFileBrowser(startPath = '/home/plex/Music') {
    currentBrowsePath = startPath;
    selectedPath = startPath;
    
    const modal = document.getElementById('file-browser-modal');
    modal.style.display = 'flex';
    
    await loadDirectoryContents(startPath);
}

function closeFileBrowser() {
    const modal = document.getElementById('file-browser-modal');
    modal.style.display = 'none';
    
    // Reset source select if no folder was selected
    const select = document.getElementById('source-directory');
    if (!selectedPath || selectedPath === currentBrowsePath) {
        select.value = select.options[0].value; // Reset to first option
    }
}

async function loadDirectoryContents(path) {
    const listElement = document.getElementById('directory-list');
    const pathElement = document.getElementById('current-path');
    const upButton = document.getElementById('go-up');
    
    listElement.innerHTML = '<div class="loading">Loading directories...</div>';
    pathElement.textContent = path;
    currentBrowsePath = path;
    
    // Enable/disable up button
    upButton.disabled = (path === '/' || path === '/home/plex/Music');
    
    try {
        const response = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Failed to load directory');
        }
        
        displayDirectoryContents(result);
        
    } catch (error) {
        listElement.innerHTML = `
            <div class="error-message">
                ⚠️ Error: ${error.message}
            </div>
        `;
    }
}

function displayDirectoryContents(data) {
    const listElement = document.getElementById('directory-list');
    
    if (data.items.length === 0) {
        listElement.innerHTML = '<div class="loading">No directories or audio files found</div>';
        return;
    }
    
    listElement.innerHTML = data.items.map(item => {
        const icon = item.type === 'directory' ? 
            (item.hasAudioFiles ? '🎵' : '📁') : 
            getAudioFileIcon(item.name);
        
        const details = item.type === 'directory' ? 
            `${item.hasAudioFiles ? 'Contains audio files' : 'Empty folder'}` :
            `${formatBytes(item.size)} • ${new Date(item.modified).toLocaleDateString()}`;
            
        return `
            <div class="file-item" onclick="selectItem('${item.path}', '${item.type}', '${item.name}')">
                <div class="file-icon">${icon}</div>
                <div class="file-info">
                    <div class="file-name">${item.name}</div>
                    <div class="file-details">${details}</div>
                </div>
            </div>
        `;
    }).join('');
}

function selectItem(path, type, name) {
    // Remove previous selection
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    // Add selection to clicked item
    event.target.closest('.file-item').classList.add('selected');
    
    if (type === 'directory') {
        // If it's a directory, navigate into it
        loadDirectoryContents(path);
    } else {
        // If it's a file, select its parent directory
        const parentPath = path.substring(0, path.lastIndexOf('/'));
        selectedPath = parentPath;
    }
    
    selectedPath = type === 'directory' ? path : path.substring(0, path.lastIndexOf('/'));
}

function navigateUp() {
    const upButton = document.getElementById('go-up');
    if (upButton.disabled) return;
    
    const parentPath = currentBrowsePath.substring(0, currentBrowsePath.lastIndexOf('/'));
    if (parentPath) {
        loadDirectoryContents(parentPath);
    }
}

function selectCurrentFolder() {
    if (!selectedPath && currentBrowsePath) {
        selectedPath = currentBrowsePath;
    }
    
    if (selectedPath) {
        // Add the selected path as a custom option
        const select = document.getElementById('source-directory');
        const customInput = document.getElementById('custom-source');
        
        // Remove any previous browser selection
        const existingOption = select.querySelector('option[data-browser="true"]');
        if (existingOption) {
            existingOption.remove();
        }
        
        // Add new option
        const option = document.createElement('option');
        option.value = selectedPath;
        option.textContent = `📁 ${selectedPath.split('/').pop() || 'Selected Folder'}`;
        option.setAttribute('data-browser', 'true');
        select.appendChild(option);
        
        // Select the new option
        select.value = selectedPath;
        customInput.style.display = 'none';
        
        closeFileBrowser();
    }
}

function getAudioFileIcon(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    switch (ext) {
        case 'mp3': return '🎵';
        case 'flac': return '🎶';
        case 'wav': case 'aiff': return '🔊';
        case 'aac': case 'm4a': return '🎧';
        case 'ogg': return '🎼';
        default: return '🎵';
    }
}

// Start music processing
async function startProcessing(moveFiles = false) {
    const sourceSelect = document.getElementById('source-directory');
    const customInput = document.getElementById('custom-source');
    const enableDiscogs = document.getElementById('enable-discogs').checked;
    const electronicMode = document.getElementById('electronic-mode').checked;
    
    let sourceDirectory = sourceSelect.value;
    if (sourceDirectory === 'custom') {
        sourceDirectory = customInput.value.trim();
        if (!sourceDirectory) {
            showError('Please enter a custom source directory');
            return;
        }
    }
    
    // Subscribe to processing updates
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'subscribe',
            channels: ['processing']
        }));
    }
    
    // Show progress section
    const progressSection = document.getElementById('processing-progress');
    const progressBar = document.getElementById('processing-progress-bar');
    const statusText = document.getElementById('processing-status');
    const logElement = document.getElementById('processing-log');
    
    progressSection.style.display = 'block';
    progressBar.style.width = '10%';
    statusText.textContent = moveFiles ? 'Starting processing (LIVE MODE)...' : 'Starting dry run...';
    logElement.textContent = '';
    
    // Disable buttons during processing
    const buttons = document.querySelectorAll('#actions .action-btn');
    buttons.forEach(btn => btn.disabled = true);
    
    try {
        const response = await fetch('/api/actions/process', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sourceDirectory: sourceDirectory,
                dryRun: !moveFiles,
                enableDiscogs: enableDiscogs,
                electronicMode: electronicMode
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            statusText.textContent = 'Processing started...';
            progressBar.style.width = '20%';
            logElement.textContent += `Command: ${result.command}\n`;
        } else {
            throw new Error(result.error || 'Failed to start processing');
        }
        
    } catch (error) {
        showError('Failed to start processing: ' + error.message);
        statusText.textContent = 'Failed to start';
        buttons.forEach(btn => btn.disabled = false);
    }
}

// Handle processing updates from WebSocket
function handleProcessingUpdate(data) {
    const progressBar = document.getElementById('processing-progress-bar');
    const statusText = document.getElementById('processing-status');
    const logElement = document.getElementById('processing-log');
    
    if (data.type === 'processing_update') {
        statusText.textContent = 'Processing in progress...';
        progressBar.style.width = '50%';
        logElement.textContent += data.data.output;
        logElement.scrollTop = logElement.scrollHeight;
    } else if (data.type === 'processing_complete') {
        const buttons = document.querySelectorAll('#actions .action-btn');
        buttons.forEach(btn => btn.disabled = false);
        
        if (data.data.success) {
            statusText.textContent = 'Processing completed successfully!';
            progressBar.style.width = '100%';
        } else {
            statusText.textContent = 'Processing failed';
            showError('Processing failed: ' + (data.data.error || 'Unknown error'));
        }
        
        // Refresh stats after processing
        setTimeout(() => {
            if (document.getElementById('overview').classList.contains('active')) {
                loadOverview();
            }
        }, 2000);
    }
}

// Enhance existing metadata
async function enhanceMetadata() {
    const enableDiscogs = document.getElementById('enable-discogs').checked;
    
    if (!enableDiscogs) {
        showError('Please enable Discogs lookup for metadata enhancement');
        return;
    }
    
    if (!confirm('This will re-process your first 10 organized albums with Discogs enrichment. Continue?')) {
        return;
    }
    
    // Subscribe to enhancement updates
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'subscribe',
            channels: ['processing']
        }));
    }
    
    // Show progress in the processing section
    const progressSection = document.getElementById('processing-progress');
    const progressBar = document.getElementById('processing-progress-bar');
    const statusText = document.getElementById('processing-status');
    const logElement = document.getElementById('processing-log');
    
    progressSection.style.display = 'block';
    progressBar.style.width = '10%';
    statusText.textContent = 'Starting metadata enhancement...';
    logElement.textContent = '';
    
    try {
        const response = await fetch('/api/actions/enhance-metadata', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                force: false
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            statusText.textContent = 'Metadata enhancement started...';
            progressBar.style.width = '20%';
            logElement.textContent += `${result.description}\n`;
        } else {
            throw new Error(result.error || 'Failed to start metadata enhancement');
        }
        
    } catch (error) {
        showError('Failed to start metadata enhancement: ' + error.message);
        statusText.textContent = 'Enhancement failed to start';
    }
}

// Start database backup
async function startDatabaseBackup() {
    const indicator = document.getElementById('db-backup-indicator');
    const text = document.getElementById('db-backup-text');
    
    indicator.textContent = '⏳';
    text.textContent = 'Creating backup...';
    
    try {
        const response = await fetch('/api/actions/backup-database', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
            indicator.textContent = '✅';
            text.textContent = `Backup completed (${formatBytes(result.size)})`;
        } else {
            throw new Error(result.error || 'Backup failed');
        }
        
    } catch (error) {
        indicator.textContent = '❌';
        text.textContent = 'Backup failed';
        showError('Database backup failed: ' + error.message);
    }
}

// Restore database
async function restoreDatabase() {
    if (!confirm('Are you sure you want to restore the database? This will overwrite current data.')) {
        return;
    }
    showError('Database restore not yet implemented');
    // TODO: Implement database restore functionality
}

// Start cloud backup
async function startCloudBackup() {
    const target = document.getElementById('backup-target').value;
    const indicator = document.getElementById('cloud-backup-indicator');
    const text = document.getElementById('cloud-backup-text');
    
    // Subscribe to backup updates
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'subscribe',
            channels: ['backup']
        }));
    }
    
    // Show progress section
    const progressSection = document.getElementById('backup-progress');
    const progressBar = document.getElementById('backup-progress-bar');
    const statusText = document.getElementById('backup-status-text');
    
    progressSection.style.display = 'block';
    progressBar.style.width = '10%';
    
    indicator.textContent = '⏳';
    text.textContent = 'Starting backup...';
    statusText.textContent = 'Initializing backup...';
    
    try {
        const response = await fetch('/api/actions/backup-cloud', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                target: target
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            statusText.textContent = 'Cloud backup started...';
            progressBar.style.width = '20%';
        } else {
            throw new Error(result.error || 'Failed to start backup');
        }
        
    } catch (error) {
        indicator.textContent = '❌';
        text.textContent = 'Backup failed to start';
        showError('Failed to start cloud backup: ' + error.message);
    }
}

// Pause cloud backup
async function pauseCloudBackup() {
    showError('Backup pause not yet implemented');
    // TODO: Implement backup pause functionality
}

// Handle backup updates from WebSocket
function handleBackupUpdate(data) {
    const indicator = document.getElementById('cloud-backup-indicator');
    const text = document.getElementById('cloud-backup-text');
    const progressBar = document.getElementById('backup-progress-bar');
    const statusText = document.getElementById('backup-status-text');
    
    if (data.type === 'backup_update') {
        indicator.textContent = '⏳';
        text.textContent = 'Backup in progress...';
        statusText.textContent = 'Syncing files...';
        progressBar.style.width = '60%';
    } else if (data.type === 'backup_complete') {
        if (data.data.success) {
            indicator.textContent = '✅';
            text.textContent = 'Backup completed successfully';
            statusText.textContent = 'All files synced';
            progressBar.style.width = '100%';
        } else {
            indicator.textContent = '❌';
            text.textContent = 'Backup failed';
            statusText.textContent = 'Backup failed';
            showError('Cloud backup failed: ' + (data.data.error || 'Unknown error'));
        }
    }
}

// Load system status
async function loadSystemStatus() {
    try {
        const status = await fetchAPI('/api/system/status');
        
        // Update dependencies status
        Object.entries(status.dependencies).forEach(([dep, isAvailable]) => {
            const element = document.getElementById(`${dep}-status`);
            if (element) {
                element.textContent = isAvailable ? '✅' : '❌';
            }
        });
        
        // Update disk space
        if (status.diskSpace.home) {
            document.getElementById('source-disk-space').textContent = 
                `${status.diskSpace.home.available} available (${status.diskSpace.home.usePercent} used)`;
        }
        if (status.diskSpace.root) {
            document.getElementById('dest-disk-space').textContent = 
                `${status.diskSpace.root.available} available (${status.diskSpace.root.usePercent} used)`;
        }
        
        // Update services status
        document.getElementById('script-status').textContent = '✅';
        document.getElementById('discogs-status').textContent = 
            status.services.discogs !== 'Not configured' ? '✅' : '❌';
        document.getElementById('backup-service-status').textContent = '✅';
        
        // Update database info
        const dbSizeElement = document.getElementById('db-disk-space');
        if (dbSizeElement) {
            dbSizeElement.textContent = status.services.database ? 'Available' : 'Not found';
        }
        
    } catch (error) {
        console.error('Failed to load system status:', error);
    }
}

// Load recent activity
async function loadRecentActivity() {
    try {
        const result = await fetchAPI('/api/system/activity');
        const container = document.querySelector('#recent-activity .activity-log');
        
        if (result.activities && result.activities.length > 0) {
            container.innerHTML = result.activities
                .map(activity => `
                    <div class="activity-item">
                        <span class="activity-time">${activity.time}</span>
                        <span class="activity-desc">${activity.description}</span>
                    </div>
                `).join('');
        } else {
            container.innerHTML = `
                <div class="activity-item">
                    <span class="activity-time">-</span>
                    <span class="activity-desc">No recent activity</span>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('Failed to load recent activity:', error);
    }
}

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Initialize Actions tab when shown
function initActionsTab() {
    // Set up source directory change handler
    const sourceSelect = document.getElementById('source-directory');
    if (sourceSelect) {
        sourceSelect.addEventListener('change', handleSourceDirectoryChange);
    }
    
    // Load system status and recent activity
    loadSystemStatus();
    loadRecentActivity();
    
    // Subscribe to WebSocket updates for actions
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'subscribe',
            channels: ['processing', 'backup']
        }));
    }
}

// App Control Functions
function reloadApp() {
    const statusElement = document.getElementById('app-control-status');
    statusElement.style.display = 'block';
    statusElement.innerHTML = '🔄 Reloading application...';
    
    // Clear service worker cache and reload
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
            registrations.forEach(registration => {
                registration.unregister();
            });
            
            // Clear all caches
            if ('caches' in window) {
                caches.keys().then(cacheNames => {
                    return Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
                }).then(() => {
                    // Force hard reload
                    window.location.reload(true);
                });
            } else {
                window.location.reload(true);
            }
        });
    } else {
        // Fallback for browsers without service worker
        window.location.reload(true);
    }
}

function clearCache() {
    const statusElement = document.getElementById('app-control-status');
    statusElement.style.display = 'block';
    statusElement.innerHTML = '🗑️ Clearing cache...';
    
    if ('caches' in window) {
        caches.keys().then(cacheNames => {
            return Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
        }).then(() => {
            // Clear IndexedDB
            if (window.indexedDB) {
                // Clear offline data
                const deleteReq = indexedDB.deleteDatabase('ordr-fm-offline');
                deleteReq.onsuccess = () => {
                    statusElement.innerHTML = '✅ Cache cleared successfully';
                    setTimeout(() => {
                        statusElement.style.display = 'none';
                    }, 3000);
                };
            } else {
                statusElement.innerHTML = '✅ Cache cleared successfully';
                setTimeout(() => {
                    statusElement.style.display = 'none';
                }, 3000);
            }
        }).catch(error => {
            console.error('Error clearing cache:', error);
            statusElement.innerHTML = '❌ Error clearing cache';
        });
    } else {
        statusElement.innerHTML = '⚠️ Cache API not supported';
        setTimeout(() => {
            statusElement.style.display = 'none';
        }, 3000);
    }
}

function checkForUpdates() {
    const statusElement = document.getElementById('app-control-status');
    statusElement.style.display = 'block';
    statusElement.innerHTML = '⬇️ Checking for updates...';
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(registration => {
            if (registration) {
                // Check for updates
                registration.update().then(() => {
                    if (registration.waiting) {
                        statusElement.innerHTML = '🆕 Update available! <button onclick="applyUpdate()" class="action-btn primary">Apply Now</button>';
                    } else {
                        statusElement.innerHTML = '✅ App is up to date';
                        setTimeout(() => {
                            statusElement.style.display = 'none';
                        }, 3000);
                    }
                });
            } else {
                statusElement.innerHTML = '⚠️ Service worker not registered';
            }
        });
    } else {
        // Fallback: check version via API
        fetch('/api/version').then(response => response.json())
            .then(data => {
                statusElement.innerHTML = `ℹ️ Current version: ${data.version}`;
                setTimeout(() => {
                    statusElement.style.display = 'none';
                }, 3000);
            })
            .catch(() => {
                statusElement.innerHTML = '❌ Unable to check for updates';
            });
    }
}

function applyUpdate() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(registration => {
            if (registration && registration.waiting) {
                registration.waiting.postMessage('skipWaiting');
                window.location.reload();
            }
        });
    }
}

// Metadata Enrichment Functions
let currentEnrichmentData = null;
let selectedAlbumId = null;

function openMetadataSearch() {
    const modal = document.getElementById('metadata-search-modal');
    modal.style.display = 'flex';
    
    // Reset form
    document.getElementById('search-artist').value = '';
    document.getElementById('search-album').value = '';
    document.getElementById('search-label').value = '';
    document.getElementById('search-year').value = '';
    
    // Hide results and preview
    document.getElementById('search-results').style.display = 'none';
    document.getElementById('enrichment-preview').style.display = 'none';
}

function closeMetadataSearch() {
    const modal = document.getElementById('metadata-search-modal');
    modal.style.display = 'none';
    currentEnrichmentData = null;
    selectedAlbumId = null;
}

async function searchDiscogs() {
    const artist = document.getElementById('search-artist').value.trim();
    const album = document.getElementById('search-album').value.trim();
    const label = document.getElementById('search-label').value.trim();
    const year = document.getElementById('search-year').value.trim();
    
    if (!artist || !album) {
        alert('Please enter artist and album name');
        return;
    }
    
    const resultsContainer = document.getElementById('results-list');
    resultsContainer.innerHTML = '<div class="loading">🔍 Searching Discogs...</div>';
    document.getElementById('search-results').style.display = 'block';
    
    try {
        const params = new URLSearchParams({ artist, album });
        if (label) params.append('label', label);
        if (year) params.append('year', year);
        
        const response = await fetch(`/api/enrichment/discogs/search?${params}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Search failed');
        }
        
        displaySearchResults(data.results, 'discogs');
        
    } catch (error) {
        console.error('Discogs search error:', error);
        resultsContainer.innerHTML = `<div class="error">❌ Search failed: ${error.message}</div>`;
    }
}

async function searchMusicBrainz() {
    const artist = document.getElementById('search-artist').value.trim();
    const album = document.getElementById('search-album').value.trim();
    
    if (!artist || !album) {
        alert('Please enter artist and album name');
        return;
    }
    
    const resultsContainer = document.getElementById('results-list');
    resultsContainer.innerHTML = '<div class="loading">🔍 Searching MusicBrainz...</div>';
    document.getElementById('search-results').style.display = 'block';
    
    try {
        const params = new URLSearchParams({ artist, album });
        const response = await fetch(`/api/enrichment/musicbrainz/search?${params}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Search failed');
        }
        
        displaySearchResults(data.results, 'musicbrainz');
        
    } catch (error) {
        console.error('MusicBrainz search error:', error);
        resultsContainer.innerHTML = `<div class="error">❌ Search failed: ${error.message}</div>`;
    }
}

function displaySearchResults(results, source) {
    const resultsContainer = document.getElementById('results-list');
    
    if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="no-results">No results found</div>';
        return;
    }
    
    resultsContainer.innerHTML = results.map((result, index) => {
        const confidence = Math.round(result.confidence * 100);
        const sourceIcon = source === 'discogs' ? '🎵' : '🎶';
        
        return `
            <div class="search-result-item" onclick="selectSearchResult('${source}', '${result.id}')">
                <div class="result-header">
                    <span class="result-source">${sourceIcon} ${source.toUpperCase()}</span>
                    <span class="result-confidence">${confidence}% match</span>
                </div>
                <div class="result-title">${result.title}</div>
                <div class="result-details">
                    <span>Artist: ${result.artist}</span>
                    ${result.year ? `<span>Year: ${result.year}</span>` : ''}
                    ${result.label ? `<span>Label: ${result.label}</span>` : ''}
                    ${result.catno ? `<span>Cat#: ${result.catno}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

async function selectSearchResult(source, id) {
    const previewContainer = document.getElementById('preview-content');
    previewContainer.innerHTML = '<div class="loading">Loading metadata...</div>';
    document.getElementById('enrichment-preview').style.display = 'block';
    
    try {
        const response = await fetch(`/api/enrichment/${source}/release/${id}`);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to load metadata');
        }
        
        currentEnrichmentData = { source, data };
        displayEnrichmentPreview(data, source);
        
    } catch (error) {
        console.error('Metadata load error:', error);
        previewContainer.innerHTML = `<div class="error">❌ Failed to load: ${error.message}</div>`;
    }
}

function displayEnrichmentPreview(data, source) {
    const previewContainer = document.getElementById('preview-content');
    
    let html = `<div class="enrichment-data">`;
    
    if (source === 'discogs') {
        html += `
            <div class="metadata-section">
                <h5>Basic Information</h5>
                <p><strong>Title:</strong> ${data.title || 'N/A'}</p>
                <p><strong>Artists:</strong> ${data.artists?.join(', ') || 'N/A'}</p>
                <p><strong>Year:</strong> ${data.year || 'N/A'}</p>
                <p><strong>Country:</strong> ${data.country || 'N/A'}</p>
            </div>
            
            <div class="metadata-section">
                <h5>Label Information</h5>
                ${data.labels?.map(label => `
                    <p><strong>${label.name}:</strong> ${label.catno || 'N/A'}</p>
                `).join('') || '<p>No label information</p>'}
            </div>
            
            <div class="metadata-section">
                <h5>Genres & Styles</h5>
                <p><strong>Genres:</strong> ${data.genres?.join(', ') || 'N/A'}</p>
                <p><strong>Styles:</strong> ${data.styles?.join(', ') || 'N/A'}</p>
            </div>
            
            <div class="metadata-section">
                <h5>Formats</h5>
                <p>${data.formats?.map(f => `${f.name} ${f.descriptions?.join(', ') || ''}`).join(', ') || 'N/A'}</p>
            </div>
        `;
        
        if (data.images?.length) {
            html += `
                <div class="metadata-section">
                    <h5>Cover Art</h5>
                    <img src="${data.images[0].uri}" alt="Cover" style="max-width: 200px; max-height: 200px;">
                </div>
            `;
        }
        
    } else if (source === 'musicbrainz') {
        html += `
            <div class="metadata-section">
                <h5>Basic Information</h5>
                <p><strong>Title:</strong> ${data.title || 'N/A'}</p>
                <p><strong>Artists:</strong> ${data.artists?.join(', ') || 'N/A'}</p>
                <p><strong>Date:</strong> ${data.date || 'N/A'}</p>
                <p><strong>Country:</strong> ${data.country || 'N/A'}</p>
                <p><strong>Status:</strong> ${data.status || 'N/A'}</p>
            </div>
            
            <div class="metadata-section">
                <h5>Label Information</h5>
                ${data.labels?.map(label => `
                    <p><strong>${label.name}:</strong> ${label.catalog_number || 'N/A'}</p>
                `).join('') || '<p>No label information</p>'}
            </div>
            
            <div class="metadata-section">
                <h5>Additional Info</h5>
                <p><strong>Barcode:</strong> ${data.barcode || 'N/A'}</p>
                <p><strong>Packaging:</strong> ${data.packaging || 'N/A'}</p>
            </div>
        `;
        
        if (data.media?.length) {
            html += `
                <div class="metadata-section">
                    <h5>Track Listing</h5>
                    ${data.media.map(medium => `
                        <div class="medium">
                            <h6>${medium.format} ${medium.position}${medium.title ? ` - ${medium.title}` : ''}</h6>
                            ${medium.tracks?.slice(0, 5).map(track => `
                                <p>${track.position}. ${track.title} ${track.length ? `(${track.length})` : ''}</p>
                            `).join('') || ''}
                            ${medium.tracks?.length > 5 ? `<p>... and ${medium.tracks.length - 5} more tracks</p>` : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        }
    }
    
    html += `</div>`;
    previewContainer.innerHTML = html;
}

function closePreview() {
    document.getElementById('enrichment-preview').style.display = 'none';
    currentEnrichmentData = null;
}

async function applyEnrichment() {
    if (!currentEnrichmentData) {
        alert('No enrichment data selected');
        return;
    }
    
    // For demo purposes, we'll show a success message
    // In a real implementation, you'd need to select an album first
    if (!selectedAlbumId) {
        alert('This is a demo. In a real scenario, you would select an album from your collection first.');
        return;
    }
    
    try {
        const response = await fetch('/api/enrichment/apply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                album_id: selectedAlbumId,
                source: currentEnrichmentData.source,
                enrichment_data: currentEnrichmentData.data
            })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Failed to apply enrichment');
        }
        
        alert('✅ Enrichment applied successfully!');
        closeMetadataSearch();
        
        // Refresh the data
        loadStats();
        
    } catch (error) {
        console.error('Apply enrichment error:', error);
        alert(`❌ Failed to apply enrichment: ${error.message}`);
    }
}