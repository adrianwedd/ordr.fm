# ordr.fm - Technical Specifications

**Version 2.1.0 - Comprehensive Music Organization System**

## Introduction

This document details the technical specifications for the complete ordr.fm system, including both the core Bash processing engine and the Node.js web interface with MusicBrainz integration. It outlines architecture principles, metadata handling, relationship processing, visualization capabilities, and safety features. This specification serves as a blueprint for development and a reference for understanding the system's behavior.

## System Architecture

ordr.fm combines two complementary technologies:

### Core Processing Engine (Bash)
- **Metadata Extraction**: `exiftool` + `jq` for comprehensive audio analysis
- **File Operations**: Atomic moves with rollback capability
- **Database Operations**: SQLite for tracking and state management
- **Parallel Processing**: Multi-core utilization for large collections

### Web Interface & API Server (Node.js)
- **MusicBrainz Integration**: Artist relationships and metadata enrichment
- **Real-time Visualization**: D3.js force-directed graphs
- **REST API**: Complete programmatic access to all functionality
- **WebSocket Support**: Live updates during processing operations

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Web Browser   │◄──►│   Node.js API    │◄──►│  Bash Scripts   │
│   (Dashboard)   │    │  (MusicBrainz)   │    │  (Processing)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│     D3.js       │    │     SQLite       │    │   Audio Files   │
│ (Visualization) │    │   (Database)     │    │  (Your Music)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Metadata Extraction and Interpretation

### Tools
*   `exiftool`: Will be used for extracting all relevant metadata from audio files. Its ability to output JSON will be leveraged for robust parsing.
*   `jq`: Will be used to parse the JSON output from `exiftool` to extract specific tag values.

### Required Tags
For an album to be considered "processable" and moved to the organized library, the following metadata tags must be consistently present across its tracks:
*   `Album Artist` (preferred) or `Artist` (fallback)
*   `Album`
*   `Title`
*   `Track Number`

### Optional/Fallback Tags
*   `Year`: Used for directory naming. If inconsistent, the earliest year found will be used, or it will be omitted from the directory name.
*   `Disc Number`: Used for file naming in multi-disc albums.
*   `Genre`: May be considered for future categorization or tagging, but not for initial directory structure.

### Metadata Consistency and Conflict Resolution
*   **Album Artist Determination:**
    *   If `Album Artist` tag is present and consistent across all tracks in a directory, it will be used.
    *   If `Album Artist` is missing but `Artist` is consistent, `Artist` will be used as `Album Artist`.
    *   If both `Album Artist` and `Artist` are inconsistent (e.g., a "Various Artists" compilation where individual track artists vary), the album will be classified as "Various Artists".
*   **Album Title Determination:** The most frequently occurring `Album` title among the tracks will be used. If there's no clear majority, the directory name will be used as a fallback, and a warning will be logged.
*   **Year Determination:** The earliest `Year` found among the tracks will be used for the album directory name. If no year is found, it will be omitted.
*   **Track Number/Title:** Each track's individual `Track Number` and `Title` will be used for its filename. If `Track Number` is missing, it will be omitted from the filename.

### Handling Missing/Inconsistent Metadata
*   If essential tags (`Album Artist`/`Artist`, `Album`, `Title`, `Track Number`) are missing or too inconsistent to determine a clear album identity for a directory, the entire directory will be moved to the `Unsorted` area.
*   A detailed log entry will explain why the album could not be processed automatically.

## MusicBrainz Integration Specifications

### Core Integration Principles
*   **Rate Limiting**: Strict adherence to 1 request per second to respect MusicBrainz guidelines
*   **Caching**: 7-day cache TTL for all API responses to minimize redundant requests
*   **Confidence Scoring**: Multi-factor algorithm combining string similarity, year matching, and metadata consistency
*   **Relationship Mapping**: Comprehensive artist relationship extraction and storage

### MusicBrainz API Client (`server/lib/musicbrainz.js`)

#### Core Methods
*   `searchReleases(artist, title, options)`: Search for releases by artist and title
*   `getRelease(mbid, includes)`: Get detailed release information including relationships
*   `getArtist(mbid, includes)`: Get artist data with aliases and collaborations
*   `enrichAlbumMetadata(albumData)`: Main enrichment function with confidence scoring
*   `buildRelationshipNetwork(artistMbids, maxDepth)`: Generate network data for visualization

#### Confidence Scoring Algorithm
```
confidence = (artistSimilarity * 0.4) + (titleSimilarity * 0.4) + (yearMatch * 0.2)

Where:
- artistSimilarity: Levenshtein distance normalized to 0-1 range
- titleSimilarity: Levenshtein distance normalized to 0-1 range  
- yearMatch: 1.0 for exact match, 0.1-0.2 for ±1-2 years, 0.0 otherwise
```

