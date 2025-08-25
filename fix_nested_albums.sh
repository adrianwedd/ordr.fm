#!/bin/bash

# Fix deeply nested albums caused by forward slashes in names
# This script finds and moves ONLY directories that directly contain audio files

SOURCE_DIR="${1:-/home/plex/Music/Albums & EPs/Lossy}"
DEST_DIR="${2:-/home/plex/Music/sorted_music}"
DRY_RUN="${3:-1}"  # Default to dry run

echo "==================================================================="
echo "Nested Album Fix Script"
echo "Source: $SOURCE_DIR"
echo "Destination: $DEST_DIR"
echo "Mode: $([ "$DRY_RUN" = "1" ] && echo "DRY RUN" || echo "LIVE RUN")"
echo "==================================================================="
echo

# Find ONLY directories that directly contain audio files
find_album_directories() {
    local source="$1"
    local albums=()
    
    while IFS= read -r dir; do
        # Check if THIS directory (not subdirs) has audio files
        local count=$(find "$dir" -maxdepth 1 -type f \( \
            -iname "*.mp3" -o -iname "*.flac" -o -iname "*.m4a" -o \
            -iname "*.wav" -o -iname "*.ogg" -o -iname "*.aac" \
        \) 2>/dev/null | grep -v "INCOMPLETE" | wc -l)
        
        if [[ $count -gt 0 ]]; then
            albums+=("$dir")
        fi
    done < <(find "$source" -type d)
    
    printf '%s\n' "${albums[@]}"
}

# Sanitize path completely - replace ALL forward slashes with underscores
sanitize_path() {
    local path="$1"
    # Replace forward slashes, colons, and other problematic characters
    echo "$path" | sed 's|[/:]|_|g' | sed 's|[*?"<>|]|_|g' | sed 's|__*|_|g'
}

# Extract basic metadata from directory name
extract_metadata() {
    local dir_path="$1"
    local dir_name=$(basename "$dir_path")
    
    # Try to extract artist and album from common patterns
    local artist=""
    local album=""
    
    # Pattern: Artist - Album
    if [[ "$dir_name" =~ ^([^-]+)[[:space:]]*-[[:space:]]*(.+)$ ]]; then
        artist="${BASH_REMATCH[1]}"
        album="${BASH_REMATCH[2]}"
    else
        # Use parent directory as artist, current as album
        artist=$(basename "$(dirname "$dir_path")")
        album="$dir_name"
    fi
    
    # Clean up
    artist=$(echo "$artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    album=$(echo "$album" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    # Sanitize
    artist=$(sanitize_path "$artist")
    album=$(sanitize_path "$album")
    
    echo "$artist|$album"
}

# Determine quality based on file extensions
determine_quality() {
    local dir="$1"
    
    if find "$dir" -maxdepth 1 -type f \( -iname "*.flac" -o -iname "*.wav" -o -iname "*.aiff" \) | grep -q .; then
        echo "Lossless"
    else
        echo "Lossy"
    fi
}

# Process albums
echo "Finding albums with audio files..."
readarray -t albums < <(find_album_directories "$SOURCE_DIR")
echo "Found ${#albums[@]} actual albums (directories with audio files)"
echo

for album_dir in "${albums[@]}"; do
    echo "----------------------------------------"
    echo "Processing: $album_dir"
    
    # Extract metadata
    metadata=$(extract_metadata "$album_dir")
    artist=$(echo "$metadata" | cut -d'|' -f1)
    album=$(echo "$metadata" | cut -d'|' -f2)
    quality=$(determine_quality "$album_dir")
    
    # Build destination path
    dest_path="$DEST_DIR/$quality/$artist/$album"
    
    echo "  Artist: $artist"
    echo "  Album: $album"
    echo "  Quality: $quality"
    echo "  Destination: $dest_path"
    
    # Check if already exists
    if [[ -d "$dest_path" ]]; then
        echo "  ⚠️  SKIPPED: Destination already exists"
        continue
    fi
    
    # Move or dry run
    if [[ "$DRY_RUN" = "1" ]]; then
        echo "  ✓ DRY RUN: Would move to $dest_path"
    else
        # Create destination directory
        mkdir -p "$(dirname "$dest_path")"
        
        # Move the album
        if mv "$album_dir" "$dest_path" 2>/dev/null; then
            echo "  ✓ MOVED: Successfully moved album"
            
            # Clean up empty parent directories
            parent="$(dirname "$album_dir")"
            while [[ "$parent" != "$SOURCE_DIR" ]] && [[ "$parent" != "/" ]]; do
                if rmdir "$parent" 2>/dev/null; then
                    echo "  ✓ CLEANED: Removed empty directory $parent"
                    parent="$(dirname "$parent")"
                else
                    break
                fi
            done
        else
            echo "  ✗ ERROR: Failed to move album"
        fi
    fi
done

echo
echo "==================================================================="
echo "Processing complete!"
echo "Albums processed: ${#albums[@]}"
echo "==================================================================="