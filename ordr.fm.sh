#!/bin/bash
set -e

# ordr.fm - Organizes music libraries based on metadata.

# --- Configuration Loading ---
# Default configuration file path
CONFIG_FILE="$(dirname "$0")/ordr.fm.conf"

# Load defaults from config file if it exists
if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
else
    echo "Warning: Configuration file not found at $CONFIG_FILE. Using hardcoded defaults." >&2
    # Hardcoded defaults if config file is missing
    SOURCE_DIR="/home/plex/Music/Unsorted and Incomplete"
    DEST_DIR="/home/plex/Music/sorted_music"
    UNSORTED_DIR_BASE="/home/plex/Music/Unsorted and Incomplete/unsorted"
    LOG_FILE="/home/plex/Music/ordr.fm.log"
    VERBOSITY=1
fi

# --- Global Variables ---
DRY_RUN=1 # Default to dry run for safety
MOVE_FILES=0 # Flag to enable actual file movement
UNSORTED_DIR="" # Will be set in main() with timestamp
INCREMENTAL_MODE=0 # Flag to enable incremental processing
SINCE_DATE="" # Process files newer than this date
STATE_DB="" # Path to state tracking database
FORCE_REPROCESS_DIR="" # Directory to force reprocess

# Define log levels
readonly LOG_QUIET=0
readonly LOG_INFO=1
readonly LOG_DEBUG=2
readonly LOG_WARNING=3
readonly LOG_ERROR=4
readonly LOG_FATAL=5

# --- Helper Functions ---
# Log function
log() {
    local level=$1
    local message="$2"
    local timestamp=$(date +"%Y-%m-%d %H:%M:%S")

    # Write to log file
    echo "[$timestamp] [$(printf '%-5s' "$(get_log_level_name $level)")] $message" >> "$LOG_FILE"

    # Write to console based on verbosity
    if [[ $VERBOSITY -ge $level ]]; then
        echo "$message"
    fi
}

get_log_level_name() {
    case $1 in
        $LOG_QUIET) echo "QUIET" ;;
        $LOG_INFO) echo "INFO" ;;
        $LOG_DEBUG) echo "DEBUG" ;;
        $LOG_WARNING) echo "WARNING" ;;
        $LOG_ERROR) echo "ERROR" ;;
        $LOG_FATAL) echo "FATAL" ;;
        *) echo "UNKNOWN" ;;
    esac
}

