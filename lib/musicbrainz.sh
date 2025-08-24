#!/bin/bash
#
# lib/musicbrainz.sh - MusicBrainz API integration module
#
# This module provides MusicBrainz database integration to complement Discogs
# for metadata reconstruction. MusicBrainz often has different coverage and
# can provide additional metadata for releases not found on Discogs.
#
# Functions exported by this module:
# - init_musicbrainz()              - Initialize MusicBrainz integration
# - musicbrainz_search()            - Search for releases
# - musicbrainz_get_release()       - Get detailed release info
# - musicbrainz_search_artist()     - Search for artist information
# - musicbrainz_rate_limit()        - Handle API rate limiting
# - musicbrainz_cache_get()         - Get cached responses
# - musicbrainz_cache_set()         - Cache API responses
#
# MusicBrainz API Documentation: https://musicbrainz.org/doc/MusicBrainz_API
# Rate limiting: 1 request per second for anonymous requests
# User-Agent required for all requests

# Configuration
MUSICBRAINZ_ENABLED=${MUSICBRAINZ_ENABLED:-1}
MUSICBRAINZ_BASE_URL=${MUSICBRAINZ_BASE_URL:-"https://musicbrainz.org/ws/2"}
MUSICBRAINZ_RATE_LIMIT=${MUSICBRAINZ_RATE_LIMIT:-1}  # requests per second
MUSICBRAINZ_USER_AGENT=${MUSICBRAINZ_USER_AGENT:-"ordr.fm/2.5.0 (https://github.com/user/ordr.fm)"}
MUSICBRAINZ_CACHE_DIR=${MUSICBRAINZ_CACHE_DIR:-""}
MUSICBRAINZ_CACHE_EXPIRY=${MUSICBRAINZ_CACHE_EXPIRY:-24}  # hours
MUSICBRAINZ_CONFIDENCE_THRESHOLD=${MUSICBRAINZ_CONFIDENCE_THRESHOLD:-0.6}
MUSICBRAINZ_LAST_REQUEST_TIME=${MUSICBRAINZ_LAST_REQUEST_TIME:-0}

# Ensure dependencies
if ! command -v curl >/dev/null 2>&1; then
    echo "ERROR: curl is required for MusicBrainz API integration" >&2
    return 1 2>/dev/null || exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq is required for JSON processing" >&2
    return 1 2>/dev/null || exit 1
fi

#
# INITIALIZATION
#

# init_musicbrainz: Initialize MusicBrainz integration
init_musicbrainz() {
    if [[ $MUSICBRAINZ_ENABLED -eq 0 ]]; then
        log $LOG_DEBUG "MusicBrainz integration disabled"
        return 0
    fi
    
    # Set up cache directory
    if [[ -z "$MUSICBRAINZ_CACHE_DIR" ]]; then
        MUSICBRAINZ_CACHE_DIR="${HOME}/.ordrfm/cache/musicbrainz"
    fi
    
    if [[ ! -d "$MUSICBRAINZ_CACHE_DIR" ]]; then
        mkdir -p "$MUSICBRAINZ_CACHE_DIR" 2>/dev/null || {
            log $LOG_WARNING "Could not create MusicBrainz cache directory: $MUSICBRAINZ_CACHE_DIR"
            MUSICBRAINZ_CACHE_DIR=""
        }
    fi
    
    log $LOG_DEBUG "MusicBrainz integration initialized (cache: $MUSICBRAINZ_CACHE_DIR)"
    return 0
}

#
# CORE API FUNCTIONS
#

# musicbrainz_api_request: Make authenticated API request with rate limiting
# Input: endpoint query_params
# Output: JSON response
musicbrainz_api_request() {
    local endpoint="$1"
    local query_params="$2"
    
    # Rate limiting - MusicBrainz requires 1 second between requests
    musicbrainz_rate_limit
    
    local url="${MUSICBRAINZ_BASE_URL}/${endpoint}?${query_params}&fmt=json"
    log $LOG_DEBUG "MusicBrainz API request: $url"
    
    # Make request with proper User-Agent
    local response
    response=$(curl -s \
        -H "User-Agent: $MUSICBRAINZ_USER_AGENT" \
        -H "Accept: application/json" \
        --max-time 30 \
        "$url" 2>/dev/null)
    
    local curl_exit=$?
    
    # Update last request time
    MUSICBRAINZ_LAST_REQUEST_TIME=$(date +%s)
    
    if [[ $curl_exit -ne 0 ]]; then
        log $LOG_WARNING "MusicBrainz API request failed (curl exit: $curl_exit)"
        return 1
    fi
    
    # Validate JSON response
    if ! echo "$response" | jq . >/dev/null 2>&1; then
        log $LOG_WARNING "Invalid JSON response from MusicBrainz API"
        return 1
    fi
    
    echo "$response"
    return 0
}

