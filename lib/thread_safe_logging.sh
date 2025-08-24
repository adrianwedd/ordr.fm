#!/bin/bash
# Thread-safe logging module for ordr.fm parallel processing
# Provides synchronized logging for concurrent operations

# Lock file for synchronized logging
LOG_LOCK_FILE="/tmp/ordr.fm_log_lock_$$"

# Thread-safe log function
log_threadsafe() {
    local level=$1
    local message=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S.%3N')
    local thread_id="${WORKER_ID:-main}"
    
    # Only log if message level is <= configured verbosity
    if [[ $level -le ${VERBOSITY:-$LOG_INFO} ]]; then
        local level_name=$(get_log_level_name $level)
        local log_line="[$timestamp] [$thread_id] [$level_name] $message"
        
        # Acquire lock for file writing
        {
            flock -x 200
            echo "$log_line" >> "${LOG_FILE:-ordr.fm.log}"
            echo "$log_line" >&2  # Also output to stderr
        } 200>"$LOG_LOCK_FILE"
    fi
}

# Override standard log functions for thread safety
log() {
    log_threadsafe "$@"
}

log_info() {
    log_threadsafe $LOG_INFO "$1"
}

log_warning() {
    log_threadsafe $LOG_WARNING "$1"
}

log_error() {
    log_threadsafe $LOG_ERROR "$1"
}

log_debug() {
    log_threadsafe $LOG_DEBUG "$1"
}

log_trace() {
    log_threadsafe $LOG_TRACE "$1"
}

# Thread-safe progress logging
log_progress() {
    local current=$1
    local total=$2
    local message="${3:-Processing}"
    local thread_id="${WORKER_ID:-main}"
    
    # Calculate percentage (avoid division by zero)
    local percent=0
    if [[ $total -gt 0 ]]; then
        percent=$((current * 100 / total))
    fi
    
    # Create progress bar
    local bar_length=20
    local filled_length=$((percent * bar_length / 100))
    local bar=""
    for ((i=0; i<filled_length; i++)); do bar+="█"; done
    for ((i=filled_length; i<bar_length; i++)); do bar+="░"; done
    
    # Thread-safe progress update
    {
        flock -x 200
        # Use carriage return to update the same line
        printf "\r[$thread_id] $message: [$bar] $percent%% ($current/$total)" >&2
        if [[ $current -eq $total ]]; then
            echo >&2  # New line when complete
        fi
    } 200>"$LOG_LOCK_FILE"
}

# Cleanup function to remove lock file
cleanup_log_locks() {
    rm -f "$LOG_LOCK_FILE"
}

# Set up cleanup trap
trap cleanup_log_locks EXIT

# Export functions
export -f log_threadsafe
export -f log
export -f log_info
export -f log_warning
export -f log_error
export -f log_debug
export -f log_trace
export -f log_progress