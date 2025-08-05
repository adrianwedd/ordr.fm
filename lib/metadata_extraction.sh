#!/bin/bash
# Metadata extraction module for ordr.fm
# Handles audio file metadata extraction and analysis

# Source common utilities
source "${BASH_SOURCE%/*}/common.sh"

# Extract metadata from audio files in directory
extract_album_metadata() {
    local album_dir="$1"
    local exiftool_output=""
    
    log $LOG_DEBUG "Extracting metadata from: $album_dir"
    
    # Use exiftool to extract metadata in JSON format
    exiftool_output=$(exiftool -j -Artist -AlbumArtist -Album -Title -Track -DiscNumber \
        -Year -Date -Genre -FileType -AudioBitrate -SampleRate -Duration \
        -FileSize -Label -CatalogNumber -Publisher -Organization \
        "$album_dir"/*.{mp3,flac,wav,m4a,ogg,aiff,alac,opus,wma} 2>/dev/null || echo "[]")
    
    echo "$exiftool_output"
}

# Analyze album quality based on formats
determine_album_quality() {
    local exiftool_output="$1"
    local has_lossless=0
    local has_lossy=0
    
    # Parse formats from exiftool output
    local formats=$(echo "$exiftool_output" | jq -r '.[].FileType' 2>/dev/null | sort -u)
    
    while IFS= read -r format; do
        [[ -z "$format" ]] && continue
        
        case "${format^^}" in
            FLAC|WAV|AIFF|ALAC)
                has_lossless=1
                ;;
            MP3|AAC|M4A|OGG|OPUS|WMA)
                has_lossy=1
                ;;
        esac
    done <<< "$formats"
    
    # Determine quality type
    if [[ $has_lossless -eq 1 ]] && [[ $has_lossy -eq 1 ]]; then
        echo "Mixed"
    elif [[ $has_lossless -eq 1 ]]; then
        echo "Lossless"
    elif [[ $has_lossy -eq 1 ]]; then
        echo "Lossy"
    else
        echo "Unknown"
    fi
}

# Extract album-level metadata from track metadata
extract_album_info() {
    local exiftool_output="$1"
    
    # Extract album artist (prefer AlbumArtist over Artist)
    local album_artist=$(echo "$exiftool_output" | \
        jq -r '[.[] | select(.AlbumArtist != null) | .AlbumArtist] | .[0] // 
               [.[] | select(.Artist != null) | .Artist] | .[0] // ""' 2>/dev/null)
    
    # Extract album title
    local album_title=$(echo "$exiftool_output" | \
        jq -r '[.[] | select(.Album != null) | .Album] | .[0] // ""' 2>/dev/null)
    
    # Extract year (prefer Year over Date)
    local album_year=$(echo "$exiftool_output" | \
        jq -r '[.[] | select(.Year != null) | .Year] | .[0] // 
               [.[] | select(.Date != null) | .Date] | .[0] // ""' 2>/dev/null | \
        grep -oE '^[0-9]{4}' | head -1)
    
    # Extract label info
    local label=$(echo "$exiftool_output" | \
        jq -r '[.[] | select(.Label != null) | .Label] | .[0] // 
               [.[] | select(.Publisher != null) | .Publisher] | .[0] // 
               [.[] | select(.Organization != null) | .Organization] | .[0] // ""' 2>/dev/null)
    
    # Extract catalog number
    local catalog=$(echo "$exiftool_output" | \
        jq -r '[.[] | select(.CatalogNumber != null) | .CatalogNumber] | .[0] // ""' 2>/dev/null)
    
    # Extract genre
    local genre=$(echo "$exiftool_output" | \
        jq -r '[.[] | select(.Genre != null) | .Genre] | .[0] // ""' 2>/dev/null)
    
    # Count tracks
    local track_count=$(echo "$exiftool_output" | jq 'length' 2>/dev/null)
    
    # Calculate total size
    local total_size=$(echo "$exiftool_output" | \
        jq '[.[] | select(.FileSize != null) | .FileSize] | map(gsub(" MB"; "") | tonumber * 1048576) | add' 2>/dev/null)
    
    # Calculate average bitrate
    local avg_bitrate=$(echo "$exiftool_output" | \
        jq '[.[] | select(.AudioBitrate != null) | .AudioBitrate | gsub(" kbps"; "") | tonumber] | add / length' 2>/dev/null)
    
    # Output as pipe-delimited string
    echo "${album_artist}|${album_title}|${album_year}|${label}|${catalog}|${genre}|${track_count}|${total_size}|${avg_bitrate}"
}

# Extract track information
extract_track_info() {
    local exiftool_output="$1"
    local tracks_json=""
    
    # Extract relevant track information
    tracks_json=$(echo "$exiftool_output" | jq -c '[.[] | {
        file: .SourceFile,
        track: .Track,
        disc: .DiscNumber,
        title: .Title,
        artist: .Artist,
        duration: .Duration,
        bitrate: .AudioBitrate,
        format: .FileType,
        size: .FileSize
    }]' 2>/dev/null)
    
    echo "$tracks_json"
}

# Generate album hash for duplicate detection
generate_album_hash() {
    local album_artist="$1"
    local album_title="$2"
    local track_count="$3"
    local total_duration="$4"
    
    # Create a unique identifier for the album
    local hash_input="${album_artist}|${album_title}|${track_count}|${total_duration}"
    local hash=$(echo -n "$hash_input" | md5sum | cut -d' ' -f1)
    
    echo "$hash"
}

# Calculate quality score for duplicate resolution
calculate_quality_score() {
    local quality_type="$1"
    local avg_bitrate="$2"
    local format_mix="$3"
    
    local score=0
    
    # Base score from quality type
    case "$quality_type" in
        "Lossless") score=1000 ;;
        "Mixed") score=500 ;;
        "Lossy") score=0 ;;
    esac
    
    # Add bitrate component (normalized to 0-500)
    if [[ -n "$avg_bitrate" ]]; then
        local bitrate_score=$(echo "scale=2; $avg_bitrate * 500 / 1411" | bc)
        score=$(echo "$score + $bitrate_score" | bc)
    fi
    
    # Bonus for specific formats
    if echo "$format_mix" | grep -i "FLAC" >/dev/null; then
        score=$(echo "$score + 100" | bc)
    fi
    
    echo "$score"
}

# Check if directory contains audio files
directory_has_audio_files() {
    local dir="$1"
    local audio_extensions="mp3|flac|wav|m4a|ogg|aiff|alac|opus|wma"
    
    if find "$dir" -maxdepth 1 -type f -iregex ".*\.($audio_extensions)$" -print -quit | grep -q .; then
        return 0
    fi
    
    return 1
}

# Count audio files in directory
count_audio_files() {
    local dir="$1"
    local audio_extensions="mp3|flac|wav|m4a|ogg|aiff|alac|opus|wma"
    
    find "$dir" -maxdepth 1 -type f -iregex ".*\.($audio_extensions)$" 2>/dev/null | wc -l
}

# Get format distribution
get_format_distribution() {
    local exiftool_output="$1"
    
    # Count each format
    local format_counts=$(echo "$exiftool_output" | \
        jq -r '.[].FileType' 2>/dev/null | \
        sort | uniq -c | \
        awk '{printf "%s:%d ", $2, $1}')
    
    echo "${format_counts% }"
}

# Export all functions
export -f extract_album_metadata determine_album_quality extract_album_info
export -f extract_track_info generate_album_hash calculate_quality_score
export -f directory_has_audio_files count_audio_files get_format_distribution