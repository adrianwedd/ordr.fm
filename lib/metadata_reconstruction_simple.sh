#!/bin/bash
#
# lib/metadata_reconstruction_simple.sh - Simplified Hybrid Metadata Reconstruction
#
# A working version of the hybrid reconstruction system without complex dependencies

# Source required dependencies
source "${BASH_SOURCE%/*}/common.sh"
source "${BASH_SOURCE%/*}/metadata_extraction.sh"

# Configuration
RECONSTRUCTION_CONFIDENCE_THRESHOLD=${RECONSTRUCTION_CONFIDENCE_THRESHOLD:-0.6}
RECONSTRUCTION_ENABLE_FUZZY=${RECONSTRUCTION_ENABLE_FUZZY:-1}
RECONSTRUCTION_DEBUG=${RECONSTRUCTION_DEBUG:-0}

# Main reconstruction function
reconstruct_album_metadata() {
    local album_dir="$1"
    local dirname=$(basename "$album_dir")
    
    log $LOG_INFO "Starting hybrid metadata reconstruction for: $dirname"
    
    # Step 1: Extract existing partial metadata
    local existing_metadata=$(extract_album_metadata "$album_dir")
    local existing_info=$(extract_album_info "$existing_metadata" "$album_dir")
    
    # Parse existing info
    IFS='|' read -r existing_artist existing_title existing_year existing_label existing_catalog existing_genre existing_track_count existing_size existing_bitrate <<< "$existing_info"
    
    log $LOG_DEBUG "Existing metadata: artist='$existing_artist' title='$existing_title' year='$existing_year'"
    
    # Step 2: Enhanced directory name parsing
    local enhanced_parsing=$(enhanced_directory_parsing_simple "$album_dir")
    IFS='|' read -r parsed_artist parsed_title parsed_year parsed_label parsed_catalog <<< "$enhanced_parsing"
    
    log $LOG_DEBUG "Enhanced parsing: artist='$parsed_artist' title='$parsed_title' year='$parsed_year'"
    
    # Step 3: Combine metadata sources
    local combined_artist="${existing_artist:-$parsed_artist}"
    local combined_title="${existing_title:-$parsed_title}"
    local combined_year="${existing_year:-$parsed_year}"
    local combined_label="${existing_label:-$parsed_label}"
    local combined_catalog="${existing_catalog:-$parsed_catalog}"
    
    # Step 4: Calculate confidence score
    local confidence=50  # Base confidence as integer (0-100)
    
    [[ -n "$combined_artist" ]] && confidence=$((confidence + 30))
    [[ -n "$combined_title" ]] && confidence=$((confidence + 20))
    [[ -n "$combined_year" ]] && confidence=$((confidence + 10))
    
    # Bonus for existing ID3 data
    if [[ -n "$existing_artist" || -n "$existing_title" ]]; then
        confidence=$((confidence + 10))
    fi
    
    # Check threshold (60 = 0.6)
    local threshold=60
    if [[ $confidence -ge $threshold ]]; then
        local final_metadata="${combined_artist}|${combined_title}|${combined_year}|${combined_label}|${combined_catalog}|${combined_genre}|${existing_track_count}|${existing_size}|${existing_bitrate}"
        
        log $LOG_INFO "Reconstruction successful (confidence: $confidence/100): $combined_artist - $combined_title"
        
        echo "$final_metadata"
        return 0
    else
        log $LOG_WARNING "Reconstruction failed - confidence $confidence below threshold $threshold"
        return 1
    fi
}

# Simplified enhanced directory parsing
enhanced_directory_parsing_simple() {
    local album_dir="$1"
    local dirname=$(basename "$album_dir")
    local artist="" title="" year="" label="" catalog=""
    
    log $LOG_DEBUG "Enhanced parsing for: $dirname"
    
    # Try existing inference first
    local basic_parsing=$(infer_metadata_from_dirname "$dirname")
    IFS='|' read -r basic_artist basic_title basic_year <<< "$basic_parsing"
    
    # Pattern: Scene release - artist-title-catalog-year-group
    if [[ "$dirname" =~ ^([a-z_]+).*-([a-z_]+.*)-([a-z0-9]+)-([0-9]{4})-[a-z]+$ ]]; then
        artist="${BASH_REMATCH[1]}"
        title="${BASH_REMATCH[2]}"
        catalog="${BASH_REMATCH[3]}"
        year="${BASH_REMATCH[4]}"
        
        # Convert underscores to spaces
        artist=$(echo "$artist" | tr '_' ' ')
        title=$(echo "$title" | tr '_' ' ')
        
    # Pattern: [LABEL123] Artist - Title (Year)
    elif [[ "$dirname" =~ ^\[([A-Z0-9]+)\][[:space:]]*([^-]+)[[:space:]]*-[[:space:]]*([^(]+)\(([0-9]{4})\) ]]; then
        catalog="${BASH_REMATCH[1]}"
        artist="${BASH_REMATCH[2]}"
        title="${BASH_REMATCH[3]}"
        year="${BASH_REMATCH[4]}"
        
    # Pattern: Artist - Title (Year) [Label]
    elif [[ "$dirname" =~ ^([^-]+)[[:space:]]*-[[:space:]]*([^(]+)\(([0-9]{4})\)[[:space:]]*\[([^]]+)\] ]]; then
        artist="${BASH_REMATCH[1]}"
        title="${BASH_REMATCH[2]}"
        year="${BASH_REMATCH[3]}"
        label="${BASH_REMATCH[4]}"
        
    # Pattern: (Year) Title
    elif [[ "$dirname" =~ ^\(([0-9]{4})\)[[:space:]]*(.+) ]]; then
        year="${BASH_REMATCH[1]}"
        title="${BASH_REMATCH[2]}"
        
    # Use basic parsing as fallback
    else
        artist="$basic_artist"
        title="$basic_title"
        year="$basic_year"
    fi
    
    # Clean up fields
    artist=$(echo "$artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    title=$(echo "$title" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    year=$(echo "$year" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    log $LOG_DEBUG "Enhanced parsing result: '$artist' | '$title' | '$year' | '$label' | '$catalog'"
    echo "$artist|$title|$year|$label|$catalog"
}

# Export functions
export -f reconstruct_album_metadata enhanced_directory_parsing_simple