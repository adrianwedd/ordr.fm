// Global variables
const charts = {};
const data = {};
let deferredPrompt = null;
let isInstalled = false;
let ws = null;
let wsReconnectAttempts = 0;
const wsMaxReconnectAttempts = 5;

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
        
        // Initialize enhanced error handling and connection monitoring
        startConnectionMonitoring();
        
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
    if (!statusEl) {return;}
    
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
        const permission = Notification.permission;
        
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
async function fetchAPI(endpoint, options = {}) {
    let response;
    let retries = 3;
    let lastError;
    
    // Retry logic for network issues
    while (retries > 0) {
        try {
            response = await fetch(API_BASE + endpoint, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });
            break; // Success, exit retry loop
        } catch (networkError) {
            lastError = networkError;
            retries--;
            if (retries > 0) {
                console.warn(`Network error, retrying... (${retries} attempts left)`, networkError);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
            }
        }
    }
    
    if (!response) {
        throw new Error(`Network request failed after retries: ${lastError.message}`);
    }
    
    // Handle specific HTTP status codes
    if (!response.ok) {
        let errorMessage;
        let errorData = null;
        
        try {
            errorData = await response.json();
            errorMessage = errorData.error || errorData.message || 'Unknown error';
        } catch (parseError) {
            errorMessage = response.statusText || `HTTP ${response.status}`;
        }
        
        // Specific error handling based on status codes
        switch (response.status) {
            case 400:
                throw new Error(`Bad request: ${errorMessage}`);
            case 401:
                throw new Error(`Authentication required: ${errorMessage}`);
            case 403:
                throw new Error(`Access denied: ${errorMessage}`);
            case 404:
                throw new Error(`Resource not found: ${errorMessage}`);
            case 409:
                throw new Error(`Conflict: ${errorMessage}`);
            case 429:
                throw new Error('Rate limited: Please try again later');
            case 500:
                throw new Error(`Server error: ${errorMessage}`);
            case 502:
                throw new Error('Bad gateway: Server temporarily unavailable');
            case 503:
                throw new Error(`Service unavailable: ${errorMessage}`);
            default:
                throw new Error(`Request failed (${response.status}): ${errorMessage}`);
        }
    }
    
    // Parse response with error handling
    try {
        return await response.json();
    } catch (parseError) {
        console.warn('Failed to parse JSON response, returning text', parseError);
        const text = await response.text();
        return text ? { data: text } : {};
    }
}

// Enhanced error display system
function showError(message, context = '', duration = 10000) {
    console.error('Error:', message, context);
    
    // Update connection status if it's a network error
    if (message.includes('Network') || message.includes('fetch')) {
        updateConnectionStatus(false);
    }
    
    // Create error notification
    const errorId = Date.now().toString();
    const errorHTML = `
        <div id="error-${errorId}" class="error-notification error" onclick="dismissError('${errorId}')">
            <div class="error-content">
                <div class="error-icon">⚠️</div>
                <div class="error-message">
                    <strong>Error</strong>
                    <p>${message}</p>
                    ${context ? `<small>${context}</small>` : ''}
                </div>
                <div class="error-dismiss">✕</div>
            </div>
        </div>
    `;
    
    // Add to error container
    const container = document.getElementById('error-container') || createErrorContainer();
    container.insertAdjacentHTML('beforeend', errorHTML);
    
    // Auto-dismiss after duration
    if (duration > 0) {
        setTimeout(() => dismissError(errorId), duration);
    }
}

// Create error container if it doesn't exist
function createErrorContainer() {
    let container = document.getElementById('error-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'error-container';
        container.className = 'error-container';
        document.body.appendChild(container);
    }
    return container;
}

// Dismiss specific error
function dismissError(errorId) {
    const errorElement = document.getElementById(`error-${errorId}`);
    if (errorElement) {
        errorElement.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => {
            if (errorElement.parentNode) {
                errorElement.parentNode.removeChild(errorElement);
            }
        }, 300);
    }
}

// Enhanced connection status monitoring
const connectionMonitor = {
    isOnline: navigator.onLine,
    lastHeartbeat: Date.now(),
    heartbeatInterval: 30000, // 30 seconds
    retryAttempts: 0,
    maxRetries: 3
};

// Update connection status UI
function updateConnectionStatus(isConnected, details = '') {
    const statusElement = document.getElementById('status');
    if (!statusElement) {return;}
    
    connectionMonitor.isOnline = isConnected;
    
    if (isConnected) {
        statusElement.textContent = details || 'Connected';
        statusElement.className = 'connected';
        connectionMonitor.retryAttempts = 0;
    } else {
        statusElement.textContent = 'Connection Lost';
        statusElement.className = 'disconnected';
    }
}

// Heartbeat to monitor server connection
async function heartbeat() {
    try {
        const response = await fetch(API_BASE + '/api/stats', {
            method: 'GET',
            timeout: 5000
        });
        
        if (response.ok) {
            connectionMonitor.lastHeartbeat = Date.now();
            updateConnectionStatus(true);
            connectionMonitor.retryAttempts = 0;
        } else {
            throw new Error(`Heartbeat failed: ${response.status}`);
        }
    } catch (error) {
        console.warn('Heartbeat failed:', error);
        connectionMonitor.retryAttempts++;
        
        if (connectionMonitor.retryAttempts >= connectionMonitor.maxRetries) {
            updateConnectionStatus(false);
        }
    }
}

