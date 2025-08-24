#!/bin/bash
#
# ordr.fm - Intelligent Music Organization Tool (Modular Version)
# Organizes music collections based on metadata, quality, and customizable rules
#
# Usage: ./ordr.fm.modular.sh [options]
# Run with --help for detailed options

# Use more tolerant error handling for album processing
set -uo pipefail

# Script directory for module loading
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load all modules
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/fileops.sh"
source "$SCRIPT_DIR/lib/database.sh"
source "$SCRIPT_DIR/lib/organization.sh"
source "$SCRIPT_DIR/lib/metadata_extraction.sh"

# Check if Discogs module exists
if [[ -f "$SCRIPT_DIR/lib/discogs.sh" ]]; then
    source "$SCRIPT_DIR/lib/discogs.sh"
fi

# Check if metadata module exists
if [[ -f "$SCRIPT_DIR/lib/metadata.sh" ]]; then
    source "$SCRIPT_DIR/lib/metadata.sh"
fi

# Check if parallel processor exists
if [[ -f "$SCRIPT_DIR/lib/parallel_processor.sh" ]]; then
    source "$SCRIPT_DIR/lib/parallel_processor.sh"
fi

# Check if performance module exists
if [[ -f "$SCRIPT_DIR/lib/performance.sh" ]]; then
    source "$SCRIPT_DIR/lib/performance.sh"
fi

# Check if resource monitor exists
if [[ -f "$SCRIPT_DIR/lib/resource_monitor.sh" ]]; then
    source "$SCRIPT_DIR/lib/resource_monitor.sh"
fi

# Check if cleanup module exists
if [[ -f "$SCRIPT_DIR/lib/cleanup.sh" ]]; then
    source "$SCRIPT_DIR/lib/cleanup.sh"
fi

# Note: Hybrid reconstruction is now implemented directly in main processing pipeline

# Load environment variables from .env file if it exists
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
    set -a  # Automatically export all variables
    source "${SCRIPT_DIR}/.env"
    set +a  # Stop auto-exporting
fi

# Global variables with defaults
VERSION="2.5.0"
DATE_NOW=$(date +%Y%m%d_%H%M%S)

# Core settings
SOURCE_DIR="."
DEST_DIR=""
UNSORTED_BASE_DIR=""
LOG_FILE="ordr.fm.log"
CONFIG_FILE=""
DRY_RUN=1
VERBOSITY=$LOG_INFO
INCREMENTAL=0
DUPLICATE_DETECTION=0

# Database paths
STATE_DB="ordr.fm.state.db"
METADATA_DB="ordr.fm.metadata.db"
DUPLICATES_DB="ordr.fm.duplicates.db"

# Electronic music organization
ENABLE_ELECTRONIC_ORGANIZATION=0
ORGANIZATION_MODE="artist"
SEPARATE_REMIXES=0
VINYL_SIDE_MARKERS=0

# Parallel processing
ENABLE_PARALLEL=0
PARALLEL_JOBS=0  # 0 = auto-detect

# Cleanup options
CLEANUP_EMPTY_DIRS=0
CLEANUP_ARTIFACTS=0

# Check dependencies
check_dependencies() {
    local required_tools=("exiftool" "jq")
    local missing_tools=()
    
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    # Optional tools
    local optional_tools=("sqlite3" "rsync" "bc")
    for tool in "${optional_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            log $LOG_WARNING "Optional tool not found: $tool (some features may be limited)"
        fi
    done
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log $LOG_ERROR "Missing required tools: ${missing_tools[*]}"
        log $LOG_ERROR "Please install: sudo apt-get install ${missing_tools[*]}"
        return 1
    fi
    
    log $LOG_INFO "All required dependencies are installed."
    return 0
}

# Load configuration file
load_config() {
    local config_file="${1:-ordr.fm.conf}"
    
    if [[ -f "$config_file" ]]; then
        log $LOG_INFO "Loading configuration from: $config_file"
        # Save and restore script state to prevent config from affecting execution
        local old_opts=$-
        set +e
        source "$config_file"
        set -$old_opts
        return 0
    else
        log $LOG_WARNING "Configuration file not found: $config_file"
        return 1
    fi
}

