#!/bin/bash
#
# cleanup_artist_mess.sh - Fix the artist directory mess in sorted_music
# Addresses: duplicate artists, years as artists, track numbers as artists, etc.

set -euo pipefail

# Source the normalization library
source "$(dirname "$0")/lib/common.sh"
source "$(dirname "$0")/lib/artist_normalization.sh"

# Configuration
SORTED_DIR="${1:-/home/plex/Music/sorted_music}"
UNSORTED_DIR="$SORTED_DIR/unsorted/artist_cleanup_$(date +%Y%m%d_%H%M%S)"
DRY_RUN="${2:-1}"  # Default to dry run

if [[ $DRY_RUN -eq 1 ]]; then
    echo "🔍 DRY RUN MODE - No changes will be made"
else
    echo "⚠️  LIVE MODE - Changes will be applied"
fi

echo "═══════════════════════════════════════════════════════════"
echo "ARTIST DIRECTORY CLEANUP"
echo "═══════════════════════════════════════════════════════════"
echo "Target: $SORTED_DIR"
echo "Unsorted: $UNSORTED_DIR"
echo ""

# Process each quality directory
for quality in "Lossy" "Lossless" "Mixed"; do
    quality_dir="$SORTED_DIR/$quality"
    
    if [[ ! -d "$quality_dir" ]]; then
        continue
    fi
    
    echo "Processing $quality directory..."
    echo "───────────────────────────────────────────────────────────"
    
    # Step 1: Identify and report invalid artist directories
    echo "Step 1: Finding invalid artist directories..."
    
    invalid_count=0
    year_dirs=()
    track_dirs=()
    catalog_dirs=()
    
    for artist_dir in "$quality_dir"/*/; do
        [[ ! -d "$artist_dir" ]] && continue
        
        artist_name=$(basename "$artist_dir")
        
        # Check for years (1974, 1988, etc.)
        if [[ "$artist_name" =~ ^[0-9]{4}$ ]]; then
            year_dirs+=("$artist_name")
            ((invalid_count++))
        # Check for track numbers (01) kikoman, etc.)
        elif [[ "$artist_name" =~ ^[0-9]{1,2}[\)].* ]]; then
            track_dirs+=("$artist_name")
            ((invalid_count++))
        # Check for catalog numbers
        elif [[ "$artist_name" =~ ^[a-z]{2,5}[[:space:]][0-9]{3,5}$ ]]; then
            catalog_dirs+=("$artist_name")
            ((invalid_count++))
        fi
    done
    
    if [[ ${#year_dirs[@]} -gt 0 ]]; then
        echo "  Found ${#year_dirs[@]} year directories: ${year_dirs[*]:0:5}..."
    fi
    if [[ ${#track_dirs[@]} -gt 0 ]]; then
        echo "  Found ${#track_dirs[@]} track number directories: ${track_dirs[*]:0:5}..."
    fi
    if [[ ${#catalog_dirs[@]} -gt 0 ]]; then
        echo "  Found ${#catalog_dirs[@]} catalog directories: ${catalog_dirs[*]:0:5}..."
    fi
    
    # Step 2: Find duplicate artists
    echo "Step 2: Finding duplicate artists..."
    
    declare -A normalized_map
    duplicates_found=0
    
    for artist_dir in "$quality_dir"/*/; do
        [[ ! -d "$artist_dir" ]] && continue
        
        artist_name=$(basename "$artist_dir")
        normalized=$(normalize_artist_name "$artist_name")
        
        if [[ -n "${normalized_map[$normalized]:-}" ]]; then
            echo "  Duplicate found: '$artist_name' = '${normalized_map[$normalized]}' -> '$normalized'"
            ((duplicates_found++))
        else
            normalized_map[$normalized]="$artist_name"
        fi
    done
    
    echo "  Found $duplicates_found duplicate artist variations"
    
    # Step 3: Apply fixes (if not dry run)
    if [[ $DRY_RUN -eq 0 ]]; then
        echo "Step 3: Applying fixes..."
        
        # Clean invalid artists
        echo "  Moving invalid artist directories to unsorted..."
        cleanup_invalid_artists "$quality_dir" "$UNSORTED_DIR/$quality"
        
        # Merge duplicates
        echo "  Merging duplicate artists..."
        merge_duplicate_artists "$quality_dir"
        
        echo "✅ Fixes applied to $quality directory"
    else
        echo "Step 3: Skipping fixes (dry run mode)"
    fi
    
    echo ""
done

echo "═══════════════════════════════════════════════════════════"
echo "CLEANUP SUMMARY"
echo "═══════════════════════════════════════════════════════════"

if [[ $DRY_RUN -eq 1 ]]; then
    echo "This was a DRY RUN. To apply changes, run:"
    echo "  $0 '$SORTED_DIR' 0"
else
    echo "✅ Cleanup completed!"
    echo "Invalid artists moved to: $UNSORTED_DIR"
    echo "Duplicate artists have been merged"
fi