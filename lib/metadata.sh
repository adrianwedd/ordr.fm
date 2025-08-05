#!/bin/bash
#
# lib/metadata.sh - Metadata extraction and processing module for ordr.fm
# 
# This module handles all metadata-related operations including:
# - Metadata extraction from audio files using exiftool
# - Album metadata aggregation and validation
# - Format detection and quality determination
# - Discogs metadata enrichment
# - Metadata sanitization and normalization
#
# Functions exported by this module:
# - extract_audio_metadata()       - Extract metadata from audio files using exiftool
# - determine_album_metadata()     - Aggregate and determine album-level metadata
# - determine_album_quality()      - Calculate album quality (Lossless/Lossy/Mixed)
# - validate_album_metadata()      - Validate essential metadata fields
# - sanitize_metadata_value()      - Sanitize metadata values for filesystem use
# - detect_audio_files()           - Find audio files in directory
# - extract_discogs_metadata()     - Extract metadata from Discogs API response
# - calculate_discogs_confidence() - Calculate confidence score for Discogs match
# - enrich_metadata_with_discogs() - Main Discogs enrichment function
# - parse_track_metadata()        - Extract individual track metadata from exiftool output
#
# Requirements:
# - exiftool (for metadata extraction)
# - jq (for JSON processing)
# - bc (for floating point calculations)
#
# Usage:
#   source lib/metadata.sh
#   
#   # Extract metadata from directory
#   exiftool_output=$(extract_audio_metadata "/path/to/album")
#   
#   # Determine album metadata
#   album_metadata=$(determine_album_metadata "$exiftool_output")
#   album_artist=$(echo "$album_metadata" | jq -r '.artist')
#   album_title=$(echo "$album_metadata" | jq -r '.title')
#   
#   # Determine quality
#   quality=$(determine_album_quality "$exiftool_output")
#

# Ensure required functions are available
if ! command -v exiftool >/dev/null 2>&1; then
    echo "ERROR: exiftool is required for metadata extraction" >&2
    return 1 2>/dev/null || exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq is required for JSON processing" >&2
    return 1 2>/dev/null || exit 1
fi

#
# CORE METADATA EXTRACTION FUNCTIONS
#

# detect_audio_files: Find all audio files in a directory
# Arguments:
#   $1: Directory path to scan
# Returns:
#   Array of audio file paths (one per line)
detect_audio_files() {
    local album_dir="$1"
    
    if [[ ! -d "$album_dir" ]]; then
        return 1
    fi
    
    find "$album_dir" -maxdepth 1 -type f \( \
        -iname "*.mp3" -o -iname "*.flac" -o -iname "*.m4a" -o \
        -iname "*.aac" -o -iname "*.ogg" -o -iname "*.wav" -o \
        -iname "*.aiff" -o -iname "*.alac" \
    \) -print0 | tr '\0' '\n'
}

