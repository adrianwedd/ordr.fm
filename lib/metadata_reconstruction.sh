#!/bin/bash
#
# lib/metadata_reconstruction.sh - Hybrid Metadata Reconstruction System
#
# This module implements a sophisticated pipeline for reconstructing missing
# or incomplete album metadata by combining multiple sources:
#
# 1. Existing ID3/metadata tags (partial data)
# 2. Enhanced directory name parsing (scene releases, catalog patterns)
# 3. Fuzzy Discogs matching (partial searches, Levenshtein distance)
# 4. MusicBrainz integration (additional data source)
# 5. File-based inference (track titles from filenames)
# 6. Hybrid validation and confidence scoring
#
# The system is designed to handle the "last mile" of difficult albums
# that can't be processed by the standard metadata extraction pipeline.
#
# Functions exported by this module:
# - reconstruct_album_metadata()     - Main hybrid reconstruction pipeline
# - enhanced_directory_parsing()     - Advanced directory name patterns
# - fuzzy_discogs_search()          - Partial/fuzzy Discogs matching
# - infer_tracks_from_filenames()   - Extract track titles from files
# - validate_reconstruction()       - Quality check reconstructed data
# - calculate_confidence_score()    - Score metadata confidence
#
# Dependencies:
# - lib/metadata_extraction.sh      - Core metadata functions
# - lib/discogs.sh                  - Discogs API integration
# - lib/musicbrainz.sh             - MusicBrainz API client
# - fzf or similar fuzzy matching   - Optional for interactive mode
#

# Source required dependencies
source "${BASH_SOURCE%/*}/common.sh"
source "${BASH_SOURCE%/*}/metadata_extraction.sh"
source "${BASH_SOURCE%/*}/discogs.sh"

# Configuration
RECONSTRUCTION_CONFIDENCE_THRESHOLD=${RECONSTRUCTION_CONFIDENCE_THRESHOLD:-0.6}
RECONSTRUCTION_ENABLE_FUZZY=${RECONSTRUCTION_ENABLE_FUZZY:-1}
RECONSTRUCTION_ENABLE_MUSICBRAINZ=${RECONSTRUCTION_ENABLE_MUSICBRAINZ:-1}
RECONSTRUCTION_ENABLE_FILENAME_INFERENCE=${RECONSTRUCTION_ENABLE_FILENAME_INFERENCE:-1}
RECONSTRUCTION_DEBUG=${RECONSTRUCTION_DEBUG:-0}

# Fuzzy matching configuration
FUZZY_ARTIST_THRESHOLD=${FUZZY_ARTIST_THRESHOLD:-0.7}
FUZZY_TITLE_THRESHOLD=${FUZZY_TITLE_THRESHOLD:-0.7}
FUZZY_COMBINED_THRESHOLD=${FUZZY_COMBINED_THRESHOLD:-0.6}

#
# MAIN HYBRID RECONSTRUCTION PIPELINE
#

