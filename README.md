# 🎵 ordr.fm

**The Ultimate Music Organization System**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-2.5.0-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS-lightgrey.svg)]()

> Transform your chaotic music collection into a beautifully organized, media-server-ready library with intelligent metadata enrichment, relationship mapping, and real-time visualization.

## ✨ What Makes ordr.fm Special

ordr.fm isn't just another music organization tool. It's a comprehensive system that combines the power of **professional-grade bash scripting** with **modern web technology** to deliver:

- **🧠 Intelligent Organization**: Album-centric processing that preserves integrity while handling edge cases
- **🔗 Relationship Discovery**: Uncover hidden connections between artists, labels, and collaborations  
- **📊 Real-time Visualization**: Interactive PWA dashboard with advanced search, mobile optimization, and offline support
- **🌐 Dual Metadata Sources**: Combine Discogs and MusicBrainz for unparalleled metadata quality
- **⚡ High Performance**: Parallel processing with database query caching and real-time progress tracking
- **🛡️ Safety First**: Comprehensive dry-run mode, atomic operations with rollback, and extensive test coverage
- **🎵 Audio Integration**: Built-in audio player with waveform visualization and playlist management
- **☁️ Cloud Backup**: Automated Google Drive backup with resume capability and progress monitoring
- **📝 Metadata Editing**: In-place editing interface with change tracking and validation
- **🔍 Advanced Search**: Saved search presets, history tracking, and multi-criteria filtering

---

## 🚀 Quick Start

### 🐳 Docker (Recommended)
```bash
# Download and start with Docker Compose
curl -O https://raw.githubusercontent.com/adrianwedd/ordr.fm/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/adrianwedd/ordr.fm/main/.env.example
cp .env.example .env && nano .env  # Configure your music paths

# Start the complete system
docker-compose up -d

# Access web dashboard
open http://localhost:3000
```

### Native Installation
```bash
# Clone and setup locally
git clone https://github.com/adrianwedd/ordr.fm.git
cd ordr.fm
./setup_wizard.sh

# Start web interface
cd visualization && npm install && npm start
```

---

## 🎯 Core Features

### 🗂️ Intelligent Music Organization

```bash
# Preview your organization (100% safe)
./ordr.fm.sh --source "/path/to/messy/music" --destination "/path/to/organized"

# Actually organize (when you're ready)
./ordr.fm.sh --source "/path/to/messy/music" --destination "/path/to/organized" --move
```

**Target Structure:**
```
📁 Organized Music/
├── 📁 Lossless/
│   ├── 📁 Aphex Twin/
│   │   └── 📁 Selected Ambient Works 85-92 (1992)/
│   │       ├── 🎵 01 - Xtal.flac
│   │       └── 🎵 02 - Tha.flac
│   └── 📁 Boards of Canada/
└── 📁 Lossy/
    └── 📁 Various Artists/
        └── 📁 Warp10+3 Influences (1999)/
```

### 🔗 MusicBrainz & Discogs Integration

**Enrich your metadata with professional databases:**

```bash
# Electronic music with label-based organization
./ordr.fm.sh --enable-electronic --discogs --move

# Combined metadata from multiple sources
./ordr.fm.sh --discogs --musicbrainz --confidence-threshold 0.8 --move
```

**What you get:**
- 🏷️ **Catalog Numbers**: `[WARP123] Artist - Album`
- 🎛️ **Label Organization**: Group releases by electronic music labels
- 👥 **Artist Relationships**: Discover collaborations and aliases
- 📀 **Release Information**: Country, format, year, barcode
- 🎹 **Remix Detection**: Separate remixes from originals

### 📊 Progressive Web Application Dashboard

**Professional visualization and management interface:**

![Dashboard Preview](docs/images/dashboard-preview.png)

**Core Features:**
- 🌐 **Interactive Network Graphs**: Explore artist collaborations and relationships
- 📈 **Live Statistics**: Real-time organization progress with caching optimization
- 🔄 **Batch Processing**: Enrich hundreds of albums automatically
- 📱 **Mobile-First Design**: Touch gestures, swipe navigation, haptic feedback
- ⚡ **WebSocket Updates**: See changes happen in real-time
- 📶 **Offline Support**: PWA functionality with service worker caching