# musicbrainz_rate_limit: Enforce rate limiting
musicbrainz_rate_limit() {
    local current_time=$(date +%s)
    local time_since_last=$((current_time - MUSICBRAINZ_LAST_REQUEST_TIME))
    local min_interval=$((1000 / MUSICBRAINZ_RATE_LIMIT))  # milliseconds
    
    if [[ $time_since_last -lt $min_interval ]]; then
        local sleep_time=$((min_interval - time_since_last))
        log $LOG_DEBUG "MusicBrainz rate limiting: sleeping ${sleep_time}ms"
        sleep "$(echo "scale=3; $sleep_time / 1000" | bc -l)"
    fi
}

#
# SEARCH FUNCTIONS
#

# musicbrainz_search: Search for releases by artist and/or title
# Input: artist title year
# Output: best_match_json or empty
musicbrainz_search() {
    local search_artist="$1"
    local search_title="$2"
    local search_year="$3"
    
    log $LOG_DEBUG "MusicBrainz search: artist='$search_artist' title='$search_title' year='$search_year'"
    
    if [[ -z "$search_artist" ]] && [[ -z "$search_title" ]]; then
        log $LOG_DEBUG "No search terms provided for MusicBrainz"
        return 1
    fi
    
    # Check cache first
    local cache_key=$(echo -n "release_search_${search_artist}_${search_title}_${search_year}" | md5sum | cut -d' ' -f1)
    local cached_result=$(musicbrainz_cache_get "$cache_key")
    if [[ -n "$cached_result" ]]; then
        log $LOG_DEBUG "Using cached MusicBrainz result"
        echo "$cached_result"
        return 0
    fi
    
    # Build search query
    local query_parts=()
    
    # Add artist to query
    if [[ -n "$search_artist" ]]; then
        # Clean artist for search
        local clean_artist=$(echo "$search_artist" | sed 's/[^a-zA-Z0-9 ]//g' | sed 's/  */ /g')
        query_parts+=("artist:\"$clean_artist\"")
    fi
    
    # Add release title to query
    if [[ -n "$search_title" ]]; then
        # Clean title for search
        local clean_title=$(echo "$search_title" | sed 's/[^a-zA-Z0-9 ]//g' | sed 's/  */ /g')
        query_parts+=("release:\"$clean_title\"")
    fi
    
    # Add year if provided
    if [[ -n "$search_year" ]] && [[ "$search_year" =~ ^[0-9]{4}$ ]]; then
        query_parts+=("date:$search_year")
    fi
    
    # Join query parts
    local query=$(IFS=' AND '; echo "${query_parts[*]}")
    local encoded_query=$(echo "$query" | sed 's/ /%20/g' | sed 's/"/%22/g' | sed 's/:/%3A/g')
    
    # Perform search
    local search_params="query=${encoded_query}&limit=10&offset=0"
    local search_result
    search_result=$(musicbrainz_api_request "release" "$search_params")
    
    if [[ $? -ne 0 ]] || [[ -z "$search_result" ]]; then
        log $LOG_DEBUG "MusicBrainz search failed or returned no results"
        return 1
    fi
    
    # Parse results and find best match
    local releases_count
    releases_count=$(echo "$search_result" | jq '.releases | length' 2>/dev/null)
    
    if [[ -z "$releases_count" ]] || [[ "$releases_count" -eq 0 ]]; then
        log $LOG_DEBUG "No releases found in MusicBrainz search results"
        return 1
    fi
    
    log $LOG_DEBUG "Found $releases_count MusicBrainz releases"
    
    # Score each release and pick the best match
    local best_release=""
    local best_score=0
    
    for ((i=0; i<releases_count; i++)); do
        local release=$(echo "$search_result" | jq ".releases[$i]" 2>/dev/null)
        if [[ -n "$release" ]]; then
            local score=$(score_musicbrainz_release "$release" "$search_artist" "$search_title" "$search_year")
            
            if [[ $(echo "$score > $best_score" | bc -l) -eq 1 ]]; then
                best_score=$score
                best_release=$release
            fi
        fi
    done
    
    # Check if best match meets threshold
    if [[ $(echo "$best_score >= $MUSICBRAINZ_CONFIDENCE_THRESHOLD" | bc -l) -eq 1 ]]; then
        log $LOG_DEBUG "Found suitable MusicBrainz match with score: $best_score"
        
        # Extract metadata from best release
        local extracted_metadata=$(extract_musicbrainz_metadata "$best_release")
        
        # Cache the result
        musicbrainz_cache_set "$cache_key" "$extracted_metadata"
        
        echo "$extracted_metadata"
        return 0
    else
        log $LOG_DEBUG "Best MusicBrainz match score ($best_score) below threshold ($MUSICBRAINZ_CONFIDENCE_THRESHOLD)"
        return 1
    fi
}

