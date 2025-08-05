#!/bin/bash
#
# lib/discogs.sh - Discogs API integration module for ordr.fm
#
# This module provides comprehensive Discogs API integration including:
# - API authentication and token management
# - Release search and retrieval with caching
# - Rate limiting and error handling
# - Metadata extraction from API responses
# - Response caching with expiration
#
# Functions exported by this module:
# - init_discogs()                 - Initialize Discogs integration
# - discogs_authenticate()         - Set up API authentication
# - discogs_search_releases()      - Search for releases on Discogs
# - discogs_get_release()          - Get detailed release information
# - discogs_extract_metadata()     - Extract metadata from release data (alias for compatibility)
# - discogs_rate_limit()           - Handle API rate limiting
# - discogs_cache_response()       - Cache API responses (alias for discogs_cache_set)
# - discogs_api_request()          - Make authenticated API requests
# - discogs_cache_key()            - Generate cache keys
# - discogs_cache_get()            - Retrieve cached responses
# - discogs_cache_set()            - Store responses in cache
#
# Dependencies:
# - curl (for HTTP requests)
# - jq (for JSON processing)
# - md5sum (for cache key generation)
# - Core logging functions (log, LOG_*)
#
# Configuration Variables (should be set before sourcing):
# - DISCOGS_ENABLED              - Enable/disable Discogs integration (0/1)
# - DISCOGS_USER_TOKEN           - User token for authentication
# - DISCOGS_CONSUMER_KEY         - Consumer key for OAuth
# - DISCOGS_CONSUMER_SECRET      - Consumer secret for OAuth
# - DISCOGS_CACHE_DIR            - Directory for response cache
# - DISCOGS_CACHE_EXPIRY         - Cache expiration time in hours
# - DISCOGS_RATE_LIMIT           - API rate limit (requests per minute)
# - DISCOGS_RATE_LIMITER_FILE    - File to track rate limiting
# - DISCOGS_CONFIDENCE_THRESHOLD - Confidence threshold for metadata acceptance
# - DISCOGS_CATALOG_NUMBERS      - Enable catalog number extraction
# - DISCOGS_REMIX_ARTISTS        - Enable remix artist extraction
# - DISCOGS_LABEL_SERIES         - Enable label series identification
#
# Usage:
#   source lib/discogs.sh
#   
#   # Initialize
#   init_discogs
#   
#   # Search for releases
#   results=$(discogs_search_releases "Artist" "Album" "2023")
#   
#   # Get release details
#   details=$(discogs_get_release "12345")
#   
#   # Extract metadata (note: this function is in lib/metadata.sh)
#   metadata=$(extract_discogs_metadata "$details")
#

# Default configuration values (can be overridden)
DISCOGS_ENABLED=${DISCOGS_ENABLED:-0}
DISCOGS_USER_TOKEN=${DISCOGS_USER_TOKEN:-""}
DISCOGS_CONSUMER_KEY=${DISCOGS_CONSUMER_KEY:-""}
DISCOGS_CONSUMER_SECRET=${DISCOGS_CONSUMER_SECRET:-""}
DISCOGS_CACHE_DIR=${DISCOGS_CACHE_DIR:-""}
DISCOGS_CACHE_EXPIRY=${DISCOGS_CACHE_EXPIRY:-24}
DISCOGS_RATE_LIMIT=${DISCOGS_RATE_LIMIT:-60}
DISCOGS_CONFIDENCE_THRESHOLD=${DISCOGS_CONFIDENCE_THRESHOLD:-0.7}
DISCOGS_CATALOG_NUMBERS=${DISCOGS_CATALOG_NUMBERS:-1}
DISCOGS_REMIX_ARTISTS=${DISCOGS_REMIX_ARTISTS:-1}
DISCOGS_LABEL_SERIES=${DISCOGS_LABEL_SERIES:-1}
DISCOGS_RATE_LIMITER_FILE=${DISCOGS_RATE_LIMITER_FILE:-""}
DISCOGS_LAST_REQUEST_TIME=${DISCOGS_LAST_REQUEST_TIME:-0}

# Ensure required dependencies are available
if ! command -v curl >/dev/null 2>&1; then
    echo "ERROR: curl is required for Discogs API integration" >&2
    return 1 2>/dev/null || exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq is required for JSON processing" >&2
    return 1 2>/dev/null || exit 1