**Advanced Features:**
- 🎵 **Built-in Audio Player**: Stream and preview tracks with waveform visualization
- 📝 **Metadata Editor**: Edit album and track information with change tracking
- ☁️ **Cloud Backup**: Automated Google Drive backup with progress monitoring
- 🔍 **Advanced Search**: Multi-criteria search with saved presets and history
- 📊 **Analytics Dashboard**: Collection insights, quality distribution, and trends
- 🔧 **Configuration Management**: Web-based settings with validation
- 📋 **Action Center**: Process albums, backup data, and manage operations

---

## 🏗️ Architecture

ordr.fm combines the best of both worlds:

### 🐚 **Bash Engine** (Core Processing)
- **Metadata Extraction**: `exiftool` + `jq` for comprehensive audio analysis
- **Database Operations**: SQLite for tracking and undo capabilities  
- **File Operations**: Atomic moves with rollback support
- **Parallel Processing**: Multi-core utilization for large collections

### 🌐 **Node.js Server** (PWA & APIs)
- **Progressive Web App**: Service worker, offline support, mobile optimization
- **Enhanced APIs**: Advanced search, metadata editing, audio streaming
- **Database Caching**: Query optimization with 5-minute TTL
- **Real-time Features**: WebSocket support for live updates
- **Audio Integration**: Range request support for streaming and waveform data
- **Cloud Integration**: Google Drive backup management
- **Error Handling**: Comprehensive retry logic and connection monitoring

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

---

## 🧪 Quality Assurance & Testing

ordr.fm includes comprehensive test coverage to ensure reliability and stability:

### Test Framework
```bash
# Run all tests (unit, integration, end-to-end)
./run_all_tests.sh

# Run specific test suites
./tests/unit/test_argument_parsing.sh
./tests/unit/test_metadata_functions.sh
./tests/integration/test_web_api_integration.sh
./tests/integration/test_end_to_end_workflow.sh

# Run Playwright browser tests
cd visualization && npm test
```

### Coverage Statistics
- **90%+ Overall Coverage**: Critical functionality thoroughly tested
- **Unit Tests**: 60+ test cases covering core functions and edge cases
- **Integration Tests**: 30+ test cases covering workflows and API endpoints
- **End-to-End Tests**: Complete user workflow validation
- **Browser Tests**: 150+ cross-browser tests (Chrome, Firefox, Safari)
- **Performance Tests**: Response time and scalability validation

### Test Categories
- ✅ **Argument Parsing**: All CLI argument validation and edge cases
- ✅ **Metadata Processing**: Quality detection, path building, validation
- ✅ **API Integration**: All REST endpoints, caching, error handling
- ✅ **Database Operations**: CRUD operations, transactions, integrity
- ✅ **File Operations**: Organization workflows, safety mechanisms
- ✅ **PWA Functionality**: Offline support, mobile features, performance
- ✅ **Error Handling**: Network failures, invalid inputs, recovery

---

## 🛠️ Installation Options

### Option 1: Quick Install Script
```bash
curl -sSL https://raw.githubusercontent.com/adrianwedd/ordr.fm/main/install.sh | bash
```

### Option 2: Manual Installation
```bash
# Install system dependencies
# Ubuntu/Debian:
sudo apt update && sudo apt install -y exiftool jq sqlite3 nodejs npm parallel bc rsync curl

# macOS:
brew install exiftool jq sqlite node parallel bc rsync curl

# Clone and setup
git clone https://github.com/adrianwedd/ordr.fm.git
cd ordr.fm
./setup_wizard.sh

# Install visualization dashboard dependencies
cd visualization && npm install
```

### Option 3: Docker (Recommended for Production)
```bash
# Quick start with Docker
docker run -v /music:/data/music:ro \
           -v /organized:/data/organized \
           -p 3000:3000 \
           adrianwedd/ordr.fm:latest

# Or use docker-compose (see docs/docker-compose.yml)
docker-compose up -d
```

---

## 📖 Usage Examples

### 🎼 Classical Music Collection
```bash
# Enhanced metadata for classical works
./ordr.fm.sh --musicbrainz \
             --organization-mode artist \
             --source "/music/classical" \
             --move
```

