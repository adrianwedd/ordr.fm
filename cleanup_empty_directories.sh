#!/bin/bash
#
# cleanup_empty_directories.sh - Safe cleanup of empty directories after hybrid reconstruction
#
# This script implements the user's "triple check directories are empty before sending them to trash" requirement.
# It provides safe, comprehensive analysis before any cleanup operations.

set -euo pipefail

TARGET_DIR="/home/plex/Music/Albums & EPs/By Artist"
TRASH_DIR="/home/pi/.local/share/Trash/files"
REPORT_FILE="/tmp/empty_cleanup_$(date +%Y%m%d_%H%M%S).txt"

echo "🧹 SAFE EMPTY DIRECTORY CLEANUP" | tee "$REPORT_FILE"
echo "===============================" | tee -a "$REPORT_FILE"
echo "Target: $TARGET_DIR" | tee -a "$REPORT_FILE"
echo "Report: $REPORT_FILE" | tee -a "$REPORT_FILE"
echo "Date: $(date)" | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"

# Safety categories
declare -a SAFE_TO_DELETE=()
declare -a NEEDS_REVIEW=()

# Counters
total=0
safe_count=0
review_count=0

echo "🔍 TRIPLE SAFETY ANALYSIS..." | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"

analyze_directory_triple_check() {
    local dir_path="$1"
    local dir_name=$(basename "$dir_path")
    
    ((total++))
    echo "[$total] Triple-checking: $dir_name" | tee -a "$REPORT_FILE"
    
    # TRIPLE CHECK SYSTEM
    
    # Check 1: File count (all files)
    local check1_files=0
    if [[ -d "$dir_path" ]]; then
        check1_files=$(find "$dir_path" -type f 2>/dev/null | wc -l || echo 0)
    fi
    
    # Check 2: Audio files specifically  
    local check2_audio=0
    if [[ -d "$dir_path" ]]; then
        check2_audio=$(find "$dir_path" -maxdepth 3 -type f \( -iname "*.mp3" -o -iname "*.flac" -o -iname "*.wav" -o -iname "*.m4a" -o -iname "*.aac" \) 2>/dev/null | wc -l || echo 0)
    fi
    
    # Check 3: Important files (metadata, logs, etc.)
    local check3_important=0
    if [[ -d "$dir_path" ]]; then
        check3_important=$(find "$dir_path" -maxdepth 3 -type f \( -iname "*.cue" -o -iname "*.log" -o -iname "*.nfo" -o -iname "*.txt" -o -iname "*.jpg" -o -iname "*.png" \) 2>/dev/null | wc -l || echo 0)
    fi
    
    # Check 4: Large files (>1MB)
    local check4_large=0  
    if [[ -d "$dir_path" ]]; then
        check4_large=$(find "$dir_path" -maxdepth 3 -type f -size +1M 2>/dev/null | wc -l || echo 0)
    fi
    
    # Check 5: Subdirectories
    local check5_subdirs=0
    if [[ -d "$dir_path" ]]; then
        check5_subdirs=$(find "$dir_path" -mindepth 1 -type d 2>/dev/null | wc -l || echo 0)
    fi
    
    echo "   Check 1 - All files: $check1_files" | tee -a "$REPORT_FILE"
    echo "   Check 2 - Audio files: $check2_audio" | tee -a "$REPORT_FILE" 
    echo "   Check 3 - Important files: $check3_important" | tee -a "$REPORT_FILE"
    echo "   Check 4 - Large files (>1MB): $check4_large" | tee -a "$REPORT_FILE"
    echo "   Check 5 - Subdirectories: $check5_subdirs" | tee -a "$REPORT_FILE"
    
    # TRIPLE SAFETY DECISION MATRIX
    if [[ $check2_audio -gt 0 ]]; then
        # HAS AUDIO - ABSOLUTELY NEVER DELETE
        echo "   🚨 NEVER DELETE: Contains $check2_audio audio files!" | tee -a "$REPORT_FILE"
        NEEDS_REVIEW+=("$dir_name [AUDIO DETECTED - DO NOT DELETE]")
        ((review_count++))
        
    elif [[ $check3_important -gt 0 ]] || [[ $check4_large -gt 0 ]]; then
        # HAS IMPORTANT OR LARGE FILES - NEEDS MANUAL REVIEW
        echo "   ⚠️  NEEDS REVIEW: Important ($check3_important) or large ($check4_large) files detected" | tee -a "$REPORT_FILE"
        NEEDS_REVIEW+=("$dir_name [Important/large files: $check3_important important, $check4_large large]")
        ((review_count++))
        
    elif [[ $check1_files -eq 0 ]] && [[ $check5_subdirs -eq 0 ]]; then
        # COMPLETELY EMPTY - SAFE TO DELETE
        echo "   ✅ SAFE TO DELETE: Completely empty (0 files, 0 subdirs)" | tee -a "$REPORT_FILE"
        SAFE_TO_DELETE+=("$dir_path")
        ((safe_count++))
        
    elif [[ $check1_files -le 2 ]] && [[ $check5_subdirs -eq 0 ]]; then
        # NEARLY EMPTY - REVIEW FIRST
        echo "   ❓ NEARLY EMPTY: Only $check1_files files - needs review" | tee -a "$REPORT_FILE"
        NEEDS_REVIEW+=("$dir_name [Nearly empty: $check1_files files]")
        ((review_count++))
        
    else
        # UNKNOWN STATE - NEEDS REVIEW
        echo "   ❓ UNKNOWN STATE: Files=$check1_files, Subdirs=$check5_subdirs - needs review" | tee -a "$REPORT_FILE"
        NEEDS_REVIEW+=("$dir_name [Unknown state: $check1_files files, $check5_subdirs subdirs]")
        ((review_count++))
    fi
    
    echo "" | tee -a "$REPORT_FILE"
}