fi

if ! command -v md5sum >/dev/null 2>&1; then
    echo "ERROR: md5sum is required for cache key generation" >&2
    return 1 2>/dev/null || exit 1
fi

#
# CORE DISCOGS API FUNCTIONS
#

# init_discogs: Initialize Discogs integration settings
# Sets up cache directory and rate limiter file
# Returns: 0 on success, 1 on failure
init_discogs() {
    if [[ $DISCOGS_ENABLED -eq 0 ]]; then
        return 0
    fi
    
    # Set up cache directory
    if [[ -z "$DISCOGS_CACHE_DIR" ]]; then
        DISCOGS_CACHE_DIR="$(dirname "${LOG_FILE:-/tmp/ordr.fm.log}")/discogs_cache"
    fi
    
    # Create cache directory if it doesn't exist
    if [[ ! -d "$DISCOGS_CACHE_DIR" ]]; then
        mkdir -p "$DISCOGS_CACHE_DIR" || {
            if command -v log >/dev/null 2>&1; then
                log ${LOG_WARNING:-2} "WARN: Could not create Discogs cache directory: $DISCOGS_CACHE_DIR. Disabling caching."
            else
                echo "WARN: Could not create Discogs cache directory: $DISCOGS_CACHE_DIR. Disabling caching." >&2
            fi
            DISCOGS_CACHE_DIR=""
        }
    fi
    
    # Set up rate limiter file
    if [[ -z "$DISCOGS_RATE_LIMITER_FILE" ]]; then
        DISCOGS_RATE_LIMITER_FILE="$(dirname "${LOG_FILE:-/tmp/ordr.fm.log}")/discogs_rate_limiter"
    fi
    
    # Initialize rate limiter file if it doesn't exist
    if [[ ! -f "$DISCOGS_RATE_LIMITER_FILE" ]]; then
        echo "0" > "$DISCOGS_RATE_LIMITER_FILE"
    fi
    
    if command -v log >/dev/null 2>&1; then
        log ${LOG_DEBUG:-4} "Discogs integration initialized. Cache: $DISCOGS_CACHE_DIR, Rate limiter: $DISCOGS_RATE_LIMITER_FILE"
    fi
}

# discogs_authenticate: Set up API authentication (compatibility function)
# This is mainly for API compatibility - actual authentication is handled in discogs_api_request
# Arguments:
#   $1: Optional token (sets DISCOGS_USER_TOKEN)
# Returns: 0 if authentication is configured, 1 otherwise
discogs_authenticate() {
    local token="$1"
    
    if [[ -n "$token" ]]; then
        DISCOGS_USER_TOKEN="$token"
        DISCOGS_ENABLED=1
    fi
    
    # Check if any authentication method is configured
    if [[ -n "$DISCOGS_USER_TOKEN" ]] || [[ -n "$DISCOGS_CONSUMER_KEY" && -n "$DISCOGS_CONSUMER_SECRET" ]]; then
        return 0
    else
        if command -v log >/dev/null 2>&1; then
            log ${LOG_WARNING:-2} "WARN: No Discogs authentication configured"
        fi
        return 1
    fi
}

# discogs_rate_limit: Handle API rate limiting
# Enforces minimum interval between API requests based on DISCOGS_RATE_LIMIT
# Uses file-based tracking for persistence across script runs
# Returns: Always 0
discogs_rate_limit() {
    if [[ $DISCOGS_ENABLED -eq 0 ]]; then
        return 0
    fi
    
    local current_time=$(date +%s)
    local last_request_time
    
    # Read last request time from file
    if [[ -f "$DISCOGS_RATE_LIMITER_FILE" ]]; then
        last_request_time=$(cat "$DISCOGS_RATE_LIMITER_FILE" 2>/dev/null || echo "0")
    else
        last_request_time=0
    fi
    
    # Calculate time since last request
    local time_diff=$((current_time - last_request_time))
    local min_interval=$((60 / DISCOGS_RATE_LIMIT))  # seconds between requests
    
    if [[ $time_diff -lt $min_interval ]]; then
        local sleep_time=$((min_interval - time_diff))
        if command -v log >/dev/null 2>&1; then
            log ${LOG_DEBUG:-4} "Rate limiting: sleeping for $sleep_time seconds"
        fi
        sleep $sleep_time
    fi
    
    # Update last request time
    echo "$current_time" > "$DISCOGS_RATE_LIMITER_FILE"
}