// Start connection monitoring
function startConnectionMonitoring() {
    // Initial heartbeat
    heartbeat();
    
    // Regular heartbeat
    setInterval(heartbeat, connectionMonitor.heartbeatInterval);
    
    // Listen for online/offline events
    window.addEventListener('online', () => {
        updateConnectionStatus(true, 'Back Online');
        heartbeat(); // Immediate heartbeat when coming back online
    });
    
    window.addEventListener('offline', () => {
        updateConnectionStatus(false, 'Offline');
    });
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
        if (charts.quality) {charts.quality.destroy();}
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
        if (charts.mode) {charts.mode.destroy();}
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
        if (!event.active) {simulation.alphaTarget(0.3).restart();}
        d.fx = d.x;
        d.fy = d.y;
    }
    
    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }
    
    function dragended(event, d) {
        if (!event.active) {simulation.alphaTarget(0);}
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
        if (charts.timeline) {charts.timeline.destroy();}
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
        if (charts.metadata) {charts.metadata.destroy();}
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
        if (charts.duplicateQuality) {charts.duplicateQuality.destroy();}
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
        if (charts.collectionGrowth) {charts.collectionGrowth.destroy();}
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
    if (bytes === 0) {return '0 Bytes';}
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
    if (upButton.disabled) {return;}
    
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
    if (existing) {return existing;}
    
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
    if (existing) {return existing;}
    
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
            '⚠️ Backup Already Running!\n\n' +
            `Active backups: ${status.activeBackups.length}\n` +
            `System processes: ${status.systemProcesses.length}\n\n` +
            'Do you want to:\n' +
            '• Cancel existing backups and start new one? (OK)\n' +
            '• Keep existing backups running? (Cancel)'
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
    if (bytes === 0) {return '0 Bytes';}
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
        if (label) {params.append('label', label);}
        if (year) {params.append('year', year);}
        
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
    
    let html = '<div class="enrichment-data">';
    
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
    
    html += '</div>';
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
const searchCache = {};
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
        if (currentSearchFilters.album) {params.append('album', currentSearchFilters.album);}
        if (currentSearchFilters.artist) {params.append('artist', currentSearchFilters.artist);}
        if (currentSearchFilters.label) {params.append('label', currentSearchFilters.label);}
        if (currentSearchFilters.yearFrom) {params.append('year_from', currentSearchFilters.yearFrom);}
        if (currentSearchFilters.yearTo) {params.append('year_to', currentSearchFilters.yearTo);}
        if (currentSearchFilters.quality) {params.append('quality', currentSearchFilters.quality);}
        if (currentSearchFilters.orgMode) {params.append('org_mode', currentSearchFilters.orgMode);}
        
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

// Enhanced Save Album Search with better UX
function saveAlbumSearch() {
    if (Object.keys(currentSearchFilters).length === 0) {
        showToast('No active filters to save', 'warning');
        return;
    }
    
    const searchName = prompt('Enter a name for this search preset:');
    if (!searchName) {return;}
    
    if (searchName.trim() === '') {
        showToast('Please enter a valid name', 'error');
        return;
    }
    
    try {
        // Save to localStorage with enhanced metadata
        const savedSearches = JSON.parse(localStorage.getItem('savedAlbumSearches') || '{}');
        
        // Check if name already exists
        if (savedSearches[searchName]) {
            if (!confirm(`A preset named "${searchName}" already exists. Overwrite it?`)) {
                return;
            }
        }
        
        savedSearches[searchName] = {
            filters: { ...currentSearchFilters },
            created: new Date().toISOString(),
            lastUsed: new Date().toISOString(),
            useCount: savedSearches[searchName]?.useCount || 0
        };
        
        localStorage.setItem('savedAlbumSearches', JSON.stringify(savedSearches));
        showToast(`Search preset "${searchName}" saved successfully!`, 'success');
        
        // Track in search history
        addToSearchHistory(currentSearchFilters, allAlbumsData.length);
        
    } catch (error) {
        console.error('Error saving search preset:', error);
        showToast('Failed to save search preset', 'error');
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

// ========== SEARCH PRESETS & HISTORY FUNCTIONS ==========

// Show Search Presets Modal
function showSearchPresets() {
    const modal = document.getElementById('search-presets-modal');
    const list = document.getElementById('search-presets-list');
    
    // Load saved presets
    try {
        const savedSearches = JSON.parse(localStorage.getItem('savedAlbumSearches') || '{}');
        const presetKeys = Object.keys(savedSearches);
        
        if (presetKeys.length === 0) {
            list.innerHTML = '<div class="no-presets">🔍 No saved search presets yet.<br>Create a search and click "💾 Save Search" to save it as a preset.</div>';
        } else {
            list.innerHTML = presetKeys
                .sort((a, b) => new Date(savedSearches[b].lastUsed || savedSearches[b].created) - new Date(savedSearches[a].lastUsed || savedSearches[a].created))
                .map(name => {
                    const preset = savedSearches[name];
                    const filterTags = Object.entries(preset.filters)
                        .map(([key, value]) => `<span class="preset-filter-tag">${key}: ${value}</span>`)
                        .join(' ');
                    
                    return `
                        <div class="preset-item">
                            <div class="preset-header">
                                <div class="preset-name">${escapeHtml(name)}</div>
                                <div class="preset-date">${formatRelativeTime(preset.created)}</div>
                            </div>
                            <div class="preset-filters">${filterTags}</div>
                            <div class="preset-actions">
                                <button class="preset-btn load" onclick="loadSearchPreset('${escapeHtml(name)}')">📁 Load</button>
                                <button class="preset-btn delete" onclick="deleteSearchPreset('${escapeHtml(name)}')">🗑️ Delete</button>
                            </div>
                        </div>
                    `;
                }).join('');
        }
        
        modal.style.display = 'flex';
    } catch (error) {
        console.error('Error loading search presets:', error);
        showToast('Failed to load search presets', 'error');
    }
}

// Close Search Presets Modal
function closeSearchPresets() {
    document.getElementById('search-presets-modal').style.display = 'none';
}

// Load Search Preset
function loadSearchPreset(name) {
    try {
        const savedSearches = JSON.parse(localStorage.getItem('savedAlbumSearches') || '{}');
        const preset = savedSearches[name];
        
        if (!preset) {
            showToast('Preset not found', 'error');
            return;
        }
        
        // Update use count and last used
        preset.useCount = (preset.useCount || 0) + 1;
        preset.lastUsed = new Date().toISOString();
        localStorage.setItem('savedAlbumSearches', JSON.stringify(savedSearches));
        
        // Load filters into form
        document.getElementById('search-album-title').value = preset.filters.album || '';
        document.getElementById('search-artist-name').value = preset.filters.artist || '';
        document.getElementById('search-label-name').value = preset.filters.label || '';
        document.getElementById('search-year-from').value = preset.filters.yearFrom || '';
        document.getElementById('search-year-to').value = preset.filters.yearTo || '';
        document.getElementById('search-quality').value = preset.filters.quality || '';
        document.getElementById('search-org-mode').value = preset.filters.orgMode || '';
        
        closeSearchPresets();
        
        // Perform search
        performAlbumSearch();
        
        showToast(`Loaded preset: ${name}`, 'success');
        
    } catch (error) {
        console.error('Error loading search preset:', error);
        showToast('Failed to load search preset', 'error');
    }
}

// Delete Search Preset
function deleteSearchPreset(name) {
    if (!confirm(`Are you sure you want to delete the preset "${name}"?`)) {
        return;
    }
    
    try {
        const savedSearches = JSON.parse(localStorage.getItem('savedAlbumSearches') || '{}');
        delete savedSearches[name];
        localStorage.setItem('savedAlbumSearches', JSON.stringify(savedSearches));
        
        showToast(`Deleted preset: ${name}`, 'success');
        
        // Refresh the presets list
        showSearchPresets();
        
    } catch (error) {
        console.error('Error deleting search preset:', error);
        showToast('Failed to delete search preset', 'error');
    }
}

// Clear All Presets
function clearAllPresets() {
    const savedSearches = JSON.parse(localStorage.getItem('savedAlbumSearches') || '{}');
    const count = Object.keys(savedSearches).length;
    
    if (count === 0) {
        showToast('No presets to clear', 'info');
        return;
    }
    
    if (!confirm(`Are you sure you want to delete all ${count} saved presets? This cannot be undone.`)) {
        return;
    }
    
    localStorage.removeItem('savedAlbumSearches');
    showToast(`Cleared ${count} presets`, 'success');
    showSearchPresets();
}

// Export Presets
function exportPresets() {
    try {
        const savedSearches = JSON.parse(localStorage.getItem('savedAlbumSearches') || '{}');
        
        if (Object.keys(savedSearches).length === 0) {
            showToast('No presets to export', 'info');
            return;
        }
        
        const data = JSON.stringify(savedSearches, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `ordr-fm-search-presets-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('Presets exported successfully', 'success');
        
    } catch (error) {
        console.error('Error exporting presets:', error);
        showToast('Failed to export presets', 'error');
    }
}

// Import Presets
function importPresets() {
    const input = document.getElementById('import-presets');
    const file = input.files[0];
    
    if (!file) {return;}
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            const existing = JSON.parse(localStorage.getItem('savedAlbumSearches') || '{}');
            
            let importCount = 0;
            let overwriteCount = 0;
            
            Object.entries(importedData).forEach(([name, preset]) => {
                if (existing[name]) {
                    overwriteCount++;
                } else {
                    importCount++;
                }
                existing[name] = preset;
            });
            
            localStorage.setItem('savedAlbumSearches', JSON.stringify(existing));
            
            const message = `Imported ${importCount} new presets` + 
                           (overwriteCount > 0 ? `, overwrote ${overwriteCount} existing` : '');
            
            showToast(message, 'success');
            showSearchPresets();
            
        } catch (error) {
            console.error('Error importing presets:', error);
            showToast('Invalid preset file format', 'error');
        }
    };
    reader.readAsText(file);
    
    // Clear input
    input.value = '';
}

// ========== SEARCH HISTORY FUNCTIONS ==========

// Add to Search History
function addToSearchHistory(filters, resultCount) {
    try {
        const history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
        
        const entry = {
            filters: { ...filters },
            resultCount,
            timestamp: new Date().toISOString(),
            id: Date.now().toString()
        };
        
        // Add to beginning, limit to 50 entries
        history.unshift(entry);
        history.splice(50);
        
        localStorage.setItem('searchHistory', JSON.stringify(history));
    } catch (error) {
        console.error('Error saving search history:', error);
    }
}

// Show Search History Modal
function showSearchHistory() {
    const modal = document.getElementById('search-history-modal');
    const list = document.getElementById('search-history-list');
    
    try {
        const history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
        
        if (history.length === 0) {
            list.innerHTML = '<div class="no-history">🕐 No search history yet.<br>Your recent searches will appear here.</div>';
        } else {
            list.innerHTML = history.map(entry => {
                const filterTags = Object.entries(entry.filters)
                    .map(([key, value]) => `<span class="history-filter-tag">${key}: ${value}</span>`)
                    .join(' ');
                
                const query = Object.values(entry.filters).join(' ');
                
                return `
                    <div class="history-item">
                        <div class="history-header">
                            <div class="history-query">${escapeHtml(query) || 'Complex search'}</div>
                            <div class="history-date">${formatRelativeTime(entry.timestamp)}</div>
                        </div>
                        <div class="history-results">${filterTags}</div>
                        <div class="history-results">Found ${entry.resultCount} results</div>
                        <div class="history-actions">
                            <button class="history-btn load" onclick="loadSearchFromHistory('${entry.id}')">🔄 Repeat</button>
                            <button class="history-btn delete" onclick="deleteSearchFromHistory('${entry.id}')">🗑️ Remove</button>
                        </div>
                    </div>
                `;
            }).join('');
        }
        
        modal.style.display = 'flex';
    } catch (error) {
        console.error('Error loading search history:', error);
        showToast('Failed to load search history', 'error');
    }
}

// Close Search History Modal
function closeSearchHistory() {
    document.getElementById('search-history-modal').style.display = 'none';
}

// Load Search from History
function loadSearchFromHistory(entryId) {
    try {
        const history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
        const entry = history.find(h => h.id === entryId);
        
        if (!entry) {
            showToast('History entry not found', 'error');
            return;
        }
        
        // Load filters into form
        document.getElementById('search-album-title').value = entry.filters.album || '';
        document.getElementById('search-artist-name').value = entry.filters.artist || '';
        document.getElementById('search-label-name').value = entry.filters.label || '';
        document.getElementById('search-year-from').value = entry.filters.yearFrom || '';
        document.getElementById('search-year-to').value = entry.filters.yearTo || '';
        document.getElementById('search-quality').value = entry.filters.quality || '';
        document.getElementById('search-org-mode').value = entry.filters.orgMode || '';
        
        closeSearchHistory();
        
        // Perform search
        performAlbumSearch();
        
        showToast('Repeated search from history', 'success');
        
    } catch (error) {
        console.error('Error loading search from history:', error);
        showToast('Failed to load search from history', 'error');
    }
}

// Delete Search from History
function deleteSearchFromHistory(entryId) {
    try {
        let history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
        history = history.filter(h => h.id !== entryId);
        localStorage.setItem('searchHistory', JSON.stringify(history));
        
        showToast('Removed from history', 'success');
        showSearchHistory();
        
    } catch (error) {
        console.error('Error deleting search from history:', error);
        showToast('Failed to remove from history', 'error');
    }
}

// Clear Search History
function clearSearchHistory() {
    const history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    
    if (history.length === 0) {
        showToast('No history to clear', 'info');
        return;
    }
    
    if (!confirm(`Are you sure you want to clear all ${history.length} search history entries?`)) {
        return;
    }
    
    localStorage.removeItem('searchHistory');
    showToast('Search history cleared', 'success');
    showSearchHistory();
}

// Format Relative Time
function formatRelativeTime(timestamp) {
    const now = new Date();
    const date = new Date(timestamp);
    const diff = now - date;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {return `${days}d ago`;}
    if (hours > 0) {return `${hours}h ago`;}
    if (minutes > 0) {return `${minutes}m ago`;}
    return 'Just now';
}

// Enhance performAlbumSearch to track history
const originalPerformAlbumSearch = performAlbumSearch;
performAlbumSearch = async function() {
    await originalPerformAlbumSearch();
    
    // Track in search history if we have filters
    if (Object.keys(currentSearchFilters).length > 0) {
        addToSearchHistory(currentSearchFilters, allAlbumsData.length);
    }
};

// Sort Album Results
function sortAlbumResults() {
    const sortBy = document.getElementById('albums-sort').value;
    currentSortOrder = sortBy;
    
    if (!allAlbumsData || allAlbumsData.length === 0) {
        return;
    }
    
    const sortedData = [...allAlbumsData];
    
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
                <button class="action-btn secondary" onclick="event.stopPropagation(); openAudioPlayer('${album.id || ''}')">🎵 Play</button>
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
// Edit album metadata function
function editAlbumMetadata(albumId) {
    openMetadataEditor(albumId);
}

// Open metadata editor modal
async function openMetadataEditor(albumId) {
    try {
        // Fetch album details
        const albumData = await fetchAPI(`/api/albums/${albumId}`);
        
        // Create modal HTML
        const modalHTML = `
            <div id="metadata-editor-modal" class="modal-overlay" onclick="closeMetadataEditor(event)">
                <div class="modal-content metadata-editor" onclick="event.stopPropagation()">
                    <div class="modal-header">
                        <h2>Edit Album Metadata</h2>
                        <button class="close-btn" onclick="closeMetadataEditor()">&times;</button>
                    </div>
                    
                    <div class="modal-body">
                        <form id="metadata-form" onsubmit="saveMetadata(event, ${albumId})">
                            <div class="form-group">
                                <label for="album-artist">Artist *</label>
                                <input type="text" id="album-artist" name="album_artist" 
                                       value="${albumData.album.album_artist || ''}" required>
                            </div>
                            
                            <div class="form-group">
                                <label for="album-title">Album Title *</label>
                                <input type="text" id="album-title" name="album_title" 
                                       value="${albumData.album.album_title || ''}" required>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="album-year">Year</label>
                                    <input type="number" id="album-year" name="album_year" 
                                           value="${albumData.album.album_year || ''}" min="1900" max="2030">
                                </div>
                                
                                <div class="form-group">
                                    <label for="album-genre">Genre</label>
                                    <input type="text" id="album-genre" name="genre" 
                                           value="${albumData.album.genre || ''}">
                                </div>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="album-label">Label</label>
                                    <input type="text" id="album-label" name="label" 
                                           value="${albumData.album.label || ''}">
                                </div>
                                
                                <div class="form-group">
                                    <label for="catalog-number">Catalog Number</label>
                                    <input type="text" id="catalog-number" name="catalog_number" 
                                           value="${albumData.album.catalog_number || ''}">
                                </div>
                            </div>
                            
                            ${albumData.tracks && albumData.tracks.length > 0 ? `
                                <div class="tracks-section">
                                    <h3>Tracks</h3>
                                    <div id="tracks-list">
                                        ${albumData.tracks.map(track => `
                                            <div class="track-row" data-track-id="${track.id}">
                                                <div class="track-number">
                                                    <input type="number" value="${track.track_number || ''}" 
                                                           onchange="updateTrackField(${track.id}, 'track_number', this.value)"
                                                           min="1" max="99" style="width: 60px;">
                                                </div>
                                                <div class="track-title">
                                                    <input type="text" value="${track.title || ''}" 
                                                           onchange="updateTrackField(${track.id}, 'title', this.value)"
                                                           placeholder="Track title">
                                                </div>
                                                <div class="track-artist">
                                                    <input type="text" value="${track.artist || ''}" 
                                                           onchange="updateTrackField(${track.id}, 'artist', this.value)"
                                                           placeholder="Artist (optional)">
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            ` : ''}
                            
                            <div class="form-actions">
                                <button type="button" class="btn secondary" onclick="closeMetadataEditor()">Cancel</button>
                                <button type="submit" class="btn primary">Save Changes</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
        
        // Add modal to page
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Show modal with animation
        requestAnimationFrame(() => {
            document.getElementById('metadata-editor-modal').classList.add('show');
        });
        
    } catch (error) {
        showError('Failed to load album metadata: ' + error.message);
    }
}

// Close metadata editor
function closeMetadataEditor(event) {
    if (event && event.target !== event.currentTarget) {return;}
    
    const modal = document.getElementById('metadata-editor-modal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.remove();
        }, 300);
    }
}

// Save metadata changes
async function saveMetadata(event, albumId) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    
    // Convert year to number if provided
    if (data.album_year) {
        data.album_year = parseInt(data.album_year);
    }
    
    try {
        showToast('Saving changes...', 'info');
        
        // Update album metadata
        await fetchAPI(`/api/albums/${albumId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        showToast('Metadata updated successfully!', 'success');
        closeMetadataEditor();
        
        // Refresh the albums display
        await loadAlbums();
        
    } catch (error) {
        showError('Failed to save metadata: ' + error.message);
    }
}

// Update individual track field
async function updateTrackField(trackId, field, value) {
    try {
        const data = { [field]: value };
        
        await fetchAPI(`/api/tracks/${trackId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        // Visual feedback
        const trackRow = document.querySelector(`[data-track-id="${trackId}"]`);
        if (trackRow) {
            trackRow.style.backgroundColor = '#10b98120';
            setTimeout(() => {
                trackRow.style.backgroundColor = '';
            }, 1000);
        }
        
    } catch (error) {
        console.error('Failed to update track:', error);
        showToast('Failed to update track', 'error');
    }
}

// Mobile Gestures & Touch Enhancement System
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
let currentTabIndex = 0;
let tabs = [];
const isSwipeEnabled = true;
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
    if (!isSwipeEnabled) {return;}
    
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
    if (!isSwipeEnabled) {return;}
    
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
    if (!isSwipeEnabled) {return;}
    
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
    if (tabs.length === 0) {return;}
    
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
const selectedTracks = new Set();

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
        if (!currentEditingAlbum.tracks[index]) {return;}
        
        // Apply bulk changes
        if (artist) {currentEditingAlbum.tracks[index].artist = artist;}
        if (genre) {currentEditingAlbum.tracks[index].genre = genre;}
        if (year) {currentEditingAlbum.tracks[index].year = year;}
        if (autoNumber) {currentEditingAlbum.tracks[index].track_number = trackNumber++;}
        
        // Update form fields
        const trackContainer = document.querySelector(`[data-track-index="${index}"]`).closest('.track-edit-item');
        if (artist) {
            const artistField = trackContainer.querySelector('[data-field="artist"]');
            if (artistField) {artistField.value = artist;}
        }
        if (genre) {
            const genreField = trackContainer.querySelector('[data-field="genre"]');
            if (genreField) {genreField.value = genre;}
        }
        if (autoNumber) {
            const numberField = trackContainer.querySelector('[data-field="track_number"]');
            if (numberField) {numberField.value = currentEditingAlbum.tracks[index].track_number;}
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
    const totalScore = 0;
    const maxScore = 0;
    
    // Basic album info (40% of score)
    let basicScore = 0;
    const basicMax = 6;
    
    if (document.getElementById('edit-album-title').value.trim()) {basicScore++;}
    if (document.getElementById('edit-album-artist').value.trim()) {basicScore++;}
    if (document.getElementById('edit-release-year').value.trim()) {basicScore++;}
    if (document.getElementById('edit-genre').value.trim()) {basicScore++;}
    if (document.getElementById('edit-label').value.trim()) {basicScore++;}
    if (document.getElementById('edit-catalog-number').value.trim()) {basicScore++;}
    
    // Track info (50% of score)
    let trackScore = 0;
    let trackMax = 0;
    
    if (currentEditingAlbum.tracks && currentEditingAlbum.tracks.length > 0) {
        currentEditingAlbum.tracks.forEach(track => {
            trackMax += 4; // title, artist, track_number, duration
            
            if (track.title && track.title.trim()) {trackScore++;}
            if (track.artist && track.artist.trim()) {trackScore++;}
            if (track.track_number) {trackScore++;}
            if (track.duration && track.duration.trim()) {trackScore++;}
        });
    }
    
    // Extended info (10% of score)
    let extendedScore = 0;
    const extendedMax = 2;
    
    // Add points for consistency and completeness
    const genres = new Set();
    const artists = new Set();
    
    if (currentEditingAlbum.tracks) {
        currentEditingAlbum.tracks.forEach(track => {
            if (track.genre) {genres.add(track.genre);}
            if (track.artist) {artists.add(track.artist);}
        });
        
        // Consistency points
        if (genres.size <= 2) {extendedScore++;} // Genre consistency
        if (artists.size <= 3 || artists.has(document.getElementById('edit-album-artist').value)) {extendedScore++;} // Artist consistency
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
    if (score >= 90) {return 'excellent';}
    if (score >= 80) {return 'good';}
    if (score >= 60) {return 'fair';}
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
        
        if (!tracksData[index]) {tracksData[index] = {};}
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

// =============================================================================
// AUDIO PLAYER SYSTEM
// =============================================================================

// Audio Player Global State
const audioPlayer = {
    audio: null,
    audioSource: null, // Web Audio API source
    playlist: [],
    currentTrack: -1,
    isPlaying: false,
    isLoading: false,
    volume: 1.0,
    isMuted: false,
    isRepeat: false,
    isShuffle: false,
    originalPlaylist: [],
    loadingTimeout: null,
    retryCount: 0,
    maxRetries: 3,
    equalizer: {
        context: null,
        filters: [],
        gains: [0, 0, 0, 0, 0, 0, 0, 0], // 8-band equalizer
        enabled: true
    },
    visualization: {
        analyser: null,
        dataArray: null,
        animationFrame: null
    }
};

// Initialize Audio Player
function initAudioPlayer() {
    try {
        // Create audio context for advanced features
        if (window.AudioContext || window.webkitAudioContext) {
            audioPlayer.equalizer.context = new (window.AudioContext || window.webkitAudioContext)();
            initEqualizer();
        }
        
        // Initialize keyboard shortcuts
        initAudioKeyboardShortcuts();
        
        console.log('Audio player initialized successfully');
    } catch (error) {
        console.error('Failed to initialize audio player:', error);
    }
}

// Initialize Equalizer
function initEqualizer() {
    const context = audioPlayer.equalizer.context;
    const frequencies = [60, 170, 350, 1000, 3000, 6000, 12000, 14000];
    
    audioPlayer.equalizer.filters = frequencies.map(freq => {
        const filter = context.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1;
        filter.gain.value = 0;
        return filter;
    });
    
    // Connect filters in series
    for (let i = 0; i < audioPlayer.equalizer.filters.length - 1; i++) {
        audioPlayer.equalizer.filters[i].connect(audioPlayer.equalizer.filters[i + 1]);
    }
    
    // Connect to destination
    audioPlayer.equalizer.filters[audioPlayer.equalizer.filters.length - 1].connect(context.destination);
    
    // Setup equalizer controls
    setupEqualizerControls();
}

// Setup Equalizer Controls
function setupEqualizerControls() {
    const sliders = document.querySelectorAll('.audio-equalizer-slider');
    sliders.forEach((slider, index) => {
        slider.addEventListener('input', (e) => {
            const gain = parseFloat(e.target.value);
            if (audioPlayer.equalizer.filters[index]) {
                audioPlayer.equalizer.filters[index].gain.value = gain;
                audioPlayer.equalizer.gains[index] = gain;
            }
        });
    });
}

// Search Tracks
async function searchTracks() {
    const searchTerm = document.getElementById('track-search').value.trim();
    if (!searchTerm) {return;}
    
    try {
        const response = await fetchAPI(`/api/search/tracks?q=${encodeURIComponent(searchTerm)}`);
        displayTrackResults(response.tracks || []);
    } catch (error) {
        console.error('Search failed:', error);
        showError('Failed to search tracks');
    }
}

// Display Track Search Results
function displayTrackResults(tracks) {
    const container = document.getElementById('track-results');
    
    if (!tracks || tracks.length === 0) {
        container.innerHTML = '<div class="loading">No tracks found. Try a different search term.</div>';
        return;
    }
    
    container.innerHTML = tracks.map((track, index) => `
        <div class="track-item" data-track-id="${track.id}">
            <div class="track-item-artwork">🎵</div>
            <div class="track-item-info">
                <div class="track-item-title">${escapeHtml(track.title || 'Unknown Title')}</div>
                <div class="track-item-details">
                    ${escapeHtml(track.artist || 'Unknown Artist')} • 
                    ${escapeHtml(track.album || 'Unknown Album')} • 
                    ${formatDuration(track.duration || 0)}
                </div>
            </div>
            <div class="track-item-actions">
                <button class="track-action-btn" onclick="playTrack(${index}, ${JSON.stringify(track).replace(/"/g, '&quot;')})" title="Play Now">▶️</button>
                <button class="track-action-btn" onclick="addToPlaylist(${JSON.stringify(track).replace(/"/g, '&quot;')})" title="Add to Playlist">➕</button>
                <button class="track-action-btn" onclick="playNext(${JSON.stringify(track).replace(/"/g, '&quot;')})" title="Play Next">⏭️</button>
            </div>
        </div>
    `).join('');
}

// Play Track
function playTrack(index, track) {
    // If this is from search results, create a temporary playlist
    if (typeof track === 'object') {
        audioPlayer.playlist = [track];
        audioPlayer.currentTrack = 0;
        audioPlayer.originalPlaylist = [...audioPlayer.playlist];
    } else {
        // Playing from existing playlist
        audioPlayer.currentTrack = index;
    }
    
    loadAndPlayCurrentTrack();
    showAudioPlayer();
}

// Add Track to Playlist
function addToPlaylist(track) {
    audioPlayer.playlist.push(track);
    if (audioPlayer.originalPlaylist.length === 0) {
        audioPlayer.originalPlaylist = [...audioPlayer.playlist];
    } else {
        audioPlayer.originalPlaylist.push(track);
    }
    
    updatePlaylistDisplay();
    showNotification(`Added "${track.title}" to playlist`);
}

// Play Track Next
function playNext(track) {
    const nextIndex = audioPlayer.currentTrack + 1;
    audioPlayer.playlist.splice(nextIndex, 0, track);
    audioPlayer.originalPlaylist.splice(nextIndex, 0, track);
    
    updatePlaylistDisplay();
    showNotification(`"${track.title}" will play next`);
}

// Load and Play Current Track
async function loadAndPlayCurrentTrack() {
    const track = audioPlayer.playlist[audioPlayer.currentTrack];
    if (!track) {return;}
    
    // Validate track data
    if (!track.id || !track.title) {
        showError('Invalid track data');
        return;
    }
    
    try {
        // Set loading state
        audioPlayer.isLoading = true;
        audioPlayer.retryCount = 0;
        updateLoadingState(true);
        
        // Cleanup previous audio
        cleanupCurrentAudio();
        
        // Create new audio element with enhanced error handling
        audioPlayer.audio = new Audio();
        audioPlayer.audio.preload = 'none';
        audioPlayer.audio.volume = audioPlayer.isMuted ? 0 : audioPlayer.volume;
        audioPlayer.audio.crossOrigin = 'anonymous';
        
        // Setup Web Audio API connection
        await setupWebAudioConnection();
        
        // Setup event listeners first
        setupAudioEventListeners();
        
        // Update UI immediately
        updateTrackInfo(track);
        updatePlaylistDisplay();
        
        // Set loading timeout
        audioPlayer.loadingTimeout = setTimeout(() => {
            if (audioPlayer.isLoading) {
                handleLoadingTimeout();
            }
        }, 10000); // 10 second timeout
        
        // Load track with validation
        const streamUrl = `/api/audio/stream/${encodeURIComponent(track.id)}`;
        audioPlayer.audio.src = streamUrl;
        
        // Preload the audio
        audioPlayer.audio.load();
        
        console.log(`Loading track: ${track.title} by ${track.artist}`);
        
    } catch (error) {
        console.error('Failed to load track:', error);
        handleLoadError(error);
    }
}

// Cleanup current audio resources
function cleanupCurrentAudio() {
    if (audioPlayer.audio) {
        // Remove all event listeners
        const events = ['loadstart', 'loadeddata', 'loadedmetadata', 'canplay', 'canplaythrough', 
                       'timeupdate', 'ended', 'error', 'abort', 'emptied', 'stalled'];
        events.forEach(event => {
            audioPlayer.audio.removeEventListener(event, () => {});
        });
        
        audioPlayer.audio.pause();
        audioPlayer.audio.src = '';
        audioPlayer.audio.load(); // This releases memory
        audioPlayer.audio = null;
    }
    
    // Cleanup Web Audio API source
    if (audioPlayer.audioSource) {
        try {
            audioPlayer.audioSource.disconnect();
        } catch (e) {
            console.warn('AudioSource already disconnected');
        }
        audioPlayer.audioSource = null;
    }
    
    // Clear timeouts
    if (audioPlayer.loadingTimeout) {
        clearTimeout(audioPlayer.loadingTimeout);
        audioPlayer.loadingTimeout = null;
    }
    
    // Stop visualization animation
    if (audioPlayer.visualization.animationFrame) {
        cancelAnimationFrame(audioPlayer.visualization.animationFrame);
        audioPlayer.visualization.animationFrame = null;
    }
}

// Setup Web Audio API connection with error handling
async function setupWebAudioConnection() {
    if (!audioPlayer.equalizer.context || !audioPlayer.equalizer.filters.length || !audioPlayer.audio) {
        return;
    }
    
    try {
        // Resume audio context if suspended
        if (audioPlayer.equalizer.context.state === 'suspended') {
            await audioPlayer.equalizer.context.resume();
        }
        
        // Create media element source only once per audio element
        audioPlayer.audioSource = audioPlayer.equalizer.context.createMediaElementSource(audioPlayer.audio);
        
        // Create analyzer for visualization
        audioPlayer.visualization.analyser = audioPlayer.equalizer.context.createAnalyser();
        audioPlayer.visualization.analyser.fftSize = 256;
        audioPlayer.visualization.dataArray = new Uint8Array(audioPlayer.visualization.analyser.frequencyBinCount);
        
        // Connect audio graph: source -> equalizer -> analyser -> destination
        if (audioPlayer.equalizer.enabled && audioPlayer.equalizer.filters.length > 0) {
            audioPlayer.audioSource.connect(audioPlayer.equalizer.filters[0]);
            audioPlayer.equalizer.filters[audioPlayer.equalizer.filters.length - 1].connect(audioPlayer.visualization.analyser);
        } else {
            audioPlayer.audioSource.connect(audioPlayer.visualization.analyser);
        }
        
        audioPlayer.visualization.analyser.connect(audioPlayer.equalizer.context.destination);
        
        console.log('Web Audio API connected successfully');
        
    } catch (error) {
        console.warn('Web Audio API connection failed:', error);
        // Continue without Web Audio API features
    }
}

// Handle loading timeout
function handleLoadingTimeout() {
    console.warn('Audio loading timeout');
    audioPlayer.isLoading = false;
    updateLoadingState(false);
    
    if (audioPlayer.retryCount < audioPlayer.maxRetries) {
        audioPlayer.retryCount++;
        showNotification(`Loading failed, retrying... (${audioPlayer.retryCount}/${audioPlayer.maxRetries})`);
        setTimeout(() => loadAndPlayCurrentTrack(), 1000);
    } else {
        showError('Failed to load audio file after multiple attempts');
        // Try to skip to next track
        if (audioPlayer.currentTrack < audioPlayer.playlist.length - 1) {
            showNotification('Skipping to next track...');
            setTimeout(() => nextTrack(), 1000);
        }
    }
}

// Handle loading errors
function handleLoadError(error) {
    console.error('Audio loading error:', error);
    audioPlayer.isLoading = false;
    updateLoadingState(false);
    
    const errorMessage = error.message || 'Unknown error occurred';
    
    if (audioPlayer.retryCount < audioPlayer.maxRetries) {
        audioPlayer.retryCount++;
        showNotification(`Loading error, retrying... (${audioPlayer.retryCount}/${audioPlayer.maxRetries})`);
        setTimeout(() => loadAndPlayCurrentTrack(), 2000);
    } else {
        showError(`Failed to load audio: ${errorMessage}`);
        // Auto-skip to next track on persistent error
        if (audioPlayer.currentTrack < audioPlayer.playlist.length - 1) {
            showNotification('Skipping to next track...');
            setTimeout(() => nextTrack(), 1500);
        }
    }
}

// Setup Audio Event Listeners with comprehensive error handling
function setupAudioEventListeners() {
    const audio = audioPlayer.audio;
    if (!audio) {return;}
    
    // Loading events
    audio.addEventListener('loadstart', () => {
        console.log('Audio loading started');
        audioPlayer.isLoading = true;
        updateLoadingState(true);
    });
    
    audio.addEventListener('loadeddata', () => {
        console.log('Audio data loaded');
        audioPlayer.isLoading = false;
        updateLoadingState(false);
        
        if (audioPlayer.loadingTimeout) {
            clearTimeout(audioPlayer.loadingTimeout);
            audioPlayer.loadingTimeout = null;
        }
    });
    
    audio.addEventListener('loadedmetadata', () => {
        console.log('Audio metadata loaded');
        updateDuration();
        audioPlayer.retryCount = 0; // Reset retry count on success
    });
    
    audio.addEventListener('canplay', () => {
        console.log('Audio can start playing');
        audioPlayer.isLoading = false;
        updateLoadingState(false);
        
        // Auto-play if this was triggered by user interaction
        if (audioPlayer.isPlaying || (audioPlayer.retryCount === 0 && audioPlayer.currentTrack >= 0)) {
            playCurrentTrack();
        }
    });
    
    audio.addEventListener('canplaythrough', () => {
        console.log('Audio can play through without buffering');
        startVisualization();
    });
    
    // Playback events
    audio.addEventListener('play', () => {
        audioPlayer.isPlaying = true;
        updatePlayButton();
        startVisualization();
        broadcastPlaybackState('playing');
    });
    
    audio.addEventListener('pause', () => {
        audioPlayer.isPlaying = false;
        updatePlayButton();
        stopVisualization();
        broadcastPlaybackState('paused');
    });
    
    audio.addEventListener('timeupdate', throttle(() => {
        updateProgress();
    }, 100)); // Throttle to every 100ms for performance
    
    audio.addEventListener('ended', () => {
        audioPlayer.isPlaying = false;
        updatePlayButton();
        stopVisualization();
        handleTrackEnd();
        broadcastPlaybackState('ended');
    });
    
    // Error handling
    audio.addEventListener('error', (event) => {
        const error = event.target.error;
        let errorMessage = 'Audio playback error';
        
        if (error) {
            switch (error.code) {
                case error.MEDIA_ERR_ABORTED:
                    errorMessage = 'Audio playback was aborted';
                    break;
                case error.MEDIA_ERR_NETWORK:
                    errorMessage = 'Network error occurred while loading audio';
                    break;
                case error.MEDIA_ERR_DECODE:
                    errorMessage = 'Audio format not supported or corrupted';
                    break;
                case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                    errorMessage = 'Audio source not supported';
                    break;
                default:
                    errorMessage = `Audio error: ${error.message || 'Unknown error'}`;
            }
        }
        
        console.error('Audio error:', errorMessage, error);
        handleLoadError(new Error(errorMessage));
    });
    
    // Network events
    audio.addEventListener('waiting', () => {
        console.log('Audio waiting for data');
        updateLoadingState(true);
        showNotification('Buffering...', 1000);
    });
    
    audio.addEventListener('stalled', () => {
        console.warn('Audio download stalled');
        showNotification('Connection slow, buffering...', 2000);
    });
    
    audio.addEventListener('suspend', () => {
        console.log('Audio loading suspended');
    });
    
    audio.addEventListener('abort', () => {
        console.log('Audio loading aborted');
        audioPlayer.isLoading = false;
        updateLoadingState(false);
    });
    
    audio.addEventListener('emptied', () => {
        console.log('Audio emptied');
        audioPlayer.isLoading = false;
        updateLoadingState(false);
    });
    
    // Volume change
    audio.addEventListener('volumechange', () => {
        updateVolumeDisplay();
        updateMuteButton();
    });
}

// Handle Track End
function handleTrackEnd() {
    if (audioPlayer.isRepeat) {
        audioPlayer.audio.currentTime = 0;
        audioPlayer.audio.play();
        return;
    }
    
    if (audioPlayer.currentTrack < audioPlayer.playlist.length - 1) {
        nextTrack();
    } else {
        // End of playlist
        audioPlayer.isPlaying = false;
        updatePlayButton();
        showNotification('Playlist finished');
    }
}

// Audio Control Functions
function togglePlayPause() {
    if (!audioPlayer.audio) {return;}
    
    if (audioPlayer.isPlaying) {
        audioPlayer.audio.pause();
        audioPlayer.isPlaying = false;
    } else {
        audioPlayer.audio.play().then(() => {
            audioPlayer.isPlaying = true;
        }).catch(error => {
            console.error('Play failed:', error);
        });
    }
    
    updatePlayButton();
}

function previousTrack() {
    if (audioPlayer.currentTrack > 0) {
        audioPlayer.currentTrack--;
        loadAndPlayCurrentTrack();
    }
}

function nextTrack() {
    if (audioPlayer.currentTrack < audioPlayer.playlist.length - 1) {
        audioPlayer.currentTrack++;
        loadAndPlayCurrentTrack();
    }
}

function seekToPosition(event) {
    if (!audioPlayer.audio) {return;}
    
    const progressBar = event.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    const newTime = percent * audioPlayer.audio.duration;
    
    audioPlayer.audio.currentTime = newTime;
}

function setVolume(event) {
    const volumeBar = event.currentTarget;
    const rect = volumeBar.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    
    audioPlayer.volume = Math.max(0, Math.min(1, percent));
    if (audioPlayer.audio) {
        audioPlayer.audio.volume = audioPlayer.volume;
    }
    
    updateVolumeDisplay();
}

function toggleMute() {
    if (!audioPlayer.audio) {return;}
    
    audioPlayer.isMuted = !audioPlayer.isMuted;
    audioPlayer.audio.muted = audioPlayer.isMuted;
    
    updateMuteButton();
}

function toggleRepeat() {
    audioPlayer.isRepeat = !audioPlayer.isRepeat;
    updateRepeatButton();
    showNotification(`Repeat ${audioPlayer.isRepeat ? 'enabled' : 'disabled'}`);
}

function toggleShuffle() {
    audioPlayer.isShuffle = !audioPlayer.isShuffle;
    
    if (audioPlayer.isShuffle) {
        // Shuffle playlist (keep current track first)
        const currentTrack = audioPlayer.playlist[audioPlayer.currentTrack];
        const otherTracks = audioPlayer.playlist.filter((_, index) => index !== audioPlayer.currentTrack);
        const shuffledTracks = shuffleArray(otherTracks);
        audioPlayer.playlist = [currentTrack, ...shuffledTracks];
        audioPlayer.currentTrack = 0;
    } else {
        // Restore original order
        const currentTrack = audioPlayer.playlist[audioPlayer.currentTrack];
        audioPlayer.playlist = [...audioPlayer.originalPlaylist];
        audioPlayer.currentTrack = audioPlayer.playlist.findIndex(track => 
            track.id === currentTrack.id
        );
        if (audioPlayer.currentTrack === -1) {audioPlayer.currentTrack = 0;}
    }
    
    updateShuffleButton();
    updatePlaylistDisplay();
    showNotification(`Shuffle ${audioPlayer.isShuffle ? 'enabled' : 'disabled'}`);
}

// UI Update Functions
function updateTrackInfo(track) {
    document.getElementById('audio-track-title').textContent = track.title || 'Unknown Title';
    document.getElementById('audio-track-artist').textContent = track.artist || 'Unknown Artist';
    document.getElementById('audio-artwork').textContent = track.title ? track.title[0].toUpperCase() : '🎵';
}

function updatePlayButton() {
    const button = document.getElementById('audio-play-pause');
    button.textContent = audioPlayer.isPlaying ? '⏸️' : '▶️';
}

function updateProgress() {
    if (!audioPlayer.audio) {return;}
    
    const current = audioPlayer.audio.currentTime;
    const duration = audioPlayer.audio.duration;
    
    if (duration > 0) {
        const percent = (current / duration) * 100;
        document.getElementById('audio-progress-fill').style.width = `${percent}%`;
        document.getElementById('audio-progress-handle').style.left = `${percent}%`;
    }
    
    document.getElementById('audio-current-time').textContent = formatTime(current);
}

function updateDuration() {
    if (!audioPlayer.audio) {return;}
    
    const duration = audioPlayer.audio.duration;
    document.getElementById('audio-duration').textContent = formatTime(duration);
}

function updateVolumeDisplay() {
    const percent = audioPlayer.volume * 100;
    document.getElementById('audio-volume-fill').style.width = `${percent}%`;
}

function updateMuteButton() {
    const button = document.getElementById('audio-mute');
    button.textContent = audioPlayer.isMuted ? '🔇' : '🔊';
}

function updateRepeatButton() {
    const button = document.getElementById('audio-repeat');
    button.style.color = audioPlayer.isRepeat ? '#667eea' : 'var(--text-primary)';
}

function updateShuffleButton() {
    const button = document.getElementById('audio-shuffle');
    button.style.color = audioPlayer.isShuffle ? '#667eea' : 'var(--text-primary)';
}

// Playlist Management
function updatePlaylistDisplay() {
    const container = document.getElementById('audio-playlist-items');
    const tabContainer = document.getElementById('current-playlist');
    
    if (audioPlayer.playlist.length === 0) {
        const emptyMessage = '<div class="empty-playlist">No tracks in playlist</div>';
        container.innerHTML = emptyMessage;
        if (tabContainer) {tabContainer.innerHTML = '<div class="empty-playlist">No tracks in playlist. Search and add tracks above.</div>';}
        return;
    }
    
    const playlistHTML = audioPlayer.playlist.map((track, index) => `
        <div class="audio-playlist-item ${index === audioPlayer.currentTrack ? 'current' : ''}" 
             onclick="playTrack(${index})">
            <div class="audio-playlist-item-index">${index + 1}</div>
            <div class="audio-playlist-item-info">
                <div class="audio-playlist-item-title">${escapeHtml(track.title || 'Unknown Title')}</div>
                <div class="audio-playlist-item-artist">${escapeHtml(track.artist || 'Unknown Artist')}</div>
            </div>
            <div class="audio-playlist-item-duration">${formatDuration(track.duration || 0)}</div>
        </div>
    `).join('');
    
    container.innerHTML = playlistHTML;
    
    // Update tab playlist display
    if (tabContainer) {
        const tabPlaylistHTML = audioPlayer.playlist.map((track, index) => `
            <div class="playlist-item ${index === audioPlayer.currentTrack ? 'current' : ''}">
                <div class="playlist-item-index">${index + 1}</div>
                <div class="playlist-item-info">
                    <div class="playlist-item-title">${escapeHtml(track.title || 'Unknown Title')}</div>
                    <div class="playlist-item-artist">${escapeHtml(track.artist || 'Unknown Artist')} • ${escapeHtml(track.album || 'Unknown Album')}</div>
                </div>
                <div class="playlist-item-duration">${formatDuration(track.duration || 0)}</div>
            </div>
        `).join('');
        tabContainer.innerHTML = tabPlaylistHTML;
    }
}

function clearPlaylist() {
    audioPlayer.playlist = [];
    audioPlayer.originalPlaylist = [];
    audioPlayer.currentTrack = -1;
    
    if (audioPlayer.audio) {
        audioPlayer.audio.pause();
        audioPlayer.audio = null;
    }
    
    audioPlayer.isPlaying = false;
    hideAudioPlayer();
    updatePlaylistDisplay();
    updatePlayButton();
    
    showNotification('Playlist cleared');
}

function shufflePlaylist() {
    if (audioPlayer.playlist.length <= 1) {return;}
    
    const currentTrack = audioPlayer.playlist[audioPlayer.currentTrack];
    const otherTracks = audioPlayer.playlist.filter((_, index) => index !== audioPlayer.currentTrack);
    const shuffledTracks = shuffleArray(otherTracks);
    
    audioPlayer.playlist = [currentTrack, ...shuffledTracks];
    audioPlayer.currentTrack = 0;
    
    updatePlaylistDisplay();
    showNotification('Playlist shuffled');
}

function savePlaylist() {
    if (audioPlayer.playlist.length === 0) {
        showError('No tracks in playlist to save');
        return;
    }
    
    const playlistName = prompt('Enter playlist name:');
    if (!playlistName) {return;}
    
    // TODO: Implement playlist saving to backend
    showNotification(`Playlist "${playlistName}" saved (feature coming soon)`);
}

// Panel Toggle Functions
function toggleEqualizer() {
    const panel = document.getElementById('audio-equalizer-panel');
    panel.classList.toggle('active');
}

function togglePlaylistPanel() {
    const panel = document.getElementById('audio-playlist-panel');
    panel.classList.toggle('active');
}

// Equalizer Functions
function resetEqualizer() {
    const sliders = document.querySelectorAll('.audio-equalizer-slider');
    sliders.forEach((slider, index) => {
        slider.value = '0';
        if (audioPlayer.equalizer.filters[index]) {
            audioPlayer.equalizer.filters[index].gain.value = 0;
            audioPlayer.equalizer.gains[index] = 0;
        }
    });
    
    showNotification('Equalizer reset to flat response');
}

function saveEqualizerPreset() {
    const presetName = prompt('Enter preset name:');
    if (!presetName) {return;}
    
    // TODO: Implement equalizer preset saving
    showNotification(`Equalizer preset "${presetName}" saved (feature coming soon)`);
}

// Audio Player Display Functions
function showAudioPlayer() {
    const container = document.getElementById('audio-player-container');
    container.classList.add('active');
    
    // Add padding to body to prevent content overlap
    document.body.style.paddingBottom = '120px';
}

function hideAudioPlayer() {
    const container = document.getElementById('audio-player-container');
    container.classList.remove('active');
    
    // Remove padding
    document.body.style.paddingBottom = '0';
    
    // Hide panels
    document.getElementById('audio-equalizer-panel').classList.remove('active');
    document.getElementById('audio-playlist-panel').classList.remove('active');
}

// Keyboard Shortcuts
function initAudioKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
        // Only handle shortcuts if no input is focused
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
            return;
        }
        
        switch (event.code) {
            case 'Space':
                event.preventDefault();
                togglePlayPause();
                break;
            case 'ArrowLeft':
                if (event.ctrlKey) {
                    event.preventDefault();
                    previousTrack();
                }
                break;
            case 'ArrowRight':
                if (event.ctrlKey) {
                    event.preventDefault();
                    nextTrack();
                }
                break;
            case 'ArrowUp':
                if (event.ctrlKey) {
                    event.preventDefault();
                    audioPlayer.volume = Math.min(1, audioPlayer.volume + 0.1);
                    if (audioPlayer.audio) {audioPlayer.audio.volume = audioPlayer.volume;}
                    updateVolumeDisplay();
                }
                break;
            case 'ArrowDown':
                if (event.ctrlKey) {
                    event.preventDefault();
                    audioPlayer.volume = Math.max(0, audioPlayer.volume - 0.1);
                    if (audioPlayer.audio) {audioPlayer.audio.volume = audioPlayer.volume;}
                    updateVolumeDisplay();
                }
                break;
            case 'KeyM':
                if (event.ctrlKey) {
                    event.preventDefault();
                    toggleMute();
                }
                break;
            case 'KeyR':
                if (event.ctrlKey) {
                    event.preventDefault();
                    toggleRepeat();
                }
                break;
            case 'KeyS':
                if (event.ctrlKey && event.shiftKey) {
                    event.preventDefault();
                    toggleShuffle();
                }
                break;
        }
    });
}

// Utility Functions
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) {return '0:00';}
    
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatDuration(seconds) {
    if (!seconds || seconds <= 0) {return '0:00';}
    return formatTime(seconds);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// =============================================================================
// AUDIO PLAYER UTILITY FUNCTIONS
// =============================================================================

// Play current track (used by event listeners)
async function playCurrentTrack() {
    if (!audioPlayer.audio) {return;}
    
    try {
        // Resume audio context for user-initiated playback
        if (audioPlayer.equalizer.context && audioPlayer.equalizer.context.state === 'suspended') {
            await audioPlayer.equalizer.context.resume();
        }
        
        const playPromise = audioPlayer.audio.play();
        if (playPromise) {
            await playPromise;
            audioPlayer.isPlaying = true;
            updatePlayButton();
            showNotification(`Now playing: ${audioPlayer.playlist[audioPlayer.currentTrack]?.title}`, 2000);
        }
    } catch (error) {
        console.error('Playback failed:', error);
        
        // Handle common playback issues
        if (error.name === 'NotAllowedError') {
            showError('Playback blocked. Please interact with the page first.');
        } else if (error.name === 'NotSupportedError') {
            showError('Audio format not supported by this browser.');
        } else {
            showError('Playback failed. Trying next track...');
            if (audioPlayer.currentTrack < audioPlayer.playlist.length - 1) {
                setTimeout(() => nextTrack(), 1000);
            }
        }
    }
}

// Update loading state in UI
function updateLoadingState(isLoading) {
    const playButton = document.getElementById('audio-play-pause');
    const trackTitle = document.getElementById('audio-track-title');
    
    if (isLoading) {
        playButton.textContent = '⏳';
        playButton.style.opacity = '0.6';
        trackTitle.style.opacity = '0.7';
        
        // Add loading spinner to play button
        playButton.classList.add('loading');
    } else {
        playButton.style.opacity = '1';
        trackTitle.style.opacity = '1';
        playButton.classList.remove('loading');
        updatePlayButton(); // Restore correct button state
    }
}

// Start audio visualization
function startVisualization() {
    if (!audioPlayer.visualization.analyser || !audioPlayer.visualization.dataArray) {
        return;
    }
    
    function updateVisualization() {
        if (!audioPlayer.isPlaying || !audioPlayer.visualization.analyser) {
            return;
        }
        
        audioPlayer.visualization.analyser.getByteFrequencyData(audioPlayer.visualization.dataArray);
        
        // Update waveform bars if they exist
        const waveformBars = document.querySelectorAll('.audio-waveform-bar');
        if (waveformBars.length > 0) {
            const dataLength = audioPlayer.visualization.dataArray.length;
            const barCount = Math.min(waveformBars.length, 64); // Limit bars
            
            for (let i = 0; i < barCount; i++) {
                const dataIndex = Math.floor((i / barCount) * dataLength);
                const value = audioPlayer.visualization.dataArray[dataIndex];
                const percentage = (value / 255) * 100;
                
                const bar = waveformBars[i];
                if (bar) {
                    bar.style.height = `${Math.max(2, percentage)}%`;
                    bar.classList.toggle('active', value > 30);
                }
            }
        }
        
        audioPlayer.visualization.animationFrame = requestAnimationFrame(updateVisualization);
    }
    
    updateVisualization();
}

// Stop audio visualization
function stopVisualization() {
    if (audioPlayer.visualization.animationFrame) {
        cancelAnimationFrame(audioPlayer.visualization.animationFrame);
        audioPlayer.visualization.animationFrame = null;
    }
    
    // Reset waveform bars
    const waveformBars = document.querySelectorAll('.audio-waveform-bar');
    waveformBars.forEach(bar => {
        bar.style.height = '2px';
        bar.classList.remove('active');
    });
}

// Broadcast playback state (for potential external integrations)
function broadcastPlaybackState(state) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const track = audioPlayer.playlist[audioPlayer.currentTrack];
        ws.send(JSON.stringify({
            type: 'audio_playback_state',
            data: {
                state,
                track: track ? {
                    title: track.title,
                    artist: track.artist,
                    album: track.album
                } : null,
                timestamp: Date.now()
            }
        }));
    }
}

// Throttle function for performance optimization
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Enhanced notification function with duration
function showNotification(message, duration = 3000) {
    // Create notification element if it doesn't exist
    let notification = document.getElementById('audio-notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'audio-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--bg-card);
            color: var(--text-primary);
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid var(--border-color);
            box-shadow: 0 4px 12px var(--shadow);
            z-index: 10000;
            transform: translateX(100%);
            transition: transform 0.3s ease;
            max-width: 300px;
            font-size: 14px;
        `;
        document.body.appendChild(notification);
    }
    
    // Clear any existing timeout
    if (notification.timeout) {
        clearTimeout(notification.timeout);
    }
    
    // Update content and show
    notification.textContent = message;
    notification.style.transform = 'translateX(0)';
    
    // Auto-hide after duration
    notification.timeout = setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
    }, duration);
}

