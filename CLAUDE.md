# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a music sorting and organization tool written in Bash. The project consists of a single main script (`ordr.fm.sh`) that analyzes music files using metadata, organizes them into a structured directory hierarchy based on quality (Lossless/Lossy/Mixed), and provides comprehensive logging and safety features.

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

### Configuration Override
```bash
# Override specific paths
./ordr.fm.sh --source "/custom/source" --destination "/custom/dest" --unsorted "/custom/unsorted"

# Custom log file
./ordr.fm.sh --log-file "/custom/path/ordr.fm.log"
```

## Development Notes

### Current Implementation Status
- Metadata extraction and album analysis: ✅ Implemented
- Directory structure planning: ✅ Implemented  
- Dry-run mode with detailed logging: ✅ Implemented
- Actual file moving/renaming: ❌ Not yet implemented (placeholder exists at ordr.fm.sh:284)
- Checksum verification: ❌ Planned
- Multi-disc album handling: ✅ Planned in dry-run output

### Key Functions
- `process_album_directory()` - Main album processing logic (ordr.fm.sh:112)
- `move_to_unsorted()` - Handles problematic albums (ordr.fm.sh:86)
- `sanitize_filename()` - Cleans filenames for filesystem compatibility (ordr.fm.sh:73)
- `check_dependencies()` - Validates required tools (ordr.fm.sh:57)

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