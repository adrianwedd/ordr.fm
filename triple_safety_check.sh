#!/bin/bash
#
# triple_safety_check.sh - Triple verification safety check for directory cleanup
# NO DELETIONS - Only analysis and recommendations

set -euo pipefail

TARGET_DIR="/home/plex/Music/Albums & EPs/By Artist"
REPORT_FILE="/tmp/safety_report_$(date +%Y%m%d_%H%M%S).txt"

echo "🔒 TRIPLE SAFETY VERIFICATION" > "$REPORT_FILE"
echo "============================" >> "$REPORT_FILE"
echo "Target: $TARGET_DIR" >> "$REPORT_FILE"
echo "Report: $REPORT_FILE" >> "$REPORT_FILE"  
echo "Date: $(date)" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# Safety categories
declare -a SAFE_FOR_DELETE=()
declare -a HAS_AUDIO=()
declare -a NEEDS_REVIEW=()
declare -a COMPLETELY_EMPTY=()

# Counters
total=0
audio_count=0
empty_count=0
review_count=0

echo "🔍 Analyzing directories..." | tee -a "$REPORT_FILE"

analyze_directory() {
    local dir_path="$1"
    local dir_name=$(basename "$dir_path")
    
    ((total++))
    
    # Triple check system with progress indication
    echo "   Analyzing: $dir_name" | tee -a "$REPORT_FILE"
    
    # Skip system and permission-problematic directories
    if [[ "$dir_path" =~ /tmp/systemd-private- ]] || [[ "$dir_path" =~ /proc ]] || [[ "$dir_path" =~ /sys ]]; then
        echo "   Skipping system directory: $dir_name" >> "$REPORT_FILE"
        return 0
    fi
    
    local check1_files=$(find "$dir_path" -maxdepth 3 -type f 2>/dev/null | wc -l)
    local check2_audio=$(find "$dir_path" -maxdepth 3 -type f \( -iname "*.mp3" -o -iname "*.flac" -o -iname "*.wav" -o -iname "*.m4a" -o -iname "*.aac" \) 2>/dev/null | wc -l)
    local check3_important=$(find "$dir_path" -maxdepth 3 -type f \( -iname "*.cue" -o -iname "*.log" -o -iname "*.nfo" -o -iname "*.txt" \) 2>/dev/null | wc -l)
    local check4_large=$(find "$dir_path" -maxdepth 3 -type f -size +5M 2>/dev/null | wc -l)
    local check5_subdirs=$(find "$dir_path" -mindepth 1 -maxdepth 2 -type d 2>/dev/null | wc -l)
    
    # Safety decision matrix
    if [[ $check2_audio -gt 0 ]]; then
        # HAS AUDIO - ABSOLUTELY DO NOT DELETE
        HAS_AUDIO+=("$dir_name [Audio: $check2_audio files]")
        ((audio_count++))
        echo "🎵 KEEP: $dir_name" >> "$REPORT_FILE"
        
    elif [[ $check1_files -eq 0 ]] && [[ $check5_subdirs -eq 0 ]]; then
        # COMPLETELY EMPTY
        COMPLETELY_EMPTY+=("$dir_name")
        ((empty_count++))
        echo "📭 EMPTY: $dir_name" >> "$REPORT_FILE"
        
    elif [[ $check3_important -gt 0 ]] || [[ $check4_large -gt 0 ]]; then
        # HAS IMPORTANT OR LARGE FILES - NEEDS REVIEW  
        NEEDS_REVIEW+=("$dir_name [Files: $check1_files, Important: $check3_important, Large: $check4_large]")
        ((review_count++))
        echo "⚠️  REVIEW: $dir_name" >> "$REPORT_FILE"
        
    elif [[ $check1_files -le 3 ]]; then
        # FEW FILES - LIST THEM FOR MANUAL DECISION
        local file_list=$(find "$dir_path" -type f -exec basename {} \; | head -3 | tr '\n' ', ' | sed 's/,$//')
        NEEDS_REVIEW+=("$dir_name [Small files: $file_list]")
        ((review_count++))
        echo "🔍 REVIEW: $dir_name [$file_list]" >> "$REPORT_FILE"
        
    else
        # UNKNOWN CONTENT
        NEEDS_REVIEW+=("$dir_name [Files: $check1_files, Subdirs: $check5_subdirs]")
        ((review_count++))
        echo "❓ REVIEW: $dir_name" >> "$REPORT_FILE"
    fi
}

# Process all directories
while IFS= read -r -d '' dir_path; do
    analyze_directory "$dir_path"
done < <(find "$TARGET_DIR" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null)

# Generate comprehensive safety report
{
    echo ""
    echo "📊 SAFETY ANALYSIS SUMMARY"
    echo "=========================="
    echo "Total directories: $total"
    echo "Has audio files (KEEP): $audio_count"
    echo "Completely empty: $empty_count"
    echo "Needs manual review: $review_count"
    echo ""
    
    if [[ $empty_count -gt 0 ]]; then
        echo "📭 COMPLETELY EMPTY DIRECTORIES ($empty_count):"
        echo "These appear safe for deletion after manual verification:"
        for dir in "${COMPLETELY_EMPTY[@]}"; do
            echo "  • $dir"
        done
        echo ""
    fi
    
    if [[ $audio_count -gt 0 ]]; then
        echo "🎵 DIRECTORIES WITH AUDIO ($audio_count):"
        echo "NEVER DELETE - These contain music files:"
        for dir in "${HAS_AUDIO[@]}"; do
            echo "  • $dir"
        done | head -20
        if [[ $audio_count -gt 20 ]]; then
            echo "  ... and $((audio_count - 20)) more"
        fi
        echo ""
    fi
    
    if [[ $review_count -gt 0 ]]; then
        echo "⚠️  NEEDS MANUAL REVIEW ($review_count):"
        echo "Check these carefully before any action:"
        for dir in "${NEEDS_REVIEW[@]}"; do
            echo "  • $dir"
        done | head -15
        if [[ $review_count -gt 15 ]]; then
            echo "  ... and $((review_count - 15)) more"
        fi
        echo ""
    fi
    
    echo "🚨 SAFETY PROTOCOL:"
    echo "=================="
    echo "1. This script makes NO deletions"
    echo "2. Only directories marked 'COMPLETELY EMPTY' are candidates"
    echo "3. ALWAYS manually verify before deleting anything"
    echo "4. Create backups before any operations"
    echo "5. Never delete directories with audio files"
    echo ""
    
    if [[ $empty_count -gt 0 ]]; then
        echo "📋 RECOMMENDED ACTIONS:"
        echo "1. Review this report: $REPORT_FILE"
        echo "2. Manually verify each empty directory"
        echo "3. Create deletion commands only for verified empties"
        echo ""
        echo "Example verification commands:"
        echo "ls -la \"$TARGET_DIR/[DIRECTORY_NAME]\""
        echo "find \"$TARGET_DIR/[DIRECTORY_NAME]\" -type f"
    else
        echo "🛡️  NO DIRECTORIES RECOMMENDED FOR DELETION"
        echo "All directories either contain files or need review"
    fi
    
} >> "$REPORT_FILE"

# Display results
echo "✅ Safety analysis completed!"
echo "📊 Results: $audio_count with audio, $empty_count empty, $review_count need review"
echo "📋 Full report: $REPORT_FILE"
echo ""
cat "$REPORT_FILE" | tail -20