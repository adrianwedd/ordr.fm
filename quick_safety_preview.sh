#!/bin/bash
#
# quick_safety_preview.sh - Quick preview of directory contents for safety

echo "🔍 QUICK SAFETY PREVIEW - First 10 directories"
echo "=============================================="
echo ""

count=0
while IFS= read -r -d '' dir_path; do
    if [[ $count -ge 10 ]]; then break; fi
    
    dir_name=$(basename "$dir_path")
    echo "📂 $dir_name"
    
    # Quick checks
    total_files=$(find "$dir_path" -type f 2>/dev/null | wc -l)
    audio_files=$(find "$dir_path" -maxdepth 3 -type f -iname "*.mp3" -o -iname "*.flac" -o -iname "*.wav" 2>/dev/null | wc -l)
    
    echo "   Files: $total_files | Audio: $audio_files"
    
    if [[ $total_files -eq 0 ]]; then
        echo "   ✅ EMPTY"
    elif [[ $audio_files -gt 0 ]]; then
        echo "   🎵 HAS AUDIO - KEEP"
        echo "   Sample files:"
        find "$dir_path" -name "*.mp3" -o -name "*.flac" | head -2 | sed 's|.*/|      • |'
    elif [[ $total_files -le 3 ]]; then
        echo "   📄 FEW FILES:"
        find "$dir_path" -type f | head -3 | sed 's|.*/|      • |'
    else
        echo "   📁 MULTIPLE FILES - REVIEW NEEDED"
    fi
    
    echo ""
    ((count++))
done < <(find "/home/plex/Music/Albums & EPs/By Artist" -mindepth 1 -maxdepth 1 -type d -print0)

echo "💡 This is just a preview. Running full verification..."