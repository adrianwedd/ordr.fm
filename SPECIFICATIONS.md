# Music Sorter - Technical Specifications

## Introduction

This document details the technical specifications for the Music Sorter script. It outlines the core principles, input/output requirements, metadata handling, album classification logic, naming conventions, error handling, and safety features. This specification serves as a blueprint for development and a reference for understanding the script's behavior.

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