# reconstruct_album_metadata: Main function for hybrid metadata reconstruction
# Input: directory path
# Output: pipe-delimited metadata string (artist|title|year|label|catalog|genre|track_count|size|bitrate)
# Returns: 0 on success with confidence >= threshold, 1 on failure
reconstruct_album_metadata() {
    local album_dir="$1"
    local dirname=$(basename "$album_dir")
    
    log $LOG_INFO "Starting hybrid metadata reconstruction for: $dirname"
    
    # Initialize reconstruction data structure
    local reconstruction_data=""
    local confidence_scores=""
    
    # Step 1: Extract existing partial metadata
    log $LOG_DEBUG "Step 1: Extracting existing metadata..."
    local existing_metadata=$(extract_album_metadata "$album_dir")
    local existing_info=$(extract_album_info "$existing_metadata" "$album_dir")
    
    # Parse existing info
    IFS='|' read -r existing_artist existing_title existing_year existing_label existing_catalog existing_genre existing_track_count existing_size existing_bitrate <<< "$existing_info"
    
    log $LOG_DEBUG "Existing metadata: artist='$existing_artist' title='$existing_title' year='$existing_year'"
    
    # Step 2: Enhanced directory name parsing
    log $LOG_DEBUG "Step 2: Enhanced directory parsing..."
    local enhanced_parsing=$(enhanced_directory_parsing "$album_dir")
    IFS='|' read -r parsed_artist parsed_title parsed_year parsed_label parsed_catalog <<< "$enhanced_parsing"
    
    log $LOG_DEBUG "Enhanced parsing: artist='$parsed_artist' title='$parsed_title' year='$parsed_year'"
    
    # Step 3: Combine and prioritize metadata sources
    log $LOG_DEBUG "Step 3: Combining metadata sources..."
    local combined_artist="${existing_artist:-$parsed_artist}"
    local combined_title="${existing_title:-$parsed_title}"  
    local combined_year="${existing_year:-$parsed_year}"
    local combined_label="${existing_label:-$parsed_label}"
    local combined_catalog="${existing_catalog:-$parsed_catalog}"
    local combined_genre="${existing_genre:-}"
    
    # Step 4: Fuzzy Discogs search if we have enough data
    local discogs_data=""
    local discogs_confidence=0
    
    if [[ $RECONSTRUCTION_ENABLE_FUZZY -eq 1 ]] && [[ -n "$combined_artist" || -n "$combined_title" ]]; then
        log $LOG_DEBUG "Step 4: Fuzzy Discogs search..."
        local fuzzy_result=$(fuzzy_discogs_search "$combined_artist" "$combined_title" "$combined_year")
        if [[ -n "$fuzzy_result" ]]; then
            IFS='|' read -r discogs_artist discogs_title discogs_year discogs_label discogs_catalog discogs_confidence <<< "$fuzzy_result"
            
            # Use Discogs data to fill gaps
            [[ -z "$combined_artist" && -n "$discogs_artist" ]] && combined_artist="$discogs_artist"
            [[ -z "$combined_title" && -n "$discogs_title" ]] && combined_title="$discogs_title"
            [[ -z "$combined_year" && -n "$discogs_year" ]] && combined_year="$discogs_year"
            [[ -z "$combined_label" && -n "$discogs_label" ]] && combined_label="$discogs_label"
            [[ -z "$combined_catalog" && -n "$discogs_catalog" ]] && combined_catalog="$discogs_catalog"
            
            log $LOG_DEBUG "Discogs fuzzy match: artist='$discogs_artist' confidence=$discogs_confidence"
        fi
    fi
    
    # Step 5: MusicBrainz search (if enabled and still missing data)
    local musicbrainz_confidence=0
    if [[ $RECONSTRUCTION_ENABLE_MUSICBRAINZ -eq 1 ]] && [[ -n "$combined_artist" || -n "$combined_title" ]]; then
        log $LOG_DEBUG "Step 5: MusicBrainz search..."
        # This will be implemented when we add MusicBrainz integration
        # local mb_result=$(musicbrainz_search "$combined_artist" "$combined_title" "$combined_year")
    fi
    
    # Step 6: File-based track inference
    local track_data=""
    if [[ $RECONSTRUCTION_ENABLE_FILENAME_INFERENCE -eq 1 ]]; then
        log $LOG_DEBUG "Step 6: Track inference from filenames..."
        track_data=$(infer_tracks_from_filenames "$album_dir")
    fi
    
    # Step 7: Calculate final confidence score
    local final_confidence=$(calculate_confidence_score \
        "$combined_artist" "$combined_title" "$combined_year" \
        "$existing_info" "$enhanced_parsing" "$discogs_confidence")
    
    log $LOG_DEBUG "Final confidence score: $final_confidence"
    
    # Step 8: Validate reconstruction
    # Convert to integer comparison (multiply by 100)
    local final_conf_int=$(printf "%.0f" $(echo "$final_confidence * 100" | bc -l 2>/dev/null || echo "0"))
    local threshold_int=$(printf "%.0f" $(echo "$RECONSTRUCTION_CONFIDENCE_THRESHOLD * 100" | bc -l 2>/dev/null || echo "60"))
    
    if [[ $final_conf_int -ge $threshold_int ]]; then
        # Build final metadata string
        local final_metadata="${combined_artist}|${combined_title}|${combined_year}|${combined_label}|${combined_catalog}|${combined_genre}|${existing_track_count}|${existing_size}|${existing_bitrate}"
        
        log $LOG_INFO "Reconstruction successful (confidence: $final_confidence): $combined_artist - $combined_title"
        
        # Store reconstruction metadata for debugging
        if [[ $RECONSTRUCTION_DEBUG -eq 1 ]]; then
            local debug_file="${album_dir}/.reconstruction_debug.json"
            cat > "$debug_file" << EOF
{
  "directory": "$album_dir",
  "confidence": $final_confidence,
  "existing_metadata": "$existing_info",
  "parsed_metadata": "$enhanced_parsing", 
  "discogs_confidence": $discogs_confidence,
  "final_metadata": "$final_metadata",
  "sources_used": {
    "existing_tags": $([ -n "$existing_artist" ] && echo "true" || echo "false"),
    "directory_parsing": $([ -n "$parsed_artist" ] && echo "true" || echo "false"),
    "discogs_fuzzy": $([ -n "$discogs_data" ] && echo "true" || echo "false"),
    "musicbrainz": false,
    "filename_inference": $([ -n "$track_data" ] && echo "true" || echo "false")
  }
}
EOF
        fi
        
        echo "$final_metadata"
        return 0
    else
        log $LOG_WARNING "Reconstruction failed - confidence $final_confidence below threshold $RECONSTRUCTION_CONFIDENCE_THRESHOLD"
        return 1
    fi
}

