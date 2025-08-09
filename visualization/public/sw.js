// ordr.fm Progressive Web App Service Worker
// Version 2.0.0 - Advanced caching and offline support

const CACHE_NAME = 'ordr-fm-v2.1.0';
const RUNTIME_CACHE = 'ordr-fm-runtime-v2.1.0';
const DATA_CACHE = 'ordr-fm-data-v2.1.0';

// Resources to cache on install
const STATIC_RESOURCES = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/d3@7'
];

// API endpoints that can be cached
const CACHEABLE_APIS = [
  '/api/stats',
  '/api/health',
  '/api/albums',
  '/api/artists',
  '/api/labels'
];

// Runtime cacheable patterns
const RUNTIME_CACHEABLE = [
  new RegExp('^https://cdn\\.jsdelivr\\.net/'),
  new RegExp('^https://fonts\\.googleapis\\.com/'),
  new RegExp('^https://fonts\\.gstatic\\.com/')
];

// Install event - cache static resources
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      
      // Cache static resources with error handling
      const cachePromises = STATIC_RESOURCES.map(async url => {
        try {
          await cache.add(url);
          console.log(`Cached: ${url}`);
        } catch (error) {
          console.warn(`Failed to cache ${url}:`, error);
        }
      });
      
      await Promise.allSettled(cachePromises);
      
      // Force activation
      await self.skipWaiting();
    })()
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  
  event.waitUntil(
    (async () => {
      // Clean up old caches
      const cacheNames = await caches.keys();
      const deletePromises = cacheNames
        .filter(cacheName => 
          cacheName.startsWith('ordr-fm-') && 
          !cacheName.endsWith('v2.0.0')
        )
        .map(cacheName => {
          console.log('Deleting old cache:', cacheName);
          return caches.delete(cacheName);
        });
      
      await Promise.all(deletePromises);
      
      // Take control of all pages immediately
      await self.clients.claim();
      
      console.log('Service Worker activated');
    })()
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {return;}
  
  // Skip chrome-extension and other non-http requests
  if (!request.url.startsWith('http')) {return;}
  
  event.respondWith(handleFetch(request, url));
});

// Advanced fetch handler with multiple caching strategies
async function handleFetch(request, url) {
  const pathname = url.pathname;
  
  try {
    // Strategy 1: Cache First for static assets
    if (isStaticAsset(pathname)) {
      return await cacheFirst(request);
    }
    
    // Strategy 2: Stale While Revalidate for API data
    if (isAPIRequest(pathname)) {
      return await staleWhileRevalidate(request);
    }
    
    // Strategy 3: Network First for dynamic content
    if (isDynamicContent(pathname)) {
      return await networkFirst(request);
    }
    
    // Strategy 4: Runtime caching for external resources
    if (isRuntimeCacheable(request.url)) {
      return await runtimeCache(request);
    }
    
    // Default: Network with cache fallback
    return await networkWithCacheFallback(request);
    
  } catch (error) {
    console.error('Fetch handler error:', error);
    return await getOfflineFallback(request);
  }
}

// Cache First strategy - for static assets that rarely change
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    throw new Error(`Cache first failed: ${error.message}`);
  }
}

// Stale While Revalidate - for API data that should be fresh but can be stale
async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA_CACHE);
  const cachedResponse = await cache.match(request);
  
  // Always try to fetch fresh data in background
  const fetchPromise = fetch(request).then(async response => {
    if (response.ok) {
      cache.put(request, response.clone());
      
      // Store in IndexedDB for offline access
      await storeAPIResponse(request, response.clone());
    }
    return response;
  }).catch(() => null);
  
  // Return cached version immediately if available, otherwise wait for network
  if (cachedResponse) {
    fetchPromise.catch(() => {}); // Ignore background fetch errors
    return cachedResponse;
  }
  
  return await fetchPromise || cachedResponse;
}

// Network First - for dynamic content that should be fresh
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

// Runtime caching - for external resources
async function runtimeCache(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    throw new Error(`Runtime cache failed: ${error.message}`);
  }
}

