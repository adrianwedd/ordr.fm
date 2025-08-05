#!/bin/bash
# Common utility functions for ordr.fm
# Provides logging, sanitization, and basic utilities

# Logging levels
LOG_ERROR=0
LOG_WARNING=1
LOG_INFO=2
LOG_DEBUG=3

# Function to log messages with severity levels
log() {
    local level=$1
    local message=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Only log if message level is <= configured verbosity
    if [[ $level -le ${VERBOSITY:-$LOG_INFO} ]]; then
        local level_name=$(get_log_level_name $level)
        echo "[$timestamp] [$level_name ] $message" | tee -a "${LOG_FILE:-ordr.fm.log}"
    fi
}

# Function to get log level name
get_log_level_name() {
    case $1 in
        $LOG_ERROR) echo "ERROR";;
        $LOG_WARNING) echo "WARNING";;
        $LOG_INFO) echo "INFO";;
        $LOG_DEBUG) echo "DEBUG";;
        *) echo "UNKNOWN";;
    esac
}

# Function to escape SQL strings
sql_escape() {
    local input="$1"
    # Replace single quotes with two single quotes for SQL escaping
    echo "$input" | sed "s/'/''/g"
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

# Lock file management
acquire_lock() {
    local lockfile="${LOCK_FILE:-/tmp/ordr.fm.lock}"
    local timeout=300 # 5 minutes
    local elapsed=0
    
    while [[ -f "$lockfile" ]] && [[ $elapsed -lt $timeout ]]; do
        log $LOG_WARNING "Waiting for lock file to be released: $lockfile"
        sleep 5
        elapsed=$((elapsed + 5))
    done
    
    if [[ -f "$lockfile" ]]; then
        log $LOG_ERROR "Lock file still exists after timeout: $lockfile"
        return 1
    fi
    
    echo $$ > "$lockfile"
    return 0
}

release_lock() {
    local lockfile="${LOCK_FILE:-/tmp/ordr.fm.lock}"
    if [[ -f "$lockfile" ]]; then
        rm -f "$lockfile"
        log $LOG_DEBUG "Released lock file: $lockfile"
    fi
}

# Signal handling
setup_signal_handlers() {
    trap 'handle_signal INT' INT
    trap 'handle_signal TERM' TERM
    trap 'handle_signal EXIT' EXIT
}

handle_signal() {
    local signal=$1
    log $LOG_INFO "Received signal: $signal"
    
    if [[ "$signal" != "EXIT" ]]; then
        log $LOG_INFO "Cleaning up and exiting..."
        release_lock
        exit 1
    else
        release_lock
    fi
}

# Exit with proper cleanup
exit_with_code() {
    local code=$1
    local message=$2
    
    [[ -n "$message" ]] && log $LOG_INFO "$message"
    release_lock
    exit $code
}

# Export all functions
export -f log get_log_level_name sql_escape sanitize_filename
export -f acquire_lock release_lock setup_signal_handlers handle_signal exit_with_code