#### Relationship Processing
*   **Artist Collaborations**: Band memberships, featured artists, producers
*   **Label Relationships**: Artist-label associations, label hierarchies
*   **Work Relationships**: Composer-performer connections for classical music
*   **Alias Resolution**: Alternative artist names and spelling variations

### Database Schema Extensions

#### MusicBrainz Entity Tables
```sql
-- Core MusicBrainz entities
mb_artists (mbid, name, sort_name, type, disambiguation, life_span_*)
mb_releases (mbid, title, date, country, barcode, status, packaging)
mb_works (mbid, title, type, language)
mb_labels (mbid, name, label_code, country, life_span_*)

-- Relationship mapping
mb_artist_relationships (source_mbid, target_mbid, relationship_type_id, direction, attributes)
mb_relationship_types (id, name, description, link_phrase, reverse_link_phrase)

-- Integration mapping
album_mb_mappings (album_id, mb_release_mbid, confidence, mapping_source, verified_*)
artist_mb_mappings (ordr_artist_name, mb_artist_mbid, confidence, mapping_source)
```

#### Relationship Types Supported
*   **member of band**: Band membership relationships
*   **collaboration**: Artist collaboration connections
*   **producer**: Production credits and relationships
*   **remixer**: Remix artist relationships
*   **founded**: Label founder relationships

## Visualization System Specifications

### Network Graph Generation

#### Data Processing Pipeline
1. **Relationship Extraction**: Parse MusicBrainz relationship data
2. **Node Creation**: Generate artist, label, and work nodes
3. **Link Generation**: Create weighted connections between entities
4. **Network Analysis**: Calculate centrality metrics and clustering
5. **Optimization**: Limit nodes/links for performance while preserving key relationships

#### Network Types
*   **Artist Networks**: Collaboration and band membership graphs
*   **Label Networks**: Artist-label relationships and label hierarchies
*   **Genre Networks**: Artist-genre associations and crossover patterns
*   **Temporal Networks**: Relationship evolution over time

### Web Interface Architecture (`server/public/`)

#### Frontend Components
*   **OrdrFMApp Class**: Main application controller with WebSocket management
*   **Network Visualization**: D3.js force-directed graphs with interactive controls
*   **Real-time Updates**: WebSocket event handling for live progress tracking
*   **Responsive Design**: Mobile-first interface with touch support

#### Visualization Features
*   **Interactive Nodes**: Click to explore, drag to reposition
*   **Zoom and Pan**: Smooth navigation of large networks
*   **Filtering**: Dynamic node/link filtering by type or attributes
*   **Search**: Find specific artists or relationships quickly
*   **Export**: Save network data as JSON, SVG, or PNG

### API Specifications

#### REST Endpoints Structure
```
/api/albums                           # Core album data with filtering
/api/artists/relationships            # Artist relationship data
/api/labels/relationships             # Label relationship data  
/api/musicbrainz/search/releases      # MusicBrainz release search
/api/musicbrainz/release/:mbid        # Detailed release information
/api/musicbrainz/artist/:mbid         # Artist details and relationships
/api/musicbrainz/enrich-album/:id     # Single album enrichment
/api/musicbrainz/batch-enrich         # Batch processing endpoint
/api/musicbrainz/network/:mbid        # Network data for visualization
/api/visualization/network            # Optimized network graph data
```

#### WebSocket Event Types
*   **batch_progress**: Real-time progress during batch operations
*   **album_enriched**: Individual album enrichment completion
*   **batch_enrichment_complete**: Batch operation completion notification
*   **update_available**: New data available for refresh

### Performance Specifications

#### Processing Benchmarks
*   **Small Collections (1-1,000 albums)**: 2-5 minutes, 150MB RAM
*   **Medium Collections (1,000-10,000 albums)**: 20-45 minutes, 300MB RAM  
*   **Large Collections (10,000+ albums)**: 3-6 hours, 500MB RAM

#### Optimization Features
*   **Parallel Processing**: Configurable worker processes for multi-core systems
*   **Caching Strategy**: Multi-layer caching for API responses and computed data
*   **Database Optimization**: Prepared statements, indexed queries, WAL mode
*   **Network Efficiency**: Request batching and connection pooling

## Album Classification Logic

Albums will be classified into one of three quality categories based on the audio files they contain. This classification will determine the top-level directory where the album is placed.

