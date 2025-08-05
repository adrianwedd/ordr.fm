# Changelog

All notable changes to ordr.fm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2025-08-05

### 🚀 Major Features Added - Node.js Integration & Relationship Visualization

This release introduces a complete Node.js web interface with MusicBrainz integration, transforming ordr.fm into a comprehensive music relationship discovery and visualization platform.

#### MusicBrainz Integration & Relationship Mapping
- **Complete MusicBrainz API Client** (`server/lib/musicbrainz.js`)
  - Artist relationship extraction and processing
  - Release matching with advanced confidence scoring  
  - Artist alias resolution and grouping
  - Comprehensive caching system (7-day TTL)
  - Rate limiting (1 req/second) respecting MusicBrainz guidelines

#### Node.js Web Server & API
- **REST API Server** (`server/server.js`) with 15+ endpoints
  - Album browsing with advanced filtering and pagination
  - Real-time MusicBrainz enrichment (single and batch)
  - Artist relationship network data for visualization
  - Comprehensive statistics and coverage reporting
- **WebSocket Support** for real-time updates
  - Live progress tracking during batch operations
  - Automatic UI refresh when data changes
  - Event-driven architecture for responsive experience

#### Interactive Web Visualization
- **Professional Dashboard** (`server/public/index.html`)
  - Live collection statistics and enrichment status
  - Album browser with filtering and search
  - Batch processing controls with progress tracking
- **D3.js Network Graphs** (`server/public/js/app.js`)
  - Interactive force-directed artist collaboration networks
  - Zoom, pan, and node manipulation controls
  - Real-time updates during metadata enrichment
  - Export capabilities (JSON, SVG, PNG)

### 📊 Extended Database Schema
- **MusicBrainz Entity Tables** (`server/database/schema.sql`)
  - Artists with aliases and relationship tracking
  - Releases with comprehensive metadata storage
  - Works for classical music composition relationships
  - Labels with hierarchical organization support
- **Relationship Tables**  
  - Artist-to-artist collaborations and band memberships
  - Album-to-MusicBrainz release mappings with confidence scores
  - Comprehensive relationship type definitions

### 📚 Documentation Overhaul
- **README.md**: Complete rewrite with modern styling and comprehensive feature overview
- **docs/API.md**: Detailed REST API and WebSocket documentation with examples
- **docs/USER_GUIDE.md**: Step-by-step user guide with screenshots and workflows  
- **server/README.md**: Node.js server specific documentation
- **SPECIFICATIONS.md**: Updated technical specifications including MusicBrainz integration

### 🔧 New API Endpoints
- `GET /api/albums` - Advanced album filtering and pagination
- `GET /api/artists/relationships` - Artist relationship data with aliases
- `POST /api/musicbrainz/enrich-album/:id` - Single album enrichment
- `POST /api/musicbrainz/batch-enrich` - Batch processing endpoint
- `GET /api/visualization/network` - Optimized D3.js graph data
- WebSocket events for real-time updates

### ⚡ Performance & Features
- **Dual-Source Enhancement**: Combine Discogs and MusicBrainz data
- **Advanced Confidence Scoring**: Multi-factor algorithm using string similarity
- **Relationship Discovery**: Artist collaboration networks and label mapping
- **Batch Processing**: Process hundreds of albums with progress tracking
- **Classical Music Support**: Composer-performer-work relationships

### 📦 New Dependencies
- Node.js 16+ required for web interface
- `express`, `ws`, `sqlite3`, `d3`, `helmet`, development tools

---

## [2.0.0] - 2025-08-05

### 🎉 Major Release - Production Ready

This release represents a complete architectural overhaul of ordr.fm, transforming it from a monolithic script into a modular, high-performance music organization system.

### ✨ Added

#### Core Features
- **Modular Architecture** (#44) - Complete refactoring into focused, reusable modules
- **Parallel Processing** (#34) - 3-10x performance improvement with multi-core support
- **Interactive Setup Wizard** (#36) - User-friendly configuration and onboarding
- **CI/CD Pipeline** (#35) - Comprehensive automated testing and quality assurance
- **Performance Optimizations** (#40) - Specialized handling for 1000+ album collections
- **Empty Directory Cleanup** (#45) - Post-processing cleanup of source directories

#### Music Organization
- **Electronic Music Features** (#20) - Intelligent label/artist routing for electronic music
- **Discogs Integration** (#19) - Rich metadata enrichment with caching
- **Artist Alias Resolution** (#26) - Handle multiple artist names/pseudonyms
- **Quality-Based Organization** - Automatic Lossless/Lossy/Mixed categorization
- **Remix Separation** - Optional organization of remix collections

#### Safety & Recovery
- **Atomic Operations** - All-or-nothing file moves with rollback capability
- **Undo/Rollback** (#29) - Reverse any organization operation
- **Dry-Run Mode** - Preview all changes before execution
- **Progress Persistence** - Resume interrupted operations

#### Developer Tools
- **Command Builder** - Interactive tool to construct complex commands
- **System Check** - Verify environment readiness
- **Test Runner** - Local testing framework
- **Benchmark Tools** - Performance measurement utilities

### 🔄 Changed

- Renamed main script from `ordr.fm.sh` to `ordr.fm.modular.sh`
- Database schema enhanced with indexes and better structure
- Logging system now thread-safe for parallel operations
- Configuration file format expanded with new options
- Default to dry-run mode for safety

### 🛡️ Security

- Fixed SQL injection vulnerability in database operations
- Added input sanitization for all user inputs
- Secure token storage in configuration
- Permission checking for file operations
- Protected directory safeguards

### 📈 Performance

- **Parallel Processing**: Up to 10x faster on multi-core systems
- **Memory Optimization**: 30-50% reduction for large collections
- **Database Optimization**: WAL mode, indexes, and query optimization
- **Batch Processing**: Efficient handling of 10,000+ albums
- **Streaming Mode**: Process extremely large collections without memory issues

### 📚 Documentation

- Comprehensive deployment guide
- Interactive quick start guide
- Production readiness checklist
- Troubleshooting guide
- Migration guide from v1.x
- API documentation for modules

### 🐛 Fixed

- Single album detection now works correctly
- Quality detection case sensitivity resolved
- Associated files (.asd, .nfo) preservation
- Multi-disc album handling
- Unicode filename support
- Long path handling

### 🔧 Technical Details

#### Dependencies
- Required: `exiftool`, `jq`, `sqlite3`
- Optional: `parallel`, `bc`, `rsync`, `curl`
- Supported OS: Linux (Ubuntu 20.04+), macOS 10.15+

#### Module Structure
```
lib/
├── common.sh           # Core utilities
├── fileops.sh          # File operations
├── database.sh         # Database operations
├── organization.sh     # Organization logic
├── metadata_extraction.sh  # Metadata handling
├── discogs.sh          # Discogs API integration
├── metadata.sh         # Enhanced metadata
├── parallel_processor.sh   # Parallel processing
├── performance.sh      # Performance optimizations
├── cleanup.sh          # Cleanup operations
└── processing/
    └── worker_pool.sh  # Worker pool implementation
```

### 🙏 Acknowledgments

This release was developed with assistance from Claude (Anthropic) through intensive pair programming sessions. Special thanks to the electronic music community for inspiration and use cases.

---

## [1.0.0] - 2024-08-04

### Initial Release
- Basic music organization by metadata
- Dry-run mode
- Simple logging
- Album integrity preservation
- Quality-based categorization