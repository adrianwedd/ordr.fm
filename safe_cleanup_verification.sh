#!/bin/bash
#
# safe_cleanup_verification.sh - TRIPLE verification before any directory cleanup
#
# This script performs comprehensive checks to ensure directories are truly empty
# before recommending them for cleanup. NO AUTOMATIC DELETIONS.

set -euo pipefail

ALBUMS_DIR="/home/plex/Music/Albums & EPs/By Artist"
LOG_FILE="/tmp/cleanup_verification_$(date +%Y%m%d_%H%M%S).log"

echo "🔍 TRIPLE VERIFICATION SAFETY CHECK"
echo "===================================" | tee "$LOG_FILE"
echo "Target directory: $ALBUMS_DIR" | tee -a "$LOG_FILE"
echo "Log file: $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Safety counters
total_dirs=0
completely_empty=0
has_audio_files=0
has_other_files=0
questionable_dirs=()
safe_for_deletion=()

echo "🔒 SAFETY PROTOCOL: Triple verification process" | tee -a "$LOG_FILE"
echo "=============================================" | tee -a "$LOG_FILE"
echo ""

# Function to check if directory is truly empty
verify_empty_directory() {
    local dir_path="$1"
    local dir_name=$(basename "$dir_path")
    
    echo "🔍 Checking: $dir_name" | tee -a "$LOG_FILE"
    
    # Check 1: Any files at all?
    local total_files=$(find "$dir_path" -type f 2>/dev/null | wc -l)
    echo "   Check 1 - Total files: $total_files" | tee -a "$LOG_FILE"
    
    # Check 2: Audio files specifically
    local audio_files=$(find "$dir_path" -maxdepth 3 -type f \( -iname "*.mp3" -o -iname "*.flac" -o -iname "*.wav" -o -iname "*.m4a" -o -iname "*.aac" -o -iname "*.ogg" -o -iname "*.wma" -o -iname "*.aiff" -o -iname "*.alac" \) 2>/dev/null | wc -l)
    echo "   Check 2 - Audio files: $audio_files" | tee -a "$LOG_FILE"
    
    # Check 3: Important files (avoid deleting valuable metadata)
    local important_files=$(find "$dir_path" -maxdepth 3 -type f \( -iname "*.cue" -o -iname "*.log" -o -iname "*.txt" -o -iname "*.nfo" -o -iname "*.sfv" -o -iname "*.m3u" \) 2>/dev/null | wc -l)
    echo "   Check 3 - Important files: $important_files" | tee -a "$LOG_FILE"
    
    # Check 4: Directory structure (subdirectories)
    local subdirs=$(find "$dir_path" -mindepth 1 -type d 2>/dev/null | wc -l)
    echo "   Check 4 - Subdirectories: $subdirs" | tee -a "$LOG_FILE"
    
    # Check 5: Hidden files
    local hidden_files=$(find "$dir_path" -name ".*" -type f 2>/dev/null | wc -l)
    echo "   Check 5 - Hidden files: $hidden_files" | tee -a "$LOG_FILE"
    
    # Check 6: File sizes (catch any substantial files)
    local large_files=$(find "$dir_path" -type f -size +1M 2>/dev/null | wc -l)
    echo "   Check 6 - Files >1MB: $large_files" | tee -a "$LOG_FILE"
    
    # Determine safety level
    if [[ $audio_files -gt 0 ]]; then
        echo "   ⚠️  HAS AUDIO FILES - DO NOT DELETE" | tee -a "$LOG_FILE"
        ((has_audio_files++))
        questionable_dirs+=("$dir_name [HAS AUDIO: $audio_files files]")
        
    elif [[ $important_files -gt 0 ]]; then
        echo "   ⚠️  HAS IMPORTANT FILES - DO NOT DELETE" | tee -a "$LOG_FILE"
        ((has_other_files++))
        questionable_dirs+=("$dir_name [IMPORTANT FILES: $important_files files]")
        
    elif [[ $large_files -gt 0 ]]; then
        echo "   ⚠️  HAS LARGE FILES - NEEDS MANUAL REVIEW" | tee -a "$LOG_FILE"
        ((has_other_files++))
        questionable_dirs+=("$dir_name [LARGE FILES: $large_files files]")
        
    elif [[ $total_files -eq 0 ]]; then
        echo "   ✅ COMPLETELY EMPTY - SAFE FOR DELETION" | tee -a "$LOG_FILE"
        ((completely_empty++))
        safe_for_deletion+=("$dir_name [EMPTY]")
        
    elif [[ $total_files -le 3 ]] && [[ $subdirs -eq 0 ]]; then
        # List the few files for manual verification
        echo "   🔍 FEW FILES - MANUAL VERIFICATION NEEDED:" | tee -a "$LOG_FILE"
        find "$dir_path" -type f -exec basename {} \; | head -5 | sed 's/^/      • /' | tee -a "$LOG_FILE"
        ((has_other_files++))
        questionable_dirs+=("$dir_name [FEW FILES: $total_files files - needs manual check]")
        
    else
        echo "   ⚠️  UNKNOWN CONTENT - DO NOT DELETE" | tee -a "$LOG_FILE"
        ((has_other_files++))
        questionable_dirs+=("$dir_name [UNKNOWN: $total_files files, $subdirs subdirs]")
    fi
    
    echo "" | tee -a "$LOG_FILE"
}

