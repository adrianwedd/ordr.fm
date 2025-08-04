# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Latest Session Summary (2025-08-04 - Session 2)

### Completed Work
- ✅ **Fixed Single Album Detection**: Source directory can now be an album itself
- ✅ **Fixed Quality Detection**: Case sensitivity issue resolved (mp3 vs MP3)
- ✅ **Testing Framework**: Comprehensive testing with backup strategy
- ✅ **Visualization Dashboard (#23)**: Full web interface with charts and stats
- ✅ **Discovered Artist Pseudonym Issue (#26)**: Atom Heart = Eyephone example

### Key Findings
- Artist pseudonyms are critical (same artist, different metadata names)
- Discogs API requires authentication token for enrichment
- Associated files (.asd, .nfo) need preservation logic
- Quality detection and single album detection now working correctly

### Next Session Plan
1. **Configure Discogs API token** for metadata enrichment
2. **Set up artist alias groups** in configuration
3. **Create Google Drive backup** before any production moves
4. **Run full test suite** with all features enabled
5. **Test on larger subset** (10-20 albums minimum)

## Project Overview

This is a professional-grade music organization tool written in Bash with advanced features for electronic music collections. The main script (`ordr.fm.sh`) analyzes metadata, enriches it via Discogs API, intelligently organizes music based on quality and metadata patterns, and tracks all operations in a database for undo/recovery.

## Architecture

### Core Components

- **Main Script**: `ordr.fm.sh` - Contains all functionality including metadata extraction, album processing, and file organization
- **Configuration**: `ordr.fm.conf` - Default configuration file with directory paths and verbosity settings
- **Specifications**: `SPECIFICATIONS.md` - Comprehensive technical specifications for the script's behavior
- **Documentation**: `README.md` - Project overview and planned features

### Key Architecture Patterns

- **Album-Centric Processing**: The script treats entire directories as albums, ensuring tracks stay together
- **Metadata-Driven Organization**: Uses `exiftool` and `jq` to extract and process audio file metadata (ID3, Vorbis, etc.)
- **Quality-Based Classification**: Organizes albums into `Lossless`, `Lossy`, or `Mixed` top-level directories
- **Safety-First Design**: Defaults to dry-run mode, requires explicit `--move` flag for actual file operations
- **Comprehensive Logging**: All operations are logged with timestamps and different verbosity levels

### Directory Structure Logic

Target structure: `<DEST_DIR>/<Quality>/<Album Artist>/<Album Title> (<Year>)/[Disc <N>/]<Track> - <Title>.<ext>`

Quality determination:
- **Lossless**: Contains any FLAC, WAV, AIFF, or ALAC files
- **Mixed**: Contains both lossless and lossy formats
- **Lossy**: Contains only MP3, AAC, M4A, or OGG files

## Dependencies

Required command-line tools (checked at startup):
- `exiftool` - Metadata extraction from audio files
- `jq` - JSON parsing for exiftool output
- `rsync` - File operations (planned)
- `md5sum` - Checksum verification (planned)

## Common Commands

### Basic Usage
```bash
# Dry run (default, safe mode)
./ordr.fm.sh

# Actual file operations (use with caution)
./ordr.fm.sh --move

# Verbose debugging output
./ordr.fm.sh --verbose

# Custom source directory
./ordr.fm.sh --source "/path/to/music"

# Custom destination
./ordr.fm.sh --destination "/path/to/organized"
```

### Electronic Music Organization
```bash
# Enable all electronic features with intelligent routing
./ordr.fm.sh --enable-electronic --discogs --move

# Use label-based organization
./ordr.fm.sh --organization-mode label --discogs

# Enable remix separation
./ordr.fm.sh --enable-remixes --discogs

# Full electronic setup with vinyl markers
./ordr.fm.sh --enable-electronic --enable-vinyl-markers --discogs
```

### Discogs Integration
```bash
# Enable Discogs enrichment (requires API token in config)
./ordr.fm.sh --discogs

# Override Discogs confidence threshold
./ordr.fm.sh --discogs --confidence-threshold 0.8

# Force fresh Discogs lookups (ignore cache)
./ordr.fm.sh --discogs --force-refresh
```

### Configuration Override
```bash
# Override specific paths
./ordr.fm.sh --source "/custom/source" --destination "/custom/dest" --unsorted "/custom/unsorted"

# Custom log file
./ordr.fm.sh --log-file "/custom/path/ordr.fm.log"

# Custom database paths
./ordr.fm.sh --state-db "/path/to/state.db" --metadata-db "/path/to/metadata.db"
```

## Development Notes

### Current Implementation Status
- Metadata extraction and album analysis: ✅ Implemented
- Directory structure planning: ✅ Implemented  
- Dry-run mode with detailed logging: ✅ Implemented
- Discogs API integration: ✅ Implemented (#19)
- Electronic music organization: ✅ Implemented (#20)
- Artist alias resolution: ✅ Implemented
- Metadata database tracking: ✅ Implemented
- Actual file moving/renaming: ❌ Not yet implemented (placeholder exists at ordr.fm.sh:284)
- Checksum verification: ❌ Planned
- Multi-disc album handling: ✅ Planned in dry-run output
- Web visualization dashboard: ❌ Planned (#23)
- Automated alias detection: ❌ Planned (#24)

### Key Functions

#### Core Processing
- `process_album_directory()` - Main album processing logic (ordr.fm.sh:112)
- `move_to_unsorted()` - Handles problematic albums (ordr.fm.sh:86)
- `sanitize_filename()` - Cleans filenames for filesystem compatibility (ordr.fm.sh:73)
- `check_dependencies()` - Validates required tools (ordr.fm.sh:57)

#### Discogs Integration (ordr.fm.sh:399-562)
- `discogs_authenticate()` - Sets up API authentication
- `discogs_search_release()` - Searches for releases
- `discogs_get_release()` - Fetches detailed release data
- `discogs_extract_metadata()` - Extracts catalog, label, series
- `discogs_rate_limit()` - Handles API rate limiting
- `discogs_cache_response()` - Caches API responses

#### Electronic Organization (ordr.fm.sh:563-825)
- `determine_organization_mode()` - Intelligent mode selection
- `should_use_label_organization()` - Label vs artist comparison
- `is_compilation()` - Detect VA/compilation releases
- `detect_remixes()` - Find remix content
- `extract_remix_artist()` - Parse remixer names
- `build_organization_path()` - Path construction

#### Artist Alias Resolution (ordr.fm.sh:932-1056)
- `resolve_artist_alias()` - Maps aliases to primary artist
- `count_artist_releases()` - Counts across all aliases
- `get_primary_artist()` - Returns canonical name
- `parse_alias_groups()` - Processes configuration

#### Metadata Database (ordr.fm.sh:1065-1293)
- `init_metadata_db()` - Creates database schema
- `track_album_metadata()` - Records all album data
- `track_move_operation()` - Logs moves for undo
- `export_metadata_json()` - Exports for visualization
- `undo_last_move()` - Reverses operations
- `generate_organization_stats()` - Creates statistics

### Metadata Handling
- Prioritizes `AlbumArtist` over `Artist` tags
- Handles "Various Artists" compilations automatically
- Uses most frequent album title if inconsistent
- Takes earliest year found across tracks
- Moves albums with insufficient metadata to timestamped unsorted directories

### Error Handling
- Graceful handling of missing dependencies
- Per-album error isolation (problematic albums moved to unsorted)
- Comprehensive logging with different severity levels
- Safe defaults (dry-run mode, no overwriting)

## Testing

No formal test framework is currently implemented. Testing should be done with:
1. Dry-run mode first (`./ordr.fm.sh`)
2. Small test directories before processing large collections
3. Review log files in detail before using `--move` flag

## Safety Features

- **Dry-run by default**: All operations are simulated unless `--move` is explicitly used
- **Timestamped unsorted directories**: Problematic files are moved to `unsorted_YYYYMMDD_HHMMSS/`
- **No overwriting**: Script avoids overwriting existing organized music
- **Comprehensive logging**: All decisions and operations are logged for audit trails
- **Database tracking**: All operations recorded for undo/recovery
- **Smart fallback logic**: Prevents sparse folders (e.g., single release in label folder)

## Configuration Tips

### For Electronic Music Collections
```bash
# ordr.fm.conf recommended settings
ORGANIZATION_MODE="hybrid"          # Intelligent routing
MIN_LABEL_RELEASES=3                # Avoid sparse label folders
SEPARATE_REMIXES=1                  # Organize remixes separately
DISCOGS_ENABLED=1                   # Get catalog numbers & labels
DISCOGS_CONFIDENCE_THRESHOLD=0.7    # Good balance
GROUP_ARTIST_ALIASES=1              # Handle multiple artist names
```

### Artist Alias Groups
```bash
# Example for electronic artists with multiple aliases
ARTIST_ALIAS_GROUPS="Uwe Schmidt,Atom TM,Atom Heart,Senor Coconut,Atomu Shinzo|Aphex Twin,AFX,Polygon Window,Caustic Window|Four Tet,Kieran Hebden,00110100 01010100"
```

## Key Technical Decisions

1. **Why Bash?** Maximum portability, no dependencies beyond standard Unix tools
2. **Why SQLite?** Lightweight, file-based, perfect for tracking metadata
3. **Why Discogs API?** Best electronic music metadata, catalog numbers crucial for organization
4. **Why dry-run default?** Safety first - users can preview changes before committing
5. **Why hybrid mode?** Intelligent routing prevents common organization problems