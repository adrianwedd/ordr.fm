#!/bin/bash
# Configuration Management Module for ordr.fm
# Handles all configuration loading, validation, and defaults

# Default configuration values
declare -g CONFIG_LOADED=0
declare -g CONFIG_FILE="${CONFIG_FILE:-./ordr.fm.conf}"

# Initialize configuration with defaults
init_config() {
    # Core directories
    export SOURCE_DIR="${SOURCE_DIR:-.}"
    export DEST_DIR="${DEST_DIR:-/home/plex/Music/sorted_music}"
    export UNSORTED_BASE="${UNSORTED_BASE:-/home/plex/Music/Unsorted and Incomplete/unsorted}"
    
    # Logging
    export LOG_FILE="${LOG_FILE:-ordr.fm.log}"
    export VERBOSE="${VERBOSE:-0}"
    export DEBUG="${DEBUG:-0}"
    
    # Processing modes
    export DRY_RUN="${DRY_RUN:-1}"
    export INCREMENTAL="${INCREMENTAL:-0}"
    export DUPLICATE_DETECTION="${DUPLICATE_DETECTION:-0}"
    
    # Database paths
    export STATE_DB="${STATE_DB:-./state.db}"
    export METADATA_DB="${METADATA_DB:-./metadata.db}"
    export DUPLICATES_DB="${DUPLICATES_DB:-./duplicates.db}"
    
    # Electronic music features
    export ENABLE_ELECTRONIC="${ENABLE_ELECTRONIC:-0}"
    export ORGANIZATION_MODE="${ORGANIZATION_MODE:-hybrid}"
    export MIN_LABEL_RELEASES="${MIN_LABEL_RELEASES:-3}"
    export SEPARATE_REMIXES="${SEPARATE_REMIXES:-0}"
    export GROUP_ARTIST_ALIASES="${GROUP_ARTIST_ALIASES:-0}"
    
    # Discogs integration
    export DISCOGS_ENABLED="${DISCOGS_ENABLED:-0}"
    export DISCOGS_TOKEN="${DISCOGS_TOKEN:-}"
    export DISCOGS_CACHE_DIR="${DISCOGS_CACHE_DIR:-./discogs_cache}"
    export DISCOGS_CONFIDENCE_THRESHOLD="${DISCOGS_CONFIDENCE_THRESHOLD:-0.7}"
    
    # Google Drive backup
    export ENABLE_GDRIVE_BACKUP="${ENABLE_GDRIVE_BACKUP:-0}"
    export GDRIVE_BACKUP_DIR="${GDRIVE_BACKUP_DIR:-/ordr.fm_backups}"
    
    # Validation
    export STRICT_MODE="${STRICT_MODE:-0}"
    
    CONFIG_LOADED=1
}

# Load configuration from file
load_config() {
    local config_file="${1:-$CONFIG_FILE}"
    
    if [[ ! -f "$config_file" ]]; then
        return 1
    fi
    
    # Source the configuration file
    source "$config_file"
    
    # Validate critical paths
    validate_config
    
    return 0
}

# Validate configuration
validate_config() {
    local errors=0
    
    # Check required directories exist or can be created
    if [[ ! -d "$SOURCE_DIR" ]]; then
        echo "ERROR: Source directory does not exist: $SOURCE_DIR" >&2
        ((errors++))
    fi
    
    # Check write permissions for destination
    local dest_parent=$(dirname "$DEST_DIR")
    if [[ ! -w "$dest_parent" ]] && [[ "$DRY_RUN" != "1" ]]; then
        echo "ERROR: No write permission for destination: $DEST_DIR" >&2
        ((errors++))
    fi
    
    # Validate Discogs token if enabled
    if [[ "$DISCOGS_ENABLED" == "1" ]] && [[ -z "$DISCOGS_TOKEN" ]]; then
        echo "WARNING: Discogs enabled but no token configured" >&2
    fi
    
    # Validate numeric values
    if [[ ! "$MIN_LABEL_RELEASES" =~ ^[0-9]+$ ]]; then
        echo "ERROR: MIN_LABEL_RELEASES must be numeric: $MIN_LABEL_RELEASES" >&2
        ((errors++))
    fi
    
    if [[ ! "$DISCOGS_CONFIDENCE_THRESHOLD" =~ ^[0-9.]+$ ]]; then
        echo "ERROR: DISCOGS_CONFIDENCE_THRESHOLD must be numeric: $DISCOGS_CONFIDENCE_THRESHOLD" >&2
        ((errors++))
    fi
    
    return $errors
}

# Override configuration from command-line arguments
override_config() {
    local key="$1"
    local value="$2"
    
    case "$key" in
        source) SOURCE_DIR="$value" ;;
        destination) DEST_DIR="$value" ;;
        unsorted) UNSORTED_BASE="$value" ;;
        log-file) LOG_FILE="$value" ;;
        verbose) VERBOSE=1 ;;
        debug) DEBUG=1; VERBOSE=1 ;;
        dry-run) DRY_RUN=1 ;;
        move) DRY_RUN=0 ;;
        incremental) INCREMENTAL=1 ;;
        duplicates) DUPLICATE_DETECTION=1 ;;
        discogs) DISCOGS_ENABLED=1 ;;
        electronic) ENABLE_ELECTRONIC=1 ;;
        gdrive-backup) ENABLE_GDRIVE_BACKUP=1 ;;
        *) return 1 ;;
    esac
    
    return 0
}

# Get configuration value
get_config() {
    local key="$1"
    local default="${2:-}"
    
    # Ensure configuration is loaded
    [[ "$CONFIG_LOADED" != "1" ]] && init_config
    
    # Return the value or default
    local var_name="${key^^}"  # Convert to uppercase
    var_name="${var_name//-/_}"  # Replace hyphens with underscores
    
    if [[ -n "${!var_name}" ]]; then
        echo "${!var_name}"
    else
        echo "$default"
    fi
}

# Set configuration value
set_config() {
    local key="$1"
    local value="$2"
    
    local var_name="${key^^}"
    var_name="${var_name//-/_}"
    
    export "$var_name=$value"
}

# Print configuration summary
print_config() {
    echo "Configuration:"
    echo "  Source Directory: $SOURCE_DIR"
    echo "  Destination Directory: $DEST_DIR"
    echo "  Unsorted Directory Base: $UNSORTED_BASE"
    echo "  Log File: $LOG_FILE"
    echo "  Verbosity: $([ "$VERBOSE" == "1" ] && echo "VERBOSE" || echo "NORMAL")"
    echo "  Mode: $([ "$DRY_RUN" == "1" ] && echo "Dry Run" || echo "Move Files")"
    echo "  Incremental Mode: $([ "$INCREMENTAL" == "1" ] && echo "Enabled" || echo "Disabled")"
    echo "  Duplicate Detection: $([ "$DUPLICATE_DETECTION" == "1" ] && echo "Enabled" || echo "Disabled")"
    
    if [[ "$DISCOGS_ENABLED" == "1" ]]; then
        echo "  Discogs Integration: Enabled"
    fi
    
    if [[ "$ENABLE_ELECTRONIC" == "1" ]]; then
        echo "  Electronic Music Features: Enabled"
        echo "    Organization Mode: $ORGANIZATION_MODE"
    fi
    
    if [[ "$ENABLE_GDRIVE_BACKUP" == "1" ]]; then
        echo "  Google Drive Backup: Enabled"
    fi
}

# Export functions
export -f init_config
export -f load_config
export -f validate_config
export -f override_config
export -f get_config
export -f set_config
export -f print_config

# Initialize configuration on source
init_config