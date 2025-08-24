#!/bin/bash
#
# analyze_all_albums.sh - Analyze all 99 albums for hybrid reconstruction success rate

set -euo pipefail

echo "📊 Comprehensive Analysis of Albums & EPs/By Artist Directory"
echo "============================================================="
echo ""

ALBUMS_DIR="/home/plex/Music/Albums & EPs/By Artist"
total_albums=$(find "$ALBUMS_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l)

echo "📂 Total albums found: $total_albums"
echo ""

# Counters
processable=0
empty_dirs=0
no_audio=0
pattern_failures=0
successful_patterns=()
failed_patterns=()

echo "🔍 Analyzing each album..."

while IFS= read -r -d '' album_path; do
    album_name=$(basename "$album_path")
    
    # Check for audio files
    audio_count=$(find "$album_path" -maxdepth 2 -type f -iname "*.mp3" -o -iname "*.flac" -o -iname "*.wav" -o -iname "*.m4a" 2>/dev/null | wc -l)
    
    if [[ $audio_count -eq 0 ]]; then
        ((empty_dirs++))
        continue
    fi
    
    # Test hybrid reconstruction patterns
    recon_artist="" recon_title="" recon_year=""
    pattern_matched=""
    
    # Pattern 1: Catalog prefix - cat## Artist - Title
    if [[ "$album_name" =~ ^([a-z]+[0-9]+)[[:space:]]+([^-]+)[[:space:]]*-[[:space:]]*(.+)$ ]]; then
        recon_artist="${BASH_REMATCH[2]}"
        recon_title="${BASH_REMATCH[3]}"
        pattern_matched="catalog_prefix"
        
    # Pattern 2: Scene release - Artist - Title - Details - Year - Group
    elif [[ "$album_name" =~ ^([A-Za-z][^-]*)[[:space:]]*-[[:space:]]*([^-]+)[[:space:]]*-[[:space:]]*[^-]*-[[:space:]]*([0-9]{4})[[:space:]]*-[A-Za-z]+ ]]; then
        recon_artist="${BASH_REMATCH[1]}"
        recon_title="${BASH_REMATCH[2]}"
        recon_year="${BASH_REMATCH[3]}"
        pattern_matched="scene_release"
        
    # Pattern 3: Simple Artist - Title
    elif [[ "$album_name" =~ ^([^-]+)[[:space:]]*-[[:space:]]*([^-].+)$ ]]; then
        recon_artist="${BASH_REMATCH[1]}"
        recon_title="${BASH_REMATCH[2]}"
        pattern_matched="artist_title"
        
    # Pattern 4: Compilation/title only (if length > 10)
    elif [[ ${#album_name} -gt 10 ]] && [[ ! "$album_name" =~ ^[0-9] ]]; then
        recon_title="$album_name"
        pattern_matched="compilation"
    fi
    
    # Clean extracted data
    recon_artist=$(echo "$recon_artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    recon_title=$(echo "$recon_title" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    # Calculate confidence
    confidence=50
    [[ -n "$recon_artist" ]] && confidence=$((confidence + 30))
    [[ -n "$recon_title" ]] && confidence=$((confidence + 20))
    [[ -n "$recon_year" ]] && confidence=$((confidence + 10))
    
    # Check success criteria
    if [[ $confidence -ge 70 ]] && ( [[ -n "$recon_artist" && -n "$recon_title" ]] || [[ "$pattern_matched" == "compilation" && -n "$recon_title" ]] ); then
        ((processable++))
        successful_patterns+=("$album_name ($pattern_matched)")
        printf "✅"
    else
        ((pattern_failures++))
        failed_patterns+=("$album_name")
        printf "❌"
    fi
    
    # Progress indicator (print dot every 10 albums)
    if [[ $(( (processable + pattern_failures + empty_dirs) % 10 )) -eq 0 ]]; then
        echo ""
    fi
    
done < <(find "$ALBUMS_DIR" -mindepth 1 -maxdepth 1 -type d -print0)

echo ""
echo ""
echo "📈 ANALYSIS RESULTS"
echo "=================="
echo ""
echo "📊 Summary Statistics:"
echo "   Total albums analyzed: $total_albums"
echo "   Albums with audio files: $((processable + pattern_failures))"
echo "   Empty/no-audio directories: $empty_dirs"
echo "   Successfully processable: $processable"
echo "   Pattern failures: $pattern_failures"
echo ""
echo "🎯 Hybrid Reconstruction Success Rate:"
echo "   Current system would process: $processable/$((processable + pattern_failures)) albums"
echo "   Success rate: $(( processable * 100 / (processable + pattern_failures) ))%"
echo "   Improvement: $(( processable )) albums rescued from problematic status"
echo ""

if [[ $pattern_failures -gt 0 ]]; then
    echo "❌ Albums still needing manual handling ($pattern_failures):"
    for i in $(seq 0 $((${#failed_patterns[@]} > 10 ? 9 : ${#failed_patterns[@]} - 1))); do
        echo "   • ${failed_patterns[i]}"
    done
    if [[ ${#failed_patterns[@]} -gt 10 ]]; then
        echo "   ... and $(( ${#failed_patterns[@]} - 10 )) more"
    fi
fi

echo ""
echo "🧹 Cleanup Recommendations:"
echo "   • Delete $empty_dirs empty directories"
echo "   • Process $processable albums with hybrid reconstruction"
echo "   • Manually review $pattern_failures remaining albums"
echo ""

total_improvement=$(( processable * 100 / total_albums ))
echo "🚀 IMPACT ASSESSMENT:"
echo "   Before: 0/$total_albums albums processable (0%)"
echo "   After:  $processable/$total_albums albums processable ($total_improvement%)"
echo "   Total improvement: +$total_improvement percentage points"