# Process all directories
echo "📂 Processing all directories in Albums & EPs/By Artist..." | tee -a "$LOG_FILE"
echo ""

while IFS= read -r -d '' dir_path; do
    ((total_dirs++))
    verify_empty_directory "$dir_path"
done < <(find "$ALBUMS_DIR" -mindepth 1 -maxdepth 1 -type d -print0)

# Final safety report
echo "📊 FINAL SAFETY VERIFICATION REPORT" | tee -a "$LOG_FILE"
echo "====================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "🔢 Statistics:" | tee -a "$LOG_FILE"
echo "   Total directories analyzed: $total_dirs" | tee -a "$LOG_FILE"
echo "   Completely empty (safe): $completely_empty" | tee -a "$LOG_FILE"
echo "   Has audio files (KEEP): $has_audio_files" | tee -a "$LOG_FILE"
echo "   Has other files (REVIEW): $has_other_files" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

if [[ $completely_empty -gt 0 ]]; then
    echo "✅ SAFE FOR DELETION ($completely_empty directories):" | tee -a "$LOG_FILE"
    for dir in "${safe_for_deletion[@]}"; do
        echo "   • $dir" | tee -a "$LOG_FILE"
    done
    echo "" | tee -a "$LOG_FILE"
fi

if [[ ${#questionable_dirs[@]} -gt 0 ]]; then
    echo "⚠️  REQUIRES MANUAL REVIEW (${#questionable_dirs[@]} directories):" | tee -a "$LOG_FILE"
    for dir in "${questionable_dirs[@]}"; do
        echo "   • $dir" | tee -a "$LOG_FILE"
    done
    echo "" | tee -a "$LOG_FILE"
fi

echo "🚨 SAFETY PROTOCOLS:" | tee -a "$LOG_FILE"
echo "   • This script makes NO automatic deletions" | tee -a "$LOG_FILE"
echo "   • ALL deletions must be manually confirmed" | tee -a "$LOG_FILE"  
echo "   • Always backup before deleting anything" | tee -a "$LOG_FILE"
echo "   • Review log file: $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

if [[ $completely_empty -gt 0 ]]; then
    echo "📋 NEXT STEPS:" | tee -a "$LOG_FILE"
    echo "   1. Review the complete log file: $LOG_FILE" | tee -a "$LOG_FILE"
    echo "   2. Manually verify each 'safe' directory" | tee -a "$LOG_FILE"
    echo "   3. Create backup before any deletions" | tee -a "$LOG_FILE"
    echo "   4. Only delete directories marked as COMPLETELY EMPTY" | tee -a "$LOG_FILE"
    echo ""
    echo "🔧 To generate deletion commands (REVIEW FIRST):"
    echo "   grep 'COMPLETELY EMPTY' $LOG_FILE"
else
    echo "🛡️  NO DIRECTORIES RECOMMENDED FOR DELETION" | tee -a "$LOG_FILE"
    echo "   All directories contain files or require manual review" | tee -a "$LOG_FILE"
fi

echo ""
echo "✅ Triple verification completed. Check log: $LOG_FILE"