*   **Lossless:** An album is classified as `Lossless` if it contains *any* audio file in a lossless format (e.g., FLAC, WAV, AIFF, ALAC). The presence of even a single lossless track elevates the entire album to this category.
*   **Lossy:** An album is classified as `Lossy` if *all* audio files within it are in lossy formats (e.g., MP3, AAC, OGG, M4A).
*   **Mixed:** An album is classified as `Mixed` if it contains *both* lossless and lossy audio files. This scenario is explicitly handled to prevent splitting albums.

The classification will be determined by scanning all audio files within an identified album directory. The script will prioritize lossless formats. If a directory contains both FLAC and MP3 versions of the same tracks, the album will be considered `Mixed`.

This classification will be reflected in the top-level directory structure, e.g., `/home/plex/Music/sorted_music/Lossless/Artist/Album` or `/home/plex/Music/sorted_music/Mixed/Artist/Album`.

## Naming Conventions

### Directory Structure

The target directory structure for organized albums will follow this pattern:

`<Destination Root>/<Quality>/<Album Artist>/<Album Title> (<Year>)/[Disc <Disc Number>/]<Track Number> - <Track Title>.<Extension>`

*   `<Destination Root>`: The user-defined base directory for sorted music (e.g., `/home/plex/Music/sorted_music`).
*   `<Quality>`: `Lossless`, `Lossy`, or `Mixed`, as determined by the album classification logic.
*   `<Album Artist>`: The determined album artist. "Various Artists" will be used for compilations.
*   `<Album Title>`: The determined album title.
*   `<Year>`: The determined album year. If unavailable, this part will be omitted.
*   `[Disc <Disc Number>/]`: Optional. Included only for multi-disc albums, creating a subdirectory for each disc.
*   `<Track Number>`: The track number, zero-padded to two digits (e.g., `01`, `02`).
*   `<Track Title>`: The title of the individual track.
*   `<Extension>`: The original file extension (e.g., `flac`, `mp3`).

### Filename Sanitization

All components used in directory and file names (Album Artist, Album Title, Track Title) will undergo a sanitization process to remove or replace characters that are illegal or problematic in common file systems (e.g., `\`, `/`, `:`, `*`, `?`, `"`, `<`, `>`, `|`). Spaces will be preserved, and leading/trailing spaces will be trimmed.

### Conflict Resolution

If a target path already exists, the script will:
*   **If identical:** Skip the move/rename operation and log it as skipped.
*   **If different but same name:** Append a unique identifier (e.g., `_1`, `_2`) to the album folder name to prevent overwriting. A warning will be logged.

## Error Handling and Logging

### Logging

All script activities will be logged to a dedicated log file (e.g., `music_sorter.log`) within the project directory. The log will include:

*   **Timestamped Entries:** Every log entry will be prefixed with a timestamp.
*   **Levels:** Support for different log levels (e.g., DEBUG, INFO, WARNING, ERROR, FATAL).
*   **Detailed Information:** For each album processed, the log will record:
    *   Original path.
    *   Identified album artist, album title, and year.
    *   Determined quality (Lossless, Lossy, Mixed).
    *   Proposed new path.
    *   Status of operation (Moved, Skipped, Unsorted, Error).
    *   Reasons for skipping or errors (e.g., "Missing required tags", "Checksum mismatch").

### Error Handling

*   **Graceful Exits:** The script will aim for graceful exits on critical errors (e.g., unable to create destination directories, missing essential dependencies).
*   **Per-Album Errors:** Errors related to individual albums (e.g., corrupted files, unreadable metadata) will be logged, and the album will be moved to the `Unsorted` directory, allowing the script to continue processing other albums.
*   **Checksum Verification:** After moving a file, its integrity will be verified using a checksum (e.g., MD5). Mismatches will be logged as errors, and the original file will be retained if possible.

## Safety Features

*   **Dry Run Mode (Default):** The script will operate in a dry-run mode by default. In this mode, it will perform all analysis, determine new paths, and log proposed actions, but it will *not* move, rename, or delete any files. This allows users to review the entire operation before committing to changes.
*   **Explicit `--move` Flag:** Actual file system modifications will only occur if a specific command-line flag (e.g., `--move` or `--execute`) is provided by the user.
*   **No Overwriting by Default:** The script will not overwrite existing files or directories in the destination without explicit instruction or a robust conflict resolution mechanism (as described in Naming Conventions).
*   **Unsorted/Problematic Handling:** Files or albums that cannot be processed correctly due to data issues will be moved to a dedicated `Unsorted` directory, preventing accidental deletion or corruption of valuable data.
*   **Dependency Checks:** The script will verify the presence of all required external tools (`exiftool`, `jq`, `rsync`) at startup and exit gracefully if any are missing.