# Function to check for required dependencies
check_dependencies() {
    local missing_deps=()
    for cmd in "exiftool" "jq" "rsync" "md5sum" "sqlite3"; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_deps+=("$cmd")
        fi
    done

    if [[ ${#missing_deps[@]} -ne 0 ]]; then
        log $LOG_FATAL "FATAL: Missing required dependencies: ${missing_deps[*]}"
        exit 1
    fi
    log $LOG_INFO "All required dependencies are installed."
}

# Function to sanitize strings for filesystem use
sanitize_filename() {
    local input="$1"
    # Remove or replace problematic characters
    local sanitized=$(echo "$input" | sed 's/[\\/:*?"<>|]\+/_/g')
    # Trim leading/trailing spaces and replace multiple spaces with a single space
    sanitized=$(echo "$sanitized" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/[[:space:]]\+/ /g')
    echo "$sanitized"
}

# --- State Database Functions for Incremental Processing ---

# Initialize the state tracking database
init_state_db() {
    local state_db="$1"
    
    if [[ ! -f "$state_db" ]]; then
        log $LOG_INFO "Creating state database: $state_db"
        sqlite3 "$state_db" <<EOF
CREATE TABLE IF NOT EXISTS processed_directories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    directory_path TEXT UNIQUE NOT NULL,
    last_modified INTEGER NOT NULL,
    directory_hash TEXT NOT NULL,
    processed_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS processed_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT UNIQUE NOT NULL,
    file_size INTEGER NOT NULL,
    file_hash TEXT NOT NULL,
    last_modified INTEGER NOT NULL,
    processed_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_dir_path ON processed_directories(directory_path);
CREATE INDEX IF NOT EXISTS idx_dir_modified ON processed_directories(last_modified);
CREATE INDEX IF NOT EXISTS idx_file_path ON processed_files(file_path);
CREATE INDEX IF NOT EXISTS idx_file_hash ON processed_files(file_hash);
EOF
        log $LOG_INFO "State database initialized successfully"
    else
        log $LOG_DEBUG "State database already exists: $state_db"
    fi
}

# Check if a directory needs processing based on modification time
directory_needs_processing() {
    local dir_path="$1"
    local state_db="$2"
    local current_mtime=$(stat -c "%Y" "$dir_path" 2>/dev/null || echo "0")
    local current_hash=$(find "$dir_path" -maxdepth 1 -type f -exec stat -c "%Y %s %n" {} \; 2>/dev/null | sort | md5sum | cut -d' ' -f1)
    
    local stored_info=$(sqlite3 "$state_db" "SELECT last_modified, directory_hash, status FROM processed_directories WHERE directory_path = \"$dir_path\";" 2>/dev/null)
    
    if [[ -z "$stored_info" ]]; then
        log $LOG_DEBUG "Directory '$dir_path' not found in state database - needs processing"
        return 0
    fi
    
    local stored_mtime=$(echo "$stored_info" | cut -d'|' -f1)
    local stored_hash=$(echo "$stored_info" | cut -d'|' -f2)
    local stored_status=$(echo "$stored_info" | cut -d'|' -f3)
    
    if [[ "$stored_status" != "success" ]]; then
        log $LOG_DEBUG "Directory '$dir_path' previously failed - needs reprocessing"
        return 0
    fi
    
    if [[ "$current_mtime" -gt "$stored_mtime" ]] || [[ "$current_hash" != "$stored_hash" ]]; then
        log $LOG_DEBUG "Directory '$dir_path' has been modified - needs processing"
        return 0
    fi
    
    log $LOG_DEBUG "Directory '$dir_path' unchanged since last processing - skipping"
    return 1
}

# Record directory processing result in state database
record_directory_processing() {
    local dir_path="$1"
    local status="$2"
    local state_db="$3"
    local current_mtime=$(stat -c "%Y" "$dir_path" 2>/dev/null || echo "0")
    local current_hash=$(find "$dir_path" -maxdepth 1 -type f -exec stat -c "%Y %s %n" {} \; 2>/dev/null | sort | md5sum | cut -d' ' -f1)
    local processed_at=$(date +%s)
    
    sqlite3 "$state_db" <<EOF
INSERT OR REPLACE INTO processed_directories 
(directory_path, last_modified, directory_hash, processed_at, status) 
VALUES ("$dir_path", $current_mtime, "$current_hash", $processed_at, "$status");
EOF
    
    log $LOG_DEBUG "Recorded processing result for '$dir_path': $status"
}

# Check if processing should continue based on --since date filter
should_process_since_date() {
    local dir_path="$1"
    local since_date="$2"
    
    if [[ -z "$since_date" ]]; then
        return 0
    fi
    
    local since_timestamp=$(date -d "$since_date" +%s 2>/dev/null)
    if [[ $? -ne 0 ]]; then
        log $LOG_WARNING "Invalid --since date format: $since_date"
        return 0
    fi
    
    local dir_mtime=$(stat -c "%Y" "$dir_path" 2>/dev/null || echo "0")
    
    if [[ "$dir_mtime" -ge "$since_timestamp" ]]; then
        log $LOG_DEBUG "Directory '$dir_path' modified since $since_date - processing"
        return 0
    else
        log $LOG_DEBUG "Directory '$dir_path' not modified since $since_date - skipping"
        return 1
    fi
}

# move_to_unsorted: Moves an album directory to the unsorted area.
# Arguments:
#   $1: The absolute path to the album directory to move.
#   $2: The reason for moving to unsorted.
move_to_unsorted() {
    local album_dir="$1"
    local reason="$2"
    local unsorted_target="${UNSORTED_DIR}/$(basename "$album_dir")"

    log $LOG_INFO "Moving '$album_dir' to unsorted: $reason"

    if [[ $DRY_RUN -eq 1 ]]; then
        log $LOG_INFO "(Dry Run) Would move '$album_dir' to '$unsorted_target'"
    else
        mkdir -p "$(dirname "$unsorted_target")" || { log $LOG_ERROR "ERROR: Could not create unsorted target directory for '$album_dir'."; return 1; }
        mv "$album_dir" "$unsorted_target"
        if [[ $? -eq 0 ]]; then
            log $LOG_INFO "Successfully moved '$album_dir' to '$unsorted_target'"
        else
            log $LOG_ERROR "ERROR: Failed to move '$album_dir' to '$unsorted_target'."
        fi
    fi
}

# --- Album Processing Logic ---

# process_album_directory: Analyzes a single directory assumed to be an album.
# Extracts metadata, determines album identity and quality, and proposes a new path.
# Arguments:
#   $1: The absolute path to the album directory to process.
process_album_directory() {
    local album_dir="$1"
    log $LOG_INFO "Processing album directory: $album_dir"

    # Find all audio files within the album directory.
    # Referencing SPECIFICATIONS.md: "Input and Output" -> "Recursive Scanning"
    # and "Metadata Extraction and Interpretation" -> "Tools"
    local audio_files=()
    while IFS= read -r -d $'\0' file; do
        audio_files+=("$file")
    done < <(find "$album_dir" -maxdepth 1 -type f \( -iname "*.mp3" -o -iname "*.flac" -o -iname "*.m4a" -o -iname "*.aac" -o -iname "*.ogg" -o -iname "*.wav" -o -iname "*.aiff" -o -iname "*.alac" \) -print0)

    if [[ ${#audio_files[@]} -eq 0 ]]; then
        log $LOG_INFO "SKIP: No audio files found in '$album_dir'. Skipping."
        return 0
    fi

    # Extract all relevant metadata from all audio files in one go using exiftool -json.
    # This is more efficient than calling exiftool per file.
    # Referencing SPECIFICATIONS.md: "Metadata Extraction and Interpretation" -> "Tools"
    local exiftool_output
    exiftool_output=$(exiftool -json "${audio_files[@]}" 2>/dev/null)

    if [[ -z "$exiftool_output" ]]; then
        log $LOG_WARNING "WARN: Could not extract metadata from any files in '$album_dir'. Moving to unsorted."
        # If no metadata can be extracted, treat as unsorted.
        move_to_unsorted "$album_dir" "No readable metadata found."
        return 0
    fi

    # --- DEBUGGING: Print raw exiftool output ---
    log $LOG_DEBUG "Raw exiftool output for '$album_dir':\n$exiftool_output"

    # Parse metadata using jq and collect relevant tags for all tracks.
    # Referencing SPECIFICATIONS.md: "Metadata Extraction and Interpretation" -> "Required Tags"
    local all_album_artists=$(echo "$exiftool_output" | jq -r '.[] | .AlbumArtist // empty')
    local all_artists=$(echo "$exiftool_output" | jq -r '.[] | .Artist // empty')
    local all_albums=$(echo "$exiftool_output" | jq -r '.[] | .Album // empty')
    local all_titles=$(echo "$exiftool_output" | jq -r '.[] | .Title // empty')
    local all_track_numbers=$(echo "$exiftool_output" | jq -r '.[].Track // empty')
    local all_years=$(echo "$exiftool_output" | jq -r '.[].Year // empty')
    local all_disc_numbers=$(echo "$exiftool_output" | jq -r '.[].DiscNumber // empty')
    local all_file_types=$(echo "$exiftool_output" | jq -r '.[].FileTypeExtension // empty')

    # --- DEBUGGING: Print collected metadata arrays ---
    log $LOG_DEBUG "Collected Album Artists: $(echo "$all_album_artists" | tr '\n' ';')"
    log $LOG_DEBUG "Collected Artists: $(echo "$all_artists" | tr '\n' ';')"
    log $LOG_DEBUG "Collected Albums: $(echo "$all_albums" | tr '\n' ';')"
    log $LOG_DEBUG "Collected Titles: $(echo "$all_titles" | tr '\n' ';')"
    log $LOG_DEBUG "Collected Track Numbers: $(echo "$all_track_numbers" | tr '\n' ';')"
    log $LOG_DEBUG "Collected Years: $(echo "$all_years" | tr '\n' ';')"
    log $LOG_DEBUG "Collected Disc Numbers: $(echo "$all_disc_numbers" | tr '\n' ';')"
    log $LOG_DEBUG "Collected File Types: $(echo "$all_file_types" | tr '\n' ';')"

    # --- Determine Album Identity ---
    # Referencing SPECIFICATIONS.md: "Metadata Extraction and Interpretation" -> "Metadata Consistency and Conflict Resolution"

    local album_artist=""
    local album_title=""
    local album_year=""

    # Determine Album Artist
    # Prioritize AlbumArtist, then Artist. Handle "Various Artists".
    if [[ $(echo "$all_album_artists" | sort -u | wc -l) -eq 1 && -n "$(echo "$all_album_artists" | head -n 1)" ]]; then
        album_artist=$(echo "$all_album_artists" | head -n 1)
        log $LOG_DEBUG "Determined Album Artist (from AlbumArtist tag): $album_artist"
    elif [[ $(echo "$all_artists" | sort -u | wc -l) -eq 1 && -n "$(echo "$all_artists" | head -n 1)" ]]; then
        album_artist=$(echo "$all_artists" | head -n 1)
        log $LOG_DEBUG "Determined Album Artist (from Artist tag): $album_artist"
    else
        # If multiple album artists or artists, classify as "Various Artists"
        album_artist="Various Artists"
        log $LOG_INFO "Determined Album Artist: '$album_artist' (multiple or inconsistent artists found)."
    fi

    # Determine Album Title (most frequent)
    album_title=$(echo "$all_albums" | sort | uniq -c | sort -nr | head -n 1 | awk '{$1=""; print $0}' | sed 's/^ *//')
    if [[ -z "$album_title" ]]; then
        album_title=$(basename "$album_dir") # Fallback to directory name
        log $LOG_WARNING "WARN: Could not determine consistent Album Title from tags. Falling back to directory name: '$album_title'"
    else
        log $LOG_DEBUG "Determined Album Title: $album_title"
    fi

    # Determine Album Year (earliest)
    album_year=$(echo "$all_years" | sort -n | head -n 1)
    if [[ -n "$album_year" ]]; then
        log $LOG_DEBUG "Determined Album Year: $album_year"
    else
        log $LOG_INFO "No consistent Album Year found."
    fi

    # Check for essential tags for processing
    if [[ -z "$album_artist" || -z "$album_title" ]]; then
        log $LOG_WARNING "WARN: Missing essential album tags (Album Artist or Album Title) for '$album_dir'. Moving to unsorted."
        move_to_unsorted "$album_dir" "Missing essential album tags."
        return 0
    fi

    # --- Determine Album Quality ---
    # Referencing SPECIFICATIONS.md: "Album Classification Logic"
    local has_lossless=0
    local has_lossy=0

    for file_type in $all_file_types; do
        case "$file_type" in
            "FLAC"|"WAV"|"AIFF"|"ALAC") has_lossless=1 ;;
            "MP3"|"AAC"|"M4A"|"OGG") has_lossy=1 ;;
        esac
    done

    local album_quality=""
    if [[ $has_lossless -eq 1 && $has_lossy -eq 1 ]]; then
        album_quality="Mixed"
    elif [[ $has_lossless -eq 1 ]]; then
        album_quality="Lossless"
    elif [[ $has_lossy -eq 1 ]]; then
        album_quality="Lossy"
    else
        album_quality="UnknownQuality" # Should not happen if audio_files is not empty
    fi
    log $LOG_DEBUG "Determined Album Quality: $album_quality"

    # --- Construct New Path ---
    # Referencing SPECIFICATIONS.md: "Naming Conventions" -> "Directory Structure"

    local sanitized_album_artist=$(sanitize_filename "$album_artist")
    local sanitized_album_title=$(sanitize_filename "$album_title")
    local sanitized_album_year=""
    if [[ -n "$album_year" ]]; then
        sanitized_album_year=" ($album_year)"
    fi

    local new_album_dir_name="${sanitized_album_title}${sanitized_album_year}"
    local proposed_album_path="${DEST_DIR}/${album_quality}/${sanitized_album_artist}/${new_album_dir_name}"

    log $LOG_INFO "Proposed new album path for '$album_dir': $proposed_album_path"

    # Placeholder for actual move/rename logic for the album directory and its files
    # This will be implemented in a later step, after dry-run is fully functional.
    if [[ $DRY_RUN -eq 1 ]]; then
        log $LOG_INFO "(Dry Run) Would move album directory '$album_dir' to '$proposed_album_path'"
        # In dry-run, we also want to show how individual files would be renamed
        log $LOG_INFO "(Dry Run) Individual files within this album would be renamed as follows:"
        echo "$exiftool_output" | jq -c '.[]' | while IFS= read -r track_json; do
            local track_artist=$(echo "$track_json" | jq -r '.Artist // empty')
            local track_title=$(echo "$track_json" | jq -r '.Title // empty')
            local track_number=$(echo "$track_json" | jq -r '.Track // empty')
            local track_disc_number=$(echo "$track_json" | jq -r '.DiscNumber // empty')
            local track_ext=$(echo "$track_json" | jq -r '.FileTypeExtension // empty')
            local original_filename=$(echo "$track_json" | jq -r '.FileName // empty')

            local sanitized_track_title=$(sanitize_filename "$track_title")
            local formatted_track_number=""
            if [[ -n "$track_number" ]]; then
                formatted_track_number=$(printf "%02d - " "$track_number")
            fi

            local formatted_disc_number=""
            if [[ -n "$track_disc_number" ]]; then
                formatted_disc_number="Disc $(sanitize_filename "$track_disc_number")"
            fi

            local new_track_filename="${formatted_track_number}${sanitized_track_title}.${track_ext}"
            local proposed_track_path="${proposed_album_path}"
            if [[ -n "$formatted_disc_number" ]]; then
                proposed_track_path="${proposed_track_path}/${formatted_disc_number}"
            fi
            proposed_track_path="${proposed_track_path}/${new_track_filename}"

            log $LOG_INFO "  - '$original_filename' -> '$proposed_track_path'"
        done
    else
        # Actual move logic will go here later
        log $LOG_INFO "(Live Run) Album move/rename logic not yet implemented."
    fi
}

# --- Argument Parsing ---
parse_arguments() {
    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            -s|--source)
                SOURCE_DIR="$2"
                shift 2
                ;;
            -d|--destination)
                DEST_DIR="$2"
                shift 2
                ;;
            -u|--unsorted)
                UNSORTED_DIR_BASE="$2"
                shift 2
                ;;
            -l|--log-file)
                LOG_FILE="$2"
                shift 2
                ;;
            -v|--verbose)
                VERBOSITY=$LOG_DEBUG
                shift
                ;;
            --move)
                MOVE_FILES=1
                DRY_RUN=0 # Disable dry run if --move is present
                shift
                ;;
            --dry-run)
                DRY_RUN=1
                MOVE_FILES=0 # Ensure no moves if --dry-run is present
                shift
                ;;
            --incremental)
                INCREMENTAL_MODE=1
                shift
                ;;
            --since)
                SINCE_DATE="$2"
                shift 2
                ;;
            --state-db)
                STATE_DB="$2"
                shift 2
                ;;
            --force-reprocess)
                FORCE_REPROCESS_DIR="$2"
                shift 2
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log $LOG_INFO "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