# extract_audio_metadata: Extract metadata from audio files using exiftool
# Arguments:
#   $1: Directory path containing audio files OR array of file paths
# Returns:
#   JSON output from exiftool
extract_audio_metadata() {
    local album_dir="$1"
    
    # Handle both directory path and file array input
    local audio_files=()
    if [[ -d "$album_dir" ]]; then
        # Directory input - find audio files
        while IFS= read -r -d $'\0' file; do
            [[ -n "$file" ]] && audio_files+=("$file")
        done < <(find "$album_dir" -maxdepth 1 -type f \( \
            -iname "*.mp3" -o -iname "*.flac" -o -iname "*.m4a" -o \
            -iname "*.aac" -o -iname "*.ogg" -o -iname "*.wav" -o \
            -iname "*.aiff" -o -iname "*.alac" \
        \) -print0)
    else
        # Assume it's a single file path
        if [[ -f "$album_dir" ]]; then
            audio_files=("$album_dir")
        else
            return 1
        fi
    fi
    
    if [[ ${#audio_files[@]} -eq 0 ]]; then
        return 1
    fi
    
    # Extract metadata using exiftool with JSON output
    local exiftool_output
    exiftool_output=$(exiftool -json "${audio_files[@]}" 2>/dev/null)
    
    if [[ -z "$exiftool_output" || "$exiftool_output" == "[]" ]]; then
        return 1
    fi
    
    echo "$exiftool_output"
}

# determine_album_metadata: Aggregate metadata from multiple tracks to determine album identity
# Arguments:
#   $1: exiftool JSON output
#   $2: fallback directory name (optional)
# Returns:
#   JSON object with album metadata: {artist, title, year, track_count}
determine_album_metadata() {
    local exiftool_output="$1"
    local fallback_dir_name="$2"
    
    if [[ -z "$exiftool_output" ]]; then
        return 1
    fi
    
    # Extract all metadata fields
    local all_album_artists=$(echo "$exiftool_output" | jq -r '.[] | .AlbumArtist // empty' | grep -v '^$')
    local all_artists=$(echo "$exiftool_output" | jq -r '.[] | .Artist // empty' | grep -v '^$')
    local all_albums=$(echo "$exiftool_output" | jq -r '.[] | .Album // empty' | grep -v '^$')
    local all_years=$(echo "$exiftool_output" | jq -r '.[] | .Year // empty' | grep -v '^$')
    local track_count=$(echo "$exiftool_output" | jq '. | length')
    
    # Determine Album Artist
    local album_artist=""
    if [[ $(echo "$all_album_artists" | sort -u | wc -l) -eq 1 && -n "$(echo "$all_album_artists" | head -n 1)" ]]; then
        album_artist=$(echo "$all_album_artists" | head -n 1)
    elif [[ $(echo "$all_artists" | sort -u | wc -l) -eq 1 && -n "$(echo "$all_artists" | head -n 1)" ]]; then
        album_artist=$(echo "$all_artists" | head -n 1)
    else
        # Multiple or inconsistent artists = Various Artists
        album_artist="Various Artists"
    fi
    
    # Determine Album Title (most frequent)
    local album_title=""
    if [[ -n "$all_albums" ]]; then
        album_title=$(echo "$all_albums" | sort | uniq -c | sort -nr | head -n 1 | awk '{$1=""; print $0}' | sed 's/^ *//')
    fi
    
    # Fallback to directory name if no album title found
    if [[ -z "$album_title" && -n "$fallback_dir_name" ]]; then
        album_title="$fallback_dir_name"
    fi
    
    # Determine Album Year (earliest)
    local album_year=""
    if [[ -n "$all_years" ]]; then
        album_year=$(echo "$all_years" | sort -n | head -n 1)
    fi
    
    # Create JSON response
    jq -n \
        --arg artist "$album_artist" \
        --arg title "$album_title" \
        --arg year "$album_year" \
        --arg count "$track_count" \
        '{
            artist: $artist,
            title: $title,
            year: $year,
            track_count: ($count | tonumber)
        }'
}

# determine_album_quality: Determine album quality based on file formats
# Arguments:
#   $1: exiftool JSON output
# Returns:
#   String: "Lossless", "Lossy", "Mixed", or "Unknown"
determine_album_quality() {
    local exiftool_output="$1"
    
    if [[ -z "$exiftool_output" ]]; then
        echo "Unknown"
        return 1
    fi
    
    local all_file_types=$(echo "$exiftool_output" | jq -r '.[] | .FileTypeExtension // empty' | grep -v '^$')
    
    local has_lossless=0
    local has_lossy=0
    
    for file_type in $all_file_types; do
        # Convert to uppercase for comparison
        local file_type_upper=$(echo "$file_type" | tr '[:lower:]' '[:upper:]')
        case "$file_type_upper" in
            "FLAC"|"WAV"|"AIFF"|"ALAC")
                has_lossless=1
                ;;
            "MP3"|"AAC"|"M4A"|"OGG")
                has_lossy=1
                ;;
        esac
    done
    
    if [[ $has_lossless -eq 1 && $has_lossy -eq 1 ]]; then
        echo "Mixed"
    elif [[ $has_lossless -eq 1 ]]; then
        echo "Lossless"
    elif [[ $has_lossy -eq 1 ]]; then
        echo "Lossy"
    else
        echo "Unknown"
    fi
}

# validate_album_metadata: Check if album has essential metadata for organization
# Arguments:
#   $1: Album metadata JSON (from determine_album_metadata)
# Returns:
#   0 if valid, 1 if invalid
validate_album_metadata() {
    local album_metadata="$1"
    
    if [[ -z "$album_metadata" ]]; then
        return 1
    fi
    
    local artist=$(echo "$album_metadata" | jq -r '.artist // empty')
    local title=$(echo "$album_metadata" | jq -r '.title // empty')
    
    if [[ -z "$artist" || -z "$title" ]]; then
        return 1
    fi
    
    return 0
}

# sanitize_metadata_value: Clean metadata values for filesystem compatibility
# Arguments:
#   $1: Raw metadata value
# Returns:
#   Sanitized string safe for filesystem use
sanitize_metadata_value() {
    local value="$1"
    
    # Remove or replace problematic characters
    echo "$value" | sed -e 's|[<>:"/\\|?*]|-|g' \
                         -e 's/[[:cntrl:]]//g' \
                         -e 's/^[[:space:]]*//' \
                         -e 's/[[:space:]]*$//' \
                         -e 's/[[:space:]]\+/ /g' \
                         -e 's/^\.*//' \
                         -e 's/\.*$//'
}