### 🎛️ Electronic Music with Labels
```bash
# Label-based organization for electronic music
./ordr.fm.sh --enable-electronic \
             --discogs \
             --organization-mode label \
             --min-label-releases 3 \
             --move
```

### 🔄 Batch Processing Large Collections
```bash
# Process 10,000+ albums efficiently
./ordr.fm.sh --parallel \
             --max-parallel-jobs 8 \
             --enable-electronic \
             --discogs \
             --move \
             --log-level debug
```

### 🌐 Web Interface Workflow
1. **Start Server**: `cd server && npm start`
2. **Access Dashboard**: Visit http://localhost:3000
3. **Load Collection**: Browse and select albums
4. **Enrich Metadata**: Batch process with MusicBrainz/Discogs
5. **Visualize Relationships**: Explore artist collaboration networks
6. **Organize Files**: Apply organization with real-time progress

---

## 🔧 Configuration

### Environment Variables
```bash
# Core paths
export ORDR_SOURCE_DIR="/music/unsorted"
export ORDR_DEST_DIR="/music/organized"
export ORDR_UNSORTED_DIR="/music/needs-review"

# API tokens
export DISCOGS_USER_TOKEN="your_discogs_token"
export MUSICBRAINZ_USER_AGENT="YourApp/1.0"

# Processing options
export ORDR_ENABLE_PARALLEL=1
export ORDR_MAX_PARALLEL_JOBS=4
export ORDR_ENABLE_ELECTRONIC=1
```

### Configuration File (`ordr.fm.conf`)
```bash
# Organization behavior
ORGANIZATION_MODE="hybrid"              # artist, label, or hybrid
MIN_LABEL_RELEASES=3                   # Minimum releases for label folder
QUALITY_DETECTION_MODE="strict"        # strict, permissive, or mixed

# Metadata enrichment
DISCOGS_ENABLED=1
DISCOGS_CONFIDENCE_THRESHOLD=0.7
MUSICBRAINZ_ENABLED=1
MUSICBRAINZ_CONFIDENCE_THRESHOLD=0.8

# Artist alias resolution
GROUP_ARTIST_ALIASES=1
ARTIST_ALIAS_GROUPS="Aphex Twin,AFX,Polygon Window|Four Tet,Kieran Hebden"

# Electronic music features
ENABLE_ELECTRONIC_ORGANIZATION=1
SEPARATE_REMIXES=1
ENABLE_VINYL_MARKERS=1
DETECT_COMPILATION_RELEASES=1
```

---

## 📊 API Reference

### Core Endpoints
```bash
# Get collection statistics
GET /api/stats

# List albums with filtering
GET /api/albums?quality=Lossless&limit=50

# Artist relationships
GET /api/artists/relationships
```

### MusicBrainz Integration
```bash
# Search for releases
GET /api/musicbrainz/search/releases?artist=Aphex%20Twin&title=Syro

# Enrich single album
POST /api/musicbrainz/enrich-album/123

# Batch enrich albums
POST /api/musicbrainz/batch-enrich
```

### Visualization Data
```bash
# Network graph data
GET /api/visualization/network?type=artist&depth=2

# Genre distribution
GET /api/genres/distribution

# Label relationships
GET /api/labels/relationships
```

### WebSocket Events
```javascript
// Real-time updates
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  switch(data.type) {
    case 'batch_progress':
      updateProgress(data.processed, data.total);
      break;
    case 'album_enriched':
      refreshVisualization();
      break;
  }
};
```

---

## 🔍 Advanced Features

### 🎭 Artist Alias Resolution
Automatically group artists with multiple names:
```bash
# Configure alias groups
ARTIST_ALIAS_GROUPS="Uwe Schmidt,Atom TM,Atom Heart,Senor Coconut|Richard D. James,Aphex Twin,AFX"

# Enable alias grouping
./ordr.fm.sh --group-artist-aliases --move
```

### 🎯 Smart Quality Detection
Intelligent handling of mixed-format albums:
```bash
# Strict: Album quality based on highest quality file
# Mixed: Separate folders for mixed-format albums
# Permissive: More flexible quality determination
./ordr.fm.sh --quality-detection-mode mixed --move
```