// Enhanced error display
function showError(message, duration = 5000) {
    console.error('Audio Player Error:', message);
    
    // Use existing error display mechanism or create enhanced one
    if (typeof window.showError === 'function') {
        window.showError(message);
    } else {
        showNotification(`❌ ${message}`, duration);
    }
}

// Add accessibility features
function addAccessibilityFeatures() {
    const audioPlayer = document.getElementById('audio-player-container');
    if (!audioPlayer) {return;}
    
    // Add ARIA labels
    const playButton = document.getElementById('audio-play-pause');
    const prevButton = document.getElementById('audio-prev');
    const nextButton = document.getElementById('audio-next');
    const muteButton = document.getElementById('audio-mute');
    const progressBar = document.getElementById('audio-progress-bar');
    const volumeBar = document.getElementById('audio-volume-bar');
    
    if (playButton) {
        playButton.setAttribute('aria-label', 'Play/Pause');
        playButton.setAttribute('role', 'button');
    }
    
    if (prevButton) {
        prevButton.setAttribute('aria-label', 'Previous track');
        prevButton.setAttribute('role', 'button');
    }
    
    if (nextButton) {
        nextButton.setAttribute('aria-label', 'Next track');
        nextButton.setAttribute('role', 'button');
    }
    
    if (muteButton) {
        muteButton.setAttribute('aria-label', 'Mute/Unmute');
        muteButton.setAttribute('role', 'button');
    }
    
    if (progressBar) {
        progressBar.setAttribute('aria-label', 'Track progress');
        progressBar.setAttribute('role', 'slider');
        progressBar.setAttribute('aria-valuemin', '0');
        progressBar.setAttribute('aria-valuemax', '100');
    }
    
    if (volumeBar) {
        volumeBar.setAttribute('aria-label', 'Volume control');
        volumeBar.setAttribute('role', 'slider');
        volumeBar.setAttribute('aria-valuemin', '0');
        volumeBar.setAttribute('aria-valuemax', '100');
    }
    
    // Add keyboard navigation
    audioPlayer.addEventListener('keydown', (event) => {
        switch (event.key) {
            case 'Enter':
            case ' ':
                if (event.target.role === 'button') {
                    event.preventDefault();
                    event.target.click();
                }
                break;
            case 'ArrowLeft':
                if (event.target === progressBar) {
                    event.preventDefault();
                    seekRelative(-5); // Seek back 5 seconds
                }
                break;
            case 'ArrowRight':
                if (event.target === progressBar) {
                    event.preventDefault();
                    seekRelative(5); // Seek forward 5 seconds
                }
                break;
        }
    });
}

