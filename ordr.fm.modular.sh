#!/bin/bash
#
# ordr.fm - Intelligent Music Organization Tool (Modular Version)
# Organizes music collections based on metadata, quality, and customizable rules
#
# Usage: ./ordr.fm.modular.sh [options]
# Run with --help for detailed options

set -euo pipefail

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

# Check if cleanup module exists
if [[ -f "$SCRIPT_DIR/lib/cleanup.sh" ]]; then
    source "$SCRIPT_DIR/lib/cleanup.sh"
fi

# Global variables with defaults
VERSION="2.0.0-modular"
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
    
    log $LOG_INFO "Processing album directory: $album_dir"
    
    # Check incremental mode
    if [[ $INCREMENTAL -eq 1 ]] && ! directory_needs_processing "$album_dir"; then
        log $LOG_INFO "Skipping already processed directory: $album_dir"
        return 0
    fi
    
    # Extract metadata
    local exiftool_output=$(extract_album_metadata "$album_dir")
    if [[ "$exiftool_output" == "[]" ]] || [[ -z "$exiftool_output" ]]; then
        log $LOG_WARNING "No audio files found in: $album_dir"
        move_to_unsorted "$album_dir" "no audio files"
        return 1
    fi
    
    # Determine album quality
    local quality=$(determine_album_quality "$exiftool_output")
    log $LOG_DEBUG "Determined Album Quality: $quality"
    
    # Extract album information
    local album_info=$(extract_album_info "$exiftool_output")
    local album_artist=$(echo "$album_info" | cut -d'|' -f1)
    local album_title=$(echo "$album_info" | cut -d'|' -f2)
    local album_year=$(echo "$album_info" | cut -d'|' -f3)
    local label=$(echo "$album_info" | cut -d'|' -f4)
    local catalog=$(echo "$album_info" | cut -d'|' -f5)
    local genre=$(echo "$album_info" | cut -d'|' -f6)
    local track_count=$(echo "$album_info" | cut -d'|' -f7)
    local total_size=$(echo "$album_info" | cut -d'|' -f8)
    local avg_bitrate=$(echo "$album_info" | cut -d'|' -f9)
    
    # Validate required metadata
    if [[ -z "$album_artist" ]] || [[ -z "$album_title" ]]; then
        log $LOG_WARNING "Missing essential metadata for: $album_dir"
        move_to_unsorted "$album_dir" "missing metadata"
        return 1
    fi
    
    # Resolve artist aliases
    local resolved_artist=$(resolve_artist_alias "$album_artist")
    if [[ "$resolved_artist" != "$album_artist" ]]; then
        log $LOG_INFO "Resolved artist alias: '$album_artist' -> '$resolved_artist'"
        album_artist="$resolved_artist"
    fi
    
    # Enrich with Discogs if enabled
    if [[ "$DISCOGS_ENABLED" == "1" ]] && command -v discogs_search_release &>/dev/null; then
        log $LOG_DEBUG "Attempting to enrich metadata with Discogs"
        local discogs_data=$(discogs_search_release "$album_artist" "$album_title" "$album_year")
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
    local dest_path=$(build_organization_path "$org_mode" "$album_data" "$quality")
    local full_dest_path="${DEST_DIR}/${dest_path}"
    
    # Sanitize destination
    full_dest_path=$(sanitize_filename "$full_dest_path")
    
    log $LOG_INFO "Proposed new album path for '$album_dir': $full_dest_path"
    
    # Perform move or log dry run
    if [[ $DRY_RUN -eq 1 ]]; then
        log $LOG_INFO "(Dry Run) Would move album directory '$album_dir' to '$full_dest_path'"
    else
        # Create move operation
        local operation_id="move_${SECONDS}_$$"
        perform_album_move "$album_dir" "$full_dest_path" "$exiftool_output" "$operation_id"
        
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
    
    # Perform atomic directory move
    log $LOG_INFO "Moving album files..."
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
}

