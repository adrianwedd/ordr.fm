#!/bin/bash
#
# lib/duplicate_analysis.sh - Deep Duplicate Analysis for Quality Selection
#
# This module implements comprehensive duplicate detection with quality-based
# selection as requested by the user. It analyzes duplicates and automatically
# selects the best quality version while moving others to duplicates/ directory.

# Source common utilities
source "${BASH_SOURCE%/*}/common.sh"

# Configuration
DUPLICATE_BASE_DIR="${DUPLICATE_BASE_DIR:-duplicates}"
DUPLICATE_ANALYSIS_ENABLED="${DUPLICATE_ANALYSIS_ENABLED:-1}"
QUALITY_PREFERENCE_ORDER="${QUALITY_PREFERENCE_ORDER:-FLAC,ALAC,WAV,MP3_320,MP3_256,MP3_192,MP3_128}"

#
# QUALITY SCORING SYSTEM
#

# calculate_audio_quality_score: Calculate comprehensive quality score
# Input: file_path
# Output: numeric score (higher = better quality)
calculate_audio_quality_score() {
    local file_path="$1"
    local score=0
    
    # Get file extension and metadata
    local extension="${file_path##*.}"
    extension=$(echo "$extension" | tr '[:upper:]' '[:lower:]')
    
    # Base format scoring
    case "$extension" in
        flac) score=1000 ;;
        alac) score=900 ;;
        wav) score=850 ;;
        aiff) score=800 ;;
        mp3)
            # Analyze MP3 bitrate for more precise scoring
            local bitrate=$(get_mp3_bitrate "$file_path")
            case "$bitrate" in
                320) score=700 ;;
                256) score=600 ;;
                192) score=500 ;;
                160) score=400 ;;
                128) score=300 ;;
                *) score=250 ;;
            esac
            ;;
        m4a|aac) score=650 ;;
        ogg) score=550 ;;
        *) score=100 ;;
    esac
    
    # File size bonus (larger files generally better quality)
    local file_size=$(stat -c%s "$file_path" 2>/dev/null || echo 0)
    local size_mb=$((file_size / 1048576))
    local size_bonus=$(( size_mb / 10 ))  # 1 point per 10MB
    score=$((score + size_bonus))
    
    # Source quality indicators (from filename/path)
    if echo "$file_path" | grep -qi "vinyl\|lp\|record"; then
        score=$((score + 50))  # Vinyl source bonus
    elif echo "$file_path" | grep -qi "cd\|compact.disk"; then
        score=$((score + 30))  # CD source bonus
    elif echo "$file_path" | grep -qi "web\|digital"; then
        score=$((score + 20))  # Digital source bonus
    fi
    
    # Penalize scene releases and compressed versions
    if echo "$file_path" | grep -qi "scene\|rip\|dvdrip"; then
        score=$((score - 100))
    fi
    
    echo "$score"
}

# get_mp3_bitrate: Extract MP3 bitrate using exiftool
get_mp3_bitrate() {
    local file_path="$1"
    
    if command -v exiftool >/dev/null 2>&1; then
        exiftool -AudioBitrate "$file_path" 2>/dev/null | grep -oE '[0-9]+' | head -1
    else
        echo "192"  # Default assumption
    fi
}

#
# DUPLICATE DETECTION ENGINE
#