// Seek relative to current position
function seekRelative(seconds) {
    if (!audioPlayer.audio) {return;}
    
    const newTime = Math.max(0, Math.min(audioPlayer.audio.duration, audioPlayer.audio.currentTime + seconds));
    audioPlayer.audio.currentTime = newTime;
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    cleanupCurrentAudio();
    
    if (audioPlayer.equalizer.context) {
        audioPlayer.equalizer.context.close();
    }
});

// Initialize audio player when app starts
document.addEventListener('DOMContentLoaded', () => {
    initAudioPlayer();
    addAccessibilityFeatures();
});

// Close audio player
function closeAudioPlayer() {
    const player = document.getElementById('audio-player');
    if (player) {
        player.classList.remove('show');
        
        // Stop current audio
        if (audioPlayer.audio) {
            audioPlayer.audio.pause();
            audioPlayer.audio.currentTime = 0;
        }
    }
}

// Play track from album (integration function)
async function playTrack(albumId, trackId, trackData) {
    try {
        // Show and prepare player
        const player = document.getElementById('audio-player');
        const trackTitle = document.getElementById('player-track-title');
        const trackArtist = document.getElementById('player-track-artist');
        
        if (trackTitle && trackArtist) {
            trackTitle.textContent = trackData.title || `Track ${trackData.track_number || '?'}`;
            trackArtist.textContent = trackData.artist || trackData.album_artist || 'Unknown Artist';
        }
        
        // Load audio
        const audioUrl = `/api/audio/${albumId}/${trackId}`;
        loadAndPlayAudio(audioUrl);
        
        // Show player
        if (player) {
            player.classList.add('show');
        }
        
        showToast(`Playing: ${trackData.title || 'Track ' + (trackData.track_number || '?')}`, 'info');
        
    } catch (error) {
        console.error('Error playing track:', error);
        showError('Failed to play track: ' + error.message);
    }
}

