#!/bin/bash
# Unified Logging System for ordr.fm
# Provides consistent logging across all modules

# Log levels
declare -g LOG_LEVEL_ERROR=0
declare -g LOG_LEVEL_WARNING=1
declare -g LOG_LEVEL_INFO=2
declare -g LOG_LEVEL_DEBUG=3
declare -g LOG_LEVEL_TRACE=4

# Current log level (default to INFO)
declare -g CURRENT_LOG_LEVEL=${CURRENT_LOG_LEVEL:-2}

# Colors for terminal output
declare -g RED='\033[0;31m'
declare -g YELLOW='\033[1;33m'
declare -g GREEN='\033[0;32m'
declare -g BLUE='\033[0;34m'
declare -g CYAN='\033[0;36m'
declare -g NC='\033[0m' # No Color

# Initialize logging
init_logging() {
    local log_file="${1:-$LOG_FILE}"
    local verbose="${2:-$VERBOSE}"
    local debug="${3:-$DEBUG}"
    
    # Set log level based on verbosity
    if [[ "$debug" == "1" ]]; then
        CURRENT_LOG_LEVEL=$LOG_LEVEL_TRACE
    elif [[ "$verbose" == "1" ]]; then
        CURRENT_LOG_LEVEL=$LOG_LEVEL_DEBUG
    else
        CURRENT_LOG_LEVEL=$LOG_LEVEL_INFO
    fi
    
    # Create log file if it doesn't exist
    if [[ -n "$log_file" ]]; then
        touch "$log_file" 2>/dev/null || {
            echo "WARNING: Cannot create log file: $log_file" >&2
            LOG_FILE=""
        }
    fi
    
    # Log initialization
    log_info "Logging initialized at level $CURRENT_LOG_LEVEL"
}

# Core logging function
log_message() {
    local level="$1"
    local message="$2"
    local color="${3:-$NC}"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Determine numeric level
    local numeric_level
    case "$level" in
        ERROR|error) numeric_level=$LOG_LEVEL_ERROR ;;
        WARNING|warning|WARN|warn) numeric_level=$LOG_LEVEL_WARNING ;;
        INFO|info) numeric_level=$LOG_LEVEL_INFO ;;
        DEBUG|debug) numeric_level=$LOG_LEVEL_DEBUG ;;
        TRACE|trace) numeric_level=$LOG_LEVEL_TRACE ;;
        *) numeric_level=$LOG_LEVEL_INFO ;;
    esac
    
    # Check if we should log this message
    if [[ $numeric_level -gt $CURRENT_LOG_LEVEL ]]; then
        return 0
    fi
    
    # Format log entry
    local log_entry="[$timestamp] [$level] $message"
    
    # Write to log file if configured
    if [[ -n "$LOG_FILE" ]]; then
        echo "$log_entry" >> "$LOG_FILE"
    fi
    
    # Write to console based on level
    if [[ $numeric_level -le $LOG_LEVEL_WARNING ]]; then
        # Errors and warnings go to stderr
        echo -e "${color}[$level]${NC} $message" >&2
    elif [[ $numeric_level -le $CURRENT_LOG_LEVEL ]]; then
        # Info and debug go to stdout if verbosity allows
        echo -e "${color}[$level]${NC} $message"
    fi
}

# Convenience functions for each log level
log_error() {
    log_message "ERROR" "$1" "$RED"
}

log_warning() {
    log_message "WARNING" "$1" "$YELLOW"
}

log_info() {
    log_message "INFO" "$1" "$GREEN"
}

log_debug() {
    log_message "DEBUG" "$1" "$BLUE"
}

log_trace() {
    log_message "TRACE" "$1" "$CYAN"
}

# Legacy compatibility functions
Error() {
    log_error "$1"
    [[ "${2:-}" == "exit" ]] && exit 1
}

Warning() {
    log_warning "$1"
}

Info() {
    log_info "$1"
}

Debug() {
    log_debug "$1"
}

# Log a separator line
log_separator() {
    local char="${1:--}"
    local width="${2:-60}"
    local separator=$(printf '%*s' "$width" | tr ' ' "$char")
    log_info "$separator"
}

# Log structured data (JSON-like)
log_structured() {
    local category="$1"
    shift
    
    local output="$category:"
    while [[ $# -gt 0 ]]; do
        local key="$1"
        local value="$2"
        output="$output $key=$value"
        shift 2
    done
    
    log_debug "$output"
}

# Log performance metrics
log_performance() {
    local operation="$1"
    local duration="$2"
    local items="${3:-}"
    
    if [[ -n "$items" ]]; then
        log_debug "PERFORMANCE: $operation completed in ${duration}s for $items items"
    else
        log_debug "PERFORMANCE: $operation completed in ${duration}s"
    fi
}

# Progress logging for long operations
log_progress() {
    local current="$1"
    local total="$2"
    local operation="${3:-Processing}"
    
    local percentage=$((current * 100 / total))
    
    # Only log at certain intervals to avoid spam
    if [[ $((current % 10)) -eq 0 ]] || [[ $current -eq $total ]]; then
        log_info "$operation: $current/$total ($percentage%)"
    fi
}

# Dry run logging
log_dry_run() {
    local action="$1"
    local details="$2"
    
    if [[ "$DRY_RUN" == "1" ]]; then
        echo -e "${BLUE}(Dry Run)${NC} Would $action: $details"
    else
        log_info "$action: $details"
    fi
}

# Set log level
set_log_level() {
    local level="$1"
    
    case "$level" in
        error|ERROR|0) CURRENT_LOG_LEVEL=$LOG_LEVEL_ERROR ;;
        warning|WARNING|warn|WARN|1) CURRENT_LOG_LEVEL=$LOG_LEVEL_WARNING ;;
        info|INFO|2) CURRENT_LOG_LEVEL=$LOG_LEVEL_INFO ;;
        debug|DEBUG|3) CURRENT_LOG_LEVEL=$LOG_LEVEL_DEBUG ;;
        trace|TRACE|4) CURRENT_LOG_LEVEL=$LOG_LEVEL_TRACE ;;
        *) 
            log_warning "Invalid log level: $level"
            return 1
            ;;
    esac
    
    log_debug "Log level set to $CURRENT_LOG_LEVEL"
}

# Export all logging functions
export -f init_logging
export -f log_message
export -f log_error
export -f log_warning
export -f log_info
export -f log_debug
export -f log_trace
export -f Error
export -f Warning
export -f Info
export -f Debug
export -f log_separator
export -f log_structured
export -f log_performance
export -f log_progress
export -f log_dry_run
export -f set_log_level