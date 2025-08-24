#!/bin/bash
# Optimized Artist Alias Resolution for ordr.fm
# Provides high-performance alias resolution with caching

# Global caching structures
declare -A ALIAS_TO_PRIMARY_CACHE
declare -A PRIMARY_TO_ALIASES_CACHE
declare -A NORMALIZED_NAME_CACHE
declare -A RELEASE_COUNT_CACHE
ALIAS_GROUPS_PARSED=0

# One-time parsing of alias groups into cache
parse_alias_groups_once() {
    [[ "$ALIAS_GROUPS_PARSED" == "1" ]] && return 0
    [[ -z "$ARTIST_ALIAS_GROUPS" ]] && return 0
    
    local group primary_artist aliases normalized_primary normalized_alias
    
    # Use bash-native parsing (no subprocess calls)
    IFS='|' read -ra groups <<< "$ARTIST_ALIAS_GROUPS"
    
    for group in "${groups[@]}"; do
        # Split group into aliases
        IFS=',' read -ra aliases <<< "$group"
        
        # Skip empty groups
        [[ ${#aliases[@]} -eq 0 ]] && continue
        
        # First alias is the primary artist
        primary_artist="${aliases[0]}"
        
        # Normalize primary artist name once
        normalized_primary=$(normalize_artist_cached "$primary_artist")
        
        # Store primary's own aliases list
        PRIMARY_TO_ALIASES_CACHE["$normalized_primary"]="$group"
        
        # Map each alias to the primary artist
        for alias in "${aliases[@]}"; do
            normalized_alias=$(normalize_artist_cached "$alias")
            ALIAS_TO_PRIMARY_CACHE["$normalized_alias"]="$primary_artist"
        done
    done
    
    ALIAS_GROUPS_PARSED=1
    [[ "$VERBOSE" == "1" ]] && echo "Debug: Parsed ${#ALIAS_TO_PRIMARY_CACHE[@]} artist aliases into cache" >&2
}

# Cached artist name normalization
normalize_artist_cached() {
    local name="$1"
    local cache_key="norm_$name"
    
    # Return cached result if exists
    [[ -n "${NORMALIZED_NAME_CACHE[$cache_key]}" ]] && {
        echo "${NORMALIZED_NAME_CACHE[$cache_key]}"
        return 0
    }
    
    # Normalize and cache
    local normalized
    normalized=$(echo "$name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]//g' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    NORMALIZED_NAME_CACHE[$cache_key]="$normalized"
    
    echo "$normalized"
}

# Optimized resolve_artist_alias with caching
fast_resolve_artist_alias() {
    local artist="$1"
    
    # Ensure alias groups are parsed
    parse_alias_groups_once
    
    # Return original if no alias groups configured
    [[ "$GROUP_ARTIST_ALIASES" != "1" ]] && { echo "$artist"; return 0; }
    [[ -z "$ARTIST_ALIAS_GROUPS" ]] && { echo "$artist"; return 0; }
    
    # Normalize input artist name
    local normalized_artist
    normalized_artist=$(normalize_artist_cached "$artist")
    
    # Look up in cache
    local primary="${ALIAS_TO_PRIMARY_CACHE[$normalized_artist]}"
    
    if [[ -n "$primary" ]]; then
        echo "$primary"
    else
        echo "$artist"
    fi
}

# Optimized get_artist_aliases with caching
fast_get_artist_aliases() {
    local artist="$1"
    
    # Ensure alias groups are parsed
    parse_alias_groups_once
    
    [[ "$GROUP_ARTIST_ALIASES" != "1" ]] && { echo "$artist"; return 0; }
    [[ -z "$ARTIST_ALIAS_GROUPS" ]] && { echo "$artist"; return 0; }
    
    # Get primary artist first
    local primary
    primary=$(fast_resolve_artist_alias "$artist")
    
    # Get normalized primary
    local normalized_primary
    normalized_primary=$(normalize_artist_cached "$primary")
    
    # Return aliases from cache
    local aliases="${PRIMARY_TO_ALIASES_CACHE[$normalized_primary]}"
    
    if [[ -n "$aliases" ]]; then
        echo "$aliases"
    else
        echo "$artist"
    fi
}

# Optimized are_artist_aliases check
fast_are_artist_aliases() {
    local artist1="$1"
    local artist2="$2"
    
    [[ "$GROUP_ARTIST_ALIASES" != "1" ]] && return 1
    [[ -z "$ARTIST_ALIAS_GROUPS" ]] && return 1
    
    # Resolve both to primary artists
    local primary1 primary2
    primary1=$(fast_resolve_artist_alias "$artist1")
    primary2=$(fast_resolve_artist_alias "$artist2")
    
    # Compare primaries
    [[ "$primary1" == "$primary2" ]]
}

# Cached release counting with aliases
fast_count_artist_releases_with_aliases() {
    local artist="$1"
    local dest_dir="$2"
    local cache_key="count_${artist}_${dest_dir}"
    
    # Return cached count if exists
    [[ -n "${RELEASE_COUNT_CACHE[$cache_key]}" ]] && {
        echo "${RELEASE_COUNT_CACHE[$cache_key]}"
        return 0
    }
    
    local total_count=0
    
    # Get all aliases for this artist
    local aliases
    aliases=$(fast_get_artist_aliases "$artist")
    
    if [[ -n "$aliases" ]]; then
        # Split aliases and count releases for each
        IFS=',' read -ra alias_array <<< "$aliases"
        
        for alias in "${alias_array[@]}"; do
            # Trim whitespace from alias
            alias=$(echo "$alias" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            
            # Count existing directories for this alias
            if [[ -d "$dest_dir/$alias" ]]; then
                local count
                count=$(find "$dest_dir/$alias" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
                total_count=$((total_count + count))
            fi
        done
    else
        # No aliases, just count for the single artist
        if [[ -d "$dest_dir/$artist" ]]; then
            total_count=$(find "$dest_dir/$artist" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
        fi
    fi
    
    # Cache the result
    RELEASE_COUNT_CACHE[$cache_key]="$total_count"
    
    echo "$total_count"
}

# Clear caches (useful for testing or when configuration changes)
clear_alias_caches() {
    unset ALIAS_TO_PRIMARY_CACHE
    unset PRIMARY_TO_ALIASES_CACHE
    unset NORMALIZED_NAME_CACHE
    unset RELEASE_COUNT_CACHE
    declare -g -A ALIAS_TO_PRIMARY_CACHE
    declare -g -A PRIMARY_TO_ALIASES_CACHE
    declare -g -A NORMALIZED_NAME_CACHE
    declare -g -A RELEASE_COUNT_CACHE
    ALIAS_GROUPS_PARSED=0
}

# Performance statistics
show_alias_cache_stats() {
    echo "Alias Resolution Cache Statistics:"
    echo "  Parsed groups: $ALIAS_GROUPS_PARSED"
    echo "  Alias mappings: ${#ALIAS_TO_PRIMARY_CACHE[@]}"
    echo "  Primary artists: ${#PRIMARY_TO_ALIASES_CACHE[@]}"
    echo "  Normalized names cached: ${#NORMALIZED_NAME_CACHE[@]}"
    echo "  Release counts cached: ${#RELEASE_COUNT_CACHE[@]}"
}

# Export optimized functions
export -f parse_alias_groups_once
export -f normalize_artist_cached
export -f fast_resolve_artist_alias
export -f fast_get_artist_aliases
export -f fast_are_artist_aliases
export -f fast_count_artist_releases_with_aliases
export -f clear_alias_caches
export -f show_alias_cache_stats

# Backward compatibility aliases
resolve_artist_alias() { fast_resolve_artist_alias "$@"; }
get_artist_aliases() { fast_get_artist_aliases "$@"; }
are_artist_aliases() { fast_are_artist_aliases "$@"; }
count_artist_releases_with_aliases() { fast_count_artist_releases_with_aliases "$@"; }

export -f resolve_artist_alias
export -f get_artist_aliases
export -f are_artist_aliases
export -f count_artist_releases_with_aliases

echo "Optimized alias resolution loaded successfully"