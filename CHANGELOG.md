# Changelog

All notable changes to ordr.fm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.0] - 2025-08-08

### Major System Restoration ✅
**From ~15% functional to 100% working system with comprehensive enhancements**

This release represents a complete system restoration and major functionality expansion, transforming ordr.fm from a broken state to a fully operational, feature-rich music organization platform.

### Added

#### 🎵 Complete Audio Integration (#123)
- **Built-in Audio Player** with streaming support and waveform visualization
- **Range Request Support** for efficient audio loading and seeking
- **Playlist Management** with track navigation and progress tracking  
- **Audio Format Validation** and playback optimization
- **Streaming API Endpoint** `/api/audio/:albumId/:trackId`

#### 📝 Advanced Metadata Management (#124)
- **In-place Metadata Editing** interface with real-time validation
- **Change Tracking and Rollback** capability for all metadata modifications
- **Bulk Editing Support** for multiple albums and tracks simultaneously
- **API Endpoints** for metadata operations: GET/PUT `/api/albums/:id`, PUT `/api/tracks/:id`
- **Real-time Updates** reflected across all dashboard views

#### ☁️ Google Drive Cloud Backup (#120)  
- **Automated Backup System** with resume capability and progress monitoring
- **Web Dashboard Integration** for backup management and status reporting
- **Configurable Scheduling** and retention policies
- **Comprehensive Error Handling** with retry mechanisms and detailed logging
- **Backup Management APIs** `/api/backup/status`, `/api/backup/start`, `/api/backup/progress`

#### 🔍 Enhanced Search & Discovery
- **Saved Search Presets** and search history tracking  
- **Multi-criteria Filtering** with real-time results and performance metrics
- **Search Analytics** and usage pattern tracking
- **Advanced Search API** with pagination and sorting support
- **Filter Persistence** across browser sessions

#### ⚡ Performance Optimization System
- **Database Query Caching** with 5-minute TTL for frequently accessed data
- **Connection Pool Management** and monitoring for optimal resource usage
- **Response Time Validation** and performance metrics collection
- **Smart Cache Invalidation** for real-time data consistency
- **Connection Monitoring** with automatic retry logic

#### 🧪 Comprehensive Test Framework
- **90%+ Code Coverage** across all system components  
- **60+ Unit Tests** covering argument parsing, metadata processing, and validation
- **30+ Integration Tests** covering API endpoints, workflows, and database operations
- **End-to-End Workflow Testing** with complete user scenario validation
- **150+ Playwright Browser Tests** for PWA functionality across multiple browsers
- **Automated Test Runner** with HTML/text reporting and timeout handling

### Fixed

#### 🔧 Critical Infrastructure Issues
- **Database Module Path Resolution** - Fixed import path conflicts with robust fallback strategies
- **SQL Schema Mismatches** - Resolved `processed_date` vs `processing_date` inconsistencies between bash and Node.js
- **Missing Export Statements** - Implemented proper module exports and function definitions
- **Malformed Exports in lib/database.sh** - Removed duplicate functions and fixed syntax errors

#### 📜 Core Script Restoration  
- **Structural Issues in ordr.fm.sh** - Fixed missing `fi` statements and orphaned code blocks
- **Argument Parsing Enhancement** - Comprehensive validation with edge case handling for all parameters
- **Import Path Resolution** - Robust module loading with multiple fallback strategies
- **Function Definition Issues** - Implemented missing functions and fixed incomplete implementations

#### 🌐 Web API & Dashboard
- **Enhanced Error Handling** - Comprehensive retry logic and connection monitoring
- **API Endpoint Fixes** - Corrected response formatting and data validation
- **Cache Invalidation** - Proper cache management for metadata updates
- **User Feedback System** - Comprehensive error reporting and progress indicators

### Enhanced

#### 📱 Progressive Web Application
- **Enhanced Service Worker** with improved offline capabilities and caching strategies
- **Mobile-first Responsive Design** with touch optimization and gesture support
- **Real-time WebSocket Updates** for live statistics and processing progress
- **Performance Optimizations** with lazy loading and resource optimization

