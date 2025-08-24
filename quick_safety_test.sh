#!/bin/bash
#
# quick_safety_test.sh - Quick test of directory analysis
#

set -euo pipefail

TARGET_DIR="/home/plex/Music/Albums & EPs/By Artist"
echo "🔍 Quick safety test on: $TARGET_DIR"

total=0
audio_count=0
empty_count=0

# Process directories with progress
while IFS= read -r -d '' dir_path; do
    dir_name=$(basename "$dir_path")
    ((total++))
    
    echo "[$total] Checking: $dir_name"
    
    # Quick checks
    audio_files=$(find "$dir_path" -maxdepth 2 -type f \( -iname "*.mp3" -o -iname "*.flac" -o -iname "*.wav" \) 2>/dev/null | wc -l)
    
    if [[ $audio_files -gt 0 ]]; then
        echo "   ✅ HAS AUDIO: $audio_files files"
        ((audio_count++))
    else
        all_files=$(find "$dir_path" -maxdepth 2 -type f 2>/dev/null | wc -l)
        if [[ $all_files -eq 0 ]]; then
            echo "   📭 EMPTY"
            ((empty_count++))
        else
            echo "   ❓ NO AUDIO, $all_files other files"
        fi
    fi
    
    # Stop after 10 for testing
    if [[ $total -ge 10 ]]; then
        echo "Stopping after 10 directories for testing..."
        break
    fi
    
done < <(find "$TARGET_DIR" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null)

echo ""
echo "📊 Quick Summary:"
echo "Total processed: $total"
echo "With audio: $audio_count"
echo "Empty: $empty_count"