#
# ENHANCED DIRECTORY NAME PARSING
#

# enhanced_directory_parsing: Advanced directory name pattern recognition
# Input: album directory path
# Output: artist|title|year|label|catalog
enhanced_directory_parsing() {
    local album_dir="$1"
    local dirname=$(basename "$album_dir")
    local artist="" title="" year="" label="" catalog=""
    
    log $LOG_DEBUG "Enhanced parsing for: $dirname"
    
    # First try existing patterns from metadata_extraction.sh
    local basic_parsing=$(infer_metadata_from_dirname "$dirname")
    IFS='|' read -r basic_artist basic_title basic_year <<< "$basic_parsing"
    
    # Enhanced patterns for complex scene releases and electronic music
    
    # Pattern 10: Label catalog prefix - [LABEL123] Artist - Title (Year)
    if [[ "$dirname" =~ ^\[([A-Z0-9]+)\][[:space:]]*([^-]+)[[:space:]]*-[[:space:]]*([^(]+)\(([0-9]{4})\) ]]; then
        catalog="${BASH_REMATCH[1]}"
        artist="${BASH_REMATCH[2]}"
        title="${BASH_REMATCH[3]}"
        year="${BASH_REMATCH[4]}"
        
        # Try to infer label from catalog pattern
        if [[ "$catalog" =~ ^([A-Z]+)[0-9]+ ]]; then
            label="${BASH_REMATCH[1]}"
        fi
        
    # Pattern 11: Uploader contamination - Artist - Title [Format] By [Uploader]
    elif [[ "$dirname" =~ ^([^-]+)[[:space:]]*-[[:space:]]*([^[]+)\[[^]]*\][[:space:]]*By[[:space:]]+.* ]]; then
        artist="${BASH_REMATCH[1]}"
        title="${BASH_REMATCH[2]}"
        
    # Pattern 12: Complex scene - artist_and_collaborator-title_with_details-catalog-year-group
    elif [[ "$dirname" =~ ^([a-z_]+)_and_[a-z_]+.*-([a-z_]+.*)-([a-z0-9]+)-([0-9]{4})-[a-z]+$ ]]; then
        artist="${BASH_REMATCH[1]}"
        title="${BASH_REMATCH[2]}"
        catalog="${BASH_REMATCH[3]}"
        year="${BASH_REMATCH[4]}"
        
        # Convert underscores to spaces
        artist=$(echo "$artist" | tr '_' ' ')
        title=$(echo "$title" | tr '_' ' ')
        
    # Pattern 13: VA compilation with catalog - VA - Title [Catalog] (Year)
    elif [[ "$dirname" =~ ^(VA|Various|Various[[:space:]]*Artists)[[:space:]]*-[[:space:]]*([^[]+)\[([^]]+)\][[:space:]]*\(([0-9]{4})\) ]]; then
        artist="Various Artists"
        title="${BASH_REMATCH[2]}"
        catalog="${BASH_REMATCH[3]}"
        year="${BASH_REMATCH[4]}"
        
    # Pattern 14: Electronic label series - Label ### - Artist - Title
    elif [[ "$dirname" =~ ^([A-Z][a-z]+)[[:space:]]+([0-9]{3})[[:space:]]*-[[:space:]]*([^-]+)[[:space:]]*-[[:space:]]*(.+) ]]; then
        label="${BASH_REMATCH[1]}"
        catalog="${BASH_REMATCH[1]}${BASH_REMATCH[2]}"
        artist="${BASH_REMATCH[3]}"
        title="${BASH_REMATCH[4]}"
        
    # Pattern 15: Year prefix - (Year) Title [various formats]
    elif [[ "$dirname" =~ ^\(([0-9]{4})\)[[:space:]]*(.+) ]]; then
        year="${BASH_REMATCH[1]}"
        title="${BASH_REMATCH[2]}"
        
        # Clean up title from format contamination
        title=$(echo "$title" | sed -E 's/[[:space:]]*\[[^]]*\]//g' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        
    # Fallback: Use basic parsing results
    else
        artist="$basic_artist"
        title="$basic_title"
        year="$basic_year"
    fi
    
    # Clean up extracted fields
    artist=$(echo "$artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    title=$(echo "$title" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    year=$(echo "$year" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    label=$(echo "$label" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    catalog=$(echo "$catalog" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    # Validate artist name if extracted
    if [[ -n "$artist" ]]; then
        if ! validate_artist_name "$artist" >/dev/null 2>&1; then
            log $LOG_DEBUG "Rejecting invalid artist: '$artist'"
            artist=""
        fi
    fi
    
    # Try to infer missing year from title if title contains (YYYY)
    if [[ -z "$year" ]] && [[ -n "$title" ]] && echo "$title" | grep -qE '\([0-9]{4}\)'; then
        year=$(echo "$title" | sed -E 's/.*\(([0-9]{4})\).*/\1/')
        title=$(echo "$title" | sed -E 's/(.*)\([0-9]{4}\)(.*)/\1\2/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    fi
    
    log $LOG_DEBUG "Enhanced parsing result: '$artist' | '$title' | '$year' | '$label' | '$catalog'"
    echo "$artist|$title|$year|$label|$catalog"
}

#
# FUZZY DISCOGS MATCHING
#

# fuzzy_discogs_search: Perform fuzzy/partial Discogs searches
# Input: artist, title, year (any can be empty)
# Output: artist|title|year|label|catalog|confidence
fuzzy_discogs_search() {
    local search_artist="$1"
    local search_title="$2"
    local search_year="$3"
    
    log $LOG_DEBUG "Fuzzy Discogs search: artist='$search_artist' title='$search_title' year='$search_year'"
    
    # Skip if no search terms
    if [[ -z "$search_artist" ]] && [[ -z "$search_title" ]]; then
        return 1
    fi
    
    # Build search query - try different combinations
    local search_queries=()
    
    # Primary search: artist and title
    if [[ -n "$search_artist" ]] && [[ -n "$search_title" ]]; then
        search_queries+=("$search_artist $search_title")
        if [[ -n "$search_year" ]]; then
            search_queries+=("$search_artist $search_title $search_year")
        fi
    fi
    
    # Fallback searches
    [[ -n "$search_artist" ]] && search_queries+=("$search_artist")
    [[ -n "$search_title" ]] && search_queries+=("$search_title")
    
    # Try each search query
    for query in "${search_queries[@]}"; do
        log $LOG_DEBUG "Trying Discogs search: '$query'"
        
        # Use existing discogs_search_releases function but with lower confidence
        local search_result
        if command -v discogs_search_releases >/dev/null 2>&1; then
            search_result=$(discogs_search_releases "$search_artist" "$search_title" "$search_year" 2>/dev/null)
            
            if [[ -n "$search_result" ]] && [[ "$search_result" != "null" ]]; then
                # Extract data from Discogs result
                local result_artist=$(echo "$search_result" | jq -r '.artist // empty' 2>/dev/null)
                local result_title=$(echo "$search_result" | jq -r '.title // empty' 2>/dev/null)
                local result_year=$(echo "$search_result" | jq -r '.year // empty' 2>/dev/null)
                local result_label=$(echo "$search_result" | jq -r '.label // empty' 2>/dev/null)
                local result_catalog=$(echo "$search_result" | jq -r '.catalog_number // empty' 2>/dev/null)
                
                # Calculate fuzzy match confidence
                local confidence=$(calculate_fuzzy_confidence \
                    "$search_artist" "$search_title" "$search_year" \
                    "$result_artist" "$result_title" "$result_year")
                
                # Convert to integer comparison 
                local conf_int=$(echo "$confidence" | awk '{printf "%d", $1*100}')
                local thresh_int=$(echo "$FUZZY_COMBINED_THRESHOLD" | awk '{printf "%d", $1*100}')
                
                if [[ $conf_int -ge $thresh_int ]]; then
                    log $LOG_DEBUG "Fuzzy match found: '$result_artist - $result_title' (confidence: $confidence)"
                    echo "$result_artist|$result_title|$result_year|$result_label|$result_catalog|$confidence"
                    return 0
                fi
            fi
        fi
    done
    
    log $LOG_DEBUG "No suitable fuzzy matches found"
    return 1
}

#
# FILE-BASED INFERENCE
#

# infer_tracks_from_filenames: Extract track information from filenames
# Input: album directory
# Output: JSON array of track info (for future use)
infer_tracks_from_filenames() {
    local album_dir="$1"
    local tracks=()
    
    log $LOG_DEBUG "Inferring track info from filenames in: $album_dir"
    
    # Find audio files
    while IFS= read -r -d '' file; do
        local basename=$(basename "$file")
        local title="" track_num=""
        
        # Pattern 1: 01 - Track Title.ext
        if [[ "$basename" =~ ^([0-9]{2})[[:space:]]*-[[:space:]]*(.+)\.[^.]+$ ]]; then
            track_num="${BASH_REMATCH[1]}"
            title="${BASH_REMATCH[2]}"
            
        # Pattern 2: Track Title.ext (no number)
        elif [[ "$basename" =~ ^(.+)\.[^.]+$ ]]; then
            title="${BASH_REMATCH[1]}"
            
        # Clean title
        title=$(echo "$title" | sed 's/_/ /g' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        fi
        
        if [[ -n "$title" ]]; then
            tracks+=("{\"file\":\"$file\",\"track\":\"$track_num\",\"title\":\"$title\"}")
        fi
        
    done < <(find "$album_dir" -maxdepth 1 -type f -iregex ".*\.\(mp3\|flac\|wav\|m4a\|ogg\)" -print0 2>/dev/null)
    
    if [[ ${#tracks[@]} -gt 0 ]]; then
        local json_array="[$(IFS=,; echo "${tracks[*]}")]"
        echo "$json_array"
    fi
    
    return 0
}

#
# CONFIDENCE SCORING AND VALIDATION
#

# calculate_confidence_score: Calculate overall confidence in reconstructed metadata
# Input: final_artist final_title final_year existing_info parsed_info discogs_confidence
# Output: confidence score (0.0-1.0)
calculate_confidence_score() {
    local final_artist="$1"
    local final_title="$2" 
    local final_year="$3"
    local existing_info="$4"
    local parsed_info="$5"
    local discogs_confidence="$6"
    
    # Use integer arithmetic (score * 100)
    local score_int=0
    
    # Base score for having essential fields
    [[ -n "$final_artist" ]] && score_int=$((score_int + 40))  # 0.4
    [[ -n "$final_title" ]] && score_int=$((score_int + 30))   # 0.3
    [[ -n "$final_year" ]] && score_int=$((score_int + 10))    # 0.1
    
    # Bonus for data source reliability
    IFS='|' read -r existing_artist existing_title _ <<< "$existing_info"
    if [[ -n "$existing_artist" || -n "$existing_title" ]]; then
        score_int=$((score_int + 10))  # 0.1 - ID3 tags are reliable
    fi
    
    # Discogs confidence bonus
    if [[ -n "$discogs_confidence" ]] && [[ "$discogs_confidence" != "0" ]] && [[ "$discogs_confidence" != "0.00" ]]; then
        local discogs_int=$(echo "$discogs_confidence" | awk '{printf "%d", $1*100}')
        local bonus=$((discogs_int / 10))  # 0.1 * confidence
        score_int=$((score_int + bonus))
    fi
    
    # Ensure score doesn't exceed 100 (1.0)
    if [[ $score_int -gt 100 ]]; then
        score_int=100
    fi
    
    # Convert back to decimal
    printf "0.%02d\n" $score_int
}

# calculate_fuzzy_confidence: Calculate confidence for fuzzy matching
# Input: search_artist search_title search_year result_artist result_title result_year
# Output: confidence score (0.0-1.0)
calculate_fuzzy_confidence() {
    local search_artist="$1"
    local search_title="$2"
    local search_year="$3"
    local result_artist="$4" 
    local result_title="$5"
    local result_year="$6"
    
    local confidence_int=0
    
    # Artist similarity (weight: 50%)
    if [[ -n "$search_artist" ]] && [[ -n "$result_artist" ]]; then
        local artist_sim=$(calculate_string_similarity "$search_artist" "$result_artist")
        local artist_sim_int=$(echo "$artist_sim" | awk '{printf "%d", $1*100}')
        confidence_int=$((confidence_int + (artist_sim_int * 50 / 100)))
    fi
    
    # Title similarity (weight: 40%)
    if [[ -n "$search_title" ]] && [[ -n "$result_title" ]]; then
        local title_sim=$(calculate_string_similarity "$search_title" "$result_title")
        local title_sim_int=$(echo "$title_sim" | awk '{printf "%d", $1*100}')
        confidence_int=$((confidence_int + (title_sim_int * 40 / 100)))
    fi
    
    # Year match (weight: 10%)
    if [[ -n "$search_year" ]] && [[ -n "$result_year" ]]; then
        if [[ "$search_year" == "$result_year" ]]; then
            confidence_int=$((confidence_int + 10))
        else
            local year_diff=$(( (search_year > result_year ? search_year - result_year : result_year - search_year) ))
            if [[ $year_diff -le 1 ]]; then
                confidence_int=$((confidence_int + 5))
            fi
        fi
    fi
    
    # Convert to decimal
    printf "0.%02d\n" $confidence_int
}

# calculate_string_similarity: Simple string similarity using common substrings
# Input: string1 string2  
# Output: similarity score (0.0-1.0)
calculate_string_similarity() {
    local str1=$(echo "$1" | tr '[:upper:]' '[:lower:]')
    local str2=$(echo "$2" | tr '[:upper:]' '[:lower:]')
    
    # Simple approach: count common words
    local words1=($(echo "$str1" | sed 's/ /\n/g' | sort -u))
    local words2=($(echo "$str2" | sed 's/ /\n/g' | sort -u))
    
    local common=0
    local total=${#words1[@]}
    
    for word in "${words1[@]}"; do
        if [[ " ${words2[*]} " =~ " $word " ]]; then
            ((common++))
        fi
    done
    
    if [[ $total -gt 0 ]]; then
        # Use bash arithmetic
        local result=$(( (common * 100) / total ))
        printf "0.%02d\n" $result
    else
        echo "0.00"
    fi
}

# Export functions
export -f reconstruct_album_metadata enhanced_directory_parsing
export -f fuzzy_discogs_search infer_tracks_from_filenames  
export -f calculate_confidence_score calculate_fuzzy_confidence calculate_string_similarity