# parse_track_metadata: Extract individual track metadata from exiftool output
# Arguments:
#   $1: exiftool JSON output
#   $2: callback function name (receives track JSON as argument)
parse_track_metadata() {
    local exiftool_output="$1"
    local callback_function="$2"
    
    if [[ -z "$exiftool_output" || -z "$callback_function" ]]; then
        return 1
    fi
    
    # Process each track
    echo "$exiftool_output" | jq -c '.[]' | while IFS= read -r track_json; do
        if command -v "$callback_function" >/dev/null 2>&1; then
            "$callback_function" "$track_json"
        else
            echo "ERROR: Callback function '$callback_function' not found" >&2
            return 1
        fi
    done
}

#
# DISCOGS METADATA ENRICHMENT FUNCTIONS
#

# extract_discogs_metadata: Extract enhanced metadata from Discogs release data
# Arguments:
#   $1: Discogs release JSON response
# Returns:
#   JSON object with extracted metadata
extract_discogs_metadata() {
    local release_json="$1"
    
    if [[ -z "$release_json" ]]; then
        return 1
    fi
    
    # Extract basic information
    local discogs_artist=$(echo "$release_json" | jq -r '.artists[0].name // empty' 2>/dev/null)
    local discogs_title=$(echo "$release_json" | jq -r '.title // empty' 2>/dev/null)
    local discogs_year=$(echo "$release_json" | jq -r '.year // empty' 2>/dev/null)
    local discogs_label=$(echo "$release_json" | jq -r '.labels[0].name // empty' 2>/dev/null)
    local discogs_catalog=$(echo "$release_json" | jq -r '.labels[0].catno // empty' 2>/dev/null)
    local discogs_genre=$(echo "$release_json" | jq -r '.genres[0] // empty' 2>/dev/null)
    local discogs_style=$(echo "$release_json" | jq -r '.styles[0] // empty' 2>/dev/null)
    
    # Extract remix artists
    local remix_artists=""
    if [[ "${DISCOGS_REMIX_ARTISTS:-1}" -eq 1 ]]; then
        remix_artists=$(echo "$release_json" | jq -r '.tracklist[]? | .title' 2>/dev/null | grep -i "remix\|rmx" | head -5 | tr '\n' ';' || echo "")
    fi
    
    # Extract label series information
    local label_series=""
    if [[ "${DISCOGS_LABEL_SERIES:-1}" -eq 1 ]]; then
        label_series=$(echo "$release_json" | jq -r '.series[]?.name // empty' 2>/dev/null | head -1)
    fi
    
    # Create enhanced metadata JSON
    jq -n \
        --arg artist "$discogs_artist" \
        --arg title "$discogs_title" \
        --arg year "$discogs_year" \
        --arg label "$discogs_label" \
        --arg catalog "$discogs_catalog" \
        --arg genre "$discogs_genre" \
        --arg style "$discogs_style" \
        --arg remix_artists "$remix_artists" \
        --arg label_series "$label_series" \
        '{
            artist: $artist,
            title: $title,
            year: $year,
            label: $label,
            catalog_number: $catalog,
            genre: $genre,
            style: $style,
            remix_artists: $remix_artists,
            label_series: $label_series
        }'
}

