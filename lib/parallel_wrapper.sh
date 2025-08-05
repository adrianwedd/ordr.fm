#!/bin/bash
# Parallel execution wrapper for ordr.fm
# Ensures all necessary functions are available in worker processes

# Export core functions for parallel execution
export_parallel_functions() {
    # Export all functions from loaded modules
    local funcs=(
        # Common functions
        log log_info log_warning log_error log_debug log_trace log_progress
        sanitize_filename exit_with_code
        
        # File operations
        create_directory_safe directory_has_audio_files count_audio_files
        perform_atomic_directory_move move_to_unsorted
        
        # Database functions
        init_databases track_album_metadata create_move_operation
        update_move_operation_status record_directory_processing
        acquire_db_lock release_db_lock
        
        # Metadata extraction
        extract_album_metadata determine_album_quality
        extract_most_common_value extract_album_info
        
        # Organization
        determine_organization_mode build_organization_path
        resolve_artist_alias should_use_label_organization
        
        # Processing
        process_album_directory perform_album_move
        
        # Discogs (if enabled)
        discogs_authenticate discogs_search_release discogs_get_release
        discogs_extract_metadata discogs_rate_limit discogs_cache_response
    )
    
    for func in "${funcs[@]}"; do
        if declare -F "$func" &>/dev/null; then
            export -f "$func"
        fi
    done
    
    # Export required variables
    export SOURCE_DIR DEST_DIR UNSORTED_BASE_DIR
    export DRY_RUN VERBOSITY LOG_FILE
    export DISCOGS_ENABLED DISCOGS_TOKEN DISCOGS_CACHE_DIR
    export ENABLE_ELECTRONIC_ORGANIZATION ORGANIZATION_MODE
    export STATE_DB METADATA_DB DUPLICATES_DB
    export DATE_NOW
}

# Source-only mode for including in parallel workers
if [[ "$1" == "--source-only" ]]; then
    # Load all modules without executing main
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    
    # Source all required modules
    source "$SCRIPT_DIR/lib/common.sh"
    source "$SCRIPT_DIR/lib/fileops.sh"
    source "$SCRIPT_DIR/lib/database.sh"
    source "$SCRIPT_DIR/lib/organization.sh"
    source "$SCRIPT_DIR/lib/metadata_extraction.sh"
    
    # Optional modules
    [[ -f "$SCRIPT_DIR/lib/discogs.sh" ]] && source "$SCRIPT_DIR/lib/discogs.sh"
    [[ -f "$SCRIPT_DIR/lib/metadata.sh" ]] && source "$SCRIPT_DIR/lib/metadata.sh"
    
    # Export all functions
    export_parallel_functions
    
    # Don't execute main
    return 0 2>/dev/null || exit 0
fi