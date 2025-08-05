# ordr.fm

## Project Overview

This project aims to provide a robust, intelligent, and safe solution for organizing chaotic music collections into a clean, consistent, and media-server-friendly structure. Many existing tools struggle with inconsistent tagging, mixed file formats within albums, and complex directory structures. This script is being developed with a strong focus on handling these real-world edge cases, ensuring album integrity, and providing clear, actionable feedback.

## Motivation

The inspiration for this project comes from the common challenge of managing large, unsorted, or inconsistently organized digital music libraries. Traditional sorting methods often break up albums, miscategorize tracks, or fail to handle mixed-quality content (e.g., FLAC and MP3 versions of the same album). Our goal is to create a tool that:

*   **Preserves Album Integrity:** Treats an album as a single logical unit, even if it contains mixed formats or VBR tracks.
*   **Leverages Metadata:** Uses embedded audio tags (ID3, Vorbis comments, etc.) as the primary source of truth for organization.
*   **Handles Edge Cases:** Explicitly addresses scenarios like "Various Artists" compilations, multi-disc albums, and problematic characters in filenames.
*   **Is Safe:** Provides a comprehensive dry-run mode to preview all changes before any files are moved or renamed.
*   **Is Transparent:** Offers detailed logging to understand every decision made by the script.
*   **Is Open Source:** Developed collaboratively to benefit from community input and address a wide range of real-world music library challenges.

## Features (Planned)

*   **Album-Centric Organization:** Processes entire album directories, ensuring all tracks from an album remain together.
*   **Metadata-Driven Renaming:** Renames files and structures directories based on embedded tags (Artist, Album Artist, Album, Title, Track Number, Disc Number, Year).
*   **Quality-Based Top-Level Sorting:** Organizes albums into `Lossless`, `Lossy`, or `Mixed` categories based on the highest quality file present in the album.
*   **Robust Error Handling:** Catches and logs issues like missing metadata, read/write errors, and checksum mismatches.
*   **Safe Dry-Run Mode:** Simulates all operations without modifying any files, providing a detailed report of proposed changes.
*   **Comprehensive Logging:** Generates a detailed log file for auditing and troubleshooting.
*   **Filename Sanitization:** Automatically cleans up problematic characters in generated filenames and directory names.
*   **Handling of Incomplete/Untagged Files:** Moves files with insufficient metadata to a dedicated "Unsorted" area for manual review.

## Quick Start

For a quick start, use our interactive setup wizard:

```bash
./setup_wizard.sh
```

Or check out the [Quick Start Guide](QUICKSTART.md).

## Installation

### System Requirements

*   **OS**: Linux (Ubuntu 20.04+, Debian 10+) or macOS 10.15+
*   **Shell**: Bash 4.0+ or Zsh 5.0+
*   **CPU**: 2+ cores (4+ recommended for parallel processing)
*   **RAM**: 2GB minimum (4GB+ recommended)

### Dependencies

Required:
*   `exiftool` (v12.0+): For extracting comprehensive metadata from audio files
*   `jq` (v1.6+): For parsing JSON output from `exiftool` efficiently
*   `sqlite3` (v3.31+): For database operations

Optional:
*   `parallel`: For enhanced parallel processing performance
*   `rsync`: For robust file copying/moving
*   `bc`: For statistics calculations
*   `curl`: For Discogs API integration

### Quick Install

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y exiftool jq sqlite3 parallel bc rsync curl

# macOS
brew install exiftool jq sqlite parallel bc rsync curl

# Clone repository
git clone https://github.com/adrianwedd/ordr.fm.git
cd ordr.fm

# Run system check
./system_check.sh

# Run setup wizard
./setup_wizard.sh
```

## Usage

### Interactive Tools

1. **Setup Wizard** - Configure ordr.fm interactively:
   ```bash
   ./setup_wizard.sh
   ```

2. **Command Builder** - Build complex commands easily:
   ```bash
   ./command_builder.sh
   ```

3. **System Check** - Verify your system is ready:
   ```bash
   ./system_check.sh
   ```

### Basic Commands

```bash
# Preview organization (safe dry-run)
./ordr.fm.modular.sh --source /music/unsorted --destination /music/organized

# Actually organize music
./ordr.fm.modular.sh --source /music/unsorted --destination /music/organized --move

# Use parallel processing for speed
./ordr.fm.modular.sh --source /music/unsorted --destination /music/organized --parallel --move

# Electronic music with Discogs enrichment
./ordr.fm.modular.sh --enable-electronic --discogs --move
```

See [Full Documentation](docs/DEPLOYMENT.md) for advanced usage.

## Contributing

We welcome contributions! If you encounter an edge case, have suggestions for improvements, or want to contribute code, please refer to the `CONTRIBUTING.md` (to be created) for guidelines.

## License

[License information will go here, e.g., MIT License]
