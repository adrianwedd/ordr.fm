# 📖 ordr.fm User Guide

**Complete Guide to Organizing Your Music Collection**

Welcome to ordr.fm! This comprehensive guide will walk you through everything from initial setup to advanced relationship visualization. Whether you have 100 albums or 100,000, ordr.fm will transform your chaotic music collection into a beautifully organized, searchable library.

## 📋 Table of Contents

- [🚀 Getting Started](#-getting-started)
- [🎯 Basic Workflow](#-basic-workflow)
- [🔧 Configuration](#-configuration)
- [🎵 Music Organization](#-music-organization)
- [🌐 Web Interface](#-web-interface)
- [🔗 Metadata Enrichment](#-metadata-enrichment)
- [📊 Visualization Features](#-visualization-features)
- [⚡ Advanced Usage](#-advanced-usage)
- [🛟 Troubleshooting](#-troubleshooting)
- [💡 Best Practices](#-best-practices)

---

## 🚀 Getting Started

### System Requirements

**Minimum:**
- Linux (Ubuntu 18.04+) or macOS (10.15+)
- 2GB RAM, 1GB free disk space
- Bash 4.0+ or Zsh 5.0+

**Recommended:**
- 4GB+ RAM for large collections
- SSD storage for database performance
- Multi-core CPU for parallel processing

### Quick Installation

```bash
# One-line installation
curl -sSL https://raw.githubusercontent.com/adrianwedd/ordr.fm/main/install.sh | bash

# Or manual installation
git clone https://github.com/adrianwedd/ordr.fm.git
cd ordr.fm
./setup_wizard.sh
```

### Initial Setup

The setup wizard will guide you through:

1. **Dependency Check**: Verify required tools are installed
2. **Path Configuration**: Set source and destination directories
3. **API Setup**: Configure Discogs and MusicBrainz tokens (optional)
4. **Organization Preferences**: Choose organization mode and quality handling
5. **Test Run**: Process a small sample to verify everything works

---

## 🎯 Basic Workflow

### Step 1: Preview Your Organization (Safe Mode)

**Always start with a dry run** to see what ordr.fm will do:

```bash
./ordr.fm.sh --source "/music/unsorted" --destination "/music/organized"
```

This will:
- ✅ Analyze all albums without moving files
- 📝 Generate a detailed report of proposed changes
- 🎯 Identify problematic albums that need attention
- 📊 Show statistics about your collection

### Step 2: Review the Logs

Check the output and log file:

```bash
# View the main log
tail -f ordr.fm.log

# Check for warnings or errors
grep -i "warning\|error" ordr.fm.log

# See organization statistics
grep "STATISTICS" ordr.fm.log
```

### Step 3: Organize Your Music

When you're satisfied with the preview:

```bash
./ordr.fm.sh --source "/music/unsorted" --destination "/music/organized" --move
```

### Step 4: Start the Web Interface

```bash
cd server
npm install
npm start
# Visit http://localhost:3000
```

---

## 🔧 Configuration

### Configuration File (`ordr.fm.conf`)

Create or edit your configuration file:

```bash
cp ordr.fm.conf.example ordr.fm.conf
nano ordr.fm.conf
```

**Essential Settings:**

```bash
# Paths
SOURCE_DIR="/music/unsorted"
DEST_DIR="/music/organized"
UNSORTED_DIR="/music/needs-review"

# Organization mode
ORGANIZATION_MODE="hybrid"          # artist, label, or hybrid
QUALITY_DETECTION_MODE="strict"     # strict, permissive, or mixed

# Metadata sources
DISCOGS_ENABLED=1
DISCOGS_USER_TOKEN="your_token_here"
MUSICBRAINZ_ENABLED=1

# Electronic music features
ENABLE_ELECTRONIC_ORGANIZATION=1
MIN_LABEL_RELEASES=3
SEPARATE_REMIXES=1
```

### Environment Variables

For sensitive data, use environment variables:

```bash
export DISCOGS_USER_TOKEN="your_discogs_token"
export MUSICBRAINZ_USER_AGENT="YourApp/1.0"
export ORDR_ENABLE_PARALLEL=1
export ORDR_MAX_PARALLEL_JOBS=4
```

### Organization Modes

**Artist Mode** (Traditional):
```
Organized/
├── Lossless/
│   ├── Aphex Twin/
│   └── Boards of Canada/
└── Lossy/
    └── Various Artists/
```

**Label Mode** (Electronic Music):
```
Organized/
├── Lossless/
│   ├── Warp Records/
│   │   ├── Aphex Twin - Selected Ambient Works/
│   │   └── Boards of Canada - Music Has The Right/
│   └── Artists/
│       └── Independent Artist/
└── Lossy/
```

**Hybrid Mode** (Intelligent):
- Uses labels for electronic music with sufficient releases
- Falls back to artist organization for others
- Best of both worlds

---

## 🎵 Music Organization

### Quality Detection

ordr.fm automatically categorizes albums by audio quality:

**Lossless** (📀):
- FLAC, WAV, AIFF, ALAC files
- Any album containing lossless formats

**Lossy** (🎵):
- MP3, AAC, M4A, OGG files only
- No lossless files present

**Mixed** (🔀):
- Albums with both lossless and lossy files
- Handled based on `QUALITY_DETECTION_MODE`

### File Naming Conventions

**Single Disc Albums:**
```
01 - Track Title.flac
02 - Another Track.flac
```

**Multi-Disc Albums:**
```
Disc 1/
├── 01 - Track Title.flac
└── 02 - Another Track.flac
Disc 2/
├── 01 - Different Track.flac
└── 02 - Final Track.flac
```

**With Catalog Numbers:**
```
[WARP123] Aphex Twin - Selected Ambient Works 85-92 (1992)/
├── 01 - Xtal.flac
└── 02 - Tha.flac
```

### Handling Special Cases

**Various Artists Albums:**
- Automatically detected and placed in "Various Artists" folder
- Preserves original compilation structure

**Albums with Missing Metadata:**
- Moved to timestamped "unsorted" directories
- Manual review required before organization

**Non-Audio Files:**
- Album artwork preserved automatically
- Additional files (.cue, .log, .nfo) maintained
- Configurable handling for associated files

---

## 🌐 Web Interface

### Dashboard Overview

The web interface provides:

**📊 Live Statistics:**
- Collection size and organization progress
- Quality distribution (lossless vs. lossy)
- Metadata coverage and confidence scores

**🎵 Album Management:**
- Browse and filter your collection
- Individual album enrichment
- Batch processing with progress tracking

**🔗 Relationship Visualization:**
- Interactive network graphs
- Artist collaboration discovery
- Label relationship mapping

### Starting the Web Server

```bash
cd server
npm install
npm start

# Custom port
PORT=8080 npm start

# Production mode
NODE_ENV=production npm start
```

### Web Interface Features

**Album Browser:**
- Filter by quality, genre, artist, label
- Search functionality
- Detailed album information
- Direct enrichment controls

**Network Visualization:**
- D3.js force-directed graphs
- Zoom, pan, and node interaction
- Relationship type filtering
- Real-time updates during processing

**Batch Operations:**
- Queue albums for enrichment
- Monitor progress in real-time
- Cancel long-running operations
- View enrichment statistics

---

## 🔗 Metadata Enrichment

### Discogs Integration

**Setup:**
1. Create a Discogs account
2. Generate a personal access token
3. Add to configuration or environment

```bash
export DISCOGS_USER_TOKEN="your_token_here"
./ordr.fm.sh --discogs --move
```

**What Discogs Provides:**
- 🏷️ Catalog numbers and label information
- 🎛️ Electronic music specialization
- 📀 Release formats and packaging details
- 🌍 Country of release and pressing info

### MusicBrainz Integration

**Setup (No Token Required):**
```bash
export MUSICBRAINZ_USER_AGENT="YourApp/1.0"
./ordr.fm.sh --musicbrainz --move
```

**What MusicBrainz Provides:**
- 👥 Artist relationships and collaborations
- 🎼 Classical music work/composer data
- 🔗 Comprehensive artist aliases
- 🎹 Recording-level metadata

### Combined Enrichment

**Best Results:**
```bash
./ordr.fm.sh --discogs --musicbrainz --confidence-threshold 0.8 --move
```

**Confidence Scoring:**
- String similarity matching for titles/artists
- Year matching with tolerance
- Multiple source validation
- User-configurable thresholds

### Web-Based Enrichment

**Single Album:**
1. Browse to album in web interface
2. Click "Enrich" button
3. Review suggested matches
4. Confirm or reject enrichment

**Batch Processing:**
1. Click "Batch Enrich" in sidebar
2. Set processing limits and thresholds
3. Monitor real-time progress
4. Review results and statistics

---

## 📊 Visualization Features

### Artist Relationship Networks

**Interactive Graphs:**
- Force-directed layout showing connections
- Node size represents collaboration count
- Edge thickness shows relationship strength
- Color coding by artist type or genre

**Exploring Relationships:**
1. Load network visualization
2. Click nodes to see details
3. Drag nodes to reorganize layout
4. Use zoom and pan for navigation
5. Filter by relationship type

### Label Networks

**Electronic Music Focus:**
- Discover label rosters and connections
- Identify sublabels and partnerships
- Track artist movement between labels
- Visualize label influence in genres

### Discovery Features

**Find Hidden Connections:**
- Artists who collaborate frequently
- Labels with overlapping rosters
- Genre crossover patterns
- Chronological relationship evolution

**Export Capabilities:**
- Network data as JSON
- Visualization as SVG/PNG
- Relationship lists as CSV
- Integration with external tools

---

## ⚡ Advanced Usage

### Parallel Processing

**Enable Parallel Mode:**
```bash
./ordr.fm.sh --parallel --max-parallel-jobs 8 --move
```

**Performance Tuning:**
- CPU cores: Use 75% of available cores
- Memory: Ensure 500MB per parallel job
- I/O: Consider storage speed limitations

### Large Collection Handling

**For 10,000+ Albums:**
```bash
# Process in chunks
./ordr.fm.sh --parallel --batch-size 1000 --move

# Enable performance tracking
./ordr.fm.sh --enable-performance-tracking --move

# Optimize database settings
export ORDR_DB_CACHE_SIZE=10000
```

### Custom Organization Rules

**Artist Alias Groups:**
```bash
ARTIST_ALIAS_GROUPS="Richard D. James,Aphex Twin,AFX,Polygon Window|Kieran Hebden,Four Tet,00110100 01010100"
```

**Label Minimum Thresholds:**
```bash
MIN_LABEL_RELEASES=5          # Higher threshold for cleaner organization
LABEL_PRIORITY_THRESHOLD=0.9  # Only use labels with high confidence
```

### Automation and Scripting

**Scheduled Organization:**
```bash
#!/bin/bash
# daily-organize.sh
cd /path/to/ordr.fm
./ordr.fm.sh --source "$WATCH_DIR" --move --quiet
./backup_database.sh
```

**Integration with Music Servers:**
```bash
# After organization, refresh Plex/Jellyfin
./ordr.fm.sh --move && curl -X POST "http://plex:32400/library/sections/1/refresh"
```

---

## 🛟 Troubleshooting

### Common Issues

**"No audio files found in directory"**
- Check file extensions and permissions
- Verify exiftool can read the files
- Look for hidden files or symlinks

**"Database is locked"**
- Stop any running ordr.fm processes
- Check for stale lock files
- Restart the Node.js server

**"MusicBrainz rate limit exceeded"**
- Wait for rate limit reset (60 seconds)
- Check for proper rate limiting configuration
- Consider reducing parallel processing

**"Insufficient metadata for organization"**
- Review files in unsorted directories
- Manually tag files with proper metadata
- Adjust confidence thresholds

### Debug Mode

**Enable Verbose Logging:**
```bash
./ordr.fm.sh --verbose --log-level debug --source "/test/dir"
```

**Check Specific Components:**
```bash
# Test metadata extraction
./ordr.fm.sh --test-metadata "/path/to/album"

# Test API connections
./ordr.fm.sh --test-apis

# Validate configuration
./ordr.fm.sh --validate-config
```

### Performance Issues

**Slow Processing:**
- Enable parallel processing
- Use SSD storage for databases
- Increase memory allocation
- Check network connectivity for API calls

**High Memory Usage:**
- Reduce parallel job count
- Process in smaller batches
- Clear metadata cache periodically

### Recovery and Undo

**Undo Last Operation:**
```bash
./ordr.fm.sh --undo-last-operation
```

**Rollback Specific Operation:**
```bash
./ordr.fm.sh --list-operations
./ordr.fm.sh --rollback-operation "op_20240115_143022"
```

**Database Recovery:**
```bash
# Backup before recovery
cp ordr.fm.metadata.db ordr.fm.metadata.db.backup

# Rebuild indexes
sqlite3 ordr.fm.metadata.db "REINDEX;"

# Vacuum database
sqlite3 ordr.fm.metadata.db "VACUUM;"
```

---

## 💡 Best Practices

### Before You Start

1. **Backup Your Music** - Always have a complete backup
2. **Test on Small Set** - Process 10-20 albums first
3. **Review Configuration** - Ensure paths and settings are correct
4. **Check Dependencies** - Run system check script

### Organization Strategy

1. **Start with Dry Runs** - Never use `--move` until you're confident
2. **Process Gradually** - Don't organize entire collection at once
3. **Review Unsorted** - Manually fix albums with poor metadata
4. **Monitor Logs** - Watch for warnings and errors

### Metadata Quality

1. **Use Multiple Sources** - Combine Discogs and MusicBrainz
2. **Set Appropriate Thresholds** - Balance accuracy vs. coverage
3. **Review Low Confidence** - Manually verify uncertain matches
4. **Maintain Consistency** - Establish naming conventions

### Performance Optimization

1. **Use SSD Storage** - Especially for database files
2. **Optimize Parallel Jobs** - Match to your system capabilities
3. **Enable Caching** - Reduce redundant API calls
4. **Monitor Resources** - Watch CPU, memory, and network usage

### Long-term Maintenance

1. **Regular Updates** - Keep ordr.fm updated
2. **Database Maintenance** - Periodic vacuum and reindex
3. **Backup Strategies** - Automated database backups
4. **Documentation** - Keep notes on custom configurations

---

## 🎓 Learning Resources

### Understanding Your Collection

**Collection Analysis:**
```bash
# Get collection statistics
./ordr.fm.sh --stats

# Analyze quality distribution
./ordr.fm.sh --quality-report

# Find duplicate albums
./ordr.fm.sh --find-duplicates
```

**Metadata Coverage:**
```bash
# Check enrichment status
curl http://localhost:3000/api/musicbrainz/stats

# View relationship statistics
curl http://localhost:3000/api/artists/relationships | jq '.relationships | length'
```

### Advanced Visualization

**Custom Network Queries:**
- Artist collaboration depth analysis
- Label relationship strength mapping
- Genre evolution over time
- Geographic release distribution

### Integration Examples

**Home Media Server:**
- Plex library refresh after organization
- Jellyfin metadata provider configuration
- Kodi NFO file generation

**Music Discovery:**
- Export playlists based on relationships
- Generate recommendation feeds
- Create artist discovery networks

---

This user guide covers the essential workflow and advanced features of ordr.fm. For additional help, check the [API Documentation](API.md), browse [GitHub Issues](https://github.com/adrianwedd/ordr.fm/issues), or join our community discussions.

**Happy organizing! 🎵**