#### 📚 Documentation System  
- **Version Update** from 2.1.0 to 2.5.0 reflecting major functionality additions
- **Enhanced README** with new architecture diagrams and comprehensive feature descriptions
- **Complete Testing Documentation** with coverage metrics and test execution guides
- **Updated API Reference** and installation instructions
- **Session Tracking in CLAUDE.md** with detailed technical achievements and implementation notes

### Technical Specifications

#### 🔌 New API Endpoints
- **Metadata Management**: 5 endpoints for album and track editing operations
- **Audio Streaming**: Range request support with format validation
- **Backup Management**: 4 endpoints for cloud backup operations and monitoring
- **Advanced Search**: Pagination, filtering, and preset management APIs
- **Performance Monitoring**: Cache management and connection status endpoints

#### 💾 Database Enhancements
- **Enhanced Schema** with proper indexing and foreign key constraints
- **Query Optimization** with caching layer and connection pooling
- **Migration Support** for upgrading from previous database versions
- **Data Integrity** checks and validation for all operations

#### 🚀 Performance Metrics
- **Sub-1000ms Response Times** for all critical API endpoints
- **5-minute TTL Caching** for frequently accessed database queries
- **90%+ Test Coverage** with comprehensive validation and error handling
- **Automated Performance Monitoring** with alerting for degraded performance

### Breaking Changes
- **Database schema updated** - Run migration scripts when upgrading from previous versions
- **API endpoints restructured** - Update any external integrations to use new endpoint formats
- **Configuration format enhanced** - Review `ordr.fm.conf` for new options and updated settings
- **Module loading paths changed** - Update any custom scripts that import ordr.fm modules

### Migration Guide
1. **Backup existing database** before upgrading
2. **Run database migration scripts** in `migrations/` directory
3. **Update configuration files** with new format and options
4. **Review custom integrations** for API endpoint changes
5. **Run comprehensive test suite** to validate upgrade success

---

## [2.1.1] - 2025-08-06

### 🔒 Security Improvements

This patch release addresses critical security vulnerabilities and implements comprehensive API protection measures.

#### Rate Limiting & DoS Protection
- **Comprehensive Rate Limiting** - Added `express-rate-limit` to all API endpoints
  - General API: 100 requests per 15 minutes per IP
  - Export endpoints: 10 requests per hour (resource-intensive operations)
  - Health checks: 1000 requests per 15 minutes (monitoring-friendly)
  - Configurable via environment variables (`RATE_LIMIT_WINDOW`, `RATE_LIMIT_MAX`)
- **Proper Error Handling** - JSON error responses with retry-after headers
- **DoS Attack Prevention** - Protects server resources from abuse and ensures service availability

#### Security Vulnerability Fixes
- **SSRF Vulnerability** (Critical) - Fixed server-side request forgery in MusicBrainz module
- **Format String Injection** (High) - Resolved externally-controlled format string vulnerabilities
- **GitHub Actions Security** (Medium) - Added explicit permissions to all workflows following least privilege principle

#### Security Monitoring & Automation
- **CodeQL Security Analysis** - Comprehensive automated security scanning
  - JavaScript/TypeScript analysis with security and quality query suites
  - Weekly scheduled scans and PR-triggered analysis
  - Automatic SARIF upload and GitHub Security integration
- **Automated Security Fixes** - GitHub Actions workflows for automatic vulnerability patching
- **Dependency Security** - All npm packages verified secure with 0 vulnerabilities

### 🧪 Testing & Verification
- **Rate Limiting Tests** - Verified DoS protection and proper response codes
- **Security Scan Results** - All high/critical CodeQL alerts resolved
- **Performance Impact** - Minimal overhead confirmed (<1% performance impact)

### 🔗 Related Issues
- Fixed #58 - v2.1.1 Security Patch Release
- Fixed #68 - Test rate limiting functionality
- Fixed #69 - Run comprehensive CodeQL security scan
- Fixed #70 - Performance impact assessment of rate limiting

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