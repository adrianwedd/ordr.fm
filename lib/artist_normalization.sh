#!/bin/bash
# Enhanced artist name normalization and validation
# Fixes the issues identified in the Lossy directory mess

# Source common utilities
source "${BASH_SOURCE%/*}/common.sh"

# Normalize artist names to fix common issues
normalize_artist_name() {
    local artist="$1"
    local original="$artist"
    
    # Step 1: Remove track number prefixes
    # Examples: "01) kikoman" -> "kikoman", "02 - Artist" -> "Artist"
    artist=$(echo "$artist" | sed -E 's/^[0-9]{1,2}[)]\s*//')
    artist=$(echo "$artist" | sed -E 's/^[0-9]{1,2}\s*[-]\s*//')
    artist=$(echo "$artist" | sed -E 's/^[0-9]{1,2}\.\s*//')
    
    # Step 2: Remove "aka" and alias patterns
    # Examples: "2000 And One Aka Dylan Hermelijn" -> "2000 And One"
    artist=$(echo "$artist" | sed -E 's/\s+[Aa][Kk][Aa]\s+.+$//')
    artist=$(echo "$artist" | sed -E 's/\s+a\.?k\.?a\.?\s+.+$/i')
    artist=$(echo "$artist" | sed -E 's/\s+also known as\s+.+$/i')
    
    # Step 3: Standardize punctuation and spacing
    # Examples: "Aaron-Carl" -> "Aaron Carl", "2 dollar egg" -> "2 Dollar Egg"
    # Keep hyphens that are part of the name (like "Jean-Michel")
    if [[ ! "$artist" =~ ^[A-Z][a-z]+-[A-Z][a-z]+$ ]]; then
        artist=$(echo "$artist" | sed 's/-/ /g')
    fi
    
    # Step 4: Proper case normalization (but preserve all caps if intentional)
    # Don't change if it's all caps and short (like "AGF", "AFX", "DMX")
    if [[ ! "$artist" =~ ^[A-Z]{2,5}$ ]]; then
        # Capitalize each word
        artist=$(echo "$artist" | sed 's/\b\(.\)/\u\1/g')
    fi
    
    # Step 5: Fix common variations
    case "${artist,,}" in
        "various"|"va"|"v.a."|"v/a")
            artist="Various Artists"
            ;;
        "unknown"|"unknown artist"|"no artist")
            artist="Unknown Artist"
            ;;
    esac
    
    # Step 6: Clean trailing/leading spaces
    artist=$(echo "$artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    if [[ "$original" != "$artist" ]]; then
        log $LOG_DEBUG "Artist normalized: '$original' -> '$artist'"
    fi
    
    echo "$artist"
}

# Validate if string is a valid artist name (not a year, track, etc.)
is_valid_artist_name() {
    local artist="$1"
    
    # Reject bare years (1974, 1988, 2020, etc.)
    if [[ "$artist" =~ ^[0-9]{4}$ ]]; then
        log $LOG_DEBUG "Rejected artist (bare year): '$artist'"
        return 1
    fi
    
    # Reject track numbers
    if [[ "$artist" =~ ^[0-9]{1,2}[\).]?$ ]]; then
        log $LOG_DEBUG "Rejected artist (track number): '$artist'"
        return 1
    fi
    
    # Reject catalog numbers (like "2inz 00140")
    if [[ "$artist" =~ ^[a-z]{2,5}[[:space:]][0-9]{3,5}$ ]]; then
        log $LOG_DEBUG "Rejected artist (catalog number): '$artist'"
        return 1
    fi
    
    # Reject too short (less than 2 chars)
    if [[ ${#artist} -lt 2 ]]; then
        log $LOG_DEBUG "Rejected artist (too short): '$artist'"
        return 1
    fi
    
    # Reject if it's just numbers
    if [[ "$artist" =~ ^[0-9]+$ ]]; then
        log $LOG_DEBUG "Rejected artist (only numbers): '$artist'"
        return 1
    fi
    
    # Accept if passes all checks
    return 0
}

# Find and merge duplicate artist directories
merge_duplicate_artists() {
    local base_dir="$1"
    
    log $LOG_INFO "Scanning for duplicate artists in: $base_dir"
    
    # Build list of potential duplicates
    declare -A artist_map
    declare -A normalized_to_original
    
    for artist_dir in "$base_dir"/*/; do
        [[ ! -d "$artist_dir" ]] && continue
        
        local artist_name=$(basename "$artist_dir")
        local normalized=$(normalize_artist_name "$artist_name")
        
        # Track all variations
        if [[ -n "${artist_map[$normalized]}" ]]; then
            artist_map[$normalized]="${artist_map[$normalized]}|$artist_name"
        else
            artist_map[$normalized]="$artist_name"
            normalized_to_original[$normalized]="$artist_name"
        fi
    done
    
    # Process duplicates
    for normalized in "${!artist_map[@]}"; do
        local variations="${artist_map[$normalized]}"
        
        # Skip if only one variation
        if [[ ! "$variations" == *"|"* ]]; then
            continue
        fi
        
        log $LOG_INFO "Found duplicate artist variations for '$normalized': $variations"
        
        # Pick the best variation (prefer proper case, no hyphens unless needed)
        local best_name="$normalized"
        local target_dir="$base_dir/$best_name"
        
        # Create target if doesn't exist
        if [[ ! -d "$target_dir" ]]; then
            mkdir -p "$target_dir"
            log $LOG_INFO "Created normalized artist directory: $target_dir"
        fi
        
        # Merge all variations into the normalized name
        IFS='|' read -ra VARIANTS <<< "$variations"
        for variant in "${VARIANTS[@]}"; do
            if [[ "$variant" != "$best_name" ]]; then
                local source_dir="$base_dir/$variant"
                if [[ -d "$source_dir" ]]; then
                    log $LOG_INFO "Merging '$variant' into '$best_name'"
                    
                    # Move all albums from variant to normalized
                    for album in "$source_dir"/*/; do
                        [[ -d "$album" ]] && mv "$album" "$target_dir/" 2>/dev/null
                    done
                    
                    # Remove empty variant directory
                    rmdir "$source_dir" 2>/dev/null
                fi
            fi
        done
    done
}

# Clean up invalid artist directories (years, track numbers, etc.)
cleanup_invalid_artists() {
    local base_dir="$1"
    local unsorted_dir="$2"
    
    log $LOG_INFO "Cleaning up invalid artist directories in: $base_dir"
    
    for artist_dir in "$base_dir"/*/; do
        [[ ! -d "$artist_dir" ]] && continue
        
        local artist_name=$(basename "$artist_dir")
        
        if ! is_valid_artist_name "$artist_name"; then
            log $LOG_WARNING "Invalid artist directory found: '$artist_name'"
            
            # Move albums to unsorted for manual review
            mkdir -p "$unsorted_dir"
            
            for album in "$artist_dir"/*/; do
                if [[ -d "$album" ]]; then
                    local album_name=$(basename "$album")
                    log $LOG_INFO "Moving album to unsorted: $album_name"
                    mv "$album" "$unsorted_dir/" 2>/dev/null
                fi
            done
            
            # Remove the invalid artist directory
            rmdir "$artist_dir" 2>/dev/null && \
                log $LOG_INFO "Removed invalid artist directory: $artist_name"
        fi
    done
}

# Export functions
export -f normalize_artist_name
export -f is_valid_artist_name
export -f merge_duplicate_artists
export -f cleanup_invalid_artists