show_help() {
    echo "Usage: $(basename "$0") [OPTIONS]"
    echo "Organizes music files based on metadata."
    echo ""
    echo "Options:"
    echo "  -s, --source DIR        Source directory to scan for music (default: $SOURCE_DIR)"
    echo "  -d, --destination DIR   Destination directory for organized music (default: $DEST_DIR)"
    echo "  -u, --unsorted DIR      Base directory for unsorted/problematic music (default: $UNSORTED_DIR_BASE)"
    echo "  -l, --log-file FILE     Path to the log file (default: $LOG_FILE)"
    echo "  -v, --verbose           Enable verbose output (DEBUG level logging)"
    echo "  --move                  Execute file moves/renames (default: dry-run only)"
    echo "  --dry-run               Simulate operations without moving files (default)"
    echo ""
    echo "Incremental Processing:"
    echo "  --incremental           Enable incremental processing mode"
    echo "  --since DATE            Process only files newer than DATE (YYYY-MM-DD format)"
    echo "  --state-db FILE         Path to state database (default: ordr.fm.state.db)"
    echo "  --force-reprocess DIR   Force reprocessing of specific directory"
    echo ""
    echo "  -h, --help              Display this help message"
    echo ""
    echo "Configuration can also be set in $CONFIG_FILE"
}