# Process album directory
process_album_directory() {
    local album_dir="$1"
    
    # Input validation
    if [[ -z "$album_dir" ]]; then
        log $LOG_ERROR "No album directory specified"
        return 1
    fi
    
    if [[ ! -d "$album_dir" ]]; then
        log $LOG_ERROR "Album directory does not exist: $album_dir"
        return 1
    fi
    
    # Check for read permissions
    if [[ ! -r "$album_dir" ]]; then
        log $LOG_ERROR "No read permission for album directory: $album_dir"
        return 1
    fi
    
    log $LOG_INFO "Processing album directory: $album_dir"
    
    # Check incremental mode
    if [[ $INCREMENTAL -eq 1 ]] && ! directory_needs_processing "$album_dir"; then
        log $LOG_INFO "Skipping already processed directory: $album_dir"
        return 0
    fi
    
    # Extract metadata with timeout protection
    local exiftool_output=""
    local metadata_timeout=120  # 2 minutes for metadata extraction
    
    if command -v timeout >/dev/null 2>&1; then
        exiftool_output=$(timeout ${metadata_timeout}s bash -c "extract_album_metadata '$album_dir'" 2>/dev/null || echo "[]")
    else
        exiftool_output=$(extract_album_metadata "$album_dir" 2>/dev/null || echo "[]")
    fi
    
    log $LOG_DEBUG "Raw exiftool output length: ${#exiftool_output} characters"
    log $LOG_DEBUG "First 1000 characters of exiftool output: ${exiftool_output:0:1000}"
    
    if [[ "$exiftool_output" == "[]" ]] || [[ -z "$exiftool_output" ]]; then
        # Try to extract metadata from NFO files as fallback
        local nfo_metadata=$(extract_nfo_metadata "$album_dir")
        if [[ $? -eq 0 ]] && [[ -n "$nfo_metadata" ]]; then
            log $LOG_INFO "Using NFO metadata for: $album_dir"
            # Convert NFO metadata to exiftool JSON format for processing
            local nfo_artist=$(echo "$nfo_metadata" | cut -d'|' -f1 | sed 's/NFO://')
            local nfo_title=$(echo "$nfo_metadata" | cut -d'|' -f2)
            local nfo_year=$(echo "$nfo_metadata" | cut -d'|' -f3)
            local nfo_genre=$(echo "$nfo_metadata" | cut -d'|' -f4)
            
            # Escape JSON strings properly
            local escaped_artist=$(escape_json_string "$nfo_artist")
            local escaped_title=$(escape_json_string "$nfo_title")
            local escaped_year=$(escape_json_string "$nfo_year")
            local escaped_genre=$(escape_json_string "$nfo_genre")
            
            # Create minimal JSON for NFO metadata
            exiftool_output="[{\"Artist\":\"$escaped_artist\",\"Album\":\"$escaped_title\",\"Year\":\"$escaped_year\",\"Genre\":\"$escaped_genre\",\"FileType\":\"NFO\"}]"
        else
            log $LOG_WARNING "No audio files or NFO metadata found in: $album_dir"
            if [[ ${SKIP_PROBLEMATIC_ALBUMS:-1} -eq 1 ]]; then
                skip_problematic_album "$album_dir" "no audio files or metadata"
            else
                move_to_unsorted "$album_dir" "no audio files or metadata"
            fi
            return 1
        fi
    fi
    
    # Determine album quality
    local quality=$(determine_album_quality "$exiftool_output")
    log $LOG_DEBUG "Determined Album Quality: $quality"
    
    # Debug: Check formats found
    local formats=$(echo "$exiftool_output" | jq -r '.[].FileType' 2>/dev/null | sort -u | tr '\n' ',' | sed 's/,$//')
    log $LOG_DEBUG "File formats detected: $formats"
    
    # Extract album information
    local album_info=$(extract_album_info "$exiftool_output" "$album_dir")
    log $LOG_DEBUG "Album info string: $album_info"
    
    local album_artist=$(echo "$album_info" | cut -d'|' -f1)
    local album_title=$(echo "$album_info" | cut -d'|' -f2)
    local album_year=$(echo "$album_info" | cut -d'|' -f3)
    local label=$(echo "$album_info" | cut -d'|' -f4)
    local catalog=$(echo "$album_info" | cut -d'|' -f5)
    local genre=$(echo "$album_info" | cut -d'|' -f6)
    local track_count=$(echo "$album_info" | cut -d'|' -f7)
    local total_size=$(echo "$album_info" | cut -d'|' -f8)
    local avg_bitrate=$(echo "$album_info" | cut -d'|' -f9)
    
    # Extract catalog number from directory name if not found in metadata
    if [[ -z "$catalog" ]]; then
        local dir_name=$(basename "$album_dir")
        # Look for catalog patterns like (HEK016ii), [SEPTICLP04], (kling020cd2), etc.
        # Extract catalog codes that contain letters and numbers, but prioritize shorter alphanumeric codes
        # and avoid common format indicators like [FLAC], [WEB], [MP3]
        # Extract catalog patterns - including spaces for codes like "lds 001"
        local all_catalogs=$(echo "$dir_name" | grep -oE '\[[A-Za-z0-9][A-Za-z0-9_% -]*\]|\([A-Za-z0-9][A-Za-z0-9_% -]*\)' | sed 's/[][]//g;s/[()]//g')
        local dir_catalog=""
        if [[ -n "$all_catalogs" ]]; then
            # Process each catalog candidate and take the first valid one
            while IFS= read -r catalog_candidate; do
                [[ -z "$catalog_candidate" ]] && continue
                # Skip common format/quality indicators and patterns containing them
                # Also skip "part X" patterns which are part of titles, not catalogs
                # Also skip remix/feature/version indicators
                if [[ ! "$catalog_candidate" =~ ^(FLAC|WEB|MP3|CD|WAV|VINYL|DIGITAL|Web|Disk|[0-9]{4}|part[[:space:]]+[0-9]+|Part[[:space:]]+[0-9]+|PART[[:space:]]+[0-9]+)$ ]] && \
                   [[ ! "$catalog_candidate" =~ (FLAC|WEB|MP3|WAV|VINYL|Web|Disk|^part[[:space:]]+|^Part[[:space:]]+|^PART[[:space:]]+) ]] && \
                   [[ ! "$catalog_candidate" =~ (remix|Remix|REMIX|mix|Mix|MIX|edit|Edit|EDIT|version|Version|VERSION|instrumental|Instrumental|INSTRUMENTAL|vocal|Vocal|VOCAL|inch|Inch|INCH|vinyl|Vinyl|VINYL|radio|Radio|RADIO|club|Club|CLUB|dub|Dub|DUB|extended|Extended|EXTENDED|original|Original|ORIGINAL|remaster|Remaster|REMASTER) ]]; then
                    dir_catalog="$catalog_candidate"
                    break
                fi
            done <<< "$all_catalogs"
        fi
        if [[ -n "$dir_catalog" ]]; then
            catalog="$dir_catalog"
            log $LOG_DEBUG "Extracted catalog from directory name: $catalog"
        fi
    fi
    
    # Clean catalog references from album title if they match extracted catalog
    if [[ -n "$catalog" ]] && [[ -n "$album_title" ]]; then
        # Check if title contains the catalog number in brackets
        local catalog_pattern="\[${catalog}\]"
        local catalog_pattern_case_insensitive=$(echo "$catalog" | tr '[:lower:]' '[:upper:]')
        local title_contains_catalog=""
        
        # Check for exact match or case-insensitive match
        if echo "$album_title" | grep -qE "\[${catalog}\]" || echo "$album_title" | grep -qiE "\[${catalog_pattern_case_insensitive}\]"; then
            title_contains_catalog="yes"
        fi
        
        if [[ "$title_contains_catalog" == "yes" ]]; then
            local cleaned_title=$(echo "$album_title" | sed -E "s/[[:space:]]*\[${catalog}\][[:space:]]*//i" | sed -E "s/[[:space:]]*\[${catalog_pattern_case_insensitive}\][[:space:]]*//i" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            # Only apply cleaning if result is still meaningful (more than 3 chars and contains spaces/letters)
            if [[ -n "$cleaned_title" ]] && [[ ${#cleaned_title} -gt 3 ]] && [[ "$cleaned_title" =~ [[:space:]] || "$cleaned_title" =~ [a-zA-Z]{4,} ]]; then
                log $LOG_DEBUG "Cleaned catalog reference from title: '$album_title' -> '$cleaned_title'"
                album_title="$cleaned_title"
            else
                log $LOG_DEBUG "Skipped catalog cleaning - result would be too short or meaningless: '$cleaned_title'"
            fi
        fi
    fi
    
    # Check if album title looks like a catalog number and try directory inference
    if [[ -n "$album_title" ]] && echo "$album_title" | grep -qE '^[A-Z]{2,6}[0-9]{2,6}$|^[A-Z]{2,4}[-_]?[0-9]{2,4}$'; then
        log $LOG_DEBUG "Album title '$album_title' appears to be a catalog number, trying directory inference"
        local catalog_like_title="$album_title"  # Save the original catalog-like title
        local dir_inferred_metadata=$(infer_metadata_from_dirname "$(basename "$album_dir")")
        if [[ -n "$dir_inferred_metadata" ]]; then
            local dir_inferred_title=$(echo "$dir_inferred_metadata" | cut -d'|' -f2)
            if [[ -n "$dir_inferred_title" ]] && [[ "$dir_inferred_title" != "$album_title" ]]; then
                log $LOG_DEBUG "Using directory-inferred title '$dir_inferred_title' instead of catalog-like title '$album_title'"
                album_title="$dir_inferred_title"
                # Also use the catalog-like original title as catalog if we don't have one
                if [[ -z "$catalog" ]]; then
                    catalog="$catalog_like_title"
                    log $LOG_DEBUG "Using original catalog-like title as catalog: $catalog"
                fi
            fi
        fi
    fi
    
    log $LOG_DEBUG "Album Artist: $album_artist, Title: $album_title, Year: $album_year"
    
    # Try to infer metadata from directory name if missing
    if [[ -z "$album_artist" ]] || [[ -z "$album_title" ]]; then
        log $LOG_DEBUG "Attempting to infer metadata from directory name: $(basename "$album_dir")"
        local inferred_metadata=$(infer_metadata_from_dirname "$(basename "$album_dir")")
        if [[ -n "$inferred_metadata" ]]; then
            local inferred_artist=$(echo "$inferred_metadata" | cut -d'|' -f1)
            local inferred_title=$(echo "$inferred_metadata" | cut -d'|' -f2)
            local inferred_year=$(echo "$inferred_metadata" | cut -d'|' -f3)
            
            [[ -z "$album_artist" && -n "$inferred_artist" ]] && album_artist="$inferred_artist"
            [[ -z "$album_title" && -n "$inferred_title" ]] && album_title="$inferred_title"
            [[ -z "$album_year" && -n "$inferred_year" ]] && album_year="$inferred_year"
            
            log $LOG_INFO "Inferred metadata - Artist: '$album_artist', Title: '$album_title', Year: '$album_year'"
            
            # Try to enrich inferred metadata with Discogs if enabled
            if [[ "$DISCOGS_ENABLED" == "1" ]] && [[ -n "$album_artist" ]] && [[ -n "$album_title" ]] && command -v discogs_search_releases &>/dev/null; then
                log $LOG_DEBUG "Attempting to enrich inferred metadata with Discogs"
                local discogs_data=$(discogs_search_releases "$album_artist" "$album_title" "$album_year")
                if [[ -n "$discogs_data" ]]; then
                    # Update metadata with Discogs data
                    local discogs_label=$(echo "$discogs_data" | jq -r '.label // empty' 2>/dev/null)
                    local discogs_catalog=$(echo "$discogs_data" | jq -r '.catalog_number // empty' 2>/dev/null)
                    local discogs_year=$(echo "$discogs_data" | jq -r '.year // empty' 2>/dev/null)
                    
                    [[ -n "$discogs_label" && -z "$label" ]] && label="$discogs_label"
                    [[ -n "$discogs_catalog" && -z "$catalog" ]] && catalog="$discogs_catalog"
                    [[ -n "$discogs_year" && -z "$album_year" ]] && album_year="$discogs_year"
                    
                    log $LOG_INFO "Enhanced with Discogs - Label: '$label', Catalog: '$catalog', Year: '$album_year'"
                fi
            fi
        fi
    fi
    
    # Validate required metadata after inference attempt
    if [[ -z "$album_artist" ]] || [[ -z "$album_title" ]]; then
        log $LOG_WARNING "Missing essential metadata for: $album_dir"
        
        # Try simple hybrid metadata reconstruction as last resort
        log $LOG_INFO "Attempting hybrid metadata reconstruction..."
        local dirname=$(basename "$album_dir")
        
        # Enhanced pattern matching for scene releases and electronic music
        local recon_artist="" recon_title="" recon_year=""
        
        # Pattern 1: Scene release - artist-title-catalog-year-group
        if [[ "$dirname" =~ ^([a-z_]+).*-([a-z_]+.*)-([a-z0-9]+)-([0-9]{4})-[a-z]+$ ]]; then
            recon_artist="${BASH_REMATCH[1]}"
            recon_title="${BASH_REMATCH[2]}"
            recon_year="${BASH_REMATCH[4]}"
            
            # Convert underscores to spaces and clean
            recon_artist=$(echo "$recon_artist" | tr '_' ' ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            recon_title=$(echo "$recon_title" | tr '_' ' ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            
            log $LOG_DEBUG "Scene release pattern matched: '$recon_artist' - '$recon_title' ($recon_year)"
            
        # Pattern 2: [CATALOG] Artist - Title (Year)
        elif [[ "$dirname" =~ ^\[([A-Z0-9]+)\][[:space:]]*([^-]+)[[:space:]]*-[[:space:]]*([^()]*)\(([0-9]{4})\)$ ]]; then
            recon_artist="${BASH_REMATCH[2]}"
            recon_title="${BASH_REMATCH[3]}"
            recon_year="${BASH_REMATCH[4]}"
            
            recon_artist=$(echo "$recon_artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            recon_title=$(echo "$recon_title" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            
            log $LOG_DEBUG "Catalog pattern matched: '$recon_artist' - '$recon_title' ($recon_year)"
            
        # Pattern 3: Artist - Title (Year) [Label]
        elif [[ "$dirname" =~ ^([^-]+)[[:space:]]*-[[:space:]]*([^()]*)\(([0-9]{4})\)[[:space:]]*\[(.+)\]$ ]]; then
            recon_artist="${BASH_REMATCH[1]}"
            recon_title="${BASH_REMATCH[2]}"
            recon_year="${BASH_REMATCH[3]}"
            
            recon_artist=$(echo "$recon_artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            recon_title=$(echo "$recon_title" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            
            log $LOG_DEBUG "Standard pattern matched: '$recon_artist' - '$recon_title' ($recon_year)"
            
        # Pattern 4: (Year) Title
        elif [[ "$dirname" =~ ^\(([0-9]{4})\)[[:space:]]*(.+) ]]; then
            recon_year="${BASH_REMATCH[1]}"
            recon_title="${BASH_REMATCH[2]}"
            
            # Clean title
            recon_title=$(echo "$recon_title" | sed -E 's/[[:space:]]*\[[^\]]*\]//g' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            
            log $LOG_DEBUG "Year prefix pattern matched: '$recon_title' ($recon_year)"
        fi
        
        # Fill gaps with reconstructed data
        [[ -z "$album_artist" && -n "$recon_artist" ]] && album_artist="$recon_artist"
        [[ -z "$album_title" && -n "$recon_title" ]] && album_title="$recon_title"
        [[ -z "$album_year" && -n "$recon_year" ]] && album_year="$recon_year"
        
        # Calculate confidence score
        local confidence=50
        [[ -n "$album_artist" ]] && confidence=$((confidence + 30))
        [[ -n "$album_title" ]] && confidence=$((confidence + 20))
        [[ -n "$album_year" ]] && confidence=$((confidence + 10))
        
        # Check if reconstruction was successful - be more lenient
        # Accept if we have artist and either title OR if directory name can be used as title
        if [[ $confidence -ge 70 ]] && [[ -n "$album_artist" ]]; then
            # If no title, use the directory name itself as title
            if [[ -z "$album_title" ]]; then
                album_title=$(basename "$album_dir")
                log $LOG_DEBUG "Using directory name as title: '$album_title'"
            fi
            log $LOG_INFO "Hybrid reconstruction successful (confidence: $confidence/100): '$album_artist' - '$album_title' ($([ -n "$album_year" ] && echo "$album_year" || echo "no year"))"
        else
            log $LOG_WARNING "Hybrid reconstruction failed - insufficient metadata (confidence: $confidence/100)"
            if [[ ${SKIP_PROBLEMATIC_ALBUMS:-1} -eq 1 ]]; then
                skip_problematic_album "$album_dir" "reconstruction failed"
            else
                move_to_unsorted "$album_dir" "reconstruction failed"
            fi
            return 1
        fi
    fi
    
    # Resolve artist aliases
    local resolved_artist=$(resolve_artist_alias "$album_artist")
    if [[ "$resolved_artist" != "$album_artist" ]]; then
        log $LOG_INFO "Resolved artist alias: '$album_artist' -> '$resolved_artist'"
        # Safeguard: Don't use empty resolved artist
        if [[ -n "$resolved_artist" ]]; then
            album_artist="$resolved_artist"
        else
            log $LOG_WARNING "resolve_artist_alias returned empty string for '$album_artist', keeping original"
        fi
    fi
    
    # Enrich with Discogs if enabled
    if [[ "$DISCOGS_ENABLED" == "1" ]] && command -v discogs_search_releases &>/dev/null; then
        log $LOG_DEBUG "Attempting to enrich metadata with Discogs"
        local discogs_data=$(discogs_search_releases "$album_artist" "$album_title" "$album_year")
        if [[ -n "$discogs_data" ]]; then
            # Update metadata with Discogs data
            local discogs_label=$(echo "$discogs_data" | jq -r '.label // empty' 2>/dev/null)
            local discogs_catalog=$(echo "$discogs_data" | jq -r '.catalog_number // empty' 2>/dev/null)
            [[ -n "$discogs_label" ]] && label="$discogs_label"
            [[ -n "$discogs_catalog" ]] && catalog="$discogs_catalog"
        fi
    fi
    
    # Determine organization mode
    local is_va=0
    is_compilation "$album_artist" && is_va=1
    
    local album_data="${album_artist}|${album_title}|${label}|${catalog}|${album_year}|${is_va}"
    local org_mode=$(determine_organization_mode "$album_data")
    
    # Build destination path
    local dest_path=$(build_organization_path "$org_mode" "$album_data" "$quality" "$album_dir")
    local full_dest_path="${DEST_DIR}/${dest_path}"
    
    # Sanitize path components but preserve directory structure
    full_dest_path=$(echo "$full_dest_path" | sed 's|//*|/|g')
    
    # Check if destination already exists (duplicate album detection)
    if [[ -d "$full_dest_path" ]]; then
        log $LOG_WARNING "Skipping duplicate album - destination already exists: $full_dest_path"
        log $LOG_INFO "Source: $album_dir"
        return 0
    fi
    
    log $LOG_INFO "Proposed new album path for '$album_dir': $full_dest_path"
    
    # Perform move or log dry run
    if [[ $DRY_RUN -eq 1 ]]; then
        log $LOG_INFO "(Dry Run) Would move album directory '$album_dir' to '$full_dest_path'"
    else
        # Create move operation
        local operation_id="move_${SECONDS}_$$"
        # Construct album metadata for file renaming
        local album_metadata="${album_artist}|${album_title}|${label:-}|${catalog:-}|${album_year:-}"
        perform_album_move "$album_dir" "$full_dest_path" "$exiftool_output" "$operation_id" "$album_metadata"
        
        # Track in metadata database
        local db_album_data="${album_dir}|${album_artist}|${album_title}|${album_year}|${track_count}|${total_size}|${quality}|${org_mode}|${full_dest_path}"
        track_album_metadata "$db_album_data"
        
        # Record processing
        record_directory_processing "$album_dir" "SUCCESS"
    fi
    
    return 0
}

# Perform album move with all files
perform_album_move() {
    local source_dir="$1"
    local dest_dir="$2"
    local exiftool_output="$3"
    local operation_id="$4"
    local album_metadata="$5"  # Optional: pipe-delimited album metadata for file renaming
    
    log $LOG_INFO "Starting atomic move operation: $operation_id"
    log $LOG_DEBUG "Source: $source_dir"
    log $LOG_DEBUG "Destination: $dest_dir"
    
    # Create parent directory
    local parent_dir=$(dirname "$dest_dir")
    if ! create_directory_safe "$parent_dir"; then
        log $LOG_ERROR "Failed to create parent directory: $parent_dir"
        return 1
    fi
    
    # Record move operation
    create_move_operation "$operation_id" "$source_dir" "$dest_dir"
    
    # Perform atomic directory move with optional file renaming
    log $LOG_INFO "Moving album files..."
    local enable_renaming="${ENABLE_FILE_RENAMING:-0}"
    if [[ "$enable_renaming" == "1" ]] && [[ -n "$album_metadata" ]]; then
        log $LOG_DEBUG "Using atomic move with file renaming"
        if perform_atomic_directory_move_with_renaming "$source_dir" "$dest_dir" "$operation_id" "$album_metadata" "$exiftool_output" "$enable_renaming"; then
            # Update move record as successful
            update_move_operation_status "$operation_id" "SUCCESS"
            log $LOG_INFO "Album move with file renaming completed successfully: $operation_id"
            
            # Clean up empty parent directory if it exists
            local parent_dir=$(dirname "$album_dir")
            if [[ -d "$parent_dir" ]] && [[ "$parent_dir" != "$SOURCE_DIR" ]]; then
                # Check if parent directory is now empty
                if [[ -z "$(ls -A "$parent_dir" 2>/dev/null)" ]]; then
                    rmdir "$parent_dir" 2>/dev/null && \
                        log $LOG_DEBUG "Removed empty parent directory: $parent_dir"
                fi
            fi
            
            return 0
        else
            log $LOG_ERROR "Directory move with file renaming failed"
            update_move_operation_status "$operation_id" "FAILED" "Directory move with file renaming failed"
            return 1
        fi
    else
        log $LOG_DEBUG "Using standard atomic move (file renaming disabled or no metadata)"
        if perform_atomic_directory_move "$source_dir" "$dest_dir" "$operation_id"; then
            # Update move record as successful
            update_move_operation_status "$operation_id" "SUCCESS"
            log $LOG_INFO "Album move completed successfully: $operation_id"
            return 0
        else
            log $LOG_ERROR "Directory move failed"
            update_move_operation_status "$operation_id" "FAILED" "Directory move failed"
            return 1
        fi
    fi
}

# Find album directories
find_album_directories() {
    local search_dir="$1"
    local output_file="$2"
    local albums=()
    
    log $LOG_INFO "Scanning for album directories in $search_dir..."
    
    # First, scan for subdirectories containing audio files
    local subdirs_found=0
    while IFS= read -r -d '' dir; do
        if directory_has_audio_files "$dir"; then
            albums+=("$dir")
            ((subdirs_found++))
        fi
    done < <(find "$search_dir" -mindepth 1 -maxdepth 3 \( -type d -o -type l \) -print0 2>/dev/null)
    
    # Only treat source directory as an album if no subdirectories with audio files were found
    if [[ $subdirs_found -eq 0 ]] && directory_has_audio_files "$search_dir"; then
        local audio_count=$(count_audio_files "$search_dir")
        log $LOG_INFO "No album subdirectories found. Source directory itself appears to be an album with $audio_count audio files"
        albums+=("$search_dir")
    elif [[ $subdirs_found -gt 0 ]]; then
        log $LOG_INFO "Found $subdirs_found album subdirectories, ignoring loose files in root directory"
    fi
    
    # Write results to temp file (one per line)
    if [[ ${#albums[@]} -gt 0 ]]; then
        printf '%s\n' "${albums[@]}" > "$output_file"
    else
        # Create empty file if no albums found
        > "$output_file"
    fi
    
    # Return count for logging
    echo ${#albums[@]}
}

# Display usage
usage() {
    cat << EOF
ordr.fm v${VERSION} - Intelligent Music Organization Tool (Modular Version)

USAGE:
    $0 [OPTIONS]

OPTIONS:
    -s, --source DIR          Source directory (default: current directory)
    -d, --destination DIR     Destination directory (required unless dry-run)
    -c, --config FILE         Configuration file (default: ordr.fm.conf)
    -u, --unsorted DIR        Base directory for unsorted albums
    
    --move                    Actually move files (default: dry-run)
    --dry-run                 Preview changes without moving files (default)
    
    -v, --verbose             Enable verbose logging
    -q, --quiet               Reduce logging verbosity
    --log-file FILE           Log file path (default: ordr.fm.log)
    
    --incremental             Skip already processed directories
    --duplicates              Enable duplicate detection
    
    --enable-electronic       Enable electronic music organization features
    --discogs                 Enable Discogs metadata enrichment
    --organization-mode MODE  Organization mode: artist, label, series, hybrid
    
    --parallel [JOBS]         Enable parallel processing (optional job count)
    
    --cleanup-empty           Remove empty source directories after processing
    --cleanup-preview         Preview empty directories without removing
    --cleanup-artifacts       Remove system artifacts (Thumbs.db, .DS_Store)
    --preserve-structure      Keep top-level structure when cleaning
    
    -h, --help                Display this help message
    -V, --version             Display version information

EXAMPLES:
    # Dry run with default settings
    $0 --source ~/Music/Incoming --destination ~/Music/Organized

    # Actual move with electronic features
    $0 --move --enable-electronic --discogs --source ~/Music/Incoming

    # Incremental processing with custom config
    $0 --incremental --config my-music.conf --move

EOF
}

# Parse command line arguments
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -s|--source)
                SOURCE_DIR="$2"
                shift 2
                ;;
            -d|--destination)
                DEST_DIR="$2"
                shift 2
                ;;
            -c|--config)
                CONFIG_FILE="$2"
                shift 2
                ;;
            -u|--unsorted)
                UNSORTED_BASE_DIR="$2"
                shift 2
                ;;
            --move)
                DRY_RUN=0
                shift
                ;;
            --dry-run)
                DRY_RUN=1
                shift
                ;;
            -v|--verbose)
                VERBOSITY=$LOG_DEBUG
                shift
                ;;
            -q|--quiet)
                VERBOSITY=$LOG_ERROR
                shift
                ;;
            --log-file)
                LOG_FILE="$2"
                shift 2
                ;;
            --incremental)
                INCREMENTAL=1
                shift
                ;;
            --duplicates)
                DUPLICATE_DETECTION=1
                shift
                ;;
            --enable-electronic)
                ENABLE_ELECTRONIC_ORGANIZATION=1
                shift
                ;;
            --discogs)
                DISCOGS_ENABLED=1
                shift
                ;;
            --organization-mode)
                ORGANIZATION_MODE="$2"
                shift 2
                ;;
            --parallel)
                ENABLE_PARALLEL=1
                if [[ -n "$2" ]] && [[ "$2" =~ ^[0-9]+$ ]]; then
                    PARALLEL_JOBS="$2"
                    shift 2
                else
                    shift
                fi
                ;;
            --cleanup-empty)
                CLEANUP_EMPTY_DIRS=1
                shift
                ;;
            --cleanup-preview)
                CLEANUP_EMPTY_DIRS=1
                CLEANUP_DRY_RUN=1
                shift
                ;;
            --cleanup-artifacts)
                CLEANUP_ARTIFACTS=1
                shift
                ;;
            --preserve-structure)
                CLEANUP_PRESERVE_STRUCTURE=1
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            -V|--version)
                echo "ordr.fm version $VERSION"
                exit 0
                ;;
            *)
                log $LOG_ERROR "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
}