// Open audio player for an album
async function openAudioPlayer(albumId) {
    try {
        // Fetch album and track data
        const albumData = await fetchAPI(`/api/albums/${albumId}`);
        
        if (!albumData.tracks || albumData.tracks.length === 0) {
            showToast('No tracks found for this album', 'info');
            return;
        }
        
        // Play first track
        const firstTrack = albumData.tracks[0];
        await playTrack(albumId, firstTrack.id, {
            title: firstTrack.title,
            artist: firstTrack.artist || albumData.album.album_artist,
            album_artist: albumData.album.album_artist,
            track_number: firstTrack.track_number
        });
        
    } catch (error) {
        console.error('Error opening audio player:', error);
        showError('Failed to open audio player: ' + error.message);
    }
}

// Add play buttons to track rows (if tracks exist in metadata editor)
function addPlayButtons() {
    const trackRows = document.querySelectorAll('.track-row');
    trackRows.forEach(row => {
        const trackId = row.dataset.trackId;
        if (trackId && !row.querySelector('.play-track-btn')) {
            const playBtn = document.createElement('button');
            playBtn.className = 'play-track-btn';
            playBtn.innerHTML = '▶️';
            playBtn.style.cssText = 'background: none; border: none; cursor: pointer; font-size: 14px; padding: 4px;';
            playBtn.onclick = (e) => {
                e.stopPropagation();
                // This would need album context - for now just show a message
                showToast('Audio playback requires real audio files in the database', 'info');
            };
            row.insertBefore(playBtn, row.firstChild);
        }
    });
}