# find_duplicate_albums: Identify potential duplicate albums
# Input: albums_list_file
# Output: duplicate_groups_json
find_duplicate_albums() {
    local albums_file="$1"
    local duplicates_file="/tmp/duplicates_$(date +%s).json"
    
    log $LOG_INFO "Starting duplicate analysis..."
    
    # Create duplicate detection based on:
    # 1. Artist name similarity (fuzzy matching)
    # 2. Album title similarity  
    # 3. Track count similarity
    # 4. Duration similarity (if available)
    
    declare -A album_signatures
    local duplicate_groups=()
    
    while IFS= read -r album_path; do
        if [[ ! -d "$album_path" ]]; then continue; fi
        
        local signature=$(generate_album_signature "$album_path")
        local key=$(echo "$signature" | cut -d'|' -f1-2)  # artist|title
        
        if [[ -n "${album_signatures[$key]:-}" ]]; then
            # Found potential duplicate
            log $LOG_DEBUG "Potential duplicate found: $album_path"
            duplicate_groups+=("${album_signatures[$key]}|$album_path")
        else
            album_signatures["$key"]="$album_path"
        fi
        
    done < "$albums_file"
    
    # Output duplicate groups as JSON
    printf '{\n  "duplicate_groups": [\n'
    local first=true
    for group in "${duplicate_groups[@]}"; do
        if [[ "$first" == "true" ]]; then
            first=false
        else
            printf ',\n'
        fi
        
        IFS='|' read -ra albums <<< "$group"
        printf '    {\n      "albums": [\n'
        for ((i=0; i<${#albums[@]}; i++)); do
            printf '        "%s"' "${albums[i]}"
            if [[ $i -lt $((${#albums[@]}-1)) ]]; then
                printf ','
            fi
            printf '\n'
        done
        printf '      ]\n    }'
    done
    printf '\n  ]\n}\n' > "$duplicates_file"
    
    echo "$duplicates_file"
}

# generate_album_signature: Create identifying signature for album
generate_album_signature() {
    local album_path="$1"
    local album_name=$(basename "$album_path")
    
    # Extract basic info for comparison
    local artist="" title="" track_count=0
    
    # Try to extract from directory name
    if [[ "$album_name" =~ ^([^-]+)[[:space:]]*-[[:space:]]*(.+)$ ]]; then
        artist="${BASH_REMATCH[1]}"
        title="${BASH_REMATCH[2]}"
    else
        title="$album_name"
    fi
    
    # Count audio files
    track_count=$(find "$album_path" -maxdepth 2 -type f -iname "*.mp3" -o -iname "*.flac" -o -iname "*.wav" | wc -l)
    
    # Normalize for comparison
    artist=$(echo "$artist" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
    title=$(echo "$title" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
    
    echo "$artist|$title|$track_count"
}

#
# QUALITY-BASED DUPLICATE RESOLUTION
#

# resolve_duplicates: Analyze duplicates and select best quality versions
# Input: duplicate_groups_json
# Output: resolution_actions_json
resolve_duplicates() {
    local duplicates_file="$1"
    local resolution_file="/tmp/duplicate_resolution_$(date +%s).json"
    
    log $LOG_INFO "Resolving duplicates with quality analysis..."
    
    if [[ ! -f "$duplicates_file" ]]; then
        log $LOG_ERROR "Duplicates file not found: $duplicates_file"
        return 1
    fi
    
    # Process each duplicate group
    local group_count=0
    printf '{\n  "resolutions": [\n' > "$resolution_file"
    
    # Parse duplicate groups and analyze each
    jq -r '.duplicate_groups[] | @base64' "$duplicates_file" 2>/dev/null | while read -r encoded_group; do
        local group_json=$(echo "$encoded_group" | base64 -d)
        local albums=($(echo "$group_json" | jq -r '.albums[]'))
        
        if [[ ${#albums[@]} -lt 2 ]]; then continue; fi
        
        log $LOG_DEBUG "Analyzing duplicate group with ${#albums[@]} albums"
        
        # Analyze quality of each album in the group
        local best_album=""
        local best_score=0
        declare -A album_scores
        
        for album_path in "${albums[@]}"; do
            local album_score=$(analyze_album_quality "$album_path")
            album_scores["$album_path"]="$album_score"
            
            if [[ $album_score -gt $best_score ]]; then
                best_score=$album_score
                best_album="$album_path"
            fi
        done
        
        # Generate resolution actions
        if [[ $group_count -gt 0 ]]; then
            printf ',\n' >> "$resolution_file"
        fi
        
        printf '    {\n      "best_album": "%s",\n      "best_score": %d,\n      "actions": [\n' "$best_album" "$best_score" >> "$resolution_file"
        
        local action_count=0
        for album_path in "${albums[@]}"; do
            if [[ "$album_path" != "$best_album" ]]; then
                if [[ $action_count -gt 0 ]]; then
                    printf ',\n' >> "$resolution_file"
                fi
                
                local reason=$(determine_duplicate_reason "$album_path" "$best_album" "${album_scores[$album_path]}" "$best_score")
                printf '        {\n          "action": "move_to_duplicates",\n          "source": "%s",\n          "reason": "%s",\n          "score": %d\n        }' \
                    "$album_path" "$reason" "${album_scores[$album_path]}" >> "$resolution_file"
                
                ((action_count++))
            fi
        done
        
        printf '\n      ]\n    }' >> "$resolution_file"
        ((group_count++))
    done
    
    printf '\n  ]\n}\n' >> "$resolution_file"
    
    echo "$resolution_file"
}

# analyze_album_quality: Comprehensive quality analysis for entire album
analyze_album_quality() {
    local album_path="$1"
    local total_score=0
    local file_count=0
    
    # Analyze all audio files in album
    while IFS= read -r -d '' audio_file; do
        local file_score=$(calculate_audio_quality_score "$audio_file")
        total_score=$((total_score + file_score))
        ((file_count++))
    done < <(find "$album_path" -maxdepth 2 -type f -iname "*.mp3" -o -iname "*.flac" -o -iname "*.wav" -o -iname "*.m4a" -print0 2>/dev/null)
    
    if [[ $file_count -gt 0 ]]; then
        # Average quality score
        echo $((total_score / file_count))
    else
        echo 0
    fi
}

# determine_duplicate_reason: Generate human-readable reason for duplicate action
determine_duplicate_reason() {
    local source_album="$1"
    local best_album="$2" 
    local source_score="$3"
    local best_score="$4"
    
    local score_diff=$((best_score - source_score))
    
    if [[ $score_diff -gt 500 ]]; then
        echo "Much lower quality (score difference: $score_diff)"
    elif [[ $score_diff -gt 200 ]]; then
        echo "Lower quality (score difference: $score_diff)"
    elif echo "$source_album" | grep -qi "scene\|rip"; then
        echo "Scene release (preferring official release)"
    elif echo "$source_album" | grep -qi "mp3" && echo "$best_album" | grep -qi "flac\|wav"; then
        echo "Lossy format (preferring lossless)"
    else
        echo "Lower overall quality score ($source_score vs $best_score)"
    fi
}

#
# DUPLICATE PROCESSING ACTIONS
#

# execute_duplicate_resolution: Execute the duplicate resolution actions
# Input: resolution_actions_json dry_run_flag
execute_duplicate_resolution() {
    local resolution_file="$1"
    local dry_run="${2:-1}"
    
    if [[ ! -f "$resolution_file" ]]; then
        log $LOG_ERROR "Resolution file not found: $resolution_file"
        return 1
    fi
    
    log $LOG_INFO "Executing duplicate resolution (dry_run: $dry_run)..."
    
    # Create duplicates directory structure
    local duplicates_dir="$DUPLICATE_BASE_DIR"
    if [[ $dry_run -eq 0 ]]; then
        mkdir -p "$duplicates_dir"/{lower_quality,scene_releases,format_preference,other}
    fi
    
    # Process each resolution group
    jq -r '.resolutions[] | @base64' "$resolution_file" 2>/dev/null | while read -r encoded_resolution; do
        local resolution_json=$(echo "$encoded_resolution" | base64 -d)
        local best_album=$(echo "$resolution_json" | jq -r '.best_album')
        
        log $LOG_INFO "Keeping best quality album: $(basename "$best_album")"
        
        # Process each action
        echo "$resolution_json" | jq -r '.actions[] | @base64' | while read -r encoded_action; do
            local action_json=$(echo "$encoded_action" | base64 -d)
            local source=$(echo "$action_json" | jq -r '.source')
            local reason=$(echo "$action_json" | jq -r '.reason')
            local score=$(echo "$action_json" | jq -r '.score')
            
            # Determine target subdirectory based on reason
            local target_subdir="other"
            if echo "$reason" | grep -qi "quality"; then
                target_subdir="lower_quality"
            elif echo "$reason" | grep -qi "scene"; then
                target_subdir="scene_releases"
            elif echo "$reason" | grep -qi "format\|lossy"; then
                target_subdir="format_preference"
            fi
            
            local target_dir="$duplicates_dir/$target_subdir/$(basename "$source")"
            
            if [[ $dry_run -eq 1 ]]; then
                log $LOG_INFO "(DRY RUN) Would move: $(basename "$source") -> $target_subdir/ ($reason)"
            else
                log $LOG_INFO "Moving duplicate: $(basename "$source") -> $target_subdir/ ($reason)"
                
                if mkdir -p "$(dirname "$target_dir")" && mv "$source" "$target_dir"; then
                    # Create metadata file explaining the move
                    cat > "$target_dir/.duplicate_info.txt" << EOF
Duplicate Detection Report
=========================
Moved on: $(date)
Reason: $reason
Quality Score: $score
Preferred Version: $best_album
Original Location: $source

This album was automatically moved because a higher quality
version was found. The preferred version has been kept in
the main music library.
EOF
                    log $LOG_INFO "Successfully moved duplicate album"
                else
                    log $LOG_ERROR "Failed to move duplicate album: $source"
                fi
            fi
        done
    done
    
    return 0
}

# Export functions
export -f calculate_audio_quality_score get_mp3_bitrate
export -f find_duplicate_albums generate_album_signature  
export -f resolve_duplicates analyze_album_quality determine_duplicate_reason
export -f execute_duplicate_resolution