# Find album directories
find_album_directories() {
    local search_dir="$1"
    local albums=()
    
    log $LOG_INFO "Scanning for album directories in $search_dir..."
    
    # Check if source directory itself is an album
    if directory_has_audio_files "$search_dir"; then
        local audio_count=$(count_audio_files "$search_dir")
        log $LOG_INFO "Source directory itself appears to be an album with $audio_count audio files"
        albums+=("$search_dir")
    else
        # Find subdirectories containing audio files
        while IFS= read -r -d '' dir; do
            if directory_has_audio_files "$dir"; then
                albums+=("$dir")
            fi
        done < <(find "$search_dir" -mindepth 1 -maxdepth 3 -type d -print0 2>/dev/null)
    fi
    
    # Output array properly
    printf '%s\n' "${albums[@]}"
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
    # Parse arguments
    parse_arguments "$@"
    
    # Load configuration
    if [[ -n "$CONFIG_FILE" ]]; then
        load_config "$CONFIG_FILE"
    else
        load_config "ordr.fm.conf" || true
    fi
    
    # Restore verbosity after config load (config may override it)
    # This ensures command line flags take precedence
    for arg in "$@"; do
        case "$arg" in
            -v|--verbose) VERBOSITY=$LOG_DEBUG ;;
            -q|--quiet) VERBOSITY=$LOG_ERROR ;;
        esac
    done
    
    # Set defaults if not configured
    DEST_DIR="${DEST_DIR:-${SOURCE_DIR}/sorted_music}"
    UNSORTED_BASE_DIR="${UNSORTED_BASE_DIR:-${SOURCE_DIR}/unsorted}"
    
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
    
    # Initialize databases
    if [[ $INCREMENTAL -eq 1 ]] || [[ $DRY_RUN -eq 0 ]]; then
        init_state_db
        init_metadata_db
    fi
    
    if [[ $DUPLICATE_DETECTION -eq 1 ]]; then
        init_duplicates_db
    fi
    
    # Initialize Discogs if enabled
    if [[ "$DISCOGS_ENABLED" == "1" ]] && command -v init_discogs &>/dev/null; then
        log $LOG_INFO "  Discogs Integration: Enabled"
        init_discogs
    fi
    
    # Create unsorted directory
    if [[ $DRY_RUN -eq 0 ]]; then
        local unsorted_dir="${UNSORTED_BASE_DIR}/unsorted_${DATE_NOW}"
        if create_directory_safe "$unsorted_dir"; then
            log $LOG_INFO "Created unsorted directory for this run: $unsorted_dir"
        fi
    else
        log $LOG_INFO "(Dry Run) Would create unsorted directory: ${UNSORTED_BASE_DIR}/unsorted_${DATE_NOW}"
    fi
    
    # Find and process album directories
    local album_dirs=()
    while IFS= read -r dir; do
        [[ -n "$dir" ]] && album_dirs+=("$dir")
    done < <(find_album_directories "$SOURCE_DIR")
    
    local total_albums=${#album_dirs[@]}
    local processed=0
    local skipped=0
    
    log $LOG_INFO "Found $total_albums potential album directories. Processing..."
    
    # Choose processing method based on collection size
    if [[ $total_albums -gt 1000 ]] && [[ -n "$(type -t process_large_collection_parallel)" ]]; then
        # Use optimized processing for large collections
        log $LOG_INFO "Large collection detected. Using optimized processing..."
        
        # Build index cache for faster lookups
        if [[ $INDEX_CACHE_ENABLED -eq 1 ]]; then
            build_album_index_cache "$SOURCE_DIR"
        fi
        
        # Initialize parallel processing with optimizations
        if [[ $PARALLEL_JOBS -eq 0 ]]; then
            init_parallel_processing "auto"
        else
            init_parallel_processing "auto" "$PARALLEL_JOBS"
        fi
        
        # Process with large collection optimizations
        process_large_collection_parallel "${album_dirs[@]}"
        
        # Get statistics
        processed=$JOBS_COMPLETED
        skipped=$JOBS_FAILED
        
        # Cleanup
        cleanup_orphaned_data
    elif [[ $ENABLE_PARALLEL -eq 1 ]] && [[ $total_albums -gt 1 ]]; then
        # Standard parallel processing
        if [[ $PARALLEL_JOBS -eq 0 ]]; then
            init_parallel_processing "auto"
        else
            init_parallel_processing "auto" "$PARALLEL_JOBS"
        fi
        
        # Process albums in parallel
        process_albums_parallel_dispatcher "${album_dirs[@]}"
        
        # Get statistics from parallel processing
        processed=$JOBS_COMPLETED
        skipped=$JOBS_FAILED
    else
        # Sequential processing
        for album_dir in "${album_dirs[@]}"; do
            if process_album_directory "$album_dir"; then
                ((processed++))
            else
                ((skipped++))
            fi
        done
    fi
    
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