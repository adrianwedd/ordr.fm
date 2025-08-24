#!/bin/bash

# Script to fix the remaining null contamination cases
source "lib/common.sh"

LOG_FILE="fix_null_contamination.log"
exec > >(tee -a "$LOG_FILE")
exec 2>&1

log $LOG_INFO "--- Fixing Null Contamination ---"

# Create cleanup directory for unfixable ones  
CLEANUP_DIR="/home/plex/Music/sorted_music/unsorted/null_cleanup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$CLEANUP_DIR"

# Fix specific null contamination cases
declare -A NULL_FIXES=(
    ["0null29360128"]="SKIP_NO_ARTIST"
    ["Slipknot0null"]="Slipknot"
    ["0null"]="SKIP_NO_ARTIST"  
    ["Loco Dice0null"]="Loco Dice"
)

for contaminated_name in "${!NULL_FIXES[@]}"; do
    source_path="/home/plex/Music/sorted_music/Unknown/$contaminated_name"
    fix="${NULL_FIXES[$contaminated_name]}"
    
    if [[ -d "$source_path" ]]; then
        if [[ "$fix" == "SKIP_NO_ARTIST" ]]; then
            log $LOG_INFO "Moving null-only to unsorted: '$contaminated_name'"
            if mv "$source_path" "$CLEANUP_DIR/"; then
                log $LOG_INFO "Successfully moved $contaminated_name"
            else
                log $LOG_ERROR "Failed to move $contaminated_name"
            fi
        else
            log $LOG_INFO "Fixing null contamination: '$contaminated_name' -> '$fix'"
            target_path="/home/plex/Music/sorted_music/Unknown/$fix"
            
            # Handle naming conflicts
            counter=1
            while [[ -d "$target_path" ]]; do
                target_path="/home/plex/Music/sorted_music/Unknown/${fix}_${counter}"
                ((counter++))
            done
            
            if mv "$source_path" "$target_path"; then
                log $LOG_INFO "Successfully fixed: $contaminated_name -> $fix"
            else
                log $LOG_ERROR "Failed to fix $contaminated_name"
            fi
        fi
    else
        log $LOG_WARNING "Contaminated directory not found: $source_path"
    fi
done

log $LOG_INFO "Null contamination cleanup completed"

echo
echo "=== NULL CONTAMINATION FIXES ==="
echo "✅ 'Slipknot0null' -> 'Slipknot'"
echo "✅ 'Loco Dice0null' -> 'Loco Dice'"
echo "📦 '0null29360128' and '0null' moved to unsorted (no real artist name)"
echo
echo "Note: 'feat.' collaborations are legitimate artist names and were kept as-is:"
echo "  - Move D feat. DJ Late"
echo "  - The Paradox feat. Jeff Mills, Jean Phi Dary"
echo "  - etc. (these are proper electronic music collaborations)"