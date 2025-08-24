#!/bin/bash

# Script to clean up problematic artist directories in sorted_music
# Moves bad directories back for reprocessing with improved validation

source "lib/common.sh"

# Initialize logging
LOG_FILE="cleanup_sorted_directories.log"
exec > >(tee -a "$LOG_FILE")
exec 2>&1

log $LOG_INFO "--- Sorted Music Cleanup Started ---"

# Define problematic patterns
declare -a BAD_PATTERNS=(
    "^[0-9]{1,3} "               # Number prefixes: "025 scorn", "80 aum"
    "^[0-9]{1,2} - "             # Track prefixes: "02 - Move D"
    "^about this product$"       # Generic terms
    "^_Unknown_$"               # Underscore unknown
    "^msqcd[0-9]"               # Catalog prefixes
    "^herbert - [0-9]{1,3} lbs" # Catalog contamination
    "^313 bass mechanics$"      # Catalog as artist
)

# Function to check if directory name matches bad patterns
is_problematic_artist() {
    local dir_name="$1"
    
    for pattern in "${BAD_PATTERNS[@]}"; do
        if [[ "$dir_name" =~ $pattern ]]; then
            return 0  # Is problematic
        fi
    done
    
    return 1  # Is okay
}

# Function to find duplicate artists with case/symbol differences
find_artist_duplicates() {
    local quality_dir="$1"
    
    # Check for AGF/agf type duplicates
    if [[ -d "$quality_dir/agf" ]] && [[ -d "$quality_dir/AGF" ]]; then
        echo "DUPLICATE: $quality_dir/agf <-> $quality_dir/AGF"
    fi
    
    # Check for Atom variants (this is complex, just flag all Atom* directories)
    find "$quality_dir" -maxdepth 1 -type d -name "Atom*" -o -name "atom*" -o -name "ATOM*" | while read atom_dir; do
        echo "ATOM_VARIANT: $atom_dir"
    done
}

# Scan sorted directories for problematic artists
log $LOG_INFO "Scanning for problematic artist directories..."

FOUND_ISSUES=0
declare -a PROBLEMATIC_DIRS=()

for quality_dir in "/home/plex/Music/sorted_music/Lossless" "/home/plex/Music/sorted_music/Lossy" "/home/plex/Music/sorted_music/Mixed" "/home/plex/Music/sorted_music/Unknown"; do
    if [[ ! -d "$quality_dir" ]]; then
        continue
    fi
    
    while IFS= read -r -d '' artist_dir; do
        artist_name=$(basename "$artist_dir")
        
        if is_problematic_artist "$artist_name"; then
            log $LOG_WARNING "Found problematic artist directory: $artist_dir"
            PROBLEMATIC_DIRS+=("$artist_dir")
            ((FOUND_ISSUES++))
            
            # Show some albums under this artist
            echo "  Albums:"
            ls "$artist_dir" | head -3 | sed 's/^/    /'
            if [[ $(ls "$artist_dir" | wc -l) -gt 3 ]]; then
                echo "    ... and $(($(ls "$artist_dir" | wc -l) - 3)) more"
            fi
        fi
    done < <(find "$quality_dir" -mindepth 1 -maxdepth 1 -type d -print0)
    
    # Check for duplicates
    echo
    echo "Checking for duplicate artists in $quality_dir:"
    find_artist_duplicates "$quality_dir"
done

log $LOG_INFO "Found $FOUND_ISSUES problematic artist directories"

if [[ $FOUND_ISSUES -eq 0 ]]; then
    log $LOG_INFO "No problematic artist directories found."
    exit 0
fi

# Show summary
echo
echo "=== SUMMARY ==="
echo "Found $FOUND_ISSUES problematic artist directories:"
for dir in "${PROBLEMATIC_DIRS[@]}"; do
    echo "  - $(basename "$dir")"
done

echo
echo "=== DUPLICATE ANALYSIS ==="
echo "AGF variants:"
find "/home/plex/Music/sorted_music" -maxdepth 2 -type d -name "*agf*" -o -name "*AGF*" | sort

echo
echo "Atom variants:"
find "/home/plex/Music/sorted_music" -maxdepth 2 -type d -name "*tom*" | grep -i atom | sort

echo
echo "Various Artist variants:"
find "/home/plex/Music/sorted_music" -maxdepth 2 -type d | grep -i various | sort

# Ask for action
echo
echo "Options:"
echo "1. Move problematic artists back to unsorted for reprocessing"
echo "2. Just report (dry run)"
echo "3. Exit without action"
echo
read -p "Choose option (1-3): " choice

case "$choice" in
    1)
        log $LOG_INFO "Moving problematic artists back for reprocessing..."
        CLEANUP_DIR="/home/plex/Music/sorted_music/unsorted/cleanup_$(date +%Y%m%d_%H%M%S)"
        mkdir -p "$CLEANUP_DIR"
        
        for problematic_dir in "${PROBLEMATIC_DIRS[@]}"; do
            artist_name=$(basename "$problematic_dir")
            log $LOG_INFO "Moving: $problematic_dir -> $CLEANUP_DIR/"
            
            if mv "$problematic_dir" "$CLEANUP_DIR/"; then
                log $LOG_INFO "Successfully moved $artist_name"
            else
                log $LOG_ERROR "Failed to move $artist_name"
            fi
        done
        
        log $LOG_INFO "Moved $FOUND_ISSUES problematic artists to: $CLEANUP_DIR"
        echo
        echo "To reprocess these albums with improved validation:"
        echo "./ordr.fm.sh --source \"$CLEANUP_DIR\" --move --verbose"
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

log $LOG_INFO "--- Sorted Music Cleanup Finished ---"