# --- Main Logic ---
main() {
    parse_arguments "$@"

    # Create log file directory if it doesn't exist
    mkdir -p "$(dirname "$LOG_FILE")" || { echo "FATAL: Could not create log directory: $(dirname "$LOG_FILE")"; exit 1; }

    # Initialize log file (clear previous content for new run)
    > "$LOG_FILE"
    log $LOG_INFO "--- ordr.fm Script Started ---"
    log $LOG_INFO "Configuration:"
    log $LOG_INFO "  Source Directory: $SOURCE_DIR"
    log $LOG_INFO "  Destination Directory: $DEST_DIR"
    log $LOG_INFO "  Unsorted Directory Base: $UNSORTED_DIR_BASE"
    log $LOG_INFO "  Log File: $LOG_FILE"
    log $LOG_INFO "  Verbosity: $(get_log_level_name $VERBOSITY)"
    log $LOG_INFO "  Mode: $([[ $DRY_RUN -eq 1 ]] && echo "Dry Run" || echo "Live Run")"
    log $LOG_INFO "  Incremental Mode: $([[ $INCREMENTAL_MODE -eq 1 ]] && echo "Enabled" || echo "Disabled")"
    [[ -n "$SINCE_DATE" ]] && log $LOG_INFO "  Since Date: $SINCE_DATE"

    check_dependencies

    # Initialize state database for incremental processing
    if [[ $INCREMENTAL_MODE -eq 1 ]]; then
        if [[ -z "$STATE_DB" ]]; then
            STATE_DB="$(dirname "$LOG_FILE")/ordr.fm.state.db"
        fi
        log $LOG_INFO "  State Database: $STATE_DB"
        init_state_db "$STATE_DB"
    fi

    # Create timestamped unsorted directory for this run
    local TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    UNSORTED_DIR="${UNSORTED_DIR_BASE}/unsorted_${TIMESTAMP}"
    if [[ $MOVE_FILES -eq 1 ]]; then
        mkdir -p "$UNSORTED_DIR" || { log $LOG_FATAL "FATAL: Could not create unsorted directory: $UNSORTED_DIR"; exit 1; }
        log $LOG_INFO "Created unsorted directory for this run: $UNSORTED_DIR"
    else
        log $LOG_INFO "(Dry Run) Would create unsorted directory: $UNSORTED_DIR"
    fi

    # Check if source directory exists
    if [[ ! -d "$SOURCE_DIR" ]]; then
        log $LOG_FATAL "FATAL: Source directory not found: $SOURCE_DIR"
        exit 1
    fi

    log $LOG_INFO "Scanning for album directories in $SOURCE_DIR..."

    local album_dirs=()
    while IFS= read -r -d '' album_dir; do
        album_dirs+=("$album_dir")
    done < <(find "$SOURCE_DIR" -type d -print0)

    if [[ ${#album_dirs[@]} -eq 0 ]]; then
        log $LOG_INFO "No album directories found in $SOURCE_DIR."
        exit 0
    fi

    log $LOG_INFO "Found ${#album_dirs[@]} potential album directories. Processing..."
    
    local processed_count=0
    local skipped_count=0
    
    for album_dir in "${album_dirs[@]}"; do
        # Skip the source directory itself
        if [[ "$album_dir" == "$SOURCE_DIR" ]]; then
            continue
        fi
        
        # Skip if --since date filter doesn't match
        if [[ -n "$SINCE_DATE" ]] && ! should_process_since_date "$album_dir" "$SINCE_DATE"; then
            ((skipped_count++))
            continue
        fi
        
        # Skip if incremental mode and directory doesn't need processing (unless force reprocessing)
        if [[ $INCREMENTAL_MODE -eq 1 ]] && [[ "$album_dir" != "$FORCE_REPROCESS_DIR"* ]] && ! directory_needs_processing "$album_dir" "$STATE_DB"; then
            ((skipped_count++))
            continue
        fi
        
        # Process the album directory
        log $LOG_DEBUG "Processing directory: $album_dir"
        
        if process_album_directory "$album_dir"; then
            # Record successful processing
            if [[ $INCREMENTAL_MODE -eq 1 ]]; then
                record_directory_processing "$album_dir" "success" "$STATE_DB"
            fi
            ((processed_count++))
        else
            # Record failed processing
            if [[ $INCREMENTAL_MODE -eq 1 ]]; then
                record_directory_processing "$album_dir" "failed" "$STATE_DB"
            fi
            log $LOG_WARNING "Failed to process directory: $album_dir"
        fi
    done
    
    log $LOG_INFO "Processing complete. Processed: $processed_count, Skipped: $skipped_count"

    log $LOG_INFO "--- ordr.fm Script Finished ---"
} 

# Execute main function
main "$@"
