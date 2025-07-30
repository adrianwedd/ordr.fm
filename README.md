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

## Installation

This script will be a Bash script with dependencies on standard command-line tools.

### Dependencies

*   `exiftool`: For extracting comprehensive metadata from audio files.
*   `jq`: For parsing JSON output from `exiftool` efficiently.
*   `rsync`: For robust file copying/moving.

Installation instructions for these dependencies will be provided here.

### Getting the Script

Once developed, the script will be available for download or cloning from this repository.

## Usage

Detailed usage instructions, including command-line arguments for dry-run, verbose logging, and actual execution, will be provided here.

## Contributing

We welcome contributions! If you encounter an edge case, have suggestions for improvements, or want to contribute code, please refer to the `CONTRIBUTING.md` (to be created) for guidelines.

## License

[License information will go here, e.g., MIT License]
