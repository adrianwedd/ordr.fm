#!/bin/bash
#
# simple_safety_check.sh - Simple safety check using ls instead of find
#

set -euo pipefail

TARGET_DIR="/home/plex/Music/Albums & EPs/By Artist"
REPORT_FILE="/tmp/simple_safety_$(date +%Y%m%d_%H%M%S).txt"

echo "🔍 Simple safety check" | tee "$REPORT_FILE"
echo "Target: $TARGET_DIR" | tee -a "$REPORT_FILE"

total=0
audio_count=0
empty_count=0

# Use ls instead of find to avoid permission issues
cd "$TARGET_DIR"

for dir_name in */; do
    # Remove trailing slash
    dir_name=${dir_name%/}
    
    if [[ ! -d "$dir_name" ]]; then
        continue
    fi
    
    ((total++))
    echo "[$total] $dir_name" | tee -a "$REPORT_FILE"
    
    # Count audio files using a simple approach
    audio_files=0
    if ls "$dir_name"/*.{mp3,flac,wav,m4a} 2>/dev/null | head -1 > /dev/null 2>&1; then
        audio_files=$(ls "$dir_name"/*.{mp3,flac,wav,m4a} 2>/dev/null | wc -l || echo 0)
    fi
    
    if [[ $audio_files -gt 0 ]]; then
        echo "   ✅ AUDIO: $audio_files files" | tee -a "$REPORT_FILE"
        ((audio_count++))
    else
        all_files=$(ls -la "$dir_name" 2>/dev/null | grep -v "^total" | grep -v "^d" | wc -l)
        if [[ $all_files -le 2 ]]; then  # Just . and ..
            echo "   📭 EMPTY" | tee -a "$REPORT_FILE"
            ((empty_count++))
        else
            echo "   ❓ NO AUDIO ($all_files files)" | tee -a "$REPORT_FILE"
        fi
    fi
done

echo ""
echo "📊 SUMMARY:" | tee -a "$REPORT_FILE"
echo "Total: $total" | tee -a "$REPORT_FILE"
echo "With audio: $audio_count" | tee -a "$REPORT_FILE"
echo "Empty: $empty_count" | tee -a "$REPORT_FILE"
echo "Candidates for hybrid reconstruction: $((total - audio_count))" | tee -a "$REPORT_FILE"
echo ""
echo "Report saved: $REPORT_FILE"