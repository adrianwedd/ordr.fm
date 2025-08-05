# ordr.fm Node.js Server

A modern web interface and API server for ordr.fm that provides MusicBrainz integration, relationship visualization, and real-time metadata management.

## Features

- **MusicBrainz Integration**: Complement Discogs data with comprehensive MusicBrainz metadata
- **Relationship Visualization**: Interactive D3.js network graphs showing artist collaborations and connections
- **Real-time Updates**: WebSocket-powered live updates during metadata enrichment
- **Database Management**: Extended SQLite schema with relationship tracking
- **Batch Processing**: Automated album enrichment with progress tracking
- **REST API**: Complete API for metadata access and manipulation

## Quick Start

### Prerequisites

- Node.js 16+ 
- Existing ordr.fm SQLite database (created by the bash script)

### Installation

```bash
cd server
npm install
```

### Configuration

Create a `.env` file:

```env
PORT=3000
METADATA_DB=../ordr.fm.metadata.db
STATE_DB=../ordr.fm.state.db
```

### Start the Server

```bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start
```

The server will be available at http://localhost:3000

## API Endpoints

### Core Data

- `GET /api/albums` - Get albums with filtering and pagination
- `GET /api/artists/relationships` - Get artist relationship data
- `GET /api/labels/relationships` - Get label relationship data
- `GET /api/genres/distribution` - Get genre distribution data
- `GET /api/stats` - Get database statistics

### MusicBrainz Integration

- `GET /api/musicbrainz/search/releases` - Search MusicBrainz for releases
- `GET /api/musicbrainz/release/:mbid` - Get detailed release information
- `GET /api/musicbrainz/artist/:mbid` - Get artist details and relationships
- `POST /api/musicbrainz/enrich-album/:albumId` - Enrich single album
- `POST /api/musicbrainz/batch-enrich` - Batch enrich albums
- `GET /api/musicbrainz/network/:mbid` - Get artist relationship network
- `GET /api/musicbrainz/stats` - Get MusicBrainz integration statistics

### Visualization

- `GET /api/visualization/network` - Get network data for D3.js visualization
- WebSocket connections for real-time updates

## Database Schema

The server extends the existing ordr.fm SQLite database with MusicBrainz-specific tables:

### New Tables

- `mb_artists` - MusicBrainz artist entities
- `mb_artist_aliases` - Artist aliases and alternate names
- `mb_releases` - MusicBrainz release information
- `mb_works` - Musical works and compositions
- `mb_labels` - Record label information
- `mb_relationship_types` - Relationship type definitions
- `mb_artist_relationships` - Artist-to-artist relationships
- `album_mb_mappings` - Links between ordr.fm albums and MusicBrainz releases
- `artist_mb_mappings` - Links between ordr.fm artists and MusicBrainz artists

### Views

- `albums_with_mb` - Albums with MusicBrainz data joined
- `artist_relationship_network` - Relationship network for visualization

## Web Interface

The web interface provides:

### Dashboard
- Live statistics display
- Recent albums list
- Batch enrichment controls

### Network Visualization
- Interactive D3.js force-directed graph
- Artist relationship exploration
- Node filtering and zoom controls
- Real-time updates during enrichment

### Controls
- Album enrichment (individual and batch)
- Network loading and filtering
- Progress tracking for long operations

## MusicBrainz Integration

### Rate Limiting
- Respects MusicBrainz guidelines (1 request/second)
- Implements caching to minimize API calls
- Graceful degradation when API is unavailable

### Confidence Scoring
- String similarity matching for artist/title pairs
- Year matching with tolerance
- Combined scoring from multiple factors
- Configurable confidence thresholds

### Relationship Processing
- Artist collaboration networks
- Band membership tracking  
- Producer/remixer relationships
- Label associations
- Classical music work relationships

## Real-time Features

### WebSocket Events
- `batch_progress` - Progress updates during batch enrichment
- `album_enriched` - Individual album enrichment completion
- `batch_enrichment_complete` - Batch operation completion
- `update_available` - New data available notifications

### Live Updates
- Statistics refresh automatically
- Visualization updates with new relationships
- Progress bars for long-running operations
- Status notifications for user feedback

## Development

### Code Structure

```
server/
├── lib/
│   ├── musicbrainz.js     # MusicBrainz API client
│   └── database.js        # Database management
├── database/
│   └── schema.sql         # Extended database schema
├── public/
│   ├── index.html         # Web interface
│   └── js/app.js          # Frontend JavaScript
├── server.js              # Main server application
└── package.json           # Dependencies and scripts
```

### Key Classes

- `MusicBrainzClient` - Handles all MusicBrainz API interactions
- `DatabaseManager` - Manages SQLite connections and queries
- `OrdrFMApp` - Frontend application with visualization

### Adding New Features

1. Extend database schema in `schema.sql`
2. Add API endpoints in `server.js`
3. Update MusicBrainz client if needed
4. Add frontend visualization in `app.js`

## Performance

### Caching Strategy
- MusicBrainz responses cached for 7 days
- Relationship networks cached with expiration
- Database queries optimized with indexes

### Optimization Features
- SQLite WAL mode for better concurrency
- Prepared statements for repeated queries
- Batch operations for bulk data processing
- Efficient network graph algorithms

## Troubleshooting

### Common Issues

**Database not found**
- Ensure you've run the main ordr.fm bash script first
- Check the `METADATA_DB` path in your `.env` file

**MusicBrainz API errors**
- Check network connectivity
- Verify rate limiting isn't being exceeded
- Clear cache if getting stale data

**Visualization not loading**
- Ensure albums have been enriched with MusicBrainz data
- Check browser console for JavaScript errors
- Verify WebSocket connection is established

### Debug Mode

Set `DEBUG=1` in your environment for verbose logging:

```bash
DEBUG=1 npm run dev
```

## Contributing

1. Follow the existing code style
2. Add tests for new features
3. Update documentation
4. Ensure all endpoints return proper JSON responses
5. Test WebSocket functionality thoroughly

## License

Same as ordr.fm main project (MIT).