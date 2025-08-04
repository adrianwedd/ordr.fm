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
FIND_DUPLICATES=0 # Flag to enable duplicate detection analysis mode
RESOLVE_DUPLICATES=0 # Flag to enable automatic duplicate resolution
DUPLICATES_DB="" # Path to duplicates database

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

# --- Duplicate Detection Functions ---

# Initialize the duplicates tracking database
init_duplicates_db() {
    local duplicates_db="$1"
    
    if [[ ! -f "$duplicates_db" ]]; then
        log $LOG_INFO "Creating duplicates database: $duplicates_db"
        sqlite3 "$duplicates_db" <<EOF
CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    directory_path TEXT UNIQUE NOT NULL,
    album_artist TEXT NOT NULL,
    album_title TEXT NOT NULL,
    album_year INTEGER,
    track_count INTEGER,
    total_size INTEGER,
    quality_type TEXT NOT NULL,
    avg_bitrate INTEGER,
    format_mix TEXT,
    album_hash TEXT NOT NULL,
    detected_at INTEGER DEFAULT (strftime('%s', 'now')),
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS duplicate_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_hash TEXT UNIQUE NOT NULL,
    album_artist TEXT NOT NULL,
    album_title TEXT NOT NULL,
    album_year INTEGER,
    track_count INTEGER,
    best_quality_album_id INTEGER,
    duplicate_count INTEGER DEFAULT 1,
    resolution_status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (best_quality_album_id) REFERENCES albums(id)
);

CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    album_id INTEGER NOT NULL,
    quality_score INTEGER NOT NULL,
    is_recommended_keeper INTEGER DEFAULT 0,
    FOREIGN KEY (group_id) REFERENCES duplicate_groups(id),
    FOREIGN KEY (album_id) REFERENCES albums(id)
);

CREATE INDEX IF NOT EXISTS idx_albums_hash ON albums(album_hash);
CREATE INDEX IF NOT EXISTS idx_albums_metadata ON albums(album_artist, album_title, album_year);
CREATE INDEX IF NOT EXISTS idx_duplicate_groups_hash ON duplicate_groups(group_hash);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
EOF
        log $LOG_INFO "Duplicates database initialized successfully"
    else
        log $LOG_DEBUG "Duplicates database already exists: $duplicates_db"
    fi
}

# Calculate quality score for an album based on format, bitrate, and file size
calculate_quality_score() {
    local quality_type="$1"
    local avg_bitrate="$2"
    local total_size="$3"
    local format_mix="$4"
    local score=0
    
    # Base score by quality type
    case "$quality_type" in
        "Lossless") score=1000 ;;
        "Lossy") score=500 ;;
        "Mixed") score=300 ;;
        *) score=100 ;;
    esac
    
    # Bonus for higher bitrate (for lossy formats)
    if [[ "$quality_type" == "Lossy" && -n "$avg_bitrate" ]]; then
        if [[ "$avg_bitrate" -ge 320 ]]; then
            score=$((score + 200))
        elif [[ "$avg_bitrate" -ge 256 ]]; then
            score=$((score + 150))
        elif [[ "$avg_bitrate" -ge 192 ]]; then
            score=$((score + 100))
        elif [[ "$avg_bitrate" -ge 128 ]]; then
            score=$((score + 50))
        fi
    fi
    
    # Bonus for larger file size (indicates better quality)
    if [[ -n "$total_size" && "$total_size" -gt 0 ]]; then
        local size_mb=$((total_size / 1024 / 1024))
        if [[ "$size_mb" -gt 500 ]]; then
            score=$((score + 100))
        elif [[ "$size_mb" -gt 200 ]]; then
            score=$((score + 50))
        elif [[ "$size_mb" -gt 100 ]]; then
            score=$((score + 25))
        fi
    fi
    
    # Penalty for mixed formats (less consistent)
    if [[ "$format_mix" == *","* ]]; then
        score=$((score - 100))
    fi
    
    echo "$score"
}