// === BACKUP MANAGEMENT FUNCTIONS ===

// Refresh backup status
async function refreshBackupStatus() {
    try {
        const status = await fetchAPI('/api/backup/status');
        updateBackupUI(status);
    } catch (error) {
        console.error('Error fetching backup status:', error);
        showError('Failed to fetch backup status: ' + error.message);
    }
}

// Update backup UI with status data
function updateBackupUI(status) {
    const statusElement = document.getElementById('backup-status');
    const statusText = document.getElementById('backup-status-text');
    const spinner = document.querySelector('.spinner');
    const startBtn = document.getElementById('start-backup-btn');
    const backupInfo = document.getElementById('backup-info');
    const backupDetails = document.getElementById('backup-details');
    
    // Update status indicator
    statusElement.className = 'backup-status';
    
    if (status.isRunning) {
        statusElement.classList.add('running');
        statusText.textContent = `Backup is running (PID: ${status.currentPid})`;
        spinner.style.display = 'block';
        startBtn.disabled = true;
        startBtn.textContent = '⏳ Backup Running';
    } else {
        spinner.style.display = 'none';
        startBtn.disabled = false;
        startBtn.textContent = '🚀 Start Backup';
        
        if (status.lastBackup) {
            statusElement.classList.add('success');
            statusText.textContent = `Last backup: ${new Date(status.lastBackup.modified).toLocaleString()}`;
            
            // Show backup details
            backupInfo.style.display = 'block';
            backupDetails.innerHTML = `
                <div class="detail-row">
                    <span class="detail-label">File:</span>
                    <span class="detail-value">${status.lastBackup.filename}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Size:</span>
                    <span class="detail-value">${formatBytes(status.lastBackup.size)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Modified:</span>
                    <span class="detail-value">${new Date(status.lastBackup.modified).toLocaleString()}</span>
                </div>
            `;
        } else {
            statusText.textContent = 'No previous backups found';
        }
    }
}

