#!/bin/bash
# Organization logic module for ordr.fm
# Handles album organization strategies, artist aliases, and electronic music features

# Source common utilities
source "${BASH_SOURCE%/*}/common.sh"

# Check if album is a compilation
is_compilation() {
    local album_artist="$1"
    local va_pattern="${VA_ARTISTS:-Various Artists|Various|VA|V.A.|Compilation}"
    
    if [[ -z "$album_artist" ]]; then
        return 0
    fi
    
    # Case-insensitive match against VA patterns
    if echo "$album_artist" | grep -iE "^($va_pattern)$" >/dev/null; then
        return 0
    fi
    
    return 1
}

# Check if release is underground/white label
is_underground() {
    local album_title="$1"
    local catalog_number="$2"
    local underground_patterns="${UNDERGROUND_PATTERNS:-white|promo|bootleg|unreleased|dubplate|test press}"
    
    # Check album title
    if echo "$album_title" | grep -iE "($underground_patterns)" >/dev/null; then
        return 0
    fi
    
    # Check catalog number
    if echo "$catalog_number" | grep -iE "($underground_patterns)" >/dev/null; then
        return 0
    fi
    
    return 1
}

# Detect remixes in track titles
detect_remixes() {
    local track_titles="$1"
    local remix_keywords="${REMIX_KEYWORDS:-remix|rmx|rework|edit|dub|mix|bootleg|refix|flip}"
    local remix_count=0
    local total_count=0
    
    while IFS=';' read -r title; do
        [[ -z "$title" ]] && continue
        total_count=$((total_count + 1))
        
        if echo "$title" | grep -iE "($remix_keywords)" >/dev/null; then
            remix_count=$((remix_count + 1))
        fi
    done <<< "$track_titles"
    
    # Return 0 if majority are remixes
    if [[ $total_count -gt 0 ]] && [[ $((remix_count * 2)) -ge $total_count ]]; then
        return 0
    fi
    
    return 1
}

