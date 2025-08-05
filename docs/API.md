# 🔌 ordr.fm API Documentation

**Complete REST API & WebSocket Reference**

The ordr.fm Node.js server provides a comprehensive REST API for accessing music metadata, managing organization operations, and integrating with external tools. This documentation covers all endpoints, authentication, rate limiting, and real-time features.

## 📋 Table of Contents

- [🚀 Quick Start](#-quick-start)
- [🔒 Authentication](#-authentication)
- [📊 Core Data Endpoints](#-core-data-endpoints)
- [🎵 MusicBrainz Integration](#-musicbrainz-integration)
- [📈 Visualization Endpoints](#-visualization-endpoints)
- [⚡ WebSocket API](#-websocket-api)
- [🛠️ Utility Endpoints](#-utility-endpoints)
- [📝 Error Handling](#-error-handling)
- [🔄 Rate Limiting](#-rate-limiting)
- [💡 Usage Examples](#-usage-examples)

---

## 🚀 Quick Start

### Base URL
```
http://localhost:3000/api
```

### Health Check
```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "databases": {
    "metadata": "connected",
    "state": "connected"
  },
  "services": {
    "musicbrainz": "ready"
  }
}
```

---

## 🔒 Authentication

The ordr.fm API currently operates without authentication for local usage. For production deployments, consider implementing:

- API keys for external integrations
- JWT tokens for web interface sessions
- Role-based access control for admin operations

**Future Authentication Header:**
```bash
Authorization: Bearer <your-api-key>
```

---

## 📊 Core Data Endpoints

### Get Albums
**`GET /api/albums`**

Retrieve albums with advanced filtering and pagination.

**Parameters:**
- `limit` (integer, default: 100) - Maximum number of results
- `offset` (integer, default: 0) - Results offset for pagination
- `quality` (string) - Filter by quality: `Lossless`, `Lossy`, `Mixed`
- `genre` (string) - Filter by genre (partial match)
- `label` (string) - Filter by label (partial match)
- `artist` (string) - Filter by artist (partial match)
- `year` (integer) - Filter by year
- `sort` (string) - Sort by: `date`, `artist`, `title`, `year`
- `order` (string) - Sort order: `asc`, `desc`

**Example Request:**
```bash
curl "http://localhost:3000/api/albums?quality=Lossless&genre=Electronic&limit=20&sort=date&order=desc"
```

**Response:**
```json
{
  "albums": [
    {
      "id": 123,
      "directory_path": "/music/source/Album Dir",
      "album_artist": "Aphex Twin",
      "album_title": "Selected Ambient Works 85-92",
      "album_year": 1992,
      "label": "Warp Records",
      "catalog_number": "WARP123",
      "genre": "Electronic",
      "track_count": 13,
      "total_size": 524288000,
      "quality_type": "Lossless",
      "avg_bitrate": 1411,
      "format_mix": "FLAC",
      "organized_path": "/music/organized/Lossless/Aphex Twin/Selected Ambient Works 85-92 (1992)",
      "processed_date": "2024-01-15T10:00:00.000Z",
      "discogs_release_id": 10962,
      "discogs_confidence": 0.95,
      "actual_track_count": 13,
      "actual_formats": "flac"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

### Get Artist Relationships
**`GET /api/artists/relationships`**

Retrieve artist relationship data including aliases and collaborations.

**Response:**
```json
{
  "artists": [
    {
      "id": "Aphex Twin",
      "name": "Aphex Twin",
      "albumCount": 15,
      "labels": ["Warp Records", "Rephlex"],
      "genres": ["Electronic", "Ambient"],
      "avgConfidence": 0.89,
      "isPrimary": true,
      "primaryArtist": "Aphex Twin"
    }
  ],
  "relationships": [
    {
      "source": "AFX",
      "target": "Aphex Twin",
      "type": "alias",
      "confidence": 1.0,
      "source_type": "manual"
    }
  ]
}
```

### Get Label Relationships
**`GET /api/labels/relationships`**

Retrieve label information and their associated artists.

**Response:**
```json
{
  "labels": [
    {
      "label_name": "Warp Records",
      "release_count": 500,
      "primary_genre": "Electronic",
      "is_electronic": true,
      "actual_releases": 45,
      "artists": ["Aphex Twin", "Boards of Canada", "Squarepusher"],
      "avg_confidence": 0.87
    }
  ]
}
```

### Get Genre Distribution
**`GET /api/genres/distribution`**

Get statistics about genre distribution across your collection.

**Response:**
```json
{
  "genres": [
    {
      "genre": "Electronic",
      "quality_type": "Lossless",
      "count": 150,
      "avg_tracks": 10.5,
      "labels": "Warp Records,Ninja Tune,R&S Records"
    }
  ]
}
```

### Get Statistics
**`GET /api/stats`**

Get comprehensive collection statistics.

**Response:**
```json
{
  "totalAlbums": 1250,
  "mappedAlbums": 890,
  "mbArtists": 450,
  "mbReleases": 890,
  "relationships": 1200,
  "avgConfidence": 0.82
}
```

---

## 🎵 MusicBrainz Integration

### Search Releases
**`GET /api/musicbrainz/search/releases`**

Search MusicBrainz database for releases.

**Parameters:**
- `artist` (string, required) - Artist name
- `title` (string, required) - Release title
- `year` (integer, optional) - Release year
- `limit` (integer, default: 10) - Maximum results

**Example:**
```bash
curl "http://localhost:3000/api/musicbrainz/search/releases?artist=Aphex%20Twin&title=Syro&year=2014"
```

**Response:**
```json
{
  "releases": [
    {
      "id": "0c1b3f6b-d5a4-4982-a8e1-3f9c0b4e8a9d",
      "title": "Syro",
      "artist-credit": [
        {
          "name": "Aphex Twin"
        }
      ],
      "date": "2014-09-23",
      "country": "GB",
      "confidence": 0.95
    }
  ],
  "count": 1,
  "offset": 0
}
```

### Get Release Details
**`GET /api/musicbrainz/release/:mbid`**

Get detailed information about a specific MusicBrainz release.

**Parameters:**
- `includes` (string, optional) - Comma-separated list: `artists,labels,recordings,relationships`

**Example:**
```bash
curl "http://localhost:3000/api/musicbrainz/release/0c1b3f6b-d5a4-4982-a8e1-3f9c0b4e8a9d?includes=artists,labels"
```

### Get Artist Details
**`GET /api/musicbrainz/artist/:mbid`**

Get detailed artist information including relationships and aliases.

**Parameters:**
- `includes` (string, optional) - Comma-separated list: `aliases,relationships,works`

### Enrich Single Album
**`POST /api/musicbrainz/enrich-album/:albumId`**

Enrich a specific album with MusicBrainz metadata.

**Example:**
```bash
curl -X POST "http://localhost:3000/api/musicbrainz/enrich-album/123"
```

**Response:**
```json
{
  "success": true,
  "mbid": "0c1b3f6b-d5a4-4982-a8e1-3f9c0b4e8a9d",
  "confidence": 0.95,
  "data": {
    "musicbrainz_release_id": "0c1b3f6b-d5a4-4982-a8e1-3f9c0b4e8a9d",
    "barcode": "5021603238329",
    "country": "GB",
    "date": "2014-09-23",
    "artist_mbid": "f22942a1-6f70-4f48-866e-238cb2308fbd",
    "relationships": []
  }
}
```

### Batch Enrich Albums
**`POST /api/musicbrainz/batch-enrich`**

Enrich multiple albums in batch with progress tracking.

**Request Body:**
```json
{
  "limit": 20,
  "confidence_threshold": 0.7
}
```

**Response:**
```json
{
  "message": "Batch enrichment completed",
  "processed": 20,
  "successful": 18,
  "total": 20
}
```

### Get Artist Network
**`GET /api/musicbrainz/network/:mbid`**

Get artist relationship network for visualization.

**Parameters:**
- `depth` (integer, default: 2) - Network depth

**Response:**
```json
{
  "nodes": [
    {
      "id": "f22942a1-6f70-4f48-866e-238cb2308fbd",
      "name": "Aphex Twin",
      "type": "artist",
      "sortName": "Aphex Twin",
      "aliases": ["AFX", "Polygon Window"]
    }
  ],
  "links": [
    {
      "source": "f22942a1-6f70-4f48-866e-238cb2308fbd",
      "target": "another-artist-mbid",
      "type": "collaboration",
      "direction": "forward"
    }
  ]
}
```

---

## 📈 Visualization Endpoints

### Get Network Data
**`GET /api/visualization/network`**

Get network graph data optimized for D3.js visualization.

**Parameters:**
- `type` (string, default: artist) - Network type: `artist`, `label`, `genre`
- `limit` (integer, default: 200) - Maximum nodes

**Example:**
```bash
curl "http://localhost:3000/api/visualization/network?type=artist&limit=100"
```

**Response:**
```json
{
  "nodes": [
    {
      "id": "Aphex Twin",
      "name": "Aphex Twin",
      "type": "artist",
      "connections": 8
    }
  ],
  "links": [
    {
      "source": "Aphex Twin",
      "target": "AFX",
      "weight": 1.0,
      "type": "alias"
    }
  ]
}
```

---

## ⚡ WebSocket API

### Connection
```javascript
const ws = new WebSocket('ws://localhost:3000');
```

### Subscribe to Events
```javascript
ws.send(JSON.stringify({
  type: 'subscribe',
  subscriptions: ['album_enriched', 'batch_enrichment_complete', 'batch_progress']
}));
```

### Event Types

#### Batch Progress
Sent during batch enrichment operations.

```json
{
  "type": "batch_progress",
  "processed": 15,
  "total": 50,
  "successful": 12,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### Album Enriched
Sent when a single album is successfully enriched.

```json
{
  "type": "album_enriched",
  "albumId": 123,
  "mbid": "0c1b3f6b-d5a4-4982-a8e1-3f9c0b4e8a9d",
  "confidence": 0.95,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### Batch Complete
Sent when batch processing completes.

```json
{
  "type": "batch_enrichment_complete",
  "processed": 50,
  "successful": 48,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## 🛠️ Utility Endpoints

### MusicBrainz Statistics
**`GET /api/musicbrainz/stats`**

Get detailed MusicBrainz integration statistics.

**Response:**
```json
{
  "database": {
    "totalAlbums": 1250,
    "mappedAlbums": 890,
    "mbArtists": 450,
    "mbReleases": 890,
    "relationships": 1200,
    "avgConfidence": 0.82
  },
  "client": {
    "cacheSize": 1024,
    "requestCount": 5000,
    "lastRequest": 1705312200000,
    "rateLimitDelay": 1000
  }
}
```

---

## 📝 Error Handling

### Error Response Format
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {
    "field": "Additional details"
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### HTTP Status Codes
- `200` - Success
- `400` - Bad Request (invalid parameters)
- `404` - Not Found (resource doesn't exist)
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error
- `503` - Service Unavailable (external API down)

### Common Error Codes
- `ALBUM_NOT_FOUND` - Album ID doesn't exist
- `MUSICBRAINZ_API_ERROR` - MusicBrainz API request failed
- `INVALID_PARAMETERS` - Required parameters missing or invalid
- `DATABASE_ERROR` - Database operation failed
- `RATE_LIMIT_EXCEEDED` - Too many requests

---

## 🔄 Rate Limiting

### MusicBrainz Rate Limiting
- **Rate**: 1 request per second
- **Burst**: Not supported
- **Headers**: None (client-side limiting)

### API Rate Limiting (Future)
- **Rate**: 1000 requests per hour per IP
- **Headers**:
  - `X-RateLimit-Limit`: Request limit
  - `X-RateLimit-Remaining`: Remaining requests
  - `X-RateLimit-Reset`: Reset timestamp

---

## 💡 Usage Examples

### JavaScript Client
```javascript
class OrdrFMClient {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  async getAlbums(filters = {}) {
    const params = new URLSearchParams(filters);
    const response = await fetch(`${this.baseUrl}/api/albums?${params}`);
    return response.json();
  }

  async enrichAlbum(albumId) {
    const response = await fetch(`${this.baseUrl}/api/musicbrainz/enrich-album/${albumId}`, {
      method: 'POST'
    });
    return response.json();
  }

  connectWebSocket() {
    const ws = new WebSocket(this.baseUrl.replace('http', 'ws'));
    
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'subscribe',
        subscriptions: ['batch_progress', 'album_enriched']
      }));
    };

    return ws;
  }
}

// Usage
const client = new OrdrFMClient();
const albums = await client.getAlbums({ quality: 'Lossless', limit: 10 });
const ws = client.connectWebSocket();
```

### Python Client
```python
import requests
import websocket
import json

class OrdrFMClient:
    def __init__(self, base_url='http://localhost:3000'):
        self.base_url = base_url
        
    def get_albums(self, **filters):
        response = requests.get(f'{self.base_url}/api/albums', params=filters)
        return response.json()
        
    def enrich_album(self, album_id):
        response = requests.post(f'{self.base_url}/api/musicbrainz/enrich-album/{album_id}')
        return response.json()
        
    def get_network_data(self, network_type='artist'):
        response = requests.get(f'{self.base_url}/api/visualization/network', 
                              params={'type': network_type})
        return response.json()

# Usage
client = OrdrFMClient()
albums = client.get_albums(quality='Lossless', limit=10)
network = client.get_network_data('artist')
```

### Bash/cURL Examples
```bash
#!/bin/bash

# Get lossless electronic albums
curl -s "http://localhost:3000/api/albums?quality=Lossless&genre=Electronic" | jq '.albums[].album_title'

# Enrich first 10 unmapped albums
curl -s -X POST "http://localhost:3000/api/musicbrainz/batch-enrich" \
     -H "Content-Type: application/json" \
     -d '{"limit": 10}'

# Get artist relationship network
curl -s "http://localhost:3000/api/visualization/network?type=artist" | jq '.nodes | length'

# Monitor WebSocket events
wscat -c ws://localhost:3000 -x '{"type":"subscribe","subscriptions":["batch_progress"]}'
```

---

## 🔧 Development & Testing

### API Testing with curl
```bash
# Test all endpoints
./test-api.sh

# Load test with ab
ab -n 1000 -c 10 http://localhost:3000/api/albums

# WebSocket testing
npm install -g wscat
wscat -c ws://localhost:3000
```

### Mock Data Generation
```bash
# Generate test data
node scripts/generate-test-data.js

# Seed database with sample albums
npm run seed
```

---

This API documentation covers all current endpoints and functionality. For the most up-to-date information, check the OpenAPI specification at `/api/docs` (when implemented) or refer to the source code in `server/server.js`.