# score_musicbrainz_release: Score a release match
# Input: release_json search_artist search_title search_year
# Output: score (0.0-1.0)
score_musicbrainz_release() {
    local release="$1"
    local search_artist="$2"
    local search_title="$3" 
    local search_year="$4"
    
    local score=0.0
    
    # Extract release data
    local mb_title=$(echo "$release" | jq -r '.title // ""' 2>/dev/null)
    local mb_date=$(echo "$release" | jq -r '.date // ""' 2>/dev/null | cut -d'-' -f1)
    
    # Get primary artist
    local mb_artist=""
    local artist_count=$(echo "$release" | jq '.["artist-credit"] | length' 2>/dev/null)
    if [[ -n "$artist_count" ]] && [[ "$artist_count" -gt 0 ]]; then
        mb_artist=$(echo "$release" | jq -r '.["artist-credit"][0].artist.name // ""' 2>/dev/null)
    fi
    
    # Score title similarity
    if [[ -n "$search_title" ]] && [[ -n "$mb_title" ]]; then
        local title_sim=$(calculate_string_similarity "$search_title" "$mb_title")
        score=$(echo "$score + $title_sim * 0.5" | bc -l)
    fi
    
    # Score artist similarity
    if [[ -n "$search_artist" ]] && [[ -n "$mb_artist" ]]; then
        local artist_sim=$(calculate_string_similarity "$search_artist" "$mb_artist")
        score=$(echo "$score + $artist_sim * 0.4" | bc -l)
    fi
    
    # Score year match
    if [[ -n "$search_year" ]] && [[ -n "$mb_date" ]] && [[ "$mb_date" =~ ^[0-9]{4}$ ]]; then
        if [[ "$search_year" == "$mb_date" ]]; then
            score=$(echo "$score + 0.1" | bc -l)
        elif [[ $(echo "($search_year - $mb_date)" | bc | tr -d '-') -le 1 ]]; then
            score=$(echo "$score + 0.05" | bc -l)
        fi
    fi
    
    echo "$score"
}

# extract_musicbrainz_metadata: Extract metadata from MusicBrainz release
# Input: release_json
# Output: artist|title|year|label|catalog
extract_musicbrainz_metadata() {
    local release="$1"
    
    # Extract basic info
    local mb_title=$(echo "$release" | jq -r '.title // ""' 2>/dev/null)
    local mb_date=$(echo "$release" | jq -r '.date // ""' 2>/dev/null | cut -d'-' -f1)
    
    # Extract primary artist
    local mb_artist=""
    local artist_count=$(echo "$release" | jq '.["artist-credit"] | length' 2>/dev/null)
    if [[ -n "$artist_count" ]] && [[ "$artist_count" -gt 0 ]]; then
        mb_artist=$(echo "$release" | jq -r '.["artist-credit"][0].artist.name // ""' 2>/dev/null)
    fi
    
    # Extract label info
    local mb_label=""
    local mb_catalog=""
    local label_count=$(echo "$release" | jq '.["label-info"] | length' 2>/dev/null)
    if [[ -n "$label_count" ]] && [[ "$label_count" -gt 0 ]]; then
        mb_label=$(echo "$release" | jq -r '.["label-info"][0].label.name // ""' 2>/dev/null)
        mb_catalog=$(echo "$release" | jq -r '.["label-info"][0].["catalog-number"] // ""' 2>/dev/null)
    fi
    
    echo "$mb_artist|$mb_title|$mb_date|$mb_label|$mb_catalog"
}

#
# CACHING FUNCTIONS  
#

# musicbrainz_cache_get: Get cached response
# Input: cache_key
# Output: cached_data or empty
musicbrainz_cache_get() {
    local cache_key="$1"
    
    if [[ -z "$MUSICBRAINZ_CACHE_DIR" ]]; then
        return 1
    fi
    
    local cache_file="$MUSICBRAINZ_CACHE_DIR/${cache_key}.json"
    
    if [[ ! -f "$cache_file" ]]; then
        return 1
    fi
    
    # Check if cache is expired
    local cache_age_hours=$(( ($(date +%s) - $(stat -c %Y "$cache_file" 2>/dev/null || echo 0)) / 3600 ))
    
    if [[ $cache_age_hours -gt $MUSICBRAINZ_CACHE_EXPIRY ]]; then
        rm -f "$cache_file" 2>/dev/null
        return 1
    fi
    
    cat "$cache_file" 2>/dev/null
    return 0
}

# musicbrainz_cache_set: Cache API response
# Input: cache_key data
# Output: none
musicbrainz_cache_set() {
    local cache_key="$1"
    local data="$2"
    
    if [[ -z "$MUSICBRAINZ_CACHE_DIR" ]] || [[ -z "$data" ]]; then
        return 1
    fi
    
    local cache_file="$MUSICBRAINZ_CACHE_DIR/${cache_key}.json"
    
    echo "$data" > "$cache_file" 2>/dev/null || {
        log $LOG_WARNING "Failed to cache MusicBrainz response to: $cache_file"
        return 1
    }
    
    return 0
}

# Export functions
export -f init_musicbrainz musicbrainz_search musicbrainz_api_request
export -f musicbrainz_rate_limit score_musicbrainz_release extract_musicbrainz_metadata
export -f musicbrainz_cache_get musicbrainz_cache_set