# discogs_cache_key: Generate cache key for Discogs API request
# Creates a normalized, hashed cache key from search parameters
# Arguments:
#   $1: Artist name
#   $2: Album title
#   $3: Year (optional)
# Returns: MD5 hash of normalized parameters
discogs_cache_key() {
    local artist="$1"
    local album="$2"
    local year="$3"
    
    # Create a normalized cache key
    local normalized_artist=$(echo "$artist" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
    local normalized_album=$(echo "$album" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
    local key="${normalized_artist}_${normalized_album}_${year:-0000}"
    
    echo "$key" | md5sum | cut -d' ' -f1
}

# discogs_cache_get: Retrieve cached response if valid
# Checks cache file existence and expiration
# Arguments:
#   $1: Cache key
# Returns: Cached JSON response if valid, otherwise exits with code 1
discogs_cache_get() {
    local cache_key="$1"
    
    if [[ -z "$DISCOGS_CACHE_DIR" || ! -d "$DISCOGS_CACHE_DIR" ]]; then
        return 1
    fi
    
    local cache_file="$DISCOGS_CACHE_DIR/$cache_key.json"
    
    if [[ ! -f "$cache_file" ]]; then
        return 1
    fi
    
    # Check if cache is expired
    local cache_age_hours=$(( ($(date +%s) - $(stat -c %Y "$cache_file" 2>/dev/null || echo 0)) / 3600 ))
    
    if [[ $cache_age_hours -gt $DISCOGS_CACHE_EXPIRY ]]; then
        if command -v log >/dev/null 2>&1; then
            log ${LOG_DEBUG:-4} "Discogs cache expired for key: $cache_key (age: ${cache_age_hours}h)"
        fi
        # Use secure_remove_file if available, otherwise use rm
        if command -v secure_remove_file >/dev/null 2>&1; then
            secure_remove_file "$cache_file"
        else
            rm -f "$cache_file"
        fi
        return 1
    fi
    
    if command -v log >/dev/null 2>&1; then
        log ${LOG_DEBUG:-4} "Using cached Discogs response for key: $cache_key"
    fi
    cat "$cache_file"
    return 0
}

# discogs_cache_set: Store response in cache
# Saves API response to cache file for future use
# Arguments:
#   $1: Cache key
#   $2: JSON response to cache
# Returns: 0 on success, 1 on failure
discogs_cache_set() {
    local cache_key="$1"
    local response="$2"
    
    if [[ -z "$DISCOGS_CACHE_DIR" || ! -d "$DISCOGS_CACHE_DIR" ]]; then
        return 1
    fi
    
    local cache_file="$DISCOGS_CACHE_DIR/$cache_key.json"
    
    echo "$response" > "$cache_file"
    if command -v log >/dev/null 2>&1; then
        log ${LOG_DEBUG:-4} "Cached Discogs response for key: $cache_key"
    fi
}

# discogs_cache_response: Alias for discogs_cache_set (for API compatibility)
# Arguments:
#   $1: Cache key
#   $2: JSON response to cache
# Returns: Result of discogs_cache_set
discogs_cache_response() {
    discogs_cache_set "$@"
}

# discogs_api_request: Make authenticated request to Discogs API
# Core function for all Discogs API communication
# Handles authentication, rate limiting, caching, and error handling
# Arguments:
#   $1: API endpoint (e.g., "/database/search?q=...")
#   $2: Cache key (optional, for caching)
# Returns: JSON response on success, exits with code 1 on failure
discogs_api_request() {
    local endpoint="$1"
    local cache_key="$2"
    
    if [[ $DISCOGS_ENABLED -eq 0 ]]; then
        return 1
    fi
    
    # Try cache first
    if [[ -n "$cache_key" ]]; then
        local cached_response
        if cached_response=$(discogs_cache_get "$cache_key"); then
            echo "$cached_response"
            return 0
        fi
    fi
    
    # Apply rate limiting
    discogs_rate_limit
    
    local api_url="https://api.discogs.com${endpoint}"
    local auth_header=""
    local user_agent="ordr.fm/1.0 +https://github.com/adrianwedd/ordr.fm"
    
    # Set up authentication
    if [[ -n "$DISCOGS_USER_TOKEN" ]]; then
        auth_header="Authorization: Discogs token=${DISCOGS_USER_TOKEN}"
    elif [[ -n "$DISCOGS_CONSUMER_KEY" && -n "$DISCOGS_CONSUMER_SECRET" ]]; then
        auth_header="Authorization: Discogs key=${DISCOGS_CONSUMER_KEY}, secret=${DISCOGS_CONSUMER_SECRET}"
    else
        if command -v log >/dev/null 2>&1; then
            log ${LOG_WARNING:-2} "WARN: No Discogs authentication configured. Using unauthenticated requests (lower rate limit)."
        fi
    fi
    
    if command -v log >/dev/null 2>&1; then
        log ${LOG_DEBUG:-4} "Making Discogs API request to: $api_url"
    fi
    
    # Make the API request
    local response
    if [[ -n "$auth_header" ]]; then
        response=$(curl -s -H "User-Agent: $user_agent" -H "$auth_header" "$api_url" 2>/dev/null)
    else
        response=$(curl -s -H "User-Agent: $user_agent" "$api_url" 2>/dev/null)
    fi
    
    local curl_exit_code=$?
    
    if [[ $curl_exit_code -ne 0 ]]; then
        if command -v log >/dev/null 2>&1; then
            log ${LOG_WARNING:-2} "WARN: Discogs API request failed with curl exit code: $curl_exit_code"
        fi
        return 1
    fi
    
    if [[ -z "$response" ]]; then
        if command -v log >/dev/null 2>&1; then
            log ${LOG_WARNING:-2} "WARN: Empty response from Discogs API"
        fi
        return 1
    fi
    
    # Check for API errors
    local error_message=$(echo "$response" | jq -r '.message // empty' 2>/dev/null)
    if [[ -n "$error_message" ]]; then
        if command -v log >/dev/null 2>&1; then
            log ${LOG_WARNING:-2} "WARN: Discogs API error: $error_message"
        fi
        return 1
    fi
    
    # Cache successful response
    if [[ -n "$cache_key" ]]; then
        discogs_cache_set "$cache_key" "$response"
    fi
    
    echo "$response"
    return 0
}

# discogs_search_releases: Search for releases on Discogs
# Constructs search query and calls API
# Arguments:
#   $1: Artist name
#   $2: Album title
#   $3: Year (optional)
# Returns: JSON search results or empty on failure
discogs_search_releases() {
    local artist="$1"
    local album="$2"
    local year="$3"
    
    if [[ $DISCOGS_ENABLED -eq 0 ]]; then
        return 1
    fi
    
    # Build search query
    local query="artist:\"$artist\" release_title:\"$album\""
    if [[ -n "$year" ]]; then
        query="$query year:$year"
    fi
    
    # URL encode the query
    local encoded_query=$(echo "$query" | jq -sRr @uri)
    local endpoint="/database/search?q=$encoded_query&type=release&per_page=10"
    
    local cache_key=$(discogs_cache_key "$artist" "$album" "$year")
    
    if command -v log >/dev/null 2>&1; then
        log ${LOG_DEBUG:-4} "Searching Discogs for: $query"
    fi
    
    discogs_api_request "$endpoint" "$cache_key"
}

# discogs_get_release: Get detailed release information from Discogs
# Retrieves full release data including tracklist, labels, etc.
# Arguments:
#   $1: Discogs release ID
# Returns: JSON release details or empty on failure
discogs_get_release() {
    local release_id="$1"
    
    if [[ $DISCOGS_ENABLED -eq 0 || -z "$release_id" ]]; then
        return 1
    fi
    
    local endpoint="/releases/$release_id"
    local cache_key="release_${release_id}"
    
    if command -v log >/dev/null 2>&1; then
        log ${LOG_DEBUG:-4} "Getting Discogs release details for ID: $release_id"
    fi
    
    discogs_api_request "$endpoint" "$cache_key"
}

# discogs_extract_metadata: Alias for extract_discogs_metadata (compatibility)
# Note: The actual implementation is in lib/metadata.sh
# This alias ensures backward compatibility for any code expecting this function name
# Arguments:
#   $1: Discogs release JSON response
# Returns: Extracted metadata JSON or calls the actual function if available
discogs_extract_metadata() {
    if command -v extract_discogs_metadata >/dev/null 2>&1; then
        extract_discogs_metadata "$@"
    else
        echo "ERROR: extract_discogs_metadata function not available. Source lib/metadata.sh first." >&2
        return 1
    fi
}

#
# UTILITY FUNCTIONS
#

# validate_discogs_config: Validate Discogs configuration
# Checks if required configuration is present
# Returns: 0 if valid, 1 if invalid
validate_discogs_config() {
    if [[ $DISCOGS_ENABLED -eq 0 ]]; then
        return 0  # Valid to be disabled
    fi
    
    # Check if at least one authentication method is configured
    if [[ -z "$DISCOGS_USER_TOKEN" ]] && [[ -z "$DISCOGS_CONSUMER_KEY" || -z "$DISCOGS_CONSUMER_SECRET" ]]; then
        if command -v log >/dev/null 2>&1; then
            log ${LOG_WARNING:-2} "WARN: Discogs enabled but no authentication configured"
        fi
        return 1
    fi
    
    # Validate rate limit
    if [[ $DISCOGS_RATE_LIMIT -le 0 ]]; then
        if command -v log >/dev/null 2>&1; then
            log ${LOG_WARNING:-2} "WARN: Invalid Discogs rate limit: $DISCOGS_RATE_LIMIT"
        fi
        return 1
    fi
    
    # Validate cache expiry
    if [[ $DISCOGS_CACHE_EXPIRY -le 0 ]]; then
        if command -v log >/dev/null 2>&1; then
            log ${LOG_WARNING:-2} "WARN: Invalid Discogs cache expiry: $DISCOGS_CACHE_EXPIRY"
        fi
        return 1
    fi
    
    return 0
}

# get_discogs_status: Get current Discogs integration status
# Returns: Human-readable status information
get_discogs_status() {
    local status="Discogs Integration Status:\n"
    status+="  Enabled: $([ $DISCOGS_ENABLED -eq 1 ] && echo "Yes" || echo "No")\n"
    
    if [[ $DISCOGS_ENABLED -eq 1 ]]; then
        status+="  Authentication: "
        if [[ -n "$DISCOGS_USER_TOKEN" ]]; then
            status+="User Token\n"
        elif [[ -n "$DISCOGS_CONSUMER_KEY" && -n "$DISCOGS_CONSUMER_SECRET" ]]; then
            status+="OAuth (Key/Secret)\n"
        else
            status+="None (Unauthenticated)\n"
        fi
        
        status+="  Cache Directory: ${DISCOGS_CACHE_DIR:-Not Set}\n"
        status+="  Cache Expiry: ${DISCOGS_CACHE_EXPIRY}h\n"
        status+="  Rate Limit: ${DISCOGS_RATE_LIMIT} req/min\n"
        status+="  Confidence Threshold: ${DISCOGS_CONFIDENCE_THRESHOLD}\n"
        
        if [[ -f "$DISCOGS_RATE_LIMITER_FILE" ]]; then
            local last_request=$(cat "$DISCOGS_RATE_LIMITER_FILE" 2>/dev/null || echo "0")
            local current_time=$(date +%s)
            local time_since_last=$((current_time - last_request))
            status+="  Last API Request: ${time_since_last}s ago\n"
        fi
    fi
    
    echo -e "$status"
}

# clear_discogs_cache: Clear the Discogs response cache
# Removes all cached API responses
# Returns: 0 on success
clear_discogs_cache() {
    if [[ -n "$DISCOGS_CACHE_DIR" && -d "$DISCOGS_CACHE_DIR" ]]; then
        rm -f "$DISCOGS_CACHE_DIR"/*.json
        if command -v log >/dev/null 2>&1; then
            log ${LOG_INFO:-3} "Cleared Discogs cache directory: $DISCOGS_CACHE_DIR"
        fi
    fi
    return 0
}

# Note: Functions are automatically available when this module is sourced
# The functions are defined in the current shell environment and available to calling scripts