# Extract remix artist from track title
extract_remix_artist() {
    local title="$1"
    local remix_keywords="${REMIX_KEYWORDS:-remix|rmx|rework|edit|dub|mix|bootleg|refix|flip}"
    
    # Common patterns: (Artist Remix), [Artist Mix], - Artist Remix
    local remixer=""
    
    # Pattern 1: (Artist Remix) or [Artist Mix]
    remixer=$(echo "$title" | grep -oE "[\(\[]([^)\]]+)\s+($remix_keywords)[\)\]]" | sed -E "s/[\(\[](.+)\s+($remix_keywords)[\)\]]/\1/i")
    
    if [[ -z "$remixer" ]]; then
        # Pattern 2: - Artist Remix
        remixer=$(echo "$title" | grep -oE "\-\s*([^-]+)\s+($remix_keywords)" | sed -E "s/\-\s*(.+)\s+($remix_keywords)/\1/i")
    fi
    
    echo "$remixer" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

# Resolve artist aliases to primary artist
resolve_artist_alias() {
    local artist="$1"
    local alias_groups="${ARTIST_ALIAS_GROUPS:-}"
    
    [[ -z "$artist" ]] && { echo "$artist"; return; }
    [[ "$GROUP_ARTIST_ALIASES" != "1" ]] && { echo "$artist"; return; }
    [[ -z "$alias_groups" ]] && { echo "$artist"; return; }
    
    log $LOG_DEBUG "resolve_artist_alias: processing '$artist'"
    
    # Normalize artist name for comparison
    local normalized_artist=$(echo "$artist" | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]*$//')
    
    # Parse alias groups
    IFS='|' read -ra groups <<< "$alias_groups"
    for group in "${groups[@]}"; do
        IFS=',' read -ra aliases <<< "$group"
        
        # Get primary artist (first in group) - ensure it's not empty
        local primary_artist="${aliases[0]}"
        if [[ -z "$primary_artist" ]]; then
            log $LOG_WARNING "Empty primary artist in alias group, skipping"
            continue
        fi
        
        # Check if input artist matches any alias
        for alias in "${aliases[@]}"; do
            local normalized_alias=$(echo "$alias" | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]*$//')
            if [[ "$normalized_artist" == "$normalized_alias" ]]; then
                log $LOG_DEBUG "Resolved alias '$artist' to primary artist '$primary_artist'"
                echo "$primary_artist"
                return
            fi
        done
    done
    
    echo "$artist"
}

# Count releases for an artist (including aliases)
count_artist_releases() {
    local artist="$1"
    local music_dir="$2"
    local count=0
    
    # Get all aliases for this artist
    local all_aliases=$(get_artist_aliases "$artist")
    
    # Count releases for each alias
    while IFS=$'\n' read -r alias; do
        [[ -z "$alias" ]] && continue
        local alias_count=$(find "$music_dir" -type d -name "*${alias}*" 2>/dev/null | wc -l)
        count=$((count + alias_count))
    done <<< "$all_aliases"
    
    echo $count
}

# Get all aliases for an artist
get_artist_aliases() {
    local artist="$1"
    local alias_groups="${ARTIST_ALIAS_GROUPS:-}"
    
    # Always include the original artist
    echo "$artist"
    
    [[ "$GROUP_ARTIST_ALIASES" != "1" ]] && return
    [[ -z "$alias_groups" ]] && return
    
    # Find which group this artist belongs to
    IFS='|' read -ra groups <<< "$alias_groups"
    for group in "${groups[@]}"; do
        if echo "$group" | grep -i "$artist" >/dev/null; then
            # Output all aliases in this group
            IFS=',' read -ra aliases <<< "$group"
            for alias in "${aliases[@]}"; do
                echo "$alias" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
            done
            break
        fi
    done
}

# Determine if label-based organization should be used
should_use_label_organization() {
    local label="$1"
    local artist="$2"
    local label_releases="${3:-0}"
    local artist_releases="${4:-0}"
    
    # No label = no label organization
    [[ -z "$label" ]] && return 1
    
    # Check minimum releases threshold
    if [[ $label_releases -lt ${MIN_LABEL_RELEASES:-3} ]]; then
        return 1
    fi
    
    # Use label priority threshold
    local threshold=${LABEL_PRIORITY_THRESHOLD:-0.8}
    if (( $(echo "$label_releases > $artist_releases * $threshold" | bc -l) )); then
        return 0
    fi
    
    return 1
}

# Determine organization mode for album
determine_organization_mode() {
    local album_data="$1"  # Pipe-delimited: artist|title|label|catalog|year|is_va
    
    local artist=$(echo "$album_data" | cut -d'|' -f1)
    local title=$(echo "$album_data" | cut -d'|' -f2)
    local label=$(echo "$album_data" | cut -d'|' -f3)
    local catalog=$(echo "$album_data" | cut -d'|' -f4)
    local year=$(echo "$album_data" | cut -d'|' -f5)
    local is_va=$(echo "$album_data" | cut -d'|' -f6)
    
    local mode="artist"  # Default
    
    # Force artist mode if disabled
    if [[ "$ENABLE_ELECTRONIC_ORGANIZATION" != "1" ]]; then
        echo "artist"
        return
    fi
    
    # Check organization mode setting
    case "$ORGANIZATION_MODE" in
        "label")
            [[ -n "$label" ]] && mode="label" || mode="artist"
            ;;
        "series")
            # Check if part of a series (catalog pattern)
            if [[ -n "$catalog" ]] && echo "$catalog" | grep -E "[0-9]{3,}" >/dev/null; then
                mode="series"
            else
                mode="artist"
            fi
            ;;
        "hybrid")
            # Intelligent mode selection
            if is_compilation "$artist"; then
                mode="compilation"
            elif is_underground "$title" "$catalog"; then
                mode="underground"
            elif should_use_label_organization "$label" "$artist"; then
                mode="label"
            else
                mode="artist"
            fi
            ;;
        *)
            mode="artist"
            ;;
    esac
    
    log $LOG_DEBUG "Selected organization mode: $mode"
    echo "$mode"
}