// Network with cache fallback - default strategy
async function networkWithCacheFallback(request) {
  try {
    const networkResponse = await fetch(request);
    return networkResponse;
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

// Offline fallback responses
async function getOfflineFallback(request) {
  if (request.destination === 'document') {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match('/') || createOfflineResponse();
  }
  
  if (isAPIRequest(new URL(request.url).pathname)) {
    return createOfflineAPIResponse();
  }
  
  return createOfflineResponse();
}

// Helper functions to identify request types
function isStaticAsset(pathname) {
  return pathname === '/' || 
         pathname.endsWith('.html') ||
         pathname.endsWith('.js') ||
         pathname.endsWith('.css') ||
         pathname.endsWith('.png') ||
         pathname.endsWith('.jpg') ||
         pathname.endsWith('.svg') ||
         pathname.includes('/icons/');
}

function isAPIRequest(pathname) {
  return pathname.startsWith('/api/') && 
         CACHEABLE_APIS.some(api => pathname.startsWith(api));
}

function isDynamicContent(pathname) {
  return pathname.startsWith('/api/') && !isAPIRequest(pathname);
}

function isRuntimeCacheable(url) {
  return RUNTIME_CACHEABLE.some(pattern => pattern.test(url));
}

// Create offline response for HTML requests
function createOfflineResponse() {
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ordr.fm - Offline</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          text-align: center;
          padding: 50px 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
        }
        .offline-container {
          background: rgba(255,255,255,0.1);
          padding: 40px;
          border-radius: 20px;
          backdrop-filter: blur(10px);
        }
        h1 { font-size: 2.5em; margin-bottom: 20px; }
        p { font-size: 1.2em; margin-bottom: 30px; }
        .retry-button {
          background: #fff;
          color: #667eea;
          border: none;
          padding: 15px 30px;
          border-radius: 50px;
          font-size: 16px;
          cursor: pointer;
          transition: transform 0.2s;
        }
        .retry-button:hover { transform: scale(1.05); }
      </style>
    </head>
    <body>
      <div class="offline-container">
        <h1>🎵 ordr.fm</h1>
        <p>You're currently offline. Some features may not be available.</p>
        <button class="retry-button" onclick="window.location.reload()">
          Retry Connection
        </button>
      </div>
    </body>
    </html>
  `, {
    status: 200,
    headers: { 'Content-Type': 'text/html' }
  });
}

// Create offline response for API requests
async function createOfflineAPIResponse(request) {
  const url = new URL(request.url);
  const endpoint = url.pathname.replace('/api/', '');
  
  // Try to get cached data from IndexedDB
  const offlineData = await offlineManager.getData(endpoint);
  
  if (offlineData) {
    return new Response(JSON.stringify({
      ...offlineData,
      offline: true,
      cached: true,
      message: 'Showing cached data (offline)',
      timestamp: Date.now()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Fallback to empty offline response
  return new Response(JSON.stringify({
    offline: true,
    cached: false,
    message: 'No offline data available',
    timestamp: Date.now()
  }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Background sync for when connection is restored
self.addEventListener('sync', event => {
  console.log('Background sync triggered:', event.tag);
  
  if (event.tag === 'refresh-data') {
    event.waitUntil(refreshCachedData());
  }
});

// Refresh cached data when connection is restored
async function refreshCachedData() {
  try {
    const cache = await caches.open(DATA_CACHE);
    const cachedRequests = await cache.keys();
    
    const refreshPromises = cachedRequests.map(async request => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          await cache.put(request, response);
          console.log('Refreshed cache for:', request.url);
          
          // Store in IndexedDB for offline access
          await storeAPIResponse(request, response.clone());
        }
      } catch (error) {
        console.warn('Failed to refresh:', request.url);
      }
    });
    
    await Promise.allSettled(refreshPromises);
    console.log('Cache refresh complete');
    
    // Notify client that data has been refreshed
    broadcastMessage({
      type: 'cache_refreshed',
      message: 'Offline data has been updated'
    });
  } catch (error) {
    console.error('Cache refresh failed:', error);
  }
}

// Handle push notifications
self.addEventListener('push', event => {
  console.log('Push notification received:', event);
  
  const options = {
    body: event.data ? event.data.text() : 'ordr.fm processing update',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '1'
    },
    actions: [
      {
        action: 'view',
        title: 'View Dashboard',
        icon: '/icons/view-action.png'
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
        icon: '/icons/dismiss-action.png'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('ordr.fm Update', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  console.log('Notification clicked:', event);
  
  event.notification.close();
  
  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Periodic background sync (if supported)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'refresh-analytics') {
    event.waitUntil(refreshAnalyticsData());
  }
});

async function refreshAnalyticsData() {
  try {
    // Refresh critical analytics data
    await fetch('/api/stats');
    await fetch('/api/health');
    console.log('Periodic analytics refresh complete');
  } catch (error) {
    console.warn('Periodic refresh failed:', error);
  }
}

// Offline data management
class OfflineDataManager {
  constructor() {
    this.dbName = 'ordrfm-offline';
    this.dbVersion = 1;
    this.stores = ['stats', 'albums', 'artists', 'labels', 'health', 'duplicates', 'insights'];
  }
  
  async openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create object stores
        this.stores.forEach(storeName => {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { 
              keyPath: 'id',
              autoIncrement: true 
            });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }
        });
      };
    });
  }
  
  async storeData(storeName, data) {
    try {
      const db = await this.openDB();
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      
      const record = {
        data: data,
        timestamp: Date.now(),
        url: data._url || 'unknown'
      };
      
      await store.put(record);
      console.log(`Stored offline data for ${storeName}`);
    } catch (error) {
      console.error('Error storing offline data:', error);
    }
  }
  
  async getData(storeName, maxAge = 3600000) { // 1 hour default
    try {
      const db = await this.openDB();
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index('timestamp');
      
      // Get most recent record
      const request = index.openCursor(null, 'prev');
      
      return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const record = cursor.value;
            const age = Date.now() - record.timestamp;
            
            if (age <= maxAge) {
              resolve(record.data);
            } else {
              resolve(null); // Data too old
            }
          } else {
            resolve(null); // No data found
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Error retrieving offline data:', error);
      return null;
    }
  }
  
  async clearOldData(maxAge = 7 * 24 * 3600000) { // 7 days default
    try {
      const db = await this.openDB();
      const cutoffTime = Date.now() - maxAge;
      
      for (const storeName of this.stores) {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const index = store.index('timestamp');
        
        const range = IDBKeyRange.upperBound(cutoffTime);
        const request = index.openCursor(range);
        
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      }
      
      console.log('Cleaned up old offline data');
    } catch (error) {
      console.error('Error cleaning offline data:', error);
    }
  }
}

const offlineManager = new OfflineDataManager();

// Store successful API responses in IndexedDB
async function storeAPIResponse(request, response) {
  try {
    const url = new URL(request.url);
    const endpoint = url.pathname.replace('/api/', '');
    
    if (response.ok && offlineManager.stores.includes(endpoint)) {
      const data = await response.json();
      data._url = request.url;
      await offlineManager.storeData(endpoint, data);
    }
  } catch (error) {
    console.error('Error storing API response:', error);
  }
}

// Broadcast message to all clients
function broadcastMessage(message) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage(message);
    });
  });
}

// Clean up old offline data periodically
setInterval(() => {
  offlineManager.clearOldData();
}, 24 * 60 * 60 * 1000); // Daily cleanup