# Process all directories with triple safety checks
while IFS= read -r -d '' dir_path; do
    analyze_directory_triple_check "$dir_path"
done < <(find "$TARGET_DIR" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null)

# Generate comprehensive safety report
{
    echo ""
    echo "📊 TRIPLE SAFETY ANALYSIS SUMMARY"
    echo "=================================="
    echo "Total directories analyzed: $total"
    echo "Safe to delete: $safe_count" 
    echo "Need manual review: $review_count"
    echo ""
    
    if [[ $safe_count -gt 0 ]]; then
        echo "✅ DIRECTORIES SAFE TO DELETE:"
        echo "=============================="
        for dir in "${SAFE_TO_DELETE[@]}"; do
            echo "  - $(basename "$dir")"
        done
        echo ""
    fi
    
    if [[ $review_count -gt 0 ]]; then
        echo "⚠️  DIRECTORIES REQUIRING MANUAL REVIEW:"
        echo "========================================"
        for item in "${NEEDS_REVIEW[@]}"; do
            echo "  - $item" 
        done
        echo ""
    fi
    
    echo "🔒 SAFETY RECOMMENDATIONS:"
    echo "=========================="
    echo "1. Review all directories marked for manual review"
    echo "2. Only delete directories explicitly marked as 'SAFE TO DELETE'"
    echo "3. Create backup before any deletion operations"
    echo "4. Use 'trash-put' command instead of 'rm' for safety"
    echo ""
    
    if [[ $safe_count -gt 0 ]]; then
        echo "💡 TO DELETE SAFE DIRECTORIES:"
        echo "=============================="
        echo "# Install trash-cli if needed: sudo apt install trash-cli"
        echo "# Then run these commands:"
        for dir in "${SAFE_TO_DELETE[@]}"; do
            echo "trash-put \"$dir\"  # $(basename "$dir")"
        done
        echo ""
        echo "🚨 WARNING: Only run above commands after manual verification!"
    fi
    
} | tee -a "$REPORT_FILE"

echo "📋 Analysis complete! Report saved to: $REPORT_FILE"
echo "⚠️  Please manually review the report before any cleanup operations."