# calculate_discogs_confidence: Calculate confidence score for Discogs metadata match
# Arguments:
#   $1: Local artist name
#   $2: Local album title  
#   $3: Local year
#   $4: Discogs metadata JSON
# Returns:
#   Confidence score (0.0-1.0)
calculate_discogs_confidence() {
    local local_artist="$1"
    local local_album="$2"
    local local_year="$3"
    local discogs_metadata="$4"
    
    if [[ -z "$discogs_metadata" ]]; then
        echo "0.0"
        return
    fi
    
    local discogs_artist=$(echo "$discogs_metadata" | jq -r '.artist // empty')
    local discogs_title=$(echo "$discogs_metadata" | jq -r '.title // empty')
    local discogs_year=$(echo "$discogs_metadata" | jq -r '.year // empty')
    
    local confidence=0.0
    local max_score=3.0
    
    # Artist matching (weight: 1.0)
    if [[ -n "$local_artist" && -n "$discogs_artist" ]]; then
        # Normalize both artists for comparison
        local norm_local_artist=$(echo "$local_artist" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
        local norm_discogs_artist=$(echo "$discogs_artist" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
        
        local artist_similarity=0.0
        if [[ "$norm_local_artist" == "$norm_discogs_artist" ]]; then
            artist_similarity=1.0
        elif [[ "$norm_local_artist" == *"$norm_discogs_artist"* ]] || [[ "$norm_discogs_artist" == *"$norm_local_artist"* ]]; then
            artist_similarity=0.7
        else
            artist_similarity=0.0
        fi
        
        confidence=$(echo "$confidence + $artist_similarity" | bc -l 2>/dev/null || echo "$confidence")
    fi
    
    # Album matching (weight: 1.0)
    if [[ -n "$local_album" && -n "$discogs_title" ]]; then
        # Normalize both titles for comparison
        local norm_local=$(echo "$local_album" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
        local norm_discogs=$(echo "$discogs_title" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
        
        local album_similarity=0.0
        if [[ "$norm_local" == "$norm_discogs" ]]; then
            album_similarity=1.0
        elif [[ "$norm_local" == *"$norm_discogs"* ]] || [[ "$norm_discogs" == *"$norm_local"* ]]; then
            album_similarity=0.7
        else
            album_similarity=0.0
        fi
        
        confidence=$(echo "$confidence + $album_similarity" | bc -l 2>/dev/null || echo "$confidence")
    fi
    
    # Year matching (weight: 1.0)
    if [[ -n "$local_year" && -n "$discogs_year" ]]; then
        if [[ "$local_year" == "$discogs_year" ]]; then
            confidence=$(echo "$confidence + 1.0" | bc -l 2>/dev/null || echo "$confidence")
        elif [[ $((local_year - discogs_year)) -ge -2 && $((local_year - discogs_year)) -le 2 ]]; then
            confidence=$(echo "$confidence + 0.5" | bc -l 2>/dev/null || echo "$confidence")
        fi
    fi
    
    # Normalize to 0.0-1.0 range
    local normalized_confidence=$(echo "scale=2; $confidence / $max_score" | bc -l 2>/dev/null || echo "0.0")
    
    # Ensure we don't exceed 1.0
    if [[ $(echo "$normalized_confidence > 1.0" | bc -l 2>/dev/null) -eq 1 ]]; then
        normalized_confidence="1.0"
    fi
    
    echo "$normalized_confidence"
}

# enrich_metadata_with_discogs: Main function to enrich metadata with Discogs data
# Arguments:
#   $1: Album artist
#   $2: Album title
#   $3: Album year
# Returns:
#   JSON object with enriched metadata including confidence score
# Note: This function requires discogs_search_releases() and discogs_get_release() 
#       functions to be available in the calling environment
enrich_metadata_with_discogs() {
    local album_artist="$1"
    local album_title="$2"
    local album_year="$3"
    
    # Check if Discogs functions are available
    if ! command -v discogs_search_releases >/dev/null 2>&1 || ! command -v discogs_get_release >/dev/null 2>&1; then
        echo "{}"
        return 0
    fi
    
    if [[ "${DISCOGS_ENABLED:-0}" -eq 0 ]]; then
        echo "{}"
        return 0
    fi
    
    # Search for releases
    local search_results
    search_results=$(discogs_search_releases "$album_artist" "$album_title" "$album_year")
    
    if [[ -z "$search_results" ]]; then
        echo "{}"
        return 0
    fi
    
    # Get the first (most relevant) result
    local first_result_id=$(echo "$search_results" | jq -r '.results[0].id // empty' 2>/dev/null)
    
    if [[ -z "$first_result_id" ]]; then
        echo "{}"
        return 0
    fi
    
    # Get detailed release information
    local release_details
    release_details=$(discogs_get_release "$first_result_id")
    
    if [[ -z "$release_details" ]]; then
        echo "{}"
        return 0
    fi
    
    # Extract enhanced metadata
    local enhanced_metadata
    enhanced_metadata=$(extract_discogs_metadata "$release_details")
    
    if [[ -z "$enhanced_metadata" ]]; then
        echo "{}"
        return 0
    fi
    
    # Calculate confidence score
    local confidence
    confidence=$(calculate_discogs_confidence "$album_artist" "$album_title" "$album_year" "$enhanced_metadata")
    
    # Add confidence score to metadata
    enhanced_metadata=$(echo "$enhanced_metadata" | jq --arg conf "$confidence" '. + {confidence: ($conf | tonumber)}')
    
    echo "$enhanced_metadata"
}

#
# UTILITY FUNCTIONS
#

# get_metadata_summary: Generate a human-readable summary of album metadata
# Arguments:
#   $1: Album metadata JSON
#   $2: Album quality string
# Returns:
#   Formatted summary string
get_metadata_summary() {
    local album_metadata="$1"
    local album_quality="$2"
    
    if [[ -z "$album_metadata" ]]; then
        echo "No metadata available"
        return 1
    fi
    
    local artist=$(echo "$album_metadata" | jq -r '.artist // "Unknown Artist"')
    local title=$(echo "$album_metadata" | jq -r '.title // "Unknown Title"')
    local year=$(echo "$album_metadata" | jq -r '.year // "Unknown Year"')
    local track_count=$(echo "$album_metadata" | jq -r '.track_count // 0')
    
    echo "Artist: $artist | Title: $title | Year: $year | Quality: ${album_quality:-Unknown} | Tracks: $track_count"
}

# Note: Functions are automatically available when this module is sourced
# The functions are defined in the current shell environment and available to calling scripts