# Generate a hash for album metadata to identify potential duplicates
generate_album_hash() {
    local album_artist="$1"
    local album_title="$2"
    local album_year="$3"
    local track_count="$4"
    
    # Normalize metadata for comparison
    local normalized_artist=$(echo "$album_artist" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
    local normalized_title=$(echo "$album_title" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
    local year_part="${album_year:-0000}"
    
    # Create hash from normalized metadata
    echo "${normalized_artist}_${normalized_title}_${year_part}_${track_count}" | md5sum | cut -d' ' -f1
}

# Analyze album directory for duplicate detection
analyze_album_for_duplicates() {
    local album_dir="$1"
    local duplicates_db="$2"
    
    log $LOG_DEBUG "Analyzing album for duplicates: $album_dir"
    
    # Use existing album processing logic to get metadata
    local audio_files=()
    while IFS= read -r -d $'\0' file; do
        audio_files+=("$file")
    done < <(find "$album_dir" -maxdepth 1 -type f \( -iname "*.mp3" -o -iname "*.flac" -o -iname "*.m4a" -o -iname "*.aac" -o -iname "*.ogg" -o -iname "*.wav" -o -iname "*.aiff" -o -iname "*.alac" \) -print0)
    
    if [[ ${#audio_files[@]} -eq 0 ]]; then
        log $LOG_DEBUG "No audio files found in '$album_dir' for duplicate analysis"
        return 1
    fi
    
    # Extract metadata
    local exiftool_output
    exiftool_output=$(exiftool -json "${audio_files[@]}" 2>/dev/null)
    
    if [[ -z "$exiftool_output" ]]; then
        log $LOG_DEBUG "Could not extract metadata from '$album_dir' for duplicate analysis"
        return 1
    fi
    
    # Parse metadata
    local all_album_artists=$(echo "$exiftool_output" | jq -r '.[] | .AlbumArtist // empty')
    local all_artists=$(echo "$exiftool_output" | jq -r '.[] | .Artist // empty')
    local all_albums=$(echo "$exiftool_output" | jq -r '.[] | .Album // empty')
    local all_years=$(echo "$exiftool_output" | jq -r '.[].Year // empty')
    local all_file_types=$(echo "$exiftool_output" | jq -r '.[].FileTypeExtension // empty')
    local all_bitrates=$(echo "$exiftool_output" | jq -r '.[].AudioBitrate // empty' | grep -v '^$' | sed 's/ kbps$//')
    
    # Determine album metadata
    local album_artist=""
    if [[ $(echo "$all_album_artists" | sort -u | wc -l) -eq 1 && -n "$(echo "$all_album_artists" | head -n 1)" ]]; then
        album_artist=$(echo "$all_album_artists" | head -n 1)
    elif [[ $(echo "$all_artists" | sort -u | wc -l) -eq 1 && -n "$(echo "$all_artists" | head -n 1)" ]]; then
        album_artist=$(echo "$all_artists" | head -n 1)
    else
        album_artist="Various Artists"
    fi
    
    local album_title=$(echo "$all_albums" | sort | uniq -c | sort -nr | head -n 1 | awk '{$1=""; print $0}' | sed 's/^ *//')
    local album_year=$(echo "$all_years" | sort -n | head -n 1)
    local track_count=${#audio_files[@]}
    
    if [[ -z "$album_title" ]]; then
        log $LOG_DEBUG "Could not determine album title for '$album_dir'"
        return 1
    fi
    
    # Calculate quality metrics
    local has_lossless=0 has_lossy=0
    local bitrate_sum=0 bitrate_count=0
    local format_list=()
    local total_size=0
    
    for file_type in $all_file_types; do
        case "$file_type" in
            "FLAC"|"WAV"|"AIFF"|"ALAC") has_lossless=1; format_list+=("$file_type") ;;
            "MP3"|"AAC"|"M4A"|"OGG") has_lossy=1; format_list+=("$file_type") ;;
        esac
    done
    
    for bitrate in $all_bitrates; do
        if [[ "$bitrate" =~ ^[0-9]+$ ]]; then
            bitrate_sum=$((bitrate_sum + bitrate))
            bitrate_count=$((bitrate_count + 1))
        fi
    done
    
    for file in "${audio_files[@]}"; do
        local file_size=$(stat -c "%s" "$file" 2>/dev/null || echo "0")
        total_size=$((total_size + file_size))
    done
    
    local quality_type=""
    if [[ $has_lossless -eq 1 && $has_lossy -eq 1 ]]; then
        quality_type="Mixed"
    elif [[ $has_lossless -eq 1 ]]; then
        quality_type="Lossless"
    elif [[ $has_lossy -eq 1 ]]; then
        quality_type="Lossy"
    else
        quality_type="Unknown"
    fi
    
    local avg_bitrate=0
    if [[ $bitrate_count -gt 0 ]]; then
        avg_bitrate=$((bitrate_sum / bitrate_count))
    fi
    
    local format_mix=$(printf "%s," "${format_list[@]}" | sed 's/,$//')
    local album_hash=$(generate_album_hash "$album_artist" "$album_title" "$album_year" "$track_count")
    
    # Store in database
    sqlite3 "$duplicates_db" <<EOF
INSERT OR REPLACE INTO albums 
(directory_path, album_artist, album_title, album_year, track_count, total_size, quality_type, avg_bitrate, format_mix, album_hash) 
VALUES ("$album_dir", "$album_artist", "$album_title", ${album_year:-NULL}, $track_count, $total_size, "$quality_type", $avg_bitrate, "$format_mix", "$album_hash");
EOF
    
    log $LOG_DEBUG "Stored album analysis: $album_artist - $album_title ($album_year) [$quality_type, ${track_count} tracks]"
    return 0
}

# Find and group duplicate albums
find_duplicate_groups() {
    local duplicates_db="$1"
    
    log $LOG_INFO "Analyzing albums for duplicates..."
    
    # Clear existing duplicate groups for fresh analysis
    sqlite3 "$duplicates_db" "DELETE FROM group_members; DELETE FROM duplicate_groups;"
    
    # Find albums with the same hash (potential duplicates)
    local duplicate_hashes=$(sqlite3 "$duplicates_db" "SELECT album_hash FROM albums GROUP BY album_hash HAVING COUNT(*) > 1;")
    
    local group_count=0
    local total_duplicates=0
    
    for hash in $duplicate_hashes; do
        # Get all albums with this hash
        local albums=$(sqlite3 "$duplicates_db" "SELECT id, directory_path, album_artist, album_title, album_year, track_count, quality_type, avg_bitrate, total_size, format_mix FROM albums WHERE album_hash = '$hash';")
        
        if [[ -z "$albums" ]]; then
            continue
        fi
        
        local album_count=$(echo "$albums" | wc -l)
        if [[ $album_count -lt 2 ]]; then
            continue
        fi
        
        # Get representative metadata from first album
        local first_album=$(echo "$albums" | head -n 1)
        local album_artist=$(echo "$first_album" | cut -d'|' -f3)
        local album_title=$(echo "$first_album" | cut -d'|' -f4)
        local album_year=$(echo "$first_album" | cut -d'|' -f5)
        local track_count=$(echo "$first_album" | cut -d'|' -f6)
        
        # Create duplicate group
        sqlite3 "$duplicates_db" <<EOF
INSERT INTO duplicate_groups (group_hash, album_artist, album_title, album_year, track_count, duplicate_count)
VALUES ('$hash', '$album_artist', '$album_title', ${album_year:-NULL}, $track_count, $album_count);
EOF
        
        local group_id=$(sqlite3 "$duplicates_db" "SELECT last_insert_rowid();")
        local best_score=0
        local best_album_id=0
        
        # Process each album in the group
        while IFS='|' read -r album_id directory_path album_artist album_title album_year track_count quality_type avg_bitrate total_size format_mix; do
            local quality_score=$(calculate_quality_score "$quality_type" "$avg_bitrate" "$total_size" "$format_mix")
            local is_keeper=0
            
            if [[ $quality_score -gt $best_score ]]; then
                best_score=$quality_score
                best_album_id=$album_id
            fi
            
            # Add to group members
            sqlite3 "$duplicates_db" <<EOF
INSERT INTO group_members (group_id, album_id, quality_score, is_recommended_keeper)
VALUES ($group_id, $album_id, $quality_score, $is_keeper);
EOF
        done <<< "$albums"
        
        # Mark the best quality album as recommended keeper
        sqlite3 "$duplicates_db" "UPDATE group_members SET is_recommended_keeper = 1 WHERE group_id = $group_id AND album_id = $best_album_id;"
        sqlite3 "$duplicates_db" "UPDATE duplicate_groups SET best_quality_album_id = $best_album_id WHERE id = $group_id;"
        
        group_count=$((group_count + 1))
        total_duplicates=$((total_duplicates + album_count))
        
        log $LOG_INFO "Found duplicate group $group_count: $album_artist - $album_title ($album_count copies)"
    done
    
    log $LOG_INFO "Duplicate analysis complete: $group_count groups containing $total_duplicates albums"
    return 0
}

# Generate duplicate report
generate_duplicate_report() {
    local duplicates_db="$1"
    local report_file="$2"
    
    log $LOG_INFO "Generating duplicate report: $report_file"
    
    {
        echo "# Duplicate Albums Report"
        echo "Generated: $(date)"
        echo "Database: $duplicates_db"
        echo ""
        
        local total_groups=$(sqlite3 "$duplicates_db" "SELECT COUNT(*) FROM duplicate_groups;")
        local total_albums=$(sqlite3 "$duplicates_db" "SELECT SUM(duplicate_count) FROM duplicate_groups;")
        local total_size_mb=$(sqlite3 "$duplicates_db" "SELECT ROUND(SUM(a.total_size) / 1024.0 / 1024.0, 1) FROM albums a JOIN group_members gm ON a.id = gm.album_id WHERE gm.is_recommended_keeper = 0;")
        
        echo "## Summary"
        echo "- Duplicate Groups: $total_groups"
        echo "- Total Duplicate Albums: $total_albums"
        echo "- Potential Space Savings: ${total_size_mb} MB"
        echo ""
        
        echo "## Duplicate Groups"
        echo ""
        
        local groups=$(sqlite3 "$duplicates_db" "SELECT id, album_artist, album_title, album_year, duplicate_count FROM duplicate_groups ORDER BY duplicate_count DESC, album_artist, album_title;")
        
        local group_num=1
        while IFS='|' read -r group_id album_artist album_title album_year duplicate_count; do
            echo "### Group $group_num: $album_artist - $album_title${album_year:+ ($album_year)}"
            echo "**Copies found:** $duplicate_count"
            echo ""
            
            # List all albums in group with recommendations
            local members=$(sqlite3 "$duplicates_db" "SELECT a.directory_path, a.quality_type, a.avg_bitrate, ROUND(a.total_size / 1024.0 / 1024.0, 1), gm.quality_score, gm.is_recommended_keeper FROM albums a JOIN group_members gm ON a.id = gm.album_id WHERE gm.group_id = $group_id ORDER BY gm.quality_score DESC;")
            
            echo "| Path | Quality | Bitrate | Size (MB) | Score | Recommendation |"
            echo "|------|---------|---------|-----------|-------|----------------|"
            
            while IFS='|' read -r path quality_type avg_bitrate size_mb quality_score is_keeper; do
                local recommendation="Remove"
                if [[ "$is_keeper" == "1" ]]; then
                    recommendation="**KEEP**"
                fi
                local bitrate_display="${avg_bitrate:-N/A}"
                if [[ "$avg_bitrate" != "0" && -n "$avg_bitrate" ]]; then
                    bitrate_display="${avg_bitrate} kbps"
                fi
                echo "| \`$path\` | $quality_type | $bitrate_display | $size_mb | $quality_score | $recommendation |"
            done <<< "$members"
            
            echo ""
            group_num=$((group_num + 1))
        done <<< "$groups"
        
        echo "## Recommended Actions"
        echo ""
        echo "To automatically resolve duplicates (keep highest quality, remove others):"
        echo "\`\`\`bash"
        echo "./ordr.fm.sh --resolve-duplicates --duplicates-db \"$duplicates_db\""
        echo "\`\`\`"
        echo ""
        echo "**WARNING:** Always review this report before running automatic resolution!"
        
    } > "$report_file"
    
    log $LOG_INFO "Duplicate report generated: $report_file"
}

# Resolve duplicates by removing lower quality copies
resolve_duplicates() {
    local duplicates_db="$1"
    local backup_dir="$2"
    
    log $LOG_INFO "Resolving duplicates (removing lower quality copies)..."
    
    # Create backup directory
    mkdir -p "$backup_dir" || {
        log $LOG_ERROR "Could not create backup directory: $backup_dir"
        return 1
    }
    
    local groups_to_resolve=$(sqlite3 "$duplicates_db" "SELECT id FROM duplicate_groups WHERE resolution_status = 'pending';")
    local resolved_count=0
    local removed_count=0
    
    for group_id in $groups_to_resolve; do
        local group_info=$(sqlite3 "$duplicates_db" "SELECT album_artist, album_title FROM duplicate_groups WHERE id = $group_id;")
        local album_artist=$(echo "$group_info" | cut -d'|' -f1)
        local album_title=$(echo "$group_info" | cut -d'|' -f2)
        
        log $LOG_INFO "Resolving duplicates for: $album_artist - $album_title"
        
        # Get albums to remove (not the recommended keeper)
        local albums_to_remove=$(sqlite3 "$duplicates_db" "SELECT a.directory_path FROM albums a JOIN group_members gm ON a.id = gm.album_id WHERE gm.group_id = $group_id AND gm.is_recommended_keeper = 0;")
        
        local group_removed=0
        for album_path in $albums_to_remove; do
            if [[ -d "$album_path" ]]; then
                local backup_name="$(basename "$album_path")_$(date +%Y%m%d_%H%M%S)"
                local backup_path="$backup_dir/$backup_name"
                
                if [[ $DRY_RUN -eq 1 ]]; then
                    log $LOG_INFO "(Dry Run) Would move '$album_path' to '$backup_path'"
                else
                    log $LOG_INFO "Moving duplicate to backup: $album_path -> $backup_path"
                    mv "$album_path" "$backup_path"
                    if [[ $? -eq 0 ]]; then
                        group_removed=$((group_removed + 1))
                        removed_count=$((removed_count + 1))
                    else
                        log $LOG_ERROR "Failed to move '$album_path' to backup"
                    fi
                fi
            else
                log $LOG_WARNING "Album directory no longer exists: $album_path"
            fi
        done
        
        if [[ $group_removed -gt 0 || $DRY_RUN -eq 1 ]]; then
            sqlite3 "$duplicates_db" "UPDATE duplicate_groups SET resolution_status = 'resolved' WHERE id = $group_id;"
            resolved_count=$((resolved_count + 1))
        fi
    done
    
    log $LOG_INFO "Duplicate resolution complete: $resolved_count groups resolved, $removed_count albums moved to backup"
    return 0
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
            --find-duplicates)
                FIND_DUPLICATES=1
                shift
                ;;
            --resolve-duplicates)
                RESOLVE_DUPLICATES=1
                shift
                ;;
            --duplicates-db)
                DUPLICATES_DB="$2"
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
    echo "Duplicate Detection:"
    echo "  --find-duplicates       Find and report duplicate albums (analysis only)"
    echo "  --resolve-duplicates    Automatically resolve duplicates (remove lower quality)"
    echo "  --duplicates-db FILE    Path to duplicates database (default: ordr.fm.duplicates.db)"
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
    log $LOG_INFO "  Duplicate Detection: $([[ $FIND_DUPLICATES -eq 1 || $RESOLVE_DUPLICATES -eq 1 ]] && echo "Enabled" || echo "Disabled")"

    check_dependencies

    # Initialize state database for incremental processing
    if [[ $INCREMENTAL_MODE -eq 1 ]]; then
        if [[ -z "$STATE_DB" ]]; then
            STATE_DB="$(dirname "$LOG_FILE")/ordr.fm.state.db"
        fi
        log $LOG_INFO "  State Database: $STATE_DB"
        init_state_db "$STATE_DB"
    fi

    # Initialize duplicates database for duplicate detection
    if [[ $FIND_DUPLICATES -eq 1 || $RESOLVE_DUPLICATES -eq 1 ]]; then
        if [[ -z "$DUPLICATES_DB" ]]; then
            DUPLICATES_DB="$(dirname "$LOG_FILE")/ordr.fm.duplicates.db"
        fi
        log $LOG_INFO "  Duplicates Database: $DUPLICATES_DB"
        init_duplicates_db "$DUPLICATES_DB"
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
        
        # For duplicate detection mode, analyze album instead of processing
        if [[ $FIND_DUPLICATES -eq 1 || $RESOLVE_DUPLICATES -eq 1 ]]; then
            if analyze_album_for_duplicates "$album_dir" "$DUPLICATES_DB"; then
                ((processed_count++))
            else
                ((skipped_count++))
            fi
        else
            # Normal album processing
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
        fi
    done
    
    log $LOG_INFO "Processing complete. Processed: $processed_count, Skipped: $skipped_count"

    # Handle duplicate detection workflow
    if [[ $FIND_DUPLICATES -eq 1 || $RESOLVE_DUPLICATES -eq 1 ]]; then
        log $LOG_INFO "Starting duplicate detection analysis..."
        
        find_duplicate_groups "$DUPLICATES_DB"
        
        if [[ $FIND_DUPLICATES -eq 1 ]]; then
            local report_file="$(dirname "$LOG_FILE")/duplicate_report_$(date +%Y%m%d_%H%M%S).md"
            generate_duplicate_report "$DUPLICATES_DB" "$report_file"
            log $LOG_INFO "Duplicate detection complete. Report saved to: $report_file"
        fi
        
        if [[ $RESOLVE_DUPLICATES -eq 1 ]]; then
            local backup_dir="$(dirname "$LOG_FILE")/duplicate_backups_$(date +%Y%m%d_%H%M%S)"
            resolve_duplicates "$DUPLICATES_DB" "$backup_dir"
            log $LOG_INFO "Duplicate resolution complete. Removed albums backed up to: $backup_dir"
        fi
    fi

    log $LOG_INFO "--- ordr.fm Script Finished ---"
} 

# Execute main function
main "$@"