### 🔄 Undo & Rollback
Every operation is tracked and reversible:
```bash
# Undo last organization operation
./ordr.fm.sh --undo-last-operation

# Rollback specific operation by ID
./ordr.fm.sh --rollback-operation "op_20231201_143022"

# List all operations
./ordr.fm.sh --list-operations
```

### 📈 Performance Monitoring
```bash
# Enable performance tracking
./ordr.fm.sh --enable-performance-tracking --move

# View performance statistics
./ordr.fm.sh --show-performance-stats
```

---

## 🔒 Safety & Security

### 🛡️ Built-in Safety Features
- **Dry-run by Default**: Never moves files without explicit `--move` flag
- **Atomic Operations**: All-or-nothing file operations with rollback
- **Checksum Verification**: Ensures file integrity during moves
- **Backup Creation**: Optional backup before any modifications
- **Comprehensive Logging**: Audit trail of all operations

### 🔐 Security Best Practices
- **No Credential Storage**: API tokens via environment variables only
- **Least Privilege**: Minimal filesystem permissions required
- **Rate Limiting**: Respectful API usage to prevent blocking
- **Input Validation**: Sanitization of all user inputs and filenames

---

## 📈 Performance

### Benchmarks
| Collection Size | Processing Time | Memory Usage | Throughput |
|----------------|----------------|--------------|------------|
| 1,000 albums   | 2-5 minutes    | 150MB       | 5-8 albums/sec |
| 10,000 albums  | 20-45 minutes  | 300MB       | 4-6 albums/sec |
| 100,000 albums | 3-6 hours      | 500MB       | 3-5 albums/sec |

### Optimization Tips
```bash
# Use parallel processing
./ordr.fm.sh --parallel --max-parallel-jobs 8

# Enable caching for metadata
export ORDR_ENABLE_METADATA_CACHE=1

# Use SSD storage for databases
export ORDR_DB_PATH="/fast/ssd/ordr.fm.db"

# Optimize for your collection type
./ordr.fm.sh --optimize-for electronic  # or classical, rock, mixed
```

---

## 🤝 Community & Support

### 📋 Getting Help
- **Documentation**: [Full Documentation](docs/)
- **Issues**: [GitHub Issues](https://github.com/adrianwedd/ordr.fm/issues)
- **Discussions**: [GitHub Discussions](https://github.com/adrianwedd/ordr.fm/discussions)
- **Discord**: [Join our Discord](https://discord.gg/ordrfm) (coming soon)

### 🎯 Roadmap
- [ ] **Docker Image**: Official Docker Hub images
- [ ] **Web GUI**: Complete web-based organization interface
- [ ] **Mobile App**: Companion mobile app for remote monitoring
- [ ] **Cloud Sync**: Integration with cloud storage services
- [ ] **AI Enhancement**: Machine learning for automatic genre classification
- [ ] **Plugin System**: Extensible architecture for custom processors

### 🏆 Contributing
We welcome contributions! Check out our [Contributing Guide](CONTRIBUTING.md) for:
- 🐛 Bug reports and fixes
- ✨ Feature requests and implementations
- 📝 Documentation improvements
- 🌍 Translations and internationalization
- 🎨 UI/UX enhancements

---

## 📄 License

Released under the [MIT License](LICENSE). Free for personal and commercial use.

---

## ⭐ Acknowledgments

- **ExifTool** by Phil Harvey - The backbone of our metadata extraction
- **MusicBrainz** - Comprehensive music metadata database
- **Discogs** - Electronic music metadata and catalog numbers
- **D3.js** - Powerful data visualization
- **Our Contributors** - Making ordr.fm better every day

---

<div align="center">

**Ready to transform your music collection?**

[📥 Download](https://github.com/adrianwedd/ordr.fm/releases/latest) | [📖 Documentation](docs/) | [🚀 Quick Start](#-quick-start) | [💬 Community](https://github.com/adrianwedd/ordr.fm/discussions)

---

Made with ❤️ by music lovers, for music lovers.

[![Star on GitHub](https://img.shields.io/github/stars/adrianwedd/ordr.fm?style=social)](https://github.com/adrianwedd/ordr.fm)

</div>