# Build organization path based on mode
build_organization_path() {
    local mode="$1"
    local album_data="$2"  # Pipe-delimited data
    local quality="$3"
    local album_dir="${4:-}"  # Optional album directory path
    
    local artist=$(echo "$album_data" | cut -d'|' -f1)
    local title=$(echo "$album_data" | cut -d'|' -f2)
    local label=$(echo "$album_data" | cut -d'|' -f3)
    local catalog=$(echo "$album_data" | cut -d'|' -f4)
    local year=$(echo "$album_data" | cut -d'|' -f5)
    
    # Detect disc number from directory path
    local disc_suffix=""
    if [[ -n "$album_dir" ]]; then
        # Enhanced disc detection patterns
        if [[ "$album_dir" =~ /Disc[[:space:]]*([0-9]+)$ ]] || [[ "$album_dir" =~ /CD[[:space:]]*([0-9]+)$ ]] || \
           [[ "$album_dir" =~ /Disk[[:space:]]*([0-9]+)$ ]] || [[ "$album_dir" =~ /(CD|Disc|Disk)[[:space:]]*([0-9]+)[[:space:]]*$ ]]; then
            local disc_num="${BASH_REMATCH[1]:-${BASH_REMATCH[2]}}"
            disc_suffix=" (Disc ${disc_num})"
            log $LOG_DEBUG "Detected disc number: $disc_num from path: $album_dir"
        fi
    fi
    
    local path=""
    
    case "$mode" in
        "artist")
            # New format: Quality/Artist/Artist - Album (YYYY) [Label] [CAT]
            path="${quality}/${artist}/${artist} - ${title}"
            [[ -n "$year" ]] && path="${path} (${year})"
            # Add label and catalog info separately  
            [[ -n "$label" ]] && path="${path} [${label}]"
            [[ -n "$catalog" ]] && path="${path} [${catalog}]"
            # Add disc suffix for multi-disc albums
            [[ -n "$disc_suffix" ]] && path="${path}${disc_suffix}"
            ;;
        "label")
            path="${quality}/Labels/${label}/${artist} - ${title}"
            [[ -n "$catalog" ]] && path="${path} [${catalog}]"
            ;;
        "series")
            local series_name=$(echo "$catalog" | sed -E 's/[0-9]+$//')
            path="${quality}/Series/${series_name}/${catalog} - ${artist} - ${title}"
            ;;
        "compilation")
            # Compilations: Quality/Various Artists/Various Artists - Album (YYYY) [Label] [CAT]
            path="${quality}/Various Artists/Various Artists - ${title}"
            [[ -n "$year" ]] && path="${path} (${year})"
            [[ -n "$label" ]] && path="${path} [${label}]"
            [[ -n "$catalog" ]] && path="${path} [${catalog}]"
            ;;
        "underground")
            local folder_name="${catalog:-$year}"
            [[ -z "$folder_name" ]] && folder_name="Unknown"
            path="${quality}/Underground/${folder_name}/${title}"
            ;;
        "remixes")
            # Extract original artist from title if possible
            local original_artist="${artist}"
            path="${quality}/Remixes/${original_artist}/${title}"
            ;;
        *)
            # Fallback to artist
            path="${quality}/${artist}/${title}"
            ;;
    esac
    
    # Truncate overly long path components (limit to 100 chars for album title)
    if [[ ${#title} -gt 100 ]]; then
        title="${title:0:97}..."
        log $LOG_DEBUG "Truncated long album title to: $title"
    fi
    
    # Rebuild path with truncated title if needed
    case "$mode" in
        "artist")
            path="${quality}/${artist}/${artist} - ${title}"
            [[ -n "$year" ]] && path="${path} (${year})"
            [[ -n "$label" ]] && path="${path} [${label}]"
            [[ -n "$catalog" ]] && path="${path} [${catalog}]"
            ;;
    esac
    
    # Sanitize the entire path (remove newlines, control chars, and invalid filename chars)
    echo "$path" | tr -d '\n\r\t' | sed 's/[\\*?"<>|[:cntrl:]]/_/g' | sed 's/__\+/_/g' | sed 's/^_\+//;s/_\+$//' | sed 's/  \+/ /g'
}

# Apply organization pattern
apply_organization_pattern() {
    local pattern="$1"
    local album_data="$2"
    local quality="$3"
    
    local artist=$(echo "$album_data" | cut -d'|' -f1)
    local title=$(echo "$album_data" | cut -d'|' -f2)
    local label=$(echo "$album_data" | cut -d'|' -f3)
    local catalog=$(echo "$album_data" | cut -d'|' -f4)
    local year=$(echo "$album_data" | cut -d'|' -f5)
    
    # Replace pattern variables
    local path="$pattern"
    path="${path//\{quality\}/$quality}"
    path="${path//\{artist\}/$artist}"
    path="${path//\{album\}/$title}"
    path="${path//\{title\}/$title}"
    path="${path//\{label\}/$label}"
    path="${path//\{catalog\}/$catalog}"
    path="${path//\{year\}/$year}"
    path="${path//\{catalog_or_year\}/${catalog:-$year}}"
    
    # Handle optional year in pattern
    if [[ -z "$year" ]]; then
        path=$(echo "$path" | sed 's/ *([^)]*)//g')
    else
        path="${path//(\{year\})/($year)}"
    fi
    
    # Clean up empty segments
    path=$(echo "$path" | sed 's|//\+|/|g' | sed 's|/$||')
    
    # Sanitize the result
    echo "$path" | sed 's/[\\*?"<>|]/_/g' | sed 's/__\+/_/g' | sed 's/^_\+//;s/_\+$//'
}

# Detect vinyl side markers in track names
detect_vinyl_sides() {
    local track_titles="$1"
    local side_pattern="[AB][0-9]|Side [AB]|[AB]-Side"
    local vinyl_tracks=0
    local total_tracks=0
    
    while IFS=';' read -r title; do
        [[ -z "$title" ]] && continue
        total_tracks=$((total_tracks + 1))
        
        if echo "$title" | grep -iE "$side_pattern" >/dev/null; then
            vinyl_tracks=$((vinyl_tracks + 1))
        fi
    done <<< "$track_titles"
    
    # Return 0 if significant number have vinyl markers
    if [[ $total_tracks -gt 0 ]] && [[ $((vinyl_tracks * 3)) -ge $total_tracks ]]; then
        return 0
    fi
    
    return 1
}

# Get vinyl position from track name
get_vinyl_position() {
    local track_name="$1"
    local position=""
    
    # Extract A1, B2, etc.
    position=$(echo "$track_name" | grep -oE "[AB][0-9]" | head -1)
    
    if [[ -z "$position" ]]; then
        # Try Side A, Side B format
        if echo "$track_name" | grep -i "Side A" >/dev/null; then
            position="A"
        elif echo "$track_name" | grep -i "Side B" >/dev/null; then
            position="B"
        fi
    fi
    
    echo "$position"
}

# Generate new filename based on pattern: nn - Track - Album - Artist.ext
# Only renames when we have complete metadata
generate_track_filename() {
    local track_file="$1"
    local track_number="$2"
    local track_title="$3"
    local album_title="$4"
    local artist_name="$5"
    local enable_renaming="${6:-1}"  # Default enabled, can be disabled
    
    # Get original filename and extension
    local original_filename=$(basename "$track_file")
    local extension="${original_filename##*.}"
    
    # If renaming is disabled, return original filename
    if [[ "$enable_renaming" != "1" ]]; then
        echo "$original_filename"
        return 0
    fi
    
    # Only rename if we have complete metadata
    if [[ -z "$track_number" ]] || [[ -z "$track_title" ]] || [[ -z "$album_title" ]] || [[ -z "$artist_name" ]]; then
        log $LOG_DEBUG "Incomplete metadata for track renaming, keeping original filename: $original_filename"
        echo "$original_filename"
        return 0
    fi
    
    # Format track number with leading zero if needed
    local formatted_track_number
    if [[ "$track_number" =~ ^[0-9]+$ ]]; then
        formatted_track_number=$(printf "%02d" "$track_number")
    else
        # Clean track number of invalid filename characters (like "/")
        formatted_track_number=$(echo "$track_number" | sed 's/[\\/:*?"<>|]/_/g' | sed 's/__\+/_/g' | sed 's/^_\+//;s/_\+$//')
    fi
    
    # Sanitize each component for filename safety
    local clean_track_title=$(echo "$track_title" | sed 's/[\\/:*?"<>|]/_/g' | sed 's/__\+/_/g' | sed 's/^_\+//;s/_\+$//')
    local clean_album_title=$(echo "$album_title" | sed 's/[\\/:*?"<>|]/_/g' | sed 's/__\+/_/g' | sed 's/^_\+//;s/_\+$//')
    local clean_artist_name=$(echo "$artist_name" | sed 's/[\\/:*?"<>|]/_/g' | sed 's/__\+/_/g' | sed 's/^_\+//;s/_\+$//')
    
    # Build new filename: nn - Track - Album - Artist.ext
    local new_filename="${formatted_track_number} - ${clean_track_title} - ${clean_album_title} - ${clean_artist_name}.${extension}"
    
    log $LOG_DEBUG "Generated new filename: $original_filename -> $new_filename"
    echo "$new_filename"
}

# Check if album appears to be a compilation based on artist variations
is_compilation_album() {
    local exiftool_output="$1"
    local artist_count=$(echo "$exiftool_output" | jq -r '.[].Artist // .[].Albumartist // ""' | sort -u | grep -v '^$' | wc -l)
    
    # If more than 3 different artists, likely a compilation
    if [[ "$artist_count" -gt 3 ]]; then
        return 0
    fi
    
    # Check for common compilation indicators
    local album_artist=$(echo "$exiftool_output" | jq -r '.[0].Albumartist // .[0].Artist // ""' | tr '[:upper:]' '[:lower:]')
    if [[ "$album_artist" =~ (various|compilation|soundtrack|mixed|sampler) ]]; then
        return 0
    fi
    
    return 1
}

# Export all functions
export -f is_compilation is_underground detect_remixes extract_remix_artist
export -f resolve_artist_alias count_artist_releases get_artist_aliases
export -f should_use_label_organization determine_organization_mode
export -f build_organization_path apply_organization_pattern
export -f detect_vinyl_sides get_vinyl_position