# Main function
main() {
    # Save command-line values
    local cmd_source_dir=""
    local cmd_dest_dir=""
    local cmd_unsorted_dir=""
    local cmd_dry_run=""
    
    # First pass: just get config file
    for ((i=1; i<=$#; i++)); do
        if [[ "${!i}" == "-c" ]] || [[ "${!i}" == "--config" ]]; then
            ((i++))
            CONFIG_FILE="${!i}"
        fi
    done
    
    # Load configuration
    if [[ -n "$CONFIG_FILE" ]]; then
        load_config "$CONFIG_FILE" || true
    else
        load_config "ordr.fm.conf" || true
    fi
    
    # Parse arguments to override config values
    parse_arguments "$@"
    
    # Set defaults if not configured
    DEST_DIR="${DEST_DIR:-${SOURCE_DIR}/sorted_music}"
    # Default unsorted directory should be in destination, not source
    UNSORTED_BASE_DIR="${UNSORTED_BASE_DIR:-${DEST_DIR}/unsorted}"
    
    # Setup signal handlers
    setup_signal_handlers
    
    # Acquire lock
    if ! acquire_lock; then
        log $LOG_ERROR "Another instance is already running"
        exit 1
    fi
    
    # Print configuration
    log $LOG_INFO "--- ordr.fm Script Started ---"
    log $LOG_INFO "Configuration:"
    log $LOG_INFO "  Source Directory: $SOURCE_DIR"
    log $LOG_INFO "  Destination Directory: $DEST_DIR"
    log $LOG_INFO "  Unsorted Directory Base: $UNSORTED_BASE_DIR"
    log $LOG_INFO "  Log File: $LOG_FILE"
    log $LOG_INFO "  Verbosity: $(get_log_level_name $VERBOSITY)"
    log $LOG_INFO "  Mode: $([ $DRY_RUN -eq 1 ] && echo "Dry Run" || echo "Live Run")"
    log $LOG_INFO "  Incremental Mode: $([ $INCREMENTAL -eq 1 ] && echo "Enabled" || echo "Disabled")"
    log $LOG_INFO "  Duplicate Detection: $([ $DUPLICATE_DETECTION -eq 1 ] && echo "Enabled" || echo "Disabled")"
    
    # Check dependencies
    if ! check_dependencies; then
        exit_with_code 1 "Missing required dependencies"
    fi
    
    # Initialize databases (needed for all modes including dry-run)
    init_state_db
    init_metadata_db
    
    if [[ $DUPLICATE_DETECTION -eq 1 ]]; then
        init_duplicates_db
    fi
    
    # Initialize Discogs if enabled  
    if [[ "$DISCOGS_ENABLED" == "1" ]] && command -v init_discogs &>/dev/null; then
        # Allow Discogs for dry runs if we have authentication configured
        if [[ $DRY_RUN -eq 1 ]] && [[ -z "$DISCOGS_USER_TOKEN" ]]; then
            log $LOG_INFO "  Discogs Integration: Disabled for dry run (no authentication configured)"
            DISCOGS_ENABLED=0
        else
            log $LOG_INFO "  Discogs Integration: Enabled"
            init_discogs
        fi
    fi
    
    # Create unsorted directory (simple, no timestamp)
    if [[ $DRY_RUN -eq 0 ]]; then
        local unsorted_dir="${UNSORTED_BASE_DIR}"
        if create_directory_safe "$unsorted_dir"; then
            log $LOG_DEBUG "Unsorted directory ready: $unsorted_dir"
        fi
    else
        log $LOG_INFO "(Dry Run) Would create unsorted directory: ${UNSORTED_BASE_DIR}"
    fi
    
    # Create temp file for album list
    local album_list_file=$(mktemp /tmp/ordr.fm.albums.XXXXXX)
    trap "rm -f $album_list_file" EXIT
    
    # Find and process album directories
    local album_count=$(find_album_directories "$SOURCE_DIR" "$album_list_file")
    
    # Read album directories from temp file
    local album_dirs=()
    if [[ -f "$album_list_file" ]] && [[ -s "$album_list_file" ]]; then
        mapfile -t album_dirs < "$album_list_file"
    fi
    
    local total_albums=${#album_dirs[@]}
    local processed=0
    local skipped=0
    
    log $LOG_INFO "Found $total_albums potential album directories. Processing..."
    
    # Force sequential processing to ensure reliable metadata extraction
    log $LOG_INFO "Using sequential processing for reliable metadata extraction"
    
    # Sequential processing
    for album_dir in "${album_dirs[@]}"; do
        if process_album_directory "$album_dir"; then
            ((processed++))
        else
            ((skipped++))
        fi
        
        # Progress logging every 50 albums
        if [[ $((processed + skipped)) -gt 0 ]] && [[ $(((processed + skipped) % 50)) -eq 0 ]]; then
            local current_progress=$((processed + skipped))
            local percent=$((current_progress * 100 / total_albums))
            log $LOG_INFO "Progress: $current_progress/$total_albums ($percent%) - Processed: $processed, Skipped: $skipped"
        fi
    done
    
    # Update statistics
    if [[ $DRY_RUN -eq 0 ]]; then
        update_organization_stats
    fi
    
    log $LOG_INFO "Processing complete. Processed: $processed, Skipped: $skipped"
    
    # Cleanup phase
    if [[ $CLEANUP_EMPTY_DIRS -eq 1 ]] || [[ $CLEANUP_ARTIFACTS -eq 1 ]]; then
        log $LOG_INFO "Starting cleanup phase..."
        
        if [[ $CLEANUP_EMPTY_DIRS -eq 1 ]]; then
            local cleanup_opts=""
            [[ $DRY_RUN -eq 1 ]] && cleanup_opts="preview"
            [[ $CLEANUP_PRESERVE_STRUCTURE -eq 1 ]] && cleanup_opts="$cleanup_opts preserve-structure"
            
            cleanup_empty_source_directories "$SOURCE_DIR" "$cleanup_opts"
        fi
        
        if [[ $CLEANUP_ARTIFACTS -eq 1 ]]; then
            cleanup_artifacts "$SOURCE_DIR"
        fi
    fi
    
    log $LOG_INFO "--- ordr.fm Script Finished ---"
    
    exit_with_code 0 "Script completed successfully: Processing completed successfully"
}

# Export functions for parallel processing
if [[ -f "$SCRIPT_DIR/lib/parallel_wrapper.sh" ]]; then
    source "$SCRIPT_DIR/lib/parallel_wrapper.sh"
    export_parallel_functions
fi

# Handle source-only mode for parallel workers
if [[ "$1" == "--source-only" ]]; then
    return 0 2>/dev/null || exit 0
fi

# Run main function
main "$@"