// Start backup process
async function startBackup() {
    try {
        showToast('Starting backup...', 'info');
        
        const response = await fetchAPI('/api/backup/start', {
            method: 'POST'
        });
        
        showToast(response.message, 'success');
        
        // Refresh status after a delay
        setTimeout(refreshBackupStatus, 2000);
        
    } catch (error) {
        console.error('Error starting backup:', error);
        showError('Failed to start backup: ' + error.message);
    }
}

// View backup logs
async function viewBackupLogs() {
    try {
        const status = await fetchAPI('/api/backup/status');
        const logsContainer = document.getElementById('backup-logs');
        const logsList = document.getElementById('backup-log-list');
        
        if (!status.recentLogs || status.recentLogs.length === 0) {
            showToast('No backup logs found', 'info');
            return;
        }
        
        // Show logs section
        logsContainer.style.display = 'block';
        
        // Populate logs list
        logsList.innerHTML = status.recentLogs.map(log => `
            <div class="log-item" onclick="viewLogContent('${log.filename}')">
                <div>
                    <div class="log-filename">${log.filename}</div>
                    <div class="log-date">${new Date(log.modified).toLocaleString()}</div>
                </div>
                <div class="log-size">${formatBytes(log.size)}</div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Error fetching backup logs:', error);
        showError('Failed to fetch backup logs: ' + error.message);
    }
}

// View log content
async function viewLogContent(filename) {
    try {
        const logData = await fetchAPI(`/api/backup/logs/${filename}`);
        
        // Create modal to show log content
        const modalHTML = `
            <div class="modal-overlay" onclick="closeLogModal(event)">
                <div class="modal-content log-viewer" onclick="event.stopPropagation()">
                    <div class="modal-header">
                        <h2>Backup Log: ${filename}</h2>
                        <button class="close-btn" onclick="closeLogModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        ${logData.isPartial ? '<p><strong>Note:</strong> Showing last 500 lines</p>' : ''}
                        <pre class="log-content">${logData.content}</pre>
                    </div>
                </div>
            </div>
        `;
        
        // Add modal to page
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Show modal
        requestAnimationFrame(() => {
            document.querySelector('.modal-overlay').classList.add('show');
        });
        
    } catch (error) {
        console.error('Error fetching log content:', error);
        showError('Failed to fetch log content: ' + error.message);
    }
}

// Close log modal
function closeLogModal(event) {
    if (event && event.target !== event.currentTarget) {return;}
    
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.remove();
        }, 300);
    }
}

// Format bytes helper function
function formatBytes(bytes) {
    if (bytes === 0) {return '0 Bytes';}
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Auto-refresh backup status when on actions tab
setInterval(() => {
    const activeTab = document.querySelector('.nav-item.active');
    if (activeTab && activeTab.textContent.includes('Actions')) {
        refreshBackupStatus();
    }
}, 30000); // Refresh every 30 seconds

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', init);