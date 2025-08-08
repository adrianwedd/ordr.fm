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
        
        // Initialize mobile touch gestures
        initMobileGestures();
        
        // Initialize configuration management
        initConfigManagement();
        
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
    
    // Auto-remove after 5 seconds with safety check
    setTimeout(() => {
        try {
            if (notification && notification.parentNode) {
                notification.remove();
            }
        } catch (error) {
            console.warn('Failed to remove notification:', error);
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
    
    // Auto-remove after 10 seconds for alerts with safety check
    setTimeout(() => {
        try {
            if (alert && alert.parentNode) {
                alert.remove();
            }
        } catch (error) {
            console.warn('Failed to remove alert:', error);
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
        
        // Update the global albums data for search system
        allAlbumsData = albums.map(album => ({
            id: album.id,
            artist: album.album_artist || album.artist,
            album: album.album_title || album.album,
            year: album.year,
            label: album.label,
            quality: album.quality,
            organization_mode: album.organization_mode || 'artist'
        }));
        
        // Update the display
        updateAlbumsDisplay();
        
    } catch (error) {
        showError('Failed to load albums: ' + error.message);
        // Fallback to empty state
        allAlbumsData = [];
        updateAlbumsDisplay();
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
    
    // Initialize backup status monitoring
    checkBackupStatus();
    setInterval(checkBackupStatus, 10000); // Check every 10 seconds
    
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

// Global backup state
let currentBackupId = null;
let backupStatus = { hasRunning: false, activeBackups: [] };

// Check backup status
async function checkBackupStatus() {
    try {
        const status = await fetchAPI('/api/actions/backup-status');
        backupStatus = status;
        updateBackupUI();
        return status;
    } catch (error) {
        console.error('Failed to check backup status:', error);
        return null;
    }
}

// Update backup UI based on status
function updateBackupUI() {
    const startBtn = document.getElementById('start-cloud-backup');
    if (!startBtn) {
        console.warn('Start backup button not found, skipping UI update');
        return;
    }
    
    const cancelBtn = document.getElementById('cancel-cloud-backup') || createCancelButton();
    const statusDiv = document.getElementById('backup-status-info') || createStatusDiv();
    
    if (backupStatus.hasRunning) {
        startBtn.disabled = true;
        startBtn.textContent = 'Backup Running...';
        cancelBtn.style.display = 'inline-block';
        statusDiv.innerHTML = `
            <div class="backup-status-active">
                📊 Active Backups: ${backupStatus.activeBackups.length} | 
                System Processes: ${backupStatus.systemProcesses.length}
                <br>
                ${backupStatus.activeBackups.map(b => `ID: ${b.id} (${b.target}) - Started: ${new Date(b.startTime).toLocaleTimeString()}`).join('<br>')}
            </div>
        `;
    } else {
        startBtn.disabled = false;
        startBtn.textContent = '🌥️ Start Google Drive Backup';
        cancelBtn.style.display = 'none';
        statusDiv.innerHTML = '<div class="backup-status-idle">✅ No backups running</div>';
    }
}

// Create cancel button if it doesn't exist
function createCancelButton() {
    const existing = document.getElementById('cancel-cloud-backup');
    if (existing) return existing;
    
    const button = document.createElement('button');
    button.id = 'cancel-cloud-backup';
    button.className = 'btn btn-danger';
    button.innerHTML = '⏹️ Cancel All Backups';
    button.style.display = 'none';
    button.onclick = cancelAllBackups;
    
    // Insert after start backup button with safety check
    const startBtn = document.getElementById('start-cloud-backup');
    if (startBtn && startBtn.parentNode) {
        startBtn.parentNode.insertBefore(button, startBtn.nextSibling);
    } else {
        console.warn('Could not find start backup button to insert cancel button');
        // Fallback: try to append to backup section
        const backupSection = document.querySelector('#backup-actions, .backup-section, [data-backup-section]');
        if (backupSection) {
            backupSection.appendChild(button);
        }
    }
    
    return button;
}

// Create status div if it doesn't exist
function createStatusDiv() {
    const existing = document.getElementById('backup-status-info');
    if (existing) return existing;
    
    const div = document.createElement('div');
    div.id = 'backup-status-info';
    div.className = 'backup-status-info';
    
    // Insert before backup controls
    const container = document.querySelector('.backup-section') || document.querySelector('[data-section="actions"]');
    if (container) {
        const firstChild = container.querySelector('h3') || container.firstChild;
        container.insertBefore(div, firstChild.nextSibling);
    }
    
    return div;
}

// Start cloud backup
async function startCloudBackup() {
    // First check if any backups are running
    const status = await checkBackupStatus();
    if (status && status.hasRunning) {
        const userChoice = confirm(
            `⚠️ Backup Already Running!\n\n` +
            `Active backups: ${status.activeBackups.length}\n` +
            `System processes: ${status.systemProcesses.length}\n\n` +
            `Do you want to:\n` +
            `• Cancel existing backups and start new one? (OK)\n` +
            `• Keep existing backups running? (Cancel)`
        );
        
        if (userChoice) {
            await cancelAllBackups();
        } else {
            return;
        }
    }
    
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
                target: target,
                force: true // Override any remaining conflicts
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            currentBackupId = result.backupId;
            statusText.textContent = `Cloud backup started (ID: ${currentBackupId})...`;
            progressBar.style.width = '20%';
            
            // Update UI state
            setTimeout(checkBackupStatus, 1000);
        } else if (response.status === 409) {
            // Conflict - backup already running
            throw new Error(`${result.error}\n\nSuggestion: ${result.suggestion}`);
        } else {
            throw new Error(result.error || 'Failed to start backup');
        }
        
    } catch (error) {
        indicator.textContent = '❌';
        text.textContent = 'Backup failed to start';
        showError('Failed to start cloud backup:\n' + error.message);
    }
}

// Cancel all backups
async function cancelAllBackups() {
    try {
        const response = await fetch('/api/actions/backup-cancel', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                killAll: true
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showSuccess(`✅ ${result.message}`);
            currentBackupId = null;
            
            // Update progress display
            const indicator = document.getElementById('cloud-backup-indicator');
            const text = document.getElementById('cloud-backup-text');
            const progressSection = document.getElementById('backup-progress');
            
            indicator.textContent = '⏹️';
            text.textContent = 'Backup cancelled';
            progressSection.style.display = 'none';
            
            // Refresh status
            setTimeout(checkBackupStatus, 1000);
        } else {
            throw new Error(result.error || 'Failed to cancel backups');
        }
    } catch (error) {
        showError('Failed to cancel backups: ' + error.message);
    }
}

// Cancel specific backup
async function cancelBackup(backupId) {
    try {
        const response = await fetch('/api/actions/backup-cancel', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                backupId: backupId
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showSuccess(`✅ Cancelled backup: ${backupId}`);
            if (currentBackupId === backupId) {
                currentBackupId = null;
            }
            setTimeout(checkBackupStatus, 1000);
        } else {
            throw new Error(result.error || 'Failed to cancel backup');
        }
    } catch (error) {
        showError('Failed to cancel backup: ' + error.message);
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
    
    console.log('Backup update:', data);
    
    switch(data.type) {
        case 'backup_update':
            indicator.textContent = '⏳';
            text.textContent = 'Backup in progress...';
            if (data.data.backupId) {
                statusText.textContent = `Syncing files... (${data.data.backupId})`;
            } else {
                statusText.textContent = 'Syncing files...';
            }
            progressBar.style.width = '60%';
            
            // Update backup status if we have an active backup
            if (data.data.backupId && currentBackupId !== data.data.backupId) {
                currentBackupId = data.data.backupId;
            }
            break;
            
        case 'backup_complete':
            if (data.data.success) {
                indicator.textContent = '✅';
                text.textContent = 'Backup completed successfully';
                statusText.textContent = `All files synced (${data.data.backupId || 'Unknown'})`;
                progressBar.style.width = '100%';
                showSuccess(`✅ Backup completed: ${data.data.backupId || 'Unknown'}`);
            } else {
                indicator.textContent = '❌';
                text.textContent = 'Backup failed';
                statusText.textContent = `Backup failed (${data.data.backupId || 'Unknown'})`;
                showError(`Cloud backup failed: ${data.data.error || 'Unknown error'}\nBackup ID: ${data.data.backupId || 'Unknown'}`);
            }
            
            // Clear current backup ID if it matches
            if (data.data.backupId === currentBackupId) {
                currentBackupId = null;
            }
            
            // Update backup status
            setTimeout(checkBackupStatus, 1000);
            break;
            
        case 'backup_cancelled':
            indicator.textContent = '⏹️';
            text.textContent = 'Backup cancelled';
            statusText.textContent = data.data.message || 'Backup was cancelled';
            progressBar.style.width = '0%';
            
            showSuccess(data.data.message || 'Backup cancelled');
            
            // Clear current backup ID if it matches
            if (data.data.backupId === currentBackupId) {
                currentBackupId = null;
            }
            
            // Update backup status
            setTimeout(checkBackupStatus, 1000);
            break;
            
        case 'backup_error':
            indicator.textContent = '❌';
            text.textContent = 'Backup error';
            statusText.textContent = `Error: ${data.data.error}`;
            
            showError(`Backup error: ${data.data.error}\nBackup ID: ${data.data.backupId || 'Unknown'}`);
            
            // Clear current backup ID if it matches
            if (data.data.backupId === currentBackupId) {
                currentBackupId = null;
            }
            
            // Update backup status
            setTimeout(checkBackupStatus, 1000);
            break;
            
        default:
            console.log('Unknown backup update type:', data.type);
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

// Advanced Search & Filter System
let currentSearchFilters = {};
let currentSortOrder = 'recent';
let currentViewMode = 'table';
let searchCache = {};
let allAlbumsData = [];

// Toggle Albums Search Interface
function toggleAlbumsSearch() {
    const container = document.getElementById('albums-search-container');
    const toggle = document.getElementById('albums-search-toggle');
    
    if (container.classList.contains('search-collapsed')) {
        container.classList.remove('search-collapsed');
        toggle.innerHTML = '🔽 Hide Search';
    } else {
        container.classList.add('search-collapsed');
        toggle.innerHTML = '🔼 Show Search';
    }
}

// Perform Advanced Album Search
async function performAlbumSearch() {
    const startTime = performance.now();
    
    // Gather search criteria
    const filters = {
        album: document.getElementById('search-album-title').value.trim(),
        artist: document.getElementById('search-artist-name').value.trim(),
        label: document.getElementById('search-label-name').value.trim(),
        yearFrom: document.getElementById('search-year-from').value,
        yearTo: document.getElementById('search-year-to').value,
        quality: document.getElementById('search-quality').value,
        orgMode: document.getElementById('search-org-mode').value
    };
    
    // Remove empty filters
    currentSearchFilters = Object.fromEntries(
        Object.entries(filters).filter(([key, value]) => value !== '')
    );
    
    try {
        // Build API query parameters
        const params = new URLSearchParams();
        if (currentSearchFilters.album) params.append('album', currentSearchFilters.album);
        if (currentSearchFilters.artist) params.append('artist', currentSearchFilters.artist);
        if (currentSearchFilters.label) params.append('label', currentSearchFilters.label);
        if (currentSearchFilters.yearFrom) params.append('year_from', currentSearchFilters.yearFrom);
        if (currentSearchFilters.yearTo) params.append('year_to', currentSearchFilters.yearTo);
        if (currentSearchFilters.quality) params.append('quality', currentSearchFilters.quality);
        if (currentSearchFilters.orgMode) params.append('org_mode', currentSearchFilters.orgMode);
        
        // Make search request
        const response = await fetchAPI(`/api/search/albums?${params.toString()}`);
        allAlbumsData = response.albums || [];
        
        // Update search statistics
        const endTime = performance.now();
        const searchTime = Math.round(endTime - startTime);
        
        document.getElementById('albums-results-count').textContent = `${allAlbumsData.length} results found`;
        document.getElementById('albums-search-time').textContent = `Search took ${searchTime}ms`;
        document.getElementById('albums-search-stats').style.display = 'flex';
        
        // Update active filters display
        updateActiveFilters();
        
        // Apply current sort and display results
        sortAlbumResults();
        
    } catch (error) {
        console.error('Album search error:', error);
        showError(`Search failed: ${error.message}`);
        document.getElementById('albums-search-stats').style.display = 'none';
    }
}

// Clear Album Search Filters
function clearAlbumSearch() {
    // Clear all input fields
    document.getElementById('search-album-title').value = '';
    document.getElementById('search-artist-name').value = '';
    document.getElementById('search-label-name').value = '';
    document.getElementById('search-year-from').value = '';
    document.getElementById('search-year-to').value = '';
    document.getElementById('search-quality').value = '';
    document.getElementById('search-org-mode').value = '';
    
    // Clear filters and reload all albums
    currentSearchFilters = {};
    document.getElementById('albums-search-stats').style.display = 'none';
    updateActiveFilters();
    
    // Reload all albums
    loadAlbums();
}

// Save Album Search (placeholder for future implementation)
function saveAlbumSearch() {
    if (Object.keys(currentSearchFilters).length === 0) {
        alert('No active filters to save');
        return;
    }
    
    const searchName = prompt('Enter a name for this search:');
    if (searchName) {
        // Save to localStorage for demo purposes
        const savedSearches = JSON.parse(localStorage.getItem('savedAlbumSearches') || '{}');
        savedSearches[searchName] = {
            filters: currentSearchFilters,
            created: new Date().toISOString()
        };
        localStorage.setItem('savedAlbumSearches', JSON.stringify(savedSearches));
        alert(`Search "${searchName}" saved successfully!`);
    }
}

// Update Active Filters Display
function updateActiveFilters() {
    const container = document.getElementById('albums-active-filters');
    container.innerHTML = '';
    
    Object.entries(currentSearchFilters).forEach(([key, value]) => {
        const chip = document.createElement('div');
        chip.className = 'filter-chip';
        
        let displayText = '';
        switch(key) {
            case 'album': displayText = `Album: ${value}`; break;
            case 'artist': displayText = `Artist: ${value}`; break;
            case 'label': displayText = `Label: ${value}`; break;
            case 'yearFrom': displayText = `From: ${value}`; break;
            case 'yearTo': displayText = `To: ${value}`; break;
            case 'quality': displayText = `Quality: ${value}`; break;
            case 'orgMode': displayText = `Mode: ${value}`; break;
        }
        
        chip.innerHTML = `
            ${displayText}
            <span class="remove" onclick="removeFilter('${key}')">✕</span>
        `;
        container.appendChild(chip);
    });
}

// Remove Individual Filter
function removeFilter(filterKey) {
    delete currentSearchFilters[filterKey];
    
    // Clear the corresponding input field
    const inputMap = {
        'album': 'search-album-title',
        'artist': 'search-artist-name',
        'label': 'search-label-name',
        'yearFrom': 'search-year-from',
        'yearTo': 'search-year-to',
        'quality': 'search-quality',
        'orgMode': 'search-org-mode'
    };
    
    const inputId = inputMap[filterKey];
    if (inputId) {
        document.getElementById(inputId).value = '';
    }
    
    // Re-perform search
    performAlbumSearch();
}

// Sort Album Results
function sortAlbumResults() {
    const sortBy = document.getElementById('albums-sort').value;
    currentSortOrder = sortBy;
    
    if (!allAlbumsData || allAlbumsData.length === 0) {
        return;
    }
    
    let sortedData = [...allAlbumsData];
    
    switch(sortBy) {
        case 'artist':
            sortedData.sort((a, b) => (a.artist || '').localeCompare(b.artist || ''));
            break;
        case 'album':
            sortedData.sort((a, b) => (a.album || '').localeCompare(b.album || ''));
            break;
        case 'year-desc':
            sortedData.sort((a, b) => (b.year || 0) - (a.year || 0));
            break;
        case 'year-asc':
            sortedData.sort((a, b) => (a.year || 0) - (b.year || 0));
            break;
        case 'label':
            sortedData.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
            break;
        case 'quality':
            sortedData.sort((a, b) => (a.quality || '').localeCompare(b.quality || ''));
            break;
        case 'recent':
        default:
            // Keep original order (most recent first)
            break;
    }
    
    allAlbumsData = sortedData;
    updateAlbumsDisplay();
}

// Switch Album View Mode
function switchAlbumView(mode) {
    currentViewMode = mode;
    
    const tableView = document.getElementById('albums-table-view');
    const gridView = document.getElementById('albums-grid-view');
    const tableBtn = document.getElementById('table-view-btn');
    const gridBtn = document.getElementById('grid-view-btn');
    
    if (mode === 'table') {
        tableView.style.display = 'block';
        gridView.style.display = 'none';
        tableBtn.classList.add('active');
        gridBtn.classList.remove('active');
    } else {
        tableView.style.display = 'none';
        gridView.style.display = 'block';
        tableBtn.classList.remove('active');
        gridBtn.classList.add('active');
    }
    
    updateAlbumsDisplay();
}

// Sort Album Table by Column
function sortAlbumTable(column) {
    const select = document.getElementById('albums-sort');
    const sortMap = {
        'artist': 'artist',
        'album': 'album',
        'year': 'year-desc',
        'label': 'label',
        'quality': 'quality',
        'mode': 'recent'
    };
    
    select.value = sortMap[column] || 'recent';
    sortAlbumResults();
}

// Update Albums Display
function updateAlbumsDisplay() {
    if (currentViewMode === 'table') {
        updateAlbumsTable();
    } else {
        updateAlbumsGrid();
    }
}

// Update Albums Table
function updateAlbumsTable() {
    const tbody = document.getElementById('albums-tbody');
    
    if (!allAlbumsData || allAlbumsData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading">No albums found</td></tr>';
        return;
    }
    
    tbody.innerHTML = allAlbumsData.map(album => `
        <tr onclick="selectAlbum('${album.id || ''}')">
            <td>${album.artist || 'Unknown Artist'}</td>
            <td>${album.album || 'Unknown Album'}</td>
            <td>${album.year || 'N/A'}</td>
            <td>${album.label || 'N/A'}</td>
            <td>
                <span class="meta-tag" style="background: ${getQualityColor(album.quality)}20; color: ${getQualityColor(album.quality)}">
                    ${album.quality || 'Unknown'}
                </span>
            </td>
            <td>${album.organization_mode || 'N/A'}</td>
            <td>
                <button class="action-btn secondary" onclick="event.stopPropagation(); viewAlbumDetails('${album.id || ''}')">📋 Details</button>
                <button class="action-btn secondary" onclick="event.stopPropagation(); editAlbumMetadata('${album.id || ''}')">✏️ Edit</button>
            </td>
        </tr>
    `).join('');
}

// Update Albums Grid
function updateAlbumsGrid() {
    const container = document.getElementById('albums-grid-container');
    
    if (!allAlbumsData || allAlbumsData.length === 0) {
        container.innerHTML = '<div class="loading">No albums found</div>';
        return;
    }
    
    container.innerHTML = allAlbumsData.map(album => `
        <div class="grid-item" onclick="selectAlbum('${album.id || ''}')">
            <div class="grid-item-header">
                <div>
                    <div class="grid-item-title">${album.album || 'Unknown Album'}</div>
                    <div class="grid-item-subtitle">${album.artist || 'Unknown Artist'}</div>
                </div>
            </div>
            <div class="grid-item-meta">
                <span class="meta-tag">${album.year || 'N/A'}</span>
                <span class="meta-tag" style="background: ${getQualityColor(album.quality)}20; color: ${getQualityColor(album.quality)}">
                    ${album.quality || 'Unknown'}
                </span>
                ${album.label ? `<span class="meta-tag">${album.label}</span>` : ''}
                ${album.organization_mode ? `<span class="meta-tag">${album.organization_mode}</span>` : ''}
            </div>
        </div>
    `).join('');
}

// Get Quality Color
function getQualityColor(quality) {
    switch(quality?.toLowerCase()) {
        case 'lossless': return '#10b981';
        case 'lossy': return '#f59e0b';
        case 'mixed': return '#8b5cf6';
        default: return '#6b7280';
    }
}

// Select Album (placeholder)
function selectAlbum(albumId) {
    console.log('Selected album:', albumId);
    // This would integrate with metadata editing functionality
}

// View Album Details (placeholder)
function viewAlbumDetails(albumId) {
    alert(`View details for album: ${albumId}\n\nThis would open a detailed view of the album.`);
}

// Edit Album Metadata - opens metadata editing interface
function editAlbumMetadata(albumId) {
    openMetadataEditor(albumId);
}

// Mobile Gestures & Touch Enhancement System
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
let currentTabIndex = 0;
let tabs = [];
let isSwipeEnabled = true;
let pullToRefreshY = 0;
let isPullToRefresh = false;

// Initialize Mobile Touch Gestures
function initMobileGestures() {
    // Only enable on mobile devices
    if (!isMobile()) {
        return;
    }
    
    // Get all tab buttons for swipe navigation
    tabs = Array.from(document.querySelectorAll('.tab'));
    currentTabIndex = tabs.findIndex(tab => tab.classList.contains('active'));
    
    // Add touch event listeners to the main container
    const container = document.querySelector('.container');
    if (container) {
        container.addEventListener('touchstart', handleTouchStart, { passive: false });
        container.addEventListener('touchmove', handleTouchMove, { passive: false });
        container.addEventListener('touchend', handleTouchEnd, { passive: false });
    }
    
    // Initialize pull-to-refresh
    initPullToRefresh();
    
    // Initialize mobile-specific UI enhancements
    enhanceMobileUI();
    
    // Add vibration feedback support
    initHapticFeedback();
    
    console.log('Mobile gestures initialized');
}

// Check if device is mobile
function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           window.innerWidth <= 768;
}

// Handle touch start
function handleTouchStart(e) {
    if (!isSwipeEnabled) return;
    
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchEndX = touchStartX;
    touchEndY = touchStartY;
    
    // Check for pull-to-refresh
    if (window.scrollY === 0) {
        isPullToRefresh = true;
        pullToRefreshY = touchStartY;
    }
}

// Handle touch move
function handleTouchMove(e) {
    if (!isSwipeEnabled) return;
    
    touchEndX = e.touches[0].clientX;
    touchEndY = e.touches[0].clientY;
    
    // Handle pull-to-refresh visual feedback
    if (isPullToRefresh && touchEndY > pullToRefreshY + 50) {
        showPullToRefreshIndicator();
        if (touchEndY > pullToRefreshY + 100) {
            e.preventDefault(); // Prevent default scroll when threshold reached
        }
    }
    
    // Show swipe indicators for horizontal swipes
    const deltaX = touchEndX - touchStartX;
    const deltaY = Math.abs(touchEndY - touchStartY);
    
    if (Math.abs(deltaX) > 50 && deltaY < 100) {
        showSwipeIndicator(deltaX > 0 ? 'right' : 'left');
    }
}

// Handle touch end
function handleTouchEnd(e) {
    if (!isSwipeEnabled) return;
    
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    const minSwipeDistance = 100;
    const maxVerticalMovement = 150;
    
    // Hide indicators
    hideSwipeIndicators();
    
    // Handle pull-to-refresh
    if (isPullToRefresh && deltaY > 100) {
        triggerPullToRefresh();
    }
    isPullToRefresh = false;
    
    // Check if this was a horizontal swipe
    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaY) < maxVerticalMovement) {
        handleSwipeGesture(deltaX);
    }
    
    // Reset touch coordinates
    touchStartX = 0;
    touchStartY = 0;
    touchEndX = 0;
    touchEndY = 0;
}

// Handle swipe gestures for tab navigation
function handleSwipeGesture(deltaX) {
    const threshold = 100;
    
    if (deltaX > threshold) {
        // Swipe right - go to previous tab
        navigateToTab('previous');
        triggerHapticFeedback('light');
    } else if (deltaX < -threshold) {
        // Swipe left - go to next tab
        navigateToTab('next');
        triggerHapticFeedback('light');
    }
}

// Navigate between tabs
function navigateToTab(direction) {
    if (tabs.length === 0) return;
    
    let newTabIndex = currentTabIndex;
    
    if (direction === 'previous') {
        newTabIndex = currentTabIndex > 0 ? currentTabIndex - 1 : tabs.length - 1;
    } else if (direction === 'next') {
        newTabIndex = currentTabIndex < tabs.length - 1 ? currentTabIndex + 1 : 0;
    }
    
    // Activate the new tab
    tabs[newTabIndex].click();
    currentTabIndex = newTabIndex;
    
    // Show navigation feedback
    showNavigationFeedback(direction);
}

// Show swipe indicators
function showSwipeIndicator(direction) {
    const indicator = document.getElementById(`swipe-${direction}`);
    if (indicator) {
        indicator.classList.add('show');
    }
}

// Hide swipe indicators
function hideSwipeIndicators() {
    document.getElementById('swipe-left')?.classList.remove('show');
    document.getElementById('swipe-right')?.classList.remove('show');
}

// Show navigation feedback
function showNavigationFeedback(direction) {
    const message = direction === 'previous' ? '← Previous Tab' : 'Next Tab →';
    showToast(message);
}

// Initialize pull-to-refresh
function initPullToRefresh() {
    // Add pull-to-refresh indicator to header
    const header = document.querySelector('header');
    if (header && !document.getElementById('pull-refresh-indicator')) {
        const indicator = document.createElement('div');
        indicator.id = 'pull-refresh-indicator';
        indicator.className = 'pull-refresh-indicator';
        indicator.innerHTML = '🔄 Pull to refresh';
        indicator.style.cssText = `
            position: absolute;
            top: -40px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(102, 126, 234, 0.9);
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 14px;
            opacity: 0;
            transition: all 0.3s ease;
            pointer-events: none;
            z-index: 1000;
        `;
        header.style.position = 'relative';
        header.appendChild(indicator);
    }
}

// Show pull-to-refresh indicator
function showPullToRefreshIndicator() {
    const indicator = document.getElementById('pull-refresh-indicator');
    if (indicator) {
        indicator.style.opacity = '1';
        indicator.style.top = '10px';
    }
}

// Trigger pull-to-refresh
function triggerPullToRefresh() {
    const indicator = document.getElementById('pull-refresh-indicator');
    if (indicator) {
        indicator.innerHTML = '🔄 Refreshing...';
        indicator.style.opacity = '1';
    }
    
    // Trigger haptic feedback
    triggerHapticFeedback('medium');
    
    // Refresh current tab data
    refreshCurrentTab();
    
    // Hide indicator after delay
    setTimeout(() => {
        if (indicator) {
            indicator.style.opacity = '0';
            indicator.style.top = '-40px';
            indicator.innerHTML = '🔄 Pull to refresh';
        }
    }, 1500);
}

// Refresh current tab
function refreshCurrentTab() {
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) {
        const tabName = activeTab.textContent.toLowerCase().trim();
        const refreshFunctions = {
            'overview': loadOverview,
            'albums': loadAlbums,
            'artists': loadArtists,
            'labels': loadLabels,
            'health': loadHealth,
            'duplicates': loadDuplicates,
            'insights': loadInsights
        };
        
        const refreshFunc = refreshFunctions[tabName];
        if (refreshFunc) {
            refreshFunc();
        }
    }
}

// Enhance mobile UI elements
function enhanceMobileUI() {
    // Add mobile-optimized styles
    addMobileStyles();
    
    // Enhance table scrolling on mobile
    enhanceTableScrolling();
    
    // Add mobile-friendly button interactions
    addMobileButtonEffects();
    
    // Initialize mobile menu
    initMobileMenu();
}

// Add mobile-specific styles
function addMobileStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* Mobile gesture feedback */
        .touch-highlight {
            -webkit-tap-highlight-color: rgba(102, 126, 234, 0.2);
            tap-highlight-color: rgba(102, 126, 234, 0.2);
        }
        
        /* Enhanced touch targets */
        @media (max-width: 768px) {
            button, .tab, .action-btn {
                min-height: 48px;
                min-width: 48px;
            }
            
            /* Table enhancements */
            .table-container {
                -webkit-overflow-scrolling: touch;
                overflow-scrolling: touch;
            }
            
            /* Card hover effects for touch */
            .card:active {
                transform: scale(0.98);
                transition: transform 0.1s ease;
            }
            
            /* Search input improvements */
            .search-input:focus {
                zoom: 1;
                -webkit-user-select: text;
            }
        }
        
        /* Toast notifications */
        .toast {
            position: fixed;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 12px 20px;
            border-radius: 25px;
            font-size: 14px;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .toast.show {
            opacity: 1;
        }
    `;
    document.head.appendChild(style);
}

// Enhance table scrolling
function enhanceTableScrolling() {
    const tables = document.querySelectorAll('.table-container');
    tables.forEach(table => {
        table.style.webkitOverflowScrolling = 'touch';
        table.style.overflowScrolling = 'touch';
    });
}

// Add mobile button effects
function addMobileButtonEffects() {
    const buttons = document.querySelectorAll('button, .tab, .action-btn');
    buttons.forEach(button => {
        button.classList.add('touch-highlight');
    });
}

// Initialize mobile menu functionality
function initMobileMenu() {
    // Mobile menu is already in HTML, just ensure functionality
    const fab = document.getElementById('mobile-fab');
    const menu = document.getElementById('mobile-menu');
    
    if (fab && menu) {
        fab.style.display = isMobile() ? 'flex' : 'none';
    }
}

// Mobile menu functions
function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    if (menu) {
        menu.classList.toggle('open');
        triggerHapticFeedback('light');
    }
}

function closeMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    if (menu) {
        menu.classList.remove('open');
    }
}

// Haptic feedback support
function initHapticFeedback() {
    // Check if vibration is supported
    if ('vibrate' in navigator) {
        console.log('Haptic feedback available');
    }
}

function triggerHapticFeedback(intensity = 'light') {
    if ('vibrate' in navigator) {
        const patterns = {
            light: [10],
            medium: [20],
            heavy: [30]
        };
        navigator.vibrate(patterns[intensity] || patterns.light);
    }
}

// Toast notification system
function showToast(message, duration = 2000) {
    // Remove existing toast
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }
    
    // Create new toast
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Show toast
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    // Hide toast
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, duration);
}

// Mobile-specific utility functions
function refreshCurrentTab() {
    showToast('Refreshing...', 1000);
    const activeTab = tabs.find(tab => tab.classList.contains('active'));
    if (activeTab) {
        activeTab.click();
    }
}

function testPushNotification() {
    if ('Notification' in window) {
        if (Notification.permission === 'granted') {
            new Notification('ordr.fm Dashboard', {
                body: 'Push notification test successful! 🎵',
                icon: '/icons/icon-192x192.png'
            });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    new Notification('ordr.fm Dashboard', {
                        body: 'Push notification test successful! 🎵',
                        icon: '/icons/icon-192x192.png'
                    });
                }
            });
        }
    }
    triggerHapticFeedback('medium');
}

// Configuration Management System
let currentConfig = {};
let originalConfig = {};

// Initialize Configuration Management
function initConfigManagement() {
    // Add event listeners for range inputs
    const rangeInputs = document.querySelectorAll('input[type="range"]');
    rangeInputs.forEach(input => {
        input.addEventListener('input', function() {
            const onInputAttr = this.getAttribute('oninput');
            if (onInputAttr) {
                const match = onInputAttr.match(/'([^']+)'/);
                if (match) {
                    updateRangeDisplay(match[1], this.value);
                }
            }
        });
    });
    
    console.log('Configuration management initialized');
}

// Update range display values
function updateRangeDisplay(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = value;
    }
}

// Load configuration from server
async function loadConfig() {
    const statusDiv = document.getElementById('config-status');
    const form = document.getElementById('config-form');
    
    statusDiv.innerHTML = '<div style="color: #667eea;">📥 Loading configuration...</div>';
    
    try {
        const response = await fetchAPI('/api/config');
        currentConfig = response.config;
        originalConfig = JSON.parse(JSON.stringify(response.config)); // Deep copy
        
        // Populate form fields
        populateConfigForm(currentConfig);
        
        // Show form and hide status
        form.style.display = 'block';
        statusDiv.innerHTML = '<div style="color: var(--success-color);">✅ Configuration loaded successfully</div>';
        
        // Clear status after delay
        setTimeout(() => {
            statusDiv.innerHTML = '';
        }, 3000);
        
    } catch (error) {
        console.error('Failed to load configuration:', error);
        statusDiv.innerHTML = '<div style="color: var(--error-color);">❌ Failed to load configuration: ' + error.message + '</div>';
    }
}

// Populate configuration form with data
function populateConfigForm(config) {
    // Core directories
    setValue('SOURCE_DIR', config.SOURCE_DIR);
    setValue('DEST_DIR', config.DEST_DIR);
    setValue('UNSORTED_DIR_BASE', config.UNSORTED_DIR_BASE);
    
    // Logging & verbosity
    setValue('LOG_FILE', config.LOG_FILE);
    setValue('VERBOSITY', config.VERBOSITY);
    
    // Processing modes
    setCheckbox('INCREMENTAL_MODE', config.INCREMENTAL_MODE);
    setValue('STATE_DB', config.STATE_DB);
    setValue('SINCE_DATE', config.SINCE_DATE);
    setCheckbox('BATCH_MODE', config.BATCH_MODE);
    
    // Duplicate detection
    setCheckbox('FIND_DUPLICATES', config.FIND_DUPLICATES);
    setCheckbox('RESOLVE_DUPLICATES', config.RESOLVE_DUPLICATES);
    setValue('DUPLICATES_DB', config.DUPLICATES_DB);
    
    // Discogs integration
    setCheckbox('DISCOGS_ENABLED', config.DISCOGS_ENABLED);
    setValue('DISCOGS_USER_TOKEN', config.DISCOGS_USER_TOKEN);
    setValue('DISCOGS_CONSUMER_KEY', config.DISCOGS_CONSUMER_KEY);
    setValue('DISCOGS_CONSUMER_SECRET', config.DISCOGS_CONSUMER_SECRET);
    setValue('DISCOGS_CONFIDENCE_THRESHOLD', config.DISCOGS_CONFIDENCE_THRESHOLD);
    setValue('DISCOGS_RATE_LIMIT', config.DISCOGS_RATE_LIMIT);
    setValue('DISCOGS_CACHE_EXPIRY', config.DISCOGS_CACHE_EXPIRY);
    
    // Electronic music organization
    setValue('ORGANIZATION_MODE', config.ORGANIZATION_MODE);
    setValue('LABEL_PRIORITY_THRESHOLD', config.LABEL_PRIORITY_THRESHOLD);
    setValue('MIN_LABEL_RELEASES', config.MIN_LABEL_RELEASES);
    setCheckbox('SEPARATE_REMIXES', config.SEPARATE_REMIXES);
    setCheckbox('SEPARATE_COMPILATIONS', config.SEPARATE_COMPILATIONS);
    setCheckbox('VINYL_SIDE_MARKERS', config.VINYL_SIDE_MARKERS);
    setCheckbox('UNDERGROUND_DETECTION', config.UNDERGROUND_DETECTION);
    
    // Artist aliases
    setCheckbox('GROUP_ARTIST_ALIASES', config.GROUP_ARTIST_ALIASES);
    setCheckbox('USE_PRIMARY_ARTIST_NAME', config.USE_PRIMARY_ARTIST_NAME);
    setValue('ARTIST_ALIAS_GROUPS', config.ARTIST_ALIAS_GROUPS);
    
    // Google Drive backup
    setCheckbox('ENABLE_GDRIVE_BACKUP', config.ENABLE_GDRIVE_BACKUP);
    setValue('GDRIVE_BACKUP_DIR', config.GDRIVE_BACKUP_DIR);
    setValue('GDRIVE_MOUNT_POINT', config.GDRIVE_MOUNT_POINT);
    setValue('MAX_PARALLEL_UPLOADS', config.MAX_PARALLEL_UPLOADS);
    setCheckbox('CHECKSUM_VERIFY', config.CHECKSUM_VERIFY);
    
    // Notifications
    setValue('NOTIFY_EMAIL', config.NOTIFY_EMAIL);
    setValue('NOTIFY_WEBHOOK', config.NOTIFY_WEBHOOK);
    
    // Organization patterns
    setValue('PATTERN_ARTIST', config.PATTERN_ARTIST);
    setValue('PATTERN_LABEL', config.PATTERN_LABEL);
    setValue('PATTERN_SERIES', config.PATTERN_SERIES);
    setValue('PATTERN_REMIX', config.PATTERN_REMIX);
    
    // Update range displays
    updateRangeDisplay('confidence-value', config.DISCOGS_CONFIDENCE_THRESHOLD || '0.7');
    updateRangeDisplay('label-threshold-value', config.LABEL_PRIORITY_THRESHOLD || '0.8');
}

// Helper function to set input value
function setValue(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.value = value || '';
    }
}

// Helper function to set checkbox value
function setCheckbox(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.checked = value === '1' || value === 1 || value === true;
    }
}

// Helper function to get input value
function getValue(id) {
    const element = document.getElementById(id);
    return element ? element.value : '';
}

// Helper function to get checkbox value
function getCheckboxValue(id) {
    const element = document.getElementById(id);
    return element && element.checked ? '1' : '0';
}

// Save configuration to server
async function saveConfig() {
    const statusDiv = document.getElementById('config-status');
    
    if (Object.keys(currentConfig).length === 0) {
        statusDiv.innerHTML = '<div style="color: var(--warning-color);">⚠️ Please load configuration first</div>';
        return;
    }
    
    statusDiv.innerHTML = '<div style="color: #667eea;">💾 Saving configuration...</div>';
    
    try {
        // Gather all form values
        const updatedConfig = {
            // Core directories
            SOURCE_DIR: getValue('SOURCE_DIR'),
            DEST_DIR: getValue('DEST_DIR'),
            UNSORTED_DIR_BASE: getValue('UNSORTED_DIR_BASE'),
            
            // Logging & verbosity
            LOG_FILE: getValue('LOG_FILE'),
            VERBOSITY: getValue('VERBOSITY'),
            
            // Processing modes
            INCREMENTAL_MODE: getCheckboxValue('INCREMENTAL_MODE'),
            STATE_DB: getValue('STATE_DB'),
            SINCE_DATE: getValue('SINCE_DATE'),
            BATCH_MODE: getCheckboxValue('BATCH_MODE'),
            
            // Duplicate detection
            FIND_DUPLICATES: getCheckboxValue('FIND_DUPLICATES'),
            RESOLVE_DUPLICATES: getCheckboxValue('RESOLVE_DUPLICATES'),
            DUPLICATES_DB: getValue('DUPLICATES_DB'),
            
            // Discogs integration
            DISCOGS_ENABLED: getCheckboxValue('DISCOGS_ENABLED'),
            DISCOGS_USER_TOKEN: getValue('DISCOGS_USER_TOKEN'),
            DISCOGS_CONSUMER_KEY: getValue('DISCOGS_CONSUMER_KEY'),
            DISCOGS_CONSUMER_SECRET: getValue('DISCOGS_CONSUMER_SECRET'),
            DISCOGS_CONFIDENCE_THRESHOLD: getValue('DISCOGS_CONFIDENCE_THRESHOLD'),
            DISCOGS_RATE_LIMIT: getValue('DISCOGS_RATE_LIMIT'),
            DISCOGS_CACHE_EXPIRY: getValue('DISCOGS_CACHE_EXPIRY'),
            
            // Electronic music organization
            ORGANIZATION_MODE: getValue('ORGANIZATION_MODE'),
            LABEL_PRIORITY_THRESHOLD: getValue('LABEL_PRIORITY_THRESHOLD'),
            MIN_LABEL_RELEASES: getValue('MIN_LABEL_RELEASES'),
            SEPARATE_REMIXES: getCheckboxValue('SEPARATE_REMIXES'),
            SEPARATE_COMPILATIONS: getCheckboxValue('SEPARATE_COMPILATIONS'),
            VINYL_SIDE_MARKERS: getCheckboxValue('VINYL_SIDE_MARKERS'),
            UNDERGROUND_DETECTION: getCheckboxValue('UNDERGROUND_DETECTION'),
            
            // Artist aliases
            GROUP_ARTIST_ALIASES: getCheckboxValue('GROUP_ARTIST_ALIASES'),
            USE_PRIMARY_ARTIST_NAME: getCheckboxValue('USE_PRIMARY_ARTIST_NAME'),
            ARTIST_ALIAS_GROUPS: getValue('ARTIST_ALIAS_GROUPS'),
            
            // Google Drive backup
            ENABLE_GDRIVE_BACKUP: getCheckboxValue('ENABLE_GDRIVE_BACKUP'),
            GDRIVE_BACKUP_DIR: getValue('GDRIVE_BACKUP_DIR'),
            GDRIVE_MOUNT_POINT: getValue('GDRIVE_MOUNT_POINT'),
            MAX_PARALLEL_UPLOADS: getValue('MAX_PARALLEL_UPLOADS'),
            CHECKSUM_VERIFY: getCheckboxValue('CHECKSUM_VERIFY'),
            
            // Notifications
            NOTIFY_EMAIL: getValue('NOTIFY_EMAIL'),
            NOTIFY_WEBHOOK: getValue('NOTIFY_WEBHOOK'),
            
            // Organization patterns
            PATTERN_ARTIST: getValue('PATTERN_ARTIST'),
            PATTERN_LABEL: getValue('PATTERN_LABEL'),
            PATTERN_SERIES: getValue('PATTERN_SERIES'),
            PATTERN_REMIX: getValue('PATTERN_REMIX')
        };
        
        // Send to server
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ config: updatedConfig })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Failed to save configuration');
        }
        
        currentConfig = updatedConfig;
        statusDiv.innerHTML = '<div style="color: var(--success-color);">✅ Configuration saved successfully</div>';
        
        // Clear status after delay
        setTimeout(() => {
            statusDiv.innerHTML = '';
        }, 3000);
        
    } catch (error) {
        console.error('Failed to save configuration:', error);
        statusDiv.innerHTML = '<div style="color: var(--error-color);">❌ Failed to save configuration: ' + error.message + '</div>';
    }
}

// Reset configuration to original values
function resetConfig() {
    if (Object.keys(originalConfig).length === 0) {
        alert('Please load configuration first');
        return;
    }
    
    if (!confirm('Are you sure you want to reset all changes? This will discard any unsaved modifications.')) {
        return;
    }
    
    // Repopulate form with original values
    populateConfigForm(originalConfig);
    
    const statusDiv = document.getElementById('config-status');
    statusDiv.innerHTML = '<div style="color: var(--success-color);">🔄 Configuration reset to original values</div>';
    
    // Clear status after delay
    setTimeout(() => {
        statusDiv.innerHTML = '';
    }, 3000);
}

// Metadata Editing System
let currentEditingAlbum = null;
let originalMetadata = null;
let selectedTracks = new Set();

// Open metadata editor for a specific album
async function openMetadataEditor(albumId) {
    const modal = document.getElementById('metadata-edit-modal');
    const loadingSection = document.getElementById('metadata-loading');
    const formSection = document.getElementById('metadata-form');
    
    // Show modal and loading state
    modal.style.display = 'flex';
    loadingSection.style.display = 'block';
    formSection.style.display = 'none';
    
    try {
        // Fetch album metadata
        const response = await fetchAPI(`/api/metadata/album/${albumId}`);
        currentEditingAlbum = response.album;
        originalMetadata = JSON.parse(JSON.stringify(response.album)); // Deep copy
        
        // Populate form
        populateMetadataForm(currentEditingAlbum);
        
        // Hide loading, show form
        loadingSection.style.display = 'none';
        formSection.style.display = 'block';
        
        // Calculate and display metadata quality score
        calculateMetadataQuality();
        
        // Load edit history
        loadMetadataHistory(albumId);
        
    } catch (error) {
        console.error('Failed to load album metadata:', error);
        showError('Failed to load album metadata: ' + error.message);
        closeMetadataEditor();
    }
}

// Populate metadata form with album data
function populateMetadataForm(album) {
    // Album information
    document.getElementById('edit-album-title').value = album.title || '';
    document.getElementById('edit-album-artist').value = album.artist || '';
    document.getElementById('edit-release-year').value = album.year || '';
    document.getElementById('edit-genre').value = album.genre || '';
    document.getElementById('edit-label').value = album.label || '';
    document.getElementById('edit-catalog-number').value = album.catalog_number || '';
    
    // Populate tracks
    populateTracksContainer(album.tracks || []);
}

// Populate tracks container with track editing fields
function populateTracksContainer(tracks) {
    const container = document.getElementById('tracks-container');
    container.innerHTML = '';
    
    if (!tracks.length) {
        container.innerHTML = '<p class="no-tracks">No tracks found for this album.</p>';
        return;
    }
    
    tracks.forEach((track, index) => {
        const trackElement = document.createElement('div');
        trackElement.className = 'track-edit-item';
        trackElement.innerHTML = `
            <div class="track-header">
                <input type="checkbox" class="track-select" data-track-index="${index}" onchange="handleTrackSelection(${index}, this.checked)">
                <span class="track-number">#${track.track_number || index + 1}</span>
                <span class="track-title">${track.title || 'Untitled'}</span>
                <button class="track-toggle" onclick="toggleTrackDetails(${index})">▼</button>
            </div>
            <div class="track-details" id="track-details-${index}" style="display: none;">
                <div class="track-form-grid">
                    <div class="form-group">
                        <label>Track Number:</label>
                        <input type="number" class="form-input track-field" data-field="track_number" data-index="${index}" value="${track.track_number || index + 1}" min="1">
                    </div>
                    <div class="form-group">
                        <label>Title:</label>
                        <input type="text" class="form-input track-field" data-field="title" data-index="${index}" value="${track.title || ''}" placeholder="Enter track title">
                    </div>
                    <div class="form-group">
                        <label>Artist:</label>
                        <input type="text" class="form-input track-field" data-field="artist" data-index="${index}" value="${track.artist || ''}" placeholder="Enter track artist">
                    </div>
                    <div class="form-group">
                        <label>Duration:</label>
                        <input type="text" class="form-input track-field" data-field="duration" data-index="${index}" value="${track.duration || ''}" placeholder="mm:ss">
                    </div>
                    <div class="form-group">
                        <label>Genre:</label>
                        <input type="text" class="form-input track-field" data-field="genre" data-index="${index}" value="${track.genre || ''}" placeholder="Enter genre">
                    </div>
                    <div class="form-group">
                        <label>File Path:</label>
                        <input type="text" class="form-input track-field" data-field="file_path" data-index="${index}" value="${track.file_path || ''}" readonly>
                    </div>
                </div>
            </div>
        `;
        
        container.appendChild(trackElement);
    });
    
    // Add event listeners for real-time validation
    container.querySelectorAll('.track-field').forEach(field => {
        field.addEventListener('input', () => {
            updateTrackField(field);
            calculateMetadataQuality();
        });
    });
}

// Update track field data
function updateTrackField(fieldElement) {
    const index = parseInt(fieldElement.dataset.index);
    const field = fieldElement.dataset.field;
    const value = fieldElement.value;
    
    if (!currentEditingAlbum.tracks[index]) {
        currentEditingAlbum.tracks[index] = {};
    }
    
    currentEditingAlbum.tracks[index][field] = value;
    
    // Update track header if title changed
    if (field === 'title') {
        const trackHeader = document.querySelector(`[data-track-index="${index}"]`).closest('.track-edit-item').querySelector('.track-title');
        trackHeader.textContent = value || 'Untitled';
    }
}

// Toggle track details visibility
function toggleTrackDetails(index) {
    const details = document.getElementById(`track-details-${index}`);
    const toggle = details.parentElement.querySelector('.track-toggle');
    
    if (details.style.display === 'none') {
        details.style.display = 'block';
        toggle.textContent = '▲';
    } else {
        details.style.display = 'none';
        toggle.textContent = '▼';
    }
}

// Handle track selection for bulk operations
function handleTrackSelection(index, isSelected) {
    if (isSelected) {
        selectedTracks.add(index);
    } else {
        selectedTracks.delete(index);
    }
    
    updateSelectedTracksCount();
}

// Toggle all tracks selection
function toggleAllTracks() {
    const checkboxes = document.querySelectorAll('.track-select');
    const allSelected = Array.from(checkboxes).every(cb => cb.checked);
    
    checkboxes.forEach((checkbox, index) => {
        checkbox.checked = !allSelected;
        handleTrackSelection(index, !allSelected);
    });
}

// Update selected tracks count
function updateSelectedTracksCount() {
    const countElement = document.getElementById('selected-tracks-count');
    if (countElement) {
        countElement.textContent = selectedTracks.size;
    }
}

// Open bulk edit modal
function bulkEditTracks() {
    if (selectedTracks.size === 0) {
        showError('Please select tracks to edit');
        return;
    }
    
    const modal = document.getElementById('bulk-edit-modal');
    modal.style.display = 'flex';
    
    updateSelectedTracksCount();
}

// Close bulk edit modal
function closeBulkEdit() {
    const modal = document.getElementById('bulk-edit-modal');
    modal.style.display = 'none';
    
    // Clear form
    document.getElementById('bulk-artist').value = '';
    document.getElementById('bulk-genre').value = '';
    document.getElementById('bulk-year').value = '';
    document.getElementById('bulk-track-numbers').checked = false;
}

// Apply bulk edit to selected tracks
function applyBulkEdit() {
    const artist = document.getElementById('bulk-artist').value.trim();
    const genre = document.getElementById('bulk-genre').value.trim();
    const year = document.getElementById('bulk-year').value.trim();
    const autoNumber = document.getElementById('bulk-track-numbers').checked;
    
    let trackNumber = 1;
    
    selectedTracks.forEach(index => {
        if (!currentEditingAlbum.tracks[index]) return;
        
        // Apply bulk changes
        if (artist) currentEditingAlbum.tracks[index].artist = artist;
        if (genre) currentEditingAlbum.tracks[index].genre = genre;
        if (year) currentEditingAlbum.tracks[index].year = year;
        if (autoNumber) currentEditingAlbum.tracks[index].track_number = trackNumber++;
        
        // Update form fields
        const trackContainer = document.querySelector(`[data-track-index="${index}"]`).closest('.track-edit-item');
        if (artist) {
            const artistField = trackContainer.querySelector('[data-field="artist"]');
            if (artistField) artistField.value = artist;
        }
        if (genre) {
            const genreField = trackContainer.querySelector('[data-field="genre"]');
            if (genreField) genreField.value = genre;
        }
        if (autoNumber) {
            const numberField = trackContainer.querySelector('[data-field="track_number"]');
            if (numberField) numberField.value = currentEditingAlbum.tracks[index].track_number;
        }
    });
    
    closeBulkEdit();
    calculateMetadataQuality();
    showSuccess(`Applied bulk changes to ${selectedTracks.size} tracks`);
}

// Auto-number tracks sequentially
function resetTrackNumbers() {
    currentEditingAlbum.tracks.forEach((track, index) => {
        track.track_number = index + 1;
        
        const numberField = document.querySelector(`[data-index="${index}"][data-field="track_number"]`);
        if (numberField) {
            numberField.value = index + 1;
        }
    });
    
    calculateMetadataQuality();
    showSuccess('Track numbers reset successfully');
}

// Calculate metadata quality score
function calculateMetadataQuality() {
    let totalScore = 0;
    let maxScore = 0;
    
    // Basic album info (40% of score)
    let basicScore = 0;
    let basicMax = 6;
    
    if (document.getElementById('edit-album-title').value.trim()) basicScore++;
    if (document.getElementById('edit-album-artist').value.trim()) basicScore++;
    if (document.getElementById('edit-release-year').value.trim()) basicScore++;
    if (document.getElementById('edit-genre').value.trim()) basicScore++;
    if (document.getElementById('edit-label').value.trim()) basicScore++;
    if (document.getElementById('edit-catalog-number').value.trim()) basicScore++;
    
    // Track info (50% of score)
    let trackScore = 0;
    let trackMax = 0;
    
    if (currentEditingAlbum.tracks && currentEditingAlbum.tracks.length > 0) {
        currentEditingAlbum.tracks.forEach(track => {
            trackMax += 4; // title, artist, track_number, duration
            
            if (track.title && track.title.trim()) trackScore++;
            if (track.artist && track.artist.trim()) trackScore++;
            if (track.track_number) trackScore++;
            if (track.duration && track.duration.trim()) trackScore++;
        });
    }
    
    // Extended info (10% of score)
    let extendedScore = 0;
    let extendedMax = 2;
    
    // Add points for consistency and completeness
    const genres = new Set();
    const artists = new Set();
    
    if (currentEditingAlbum.tracks) {
        currentEditingAlbum.tracks.forEach(track => {
            if (track.genre) genres.add(track.genre);
            if (track.artist) artists.add(track.artist);
        });
        
        // Consistency points
        if (genres.size <= 2) extendedScore++; // Genre consistency
        if (artists.size <= 3 || artists.has(document.getElementById('edit-album-artist').value)) extendedScore++; // Artist consistency
    }
    
    // Calculate percentages
    const basicPercent = basicMax > 0 ? (basicScore / basicMax) * 100 : 0;
    const trackPercent = trackMax > 0 ? (trackScore / trackMax) * 100 : 0;
    const extendedPercent = extendedMax > 0 ? (extendedScore / extendedMax) * 100 : 0;
    
    // Weighted total score
    const totalPercent = Math.round((basicPercent * 0.4 + trackPercent * 0.5 + extendedPercent * 0.1));
    
    // Update UI
    document.getElementById('metadata-score').textContent = totalPercent;
    document.getElementById('basic-info-score').textContent = `${basicScore}/${basicMax}`;
    document.getElementById('track-info-score').textContent = `${trackScore}/${trackMax}`;
    document.getElementById('extended-info-score').textContent = `${extendedScore}/${extendedMax}`;
    
    // Update score circle color
    const scoreCircle = document.querySelector('.score-circle');
    scoreCircle.className = `score-circle ${getQualityClass(totalPercent)}`;
}

// Get quality class based on score
function getQualityClass(score) {
    if (score >= 90) return 'excellent';
    if (score >= 80) return 'good';
    if (score >= 60) return 'fair';
    return 'poor';
}

// Load metadata edit history
async function loadMetadataHistory(albumId) {
    try {
        const response = await fetchAPI(`/api/metadata/history/${albumId}`);
        const historyContainer = document.getElementById('metadata-history');
        
        if (response.history && response.history.length > 0) {
            historyContainer.innerHTML = response.history.map(entry => `
                <div class="history-entry">
                    <div class="history-header">
                        <span class="history-date">${new Date(entry.timestamp).toLocaleString()}</span>
                        <span class="history-user">${entry.user || 'System'}</span>
                    </div>
                    <div class="history-changes">
                        ${entry.changes.map(change => `
                            <div class="history-change">
                                <strong>${change.field}:</strong> 
                                <span class="old-value">${change.old_value || 'Empty'}</span> → 
                                <span class="new-value">${change.new_value || 'Empty'}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('');
        } else {
            historyContainer.innerHTML = '<p class="no-history">No edit history available</p>';
        }
    } catch (error) {
        console.error('Failed to load metadata history:', error);
    }
}

// Preview metadata changes
function previewMetadata() {
    const modal = document.getElementById('metadata-preview-modal');
    modal.style.display = 'flex';
    
    // Populate original metadata
    displayMetadata('original-metadata-display', originalMetadata);
    
    // Collect current form data
    const updatedMetadata = collectFormData();
    displayMetadata('updated-metadata-display', updatedMetadata);
    
    // Generate changes summary
    generateChangesSummary(originalMetadata, updatedMetadata);
}

// Collect form data
function collectFormData() {
    const formData = {
        id: currentEditingAlbum.id,
        title: document.getElementById('edit-album-title').value.trim(),
        artist: document.getElementById('edit-album-artist').value.trim(),
        year: document.getElementById('edit-release-year').value.trim(),
        genre: document.getElementById('edit-genre').value.trim(),
        label: document.getElementById('edit-label').value.trim(),
        catalog_number: document.getElementById('edit-catalog-number').value.trim(),
        tracks: []
    };
    
    // Collect track data
    const trackFields = document.querySelectorAll('.track-field');
    const tracksData = {};
    
    trackFields.forEach(field => {
        const index = parseInt(field.dataset.index);
        const fieldName = field.dataset.field;
        
        if (!tracksData[index]) tracksData[index] = {};
        tracksData[index][fieldName] = field.value.trim();
    });
    
    // Convert to array
    formData.tracks = Object.keys(tracksData).map(index => tracksData[index]);
    
    return formData;
}

// Display metadata in preview
function displayMetadata(containerId, metadata) {
    const container = document.getElementById(containerId);
    
    container.innerHTML = `
        <div class="metadata-display">
            <div class="metadata-album">
                <h4>Album Information</h4>
                <p><strong>Title:</strong> ${metadata.title || 'N/A'}</p>
                <p><strong>Artist:</strong> ${metadata.artist || 'N/A'}</p>
                <p><strong>Year:</strong> ${metadata.year || 'N/A'}</p>
                <p><strong>Genre:</strong> ${metadata.genre || 'N/A'}</p>
                <p><strong>Label:</strong> ${metadata.label || 'N/A'}</p>
                <p><strong>Catalog #:</strong> ${metadata.catalog_number || 'N/A'}</p>
            </div>
            <div class="metadata-tracks">
                <h4>Tracks (${metadata.tracks ? metadata.tracks.length : 0})</h4>
                ${metadata.tracks ? metadata.tracks.map(track => `
                    <div class="track-preview">
                        <strong>#${track.track_number || '?'}</strong> 
                        ${track.title || 'Untitled'} 
                        ${track.artist ? `by ${track.artist}` : ''} 
                        ${track.duration ? `(${track.duration})` : ''}
                    </div>
                `).join('') : '<p>No tracks</p>'}
            </div>
        </div>
    `;
}

// Generate changes summary
function generateChangesSummary(original, updated) {
    const container = document.getElementById('changes-summary');
    const changes = [];
    
    // Compare album fields
    const albumFields = ['title', 'artist', 'year', 'genre', 'label', 'catalog_number'];
    albumFields.forEach(field => {
        const oldVal = original[field] || '';
        const newVal = updated[field] || '';
        
        if (oldVal !== newVal) {
            changes.push({
                type: 'album',
                field: field,
                old: oldVal,
                new: newVal
            });
        }
    });
    
    // Compare tracks
    const maxTracks = Math.max(
        original.tracks ? original.tracks.length : 0,
        updated.tracks ? updated.tracks.length : 0
    );
    
    for (let i = 0; i < maxTracks; i++) {
        const oldTrack = original.tracks && original.tracks[i] ? original.tracks[i] : {};
        const newTrack = updated.tracks && updated.tracks[i] ? updated.tracks[i] : {};
        
        const trackFields = ['title', 'artist', 'track_number', 'duration', 'genre'];
        trackFields.forEach(field => {
            const oldVal = oldTrack[field] || '';
            const newVal = newTrack[field] || '';
            
            if (oldVal !== newVal) {
                changes.push({
                    type: 'track',
                    trackIndex: i + 1,
                    field: field,
                    old: oldVal,
                    new: newVal
                });
            }
        });
    }
    
    if (changes.length === 0) {
        container.innerHTML = '<p>No changes detected</p>';
        return;
    }
    
    container.innerHTML = `
        <div class="changes-list">
            ${changes.map(change => `
                <div class="change-item">
                    <strong>${change.type === 'album' ? 'Album' : `Track ${change.trackIndex}`} - ${change.field}:</strong><br>
                    <span class="old-value">${change.old || 'Empty'}</span> → 
                    <span class="new-value">${change.new || 'Empty'}</span>
                </div>
            `).join('')}
        </div>
        <p><strong>Total changes: ${changes.length}</strong></p>
    `;
}

// Switch preview tab
function switchPreviewTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.preview-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[onclick="switchPreviewTab('${tabName}')"]`).classList.add('active');
    
    // Show corresponding content
    document.getElementById('preview-before').style.display = tabName === 'before' ? 'block' : 'none';
    document.getElementById('preview-after').style.display = tabName === 'after' ? 'block' : 'none';
    document.getElementById('preview-diff').style.display = tabName === 'diff' ? 'block' : 'none';
}

// Confirm and save metadata changes
async function confirmMetadataChanges() {
    await saveMetadata();
    closeMetadataPreview();
}

// Save metadata changes
async function saveMetadata() {
    const saveBtn = document.getElementById('save-metadata-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '💾 Saving...';
    
    try {
        const updatedMetadata = collectFormData();
        
        const response = await fetch('/api/metadata/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                albumId: currentEditingAlbum.id,
                metadata: updatedMetadata,
                originalMetadata: originalMetadata
            })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Failed to save metadata');
        }
        
        showSuccess('Metadata saved successfully!');
        
        // Update original metadata for future comparisons
        originalMetadata = JSON.parse(JSON.stringify(updatedMetadata));
        
        // Refresh data in the UI
        if (document.getElementById('albums').classList.contains('active')) {
            loadAlbums();
        }
        
        closeMetadataEditor();
        
    } catch (error) {
        console.error('Failed to save metadata:', error);
        showError('Failed to save metadata: ' + error.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save Changes';
    }
}

// Reset metadata form to original values
function resetMetadataForm() {
    if (!confirm('Are you sure you want to reset all changes? This will discard all unsaved modifications.')) {
        return;
    }
    
    currentEditingAlbum = JSON.parse(JSON.stringify(originalMetadata));
    populateMetadataForm(currentEditingAlbum);
    calculateMetadataQuality();
    
    // Clear selections
    selectedTracks.clear();
    updateSelectedTracksCount();
    
    showSuccess('Form reset to original values');
}

// Close metadata editor
function closeMetadataEditor() {
    const modal = document.getElementById('metadata-edit-modal');
    modal.style.display = 'none';
    
    // Reset state
    currentEditingAlbum = null;
    originalMetadata = null;
    selectedTracks.clear();
}

// Close metadata preview
function closeMetadataPreview() {
    const modal = document.getElementById('metadata-preview-modal');
    modal.style.display = 'none';
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', init);