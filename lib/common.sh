#!/bin/bash
# Common utility functions for ordr.fm
# Provides logging, sanitization, and basic utilities

# Logging levels - only set if not already defined
if [[ -z "${LOG_ERROR:-}" ]]; then
    readonly LOG_ERROR=0
    readonly LOG_WARNING=1
    readonly LOG_INFO=2
    readonly LOG_DEBUG=3
fi

# Function to log messages with severity levels
log() {
    local level=$1
    local message=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Only log if message level is <= configured verbosity
    if [[ $level -le ${VERBOSITY:-$LOG_INFO} ]]; then
        local level_name=$(get_log_level_name $level)
        echo "[$timestamp] [$level_name ] $message" | tee -a "${LOG_FILE:-ordr.fm.log}" >&2
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

# Lock file management with PID validation and robust cleanup
acquire_lock() {
    local lockfile="${LOCK_FILE:-/tmp/ordr.fm.lock}"
    local timeout=300 # 5 minutes
    local elapsed=0
    local check_interval=2 # Check every 2 seconds instead of 5
    local max_stale_time=1800 # 30 minutes max age for lock file
    
    # Check if lock file exists and validate it
    while [[ -f "$lockfile" ]] && [[ $elapsed -lt $timeout ]]; do
        local lock_pid=""
        local lock_age=0
        
        # Read PID from lock file if it exists
        if [[ -r "$lockfile" ]]; then
            lock_pid=$(cat "$lockfile" 2>/dev/null | head -1)
            lock_age=$(( $(date +%s) - $(stat -c %Y "$lockfile" 2>/dev/null || echo 0) ))
        fi
        
        # Check if the process is still running
        if [[ -n "$lock_pid" ]] && [[ "$lock_pid" =~ ^[0-9]+$ ]]; then
            if ! kill -0 "$lock_pid" 2>/dev/null; then
                log $LOG_WARNING "Removing stale lock file (process $lock_pid no longer exists): $lockfile"
                rm -f "$lockfile" 2>/dev/null
                break
            fi
        fi
        
        # Check if lock file is too old (stale)
        if [[ $lock_age -gt $max_stale_time ]]; then
            log $LOG_WARNING "Removing stale lock file (age: ${lock_age}s > ${max_stale_time}s): $lockfile"
            rm -f "$lockfile" 2>/dev/null
            break
        fi
        
        # If we get here, the lock is valid but held by another process
        if [[ $((elapsed % 10)) -eq 0 ]]; then  # Log every 10 seconds instead of every check
            log $LOG_INFO "Waiting for lock held by process $lock_pid (${elapsed}s elapsed): $lockfile"
        fi
        
        sleep $check_interval
        elapsed=$((elapsed + check_interval))
    done
    
    # Final check - if lock still exists after timeout, try force cleanup
    if [[ -f "$lockfile" ]]; then
        local lock_pid=$(cat "$lockfile" 2>/dev/null | head -1)
        log $LOG_ERROR "Lock file timeout after ${timeout}s. Attempting force cleanup: $lockfile"
        
        # Try to remove the lock file
        if rm -f "$lockfile" 2>/dev/null; then
            log $LOG_WARNING "Force removed stale lock file"
        else
            log $LOG_ERROR "Failed to remove lock file: $lockfile"
            return 1
        fi
    fi
    
    # Create new lock file with current PID and timestamp
    local lock_content="$$
$(date '+%Y-%m-%d %H:%M:%S')
$(whoami)@$(hostname)
$0"
    
    if echo "$lock_content" > "$lockfile" 2>/dev/null; then
        log $LOG_DEBUG "Acquired lock: $lockfile (PID: $$)"
        return 0
    else
        log $LOG_ERROR "Failed to create lock file: $lockfile"
        return 1
    fi
}

release_lock() {
    local lockfile="${LOCK_FILE:-/tmp/ordr.fm.lock}"
    local force="${1:-false}"
    
    if [[ -f "$lockfile" ]]; then
        # Verify we own this lock before releasing it
        local lock_pid=$(cat "$lockfile" 2>/dev/null | head -1)
        
        if [[ "$force" == "true" ]] || [[ "$lock_pid" == "$$" ]] || [[ -z "$lock_pid" ]]; then
            if rm -f "$lockfile" 2>/dev/null; then
                log $LOG_DEBUG "Released lock file: $lockfile (PID: $$)"
            else
                log $LOG_WARNING "Failed to remove lock file: $lockfile"
            fi
        else
            log $LOG_WARNING "Cannot release lock owned by different process (PID: $lock_pid, current: $$)"
        fi
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
        release_lock true  # Force release on signal
        # Clean up temporary files
        cleanup_temp_files
        exit 1
    else
        release_lock
        cleanup_temp_files
    fi
}

# Force cleanup function for emergencies
force_cleanup_locks() {
    local lockfile="${LOCK_FILE:-/tmp/ordr.fm.lock}"
    
    if [[ -f "$lockfile" ]]; then
        local lock_pid=$(cat "$lockfile" 2>/dev/null | head -1)
        log $LOG_WARNING "Force cleaning lock file (was owned by PID: $lock_pid)"
        rm -f "$lockfile" 2>/dev/null
    fi
    
    # Clean up any orphaned lock files
    find /tmp -name "ordr.fm*.lock" -type f -mtime +1 -delete 2>/dev/null || true
    log $LOG_INFO "Force cleanup completed"
}

# Clean up temporary files
cleanup_temp_files() {
    # Remove temporary album list files
    find /tmp -name "ordr.fm.albums.*" -type f -mtime +1 -delete 2>/dev/null || true
    # Remove old temporary directories
    find /tmp -name "ordr.fm.*" -type d -mtime +1 -exec rm -rf {} + 2>/dev/null || true
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
export -f force_cleanup_locks cleanup_temp_files