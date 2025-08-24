#!/bin/bash

# Script to fix the 6 specific problematic artists we identified
source "lib/common.sh"

LOG_FILE="fix_specific_issues.log"
exec > >(tee -a "$LOG_FILE")
exec 2>&1

log $LOG_INFO "--- Fixing Specific Issues ---"

# Create cleanup directory for unfixable ones
CLEANUP_DIR="/home/plex/Music/sorted_music/unsorted/specific_cleanup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$CLEANUP_DIR"

# Fix "deta003) claude young" -> "Claude Young"
if [[ -d "/home/plex/Music/sorted_music/Lossy/deta003) claude young" ]]; then
    log $LOG_INFO "Fixing: 'deta003) claude young' -> 'Claude Young'"
    if mv "/home/plex/Music/sorted_music/Lossy/deta003) claude young" "/home/plex/Music/sorted_music/Lossy/Claude Young"; then
        log $LOG_INFO "Successfully fixed Claude Young"
    else
        log $LOG_ERROR "Failed to fix Claude Young"
    fi
fi

# Move catalog-only names to unsorted (no real artist)
for catalog_only in "playcd018" "bnr370"; do
    source_path="/home/plex/Music/sorted_music/Lossy/$catalog_only"
    if [[ -d "$source_path" ]]; then
        log $LOG_INFO "Moving catalog-only to unsorted: '$catalog_only'"
        if mv "$source_path" "$CLEANUP_DIR/"; then
            log $LOG_INFO "Successfully moved $catalog_only"
        else
            log $LOG_ERROR "Failed to move $catalog_only"
        fi
    fi
done

# Fix null contamination "Beige0null3774873.6" -> "Beige"
if [[ -d "/home/plex/Music/sorted_music/Unknown/Beige0null3774873.6" ]]; then
    log $LOG_INFO "Fixing null contamination: 'Beige0null3774873.6' -> 'Beige'"
    if mv "/home/plex/Music/sorted_music/Unknown/Beige0null3774873.6" "/home/plex/Music/sorted_music/Unknown/Beige"; then
        log $LOG_INFO "Successfully fixed Beige"
    else
        log $LOG_ERROR "Failed to fix Beige"
    fi
fi

# Fix album title as artist "Repeat (plaid & mark broom) - full album - 1993" -> extract "Plaid & Mark Broom"
if [[ -d "/home/plex/Music/sorted_music/Lossy/Repeat (plaid & mark broom) - full album - 1993" ]]; then
    log $LOG_INFO "Fixing album title as artist: extracting 'Plaid & Mark Broom'"
    if mv "/home/plex/Music/sorted_music/Lossy/Repeat (plaid & mark broom) - full album - 1993" "/home/plex/Music/sorted_music/Lossy/Plaid & Mark Broom"; then
        log $LOG_INFO "Successfully fixed Plaid & Mark Broom"
    else
        log $LOG_ERROR "Failed to fix Plaid & Mark Broom"
    fi
fi

# Fix featuring track as artist "Round Four Feat. Paul St. Hilaire - Find A Way" -> "Round Four"
if [[ -d "/home/plex/Music/sorted_music/Lossless/Round Four Feat. Paul St. Hilaire - Find A Way (Vocal + Version)" ]]; then
    log $LOG_INFO "Fixing featuring track as artist: extracting 'Round Four'"
    if mv "/home/plex/Music/sorted_music/Lossless/Round Four Feat. Paul St. Hilaire - Find A Way (Vocal + Version)" "/home/plex/Music/sorted_music/Lossless/Round Four"; then
        log $LOG_INFO "Successfully fixed Round Four"
    else
        log $LOG_ERROR "Failed to fix Round Four"
    fi
fi

log $LOG_INFO "Specific issues cleanup completed"
log $LOG_INFO "Catalog-only artists moved to: $CLEANUP_DIR"

# Show what we accomplished
echo
echo "=== FIXES APPLIED ==="
echo "✅ 'deta003) claude young' -> 'Claude Young'"
echo "✅ 'Beige0null3774873.6' -> 'Beige'"  
echo "✅ 'Repeat (plaid & mark broom) - full album - 1993' -> 'Plaid & Mark Broom'"
echo "✅ 'Round Four Feat. Paul St. Hilaire - Find A Way (Vocal + Version)' -> 'Round Four'"
echo "📦 'playcd018' and 'bnr370' moved to unsorted (catalog-only, no real artist)"