#!/bin/bash

# Script to identify and cleanup bad artist directories
# Created after implementing artist name validation fixes

source "lib/common.sh"

# Initialize logging
LOG_FILE="cleanup_bad_artists.log"
exec > >(tee -a "$LOG_FILE")
exec 2>&1

log $LOG_INFO "--- Bad Artist Cleanup Started ---"

# Define patterns for problematic artist directories
declare -a BAD_PATTERNS=(
    "^[0-9]{1,2}$"           # Pure numbers: 01, 03
    "^[0-9]{2}\\."           # Numbers with dots: 05.
    "null"                   # Null contamination
    "^\\["                   # Catalog prefixes: [don 2]
    "^¥"                     # Special characters
    "^\\..*If.*You"          # Track titles as artists
    "^0$"                    # Single zero
)

# Function to check if directory name matches bad patterns
is_bad_artist_name() {
    local dir_name="$1"
    
    for pattern in "${BAD_PATTERNS[@]}"; do
        if [[ "$dir_name" =~ $pattern ]]; then
            return 0  # Is bad
        fi
    done
    
    return 1  # Is good
}

# Function to find original source directory
find_original_source() {
    local artist_name="$1"
    local album_name="$2"
    
    # Search in remaining unprocessed directories
    find "/home/plex/Music/Albums & EPs/By Artist" -maxdepth 1 -type d -iname "*$artist_name*" 2>/dev/null | head -1
}

# Scan sorted directories for bad artist names
log $LOG_INFO "Scanning for problematic artist directories..."

FOUND_ISSUES=0
declare -a BAD_DIRS=()

for quality_dir in "/home/plex/Music/sorted_music/Lossless" "/home/plex/Music/sorted_music/Lossy" "/home/plex/Music/sorted_music/Mixed"; do
    if [[ ! -d "$quality_dir" ]]; then
        continue
    fi
    
    while IFS= read -r -d '' artist_dir; do
        artist_name=$(basename "$artist_dir")
        
        if is_bad_artist_name "$artist_name"; then
            log $LOG_WARNING "Found problematic artist directory: $artist_dir"
            BAD_DIRS+=("$artist_dir")
            ((FOUND_ISSUES++))
            
            # List albums under this bad artist
            ls -la "$artist_dir" | grep "^d" | awk '{print "  -> " $NF}'
        fi
    done < <(find "$quality_dir" -mindepth 1 -maxdepth 1 -type d -print0)
done

log $LOG_INFO "Found $FOUND_ISSUES problematic artist directories"

if [[ $FOUND_ISSUES -eq 0 ]]; then
    log $LOG_INFO "No problematic artist directories found. Cleanup not needed."
    exit 0
fi

# Ask for action
echo
echo "Found $FOUND_ISSUES problematic artist directories."
echo "Options:"
echo "1. Move bad artists back to unsorted for reprocessing"
echo "2. Just report (dry run)"
echo "3. Exit without action"
echo
read -p "Choose option (1-3): " choice

case "$choice" in
    1)
        log $LOG_INFO "Moving problematic artists back for reprocessing..."
        UNSORTED_DIR="/home/plex/Music/sorted_music/unsorted/cleanup_$(date +%Y%m%d_%H%M%S)"
        mkdir -p "$UNSORTED_DIR"
        
        for bad_dir in "${BAD_DIRS[@]}"; do
            artist_name=$(basename "$bad_dir")
            log $LOG_INFO "Moving: $bad_dir -> $UNSORTED_DIR/"
            
            if mv "$bad_dir" "$UNSORTED_DIR/"; then
                log $LOG_INFO "Successfully moved $artist_name"
            else
                log $LOG_ERROR "Failed to move $artist_name"
            fi
        done
        
        log $LOG_INFO "Moved $FOUND_ISSUES problematic artists to: $UNSORTED_DIR"
        echo
        echo "To reprocess these albums with fixed metadata extraction:"
        echo "./ordr.fm.sh --source \"$UNSORTED_DIR\" --move --verbose"
        ;;
    2)
        log $LOG_INFO "Dry run completed. No changes made."
        ;;
    3)
        log $LOG_INFO "User chose to exit. No changes made."
        exit 0
        ;;
    *)
        log $LOG_ERROR "Invalid choice. Exiting."
        exit 1
        ;;
esac

log $LOG_INFO "--- Bad Artist Cleanup Finished ---"