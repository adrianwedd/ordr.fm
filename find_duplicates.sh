#\!/bin/bash
# Find albums that exist in both MP3 and FLAC formats

echo "=== Finding Duplicate Albums (MP3 + FLAC) ==="
echo "This will help identify albums we can delete after backup..."
echo

MUSIC_DIR="/home/plex/Music"
DUPE_LOG="duplicate_albums_$(date +%Y%m%d_%H%M%S).txt"

# Find all directories containing music
echo "Analyzing music collection for duplicates..."

# Find albums with both MP3 and FLAC files
find "$MUSIC_DIR" -type d | while read -r dir; do
    # Check if directory has both MP3 and FLAC files
    MP3_COUNT=$(find "$dir" -maxdepth 1 -name "*.mp3" -o -name "*.MP3" 2>/dev/null | wc -l)
    FLAC_COUNT=$(find "$dir" -maxdepth 1 -name "*.flac" -o -name "*.FLAC" 2>/dev/null | wc -l)
    
    if [ "$MP3_COUNT" -gt 0 ] && [ "$FLAC_COUNT" -gt 0 ]; then
        SIZE=$(du -sh "$dir" 2>/dev/null | cut -f1)
        echo "MIXED FORMAT: $dir (Size: $SIZE, MP3: $MP3_COUNT, FLAC: $FLAC_COUNT)" | tee -a "$DUPE_LOG"
    fi
done

echo
echo "=== Checking for potential same-album duplicates ==="

# Look for directories with similar names (might be duplicates)
find "$MUSIC_DIR" -type d -mindepth 2 -maxdepth 3 | sed 's/[[(].*//' | sort | uniq -d | while read -r base; do
    echo "Potential duplicate album base: $base" | tee -a "$DUPE_LOG"
    find "$MUSIC_DIR" -type d -name "${base}*" | while read -r dir; do
        SIZE=$(du -sh "$dir" 2>/dev/null | cut -f1)
        echo "  -> $dir (Size: $SIZE)" | tee -a "$DUPE_LOG"
    done
done

echo
echo "Results saved to: $DUPE_LOG"
echo "Total potential space savings:"
grep "MIXED FORMAT" "$DUPE_LOG" 2>/dev/null | cut -d'(' -f2 | cut -d',' -f1 | sed 's/Size: //' | while read size; do
    echo "$size"
done | head -20
