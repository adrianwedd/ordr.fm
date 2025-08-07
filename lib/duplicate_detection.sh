#!/bin/bash
# Advanced Duplicate Detection Engine for ordr.fm
# Provides intelligent duplicate detection with safety mechanisms

# Source required modules
source "${BASH_SOURCE%/*}/common.sh"
source "${BASH_SOURCE%/*}/database.sh"

# Configuration
declare -g DUPLICATE_THRESHOLD=0.85  # Minimum score to consider duplicate
declare -g FUZZY_MATCH_THRESHOLD=0.8  # Metadata fuzzy matching threshold
declare -g DURATION_TOLERANCE=5       # Seconds tolerance for track duration
declare -g QUALITY_WEIGHTS=()
declare -g DUPLICATE_DB="/tmp/ordr.fm_duplicates.db"

# Quality scoring weights
declare -g -A FORMAT_QUALITY=(
    ["flac"]=100
    ["wav"]=95
    ["aiff"]=95
    ["alac"]=90
    ["mp3"]=60
    ["aac"]=55
    ["m4a"]=55
    ["ogg"]=50
    ["wma"]=30
)

declare -g -A BITRATE_QUALITY=(
    ["320"]=100
    ["256"]=85
    ["192"]=70
    ["128"]=50
    ["96"]=30
)

# Initialize duplicate detection database
init_duplicate_detection() {
    local db_path="${1:-$DUPLICATE_DB}"
    
    sqlite3 "$db_path" << 'EOF'
CREATE TABLE IF NOT EXISTS audio_fingerprints (
    id INTEGER PRIMARY KEY,
    album_path TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    metadata_hash TEXT NOT NULL,
    duration_ms INTEGER,
    file_count INTEGER,
    total_size INTEGER,
    quality_score INTEGER,
    format TEXT,
    avg_bitrate INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS duplicate_groups (
    id INTEGER PRIMARY KEY,
    group_hash TEXT NOT NULL UNIQUE,
    album_count INTEGER,
    total_size INTEGER,
    best_quality_id INTEGER,
    duplicate_score REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (best_quality_id) REFERENCES audio_fingerprints(id)
);

CREATE TABLE IF NOT EXISTS duplicate_members (
    group_id INTEGER,
    fingerprint_id INTEGER,
    is_recommended_keep BOOLEAN DEFAULT 0,
    is_marked_for_deletion BOOLEAN DEFAULT 0,
    PRIMARY KEY (group_id, fingerprint_id),
    FOREIGN KEY (group_id) REFERENCES duplicate_groups(id),
    FOREIGN KEY (fingerprint_id) REFERENCES audio_fingerprints(id)
);

CREATE INDEX IF NOT EXISTS idx_fingerprint ON audio_fingerprints(fingerprint);
CREATE INDEX IF NOT EXISTS idx_metadata_hash ON audio_fingerprints(metadata_hash);
CREATE INDEX IF NOT EXISTS idx_duration ON audio_fingerprints(duration_ms);
CREATE INDEX IF NOT EXISTS idx_group_hash ON duplicate_groups(group_hash);
EOF
    
    log $LOG_INFO "Initialized duplicate detection database: $db_path"
}

# Generate audio fingerprint for an album
generate_audio_fingerprint() {
    local album_path="$1"
    local metadata_json="$2"
    
    # Extract key metadata for fingerprinting
    local artist=$(echo "$metadata_json" | jq -r '.artist // "Unknown"' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
    local album=$(echo "$metadata_json" | jq -r '.title // "Unknown"' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
    local year=$(echo "$metadata_json" | jq -r '.year // ""')
    local track_count=$(echo "$metadata_json" | jq -r '.track_count // 0')
    
    # Get file information
    local total_size=$(du -sb "$album_path" 2>/dev/null | cut -f1)
    local file_count=$(find "$album_path" -type f \( -name "*.mp3" -o -name "*.flac" -o -name "*.wav" -o -name "*.m4a" -o -name "*.aac" -o -name "*.ogg" \) | wc -l)
    
    # Calculate total duration from all tracks
    local total_duration=0
    if command -v exiftool >/dev/null 2>&1; then
        local durations
        durations=$(find "$album_path" -type f \( -name "*.mp3" -o -name "*.flac" -o -name "*.wav" -o -name "*.m4a" -o -name "*.aac" -o -name "*.ogg" \) -exec exiftool -Duration -n -T {} \; 2>/dev/null | grep -v '^$')
        if [[ -n "$durations" ]]; then
            total_duration=$(echo "$durations" | awk '{sum += $1} END {printf "%.0f", sum * 1000}')  # Convert to ms
        fi
    fi
    
    # Create composite fingerprint
    local content_fingerprint="${artist}|${album}|${track_count}|${file_count}|${total_duration}"
    local fingerprint=$(echo "$content_fingerprint" | sha256sum | cut -d' ' -f1)
    
    # Create metadata hash for exact matching
    local metadata_fingerprint="${artist}${album}${year}${track_count}"
    local metadata_hash=$(echo "$metadata_fingerprint" | sha256sum | cut -d' ' -f1)
    
    echo "$fingerprint|$metadata_hash|$total_duration|$file_count|$total_size"
}

# Calculate quality score for an album
calculate_quality_score() {
    local album_path="$1"
    local metadata_json="$2"
    
    local total_score=0
    local file_count=0
    local primary_format=""
    local avg_bitrate=0
    
    # Analyze each audio file
    while IFS= read -r -d '' file; do
        local ext="${file##*.}"
        ext=$(echo "$ext" | tr '[:upper:]' '[:lower:]')
        
        # Format scoring
        local format_score=${FORMAT_QUALITY[$ext]:-30}
        
        # Bitrate scoring (if available)
        local bitrate_score=50  # Default
        if command -v exiftool >/dev/null 2>&1; then
            local bitrate
            bitrate=$(exiftool -AudioBitrate -n -T "$file" 2>/dev/null | grep -o '^[0-9]*')
            if [[ -n "$bitrate" && "$bitrate" -gt 0 ]]; then
                # Find closest bitrate match
                local best_match=96
                for rate in "${!BITRATE_QUALITY[@]}"; do
                    if [[ $bitrate -ge $rate ]]; then
                        if [[ $rate -gt $best_match ]]; then
                            best_match=$rate
                        fi
                    fi
                done
                bitrate_score=${BITRATE_QUALITY[$best_match]:-50}
                avg_bitrate=$((avg_bitrate + bitrate))
            fi
        fi
        
        # Weighted score (format 70%, bitrate 30%)
        local file_score=$(( (format_score * 70 + bitrate_score * 30) / 100 ))
        total_score=$((total_score + file_score))
        file_count=$((file_count + 1))
        
        # Track primary format
        if [[ -z "$primary_format" ]]; then
            primary_format="$ext"
        fi
        
    done < <(find "$album_path" -type f \( -name "*.mp3" -o -name "*.flac" -o -name "*.wav" -o -name "*.m4a" -o -name "*.aac" -o -name "*.ogg" \) -print0)
    
    if [[ $file_count -gt 0 ]]; then
        total_score=$((total_score / file_count))
        avg_bitrate=$((avg_bitrate / file_count))
    fi
    
    echo "$total_score|$primary_format|$avg_bitrate"
}

# Fuzzy match two strings using Levenshtein-like algorithm
fuzzy_match_score() {
    local str1="$1"
    local str2="$2"
    
    # Simple implementation - normalize and compare
    str1=$(echo "$str1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
    str2=$(echo "$str2" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
    
    if [[ "$str1" == "$str2" ]]; then
        echo "1.0"
        return
    fi
    
    # Length-based similarity as approximation
    local len1=${#str1}
    local len2=${#str2}
    local max_len=$((len1 > len2 ? len1 : len2))
    
    if [[ $max_len -eq 0 ]]; then
        echo "1.0"
        return
    fi
    
    # Count common characters (simple approach)
    local common=0
    local min_len=$((len1 < len2 ? len1 : len2))
    
    for ((i=0; i<min_len; i++)); do
        if [[ "${str1:$i:1}" == "${str2:$i:1}" ]]; then
            ((common++))
        fi
    done
    
    local similarity=$(echo "scale=2; $common / $max_len" | bc)
    echo "$similarity"
}

# Calculate duplicate score between two albums
calculate_duplicate_score() {
    local fp1_data="$1"  # fingerprint_id|album_path|fingerprint|metadata_hash|duration_ms|file_count|quality_score|format
    local fp2_data="$2"
    
    # Parse fingerprint data
    IFS='|' read -r fp1_id fp1_path fp1_fingerprint fp1_metadata fp1_duration fp1_files fp1_quality fp1_format <<< "$fp1_data"
    IFS='|' read -r fp2_id fp2_path fp2_fingerprint fp2_metadata fp2_duration fp2_files fp2_quality fp2_format <<< "$fp2_data"
    
    local score=0.0
    
    # Exact fingerprint match (40% weight)
    if [[ "$fp1_fingerprint" == "$fp2_fingerprint" ]]; then
        score=$(echo "$score + 0.4" | bc)
    fi
    
    # Metadata hash match (25% weight)
    if [[ "$fp1_metadata" == "$fp2_metadata" ]]; then
        score=$(echo "$score + 0.25" | bc)
    else
        # Fuzzy metadata matching
        local artist1 artist2 album1 album2
        artist1=$(basename "$(dirname "$fp1_path")")
        artist2=$(basename "$(dirname "$fp2_path")")
        album1=$(basename "$fp1_path")
        album2=$(basename "$fp2_path")
        
        local artist_match=$(fuzzy_match_score "$artist1" "$artist2")
        local album_match=$(fuzzy_match_score "$album1" "$album2")
        local metadata_score=$(echo "($artist_match + $album_match) / 2 * 0.25" | bc)
        score=$(echo "$score + $metadata_score" | bc)
    fi
    
    # Duration similarity (15% weight)
    if [[ "$fp1_duration" -gt 0 && "$fp2_duration" -gt 0 ]]; then
        local duration_diff=$(echo "$fp1_duration - $fp2_duration" | bc | tr -d '-')
        local duration_tolerance=$((DURATION_TOLERANCE * 1000))  # Convert to ms
        
        if [[ $(echo "$duration_diff <= $duration_tolerance" | bc) -eq 1 ]]; then
            local duration_score=$(echo "scale=3; (1 - $duration_diff / ($duration_tolerance + 1)) * 0.15" | bc)
            score=$(echo "$score + $duration_score" | bc)
        fi
    fi
    
    # File count similarity (10% weight)
    if [[ "$fp1_files" -eq "$fp2_files" ]]; then
        score=$(echo "$score + 0.1" | bc)
    elif [[ "$fp1_files" -gt 0 && "$fp2_files" -gt 0 ]]; then
        local file_diff=$(echo "$fp1_files - $fp2_files" | bc | tr -d '-')
        local file_score=$(echo "scale=3; (1 - $file_diff / ($fp1_files + $fp2_files)) * 0.1" | bc)
        score=$(echo "$score + $file_score" | bc)
    fi
    
    # Quality bonus (10% weight) - prefer keeping higher quality
    local quality_diff=$(echo "$fp1_quality - $fp2_quality" | bc | tr -d '-')
    if [[ $(echo "$quality_diff <= 10" | bc) -eq 1 ]]; then
        score=$(echo "$score + 0.1" | bc)
    fi
    
    echo "$score"
}

# Scan collection and generate fingerprints
scan_for_duplicates() {
    local source_dir="${1:-$SOURCE_DIR}"
    local db_path="${2:-$DUPLICATE_DB}"
    
    log $LOG_INFO "Scanning collection for duplicates: $source_dir"
    
    # Initialize database
    init_duplicate_detection "$db_path"
    
    # Clear existing data
    sqlite3 "$db_path" "DELETE FROM audio_fingerprints; DELETE FROM duplicate_groups; DELETE FROM duplicate_members;"
    
    local album_count=0
    local processed_count=0
    
    # Process each album directory
    while IFS= read -r -d '' album_dir; do
        ((album_count++))
        
        log $LOG_DEBUG "Processing album: $album_dir"
        
        # Extract metadata for this album
        local metadata_json
        if command -v extract_audio_metadata >/dev/null 2>&1; then
            local exiftool_output
            exiftool_output=$(extract_audio_metadata "$album_dir")
            if [[ -n "$exiftool_output" ]]; then
                metadata_json=$(determine_album_metadata "$exiftool_output" "$(basename "$album_dir")")
            fi
        fi
        
        if [[ -z "$metadata_json" || "$metadata_json" == "null" ]]; then
            log $LOG_WARNING "Skipping album with no metadata: $album_dir"
            continue
        fi
        
        # Generate fingerprint
        local fingerprint_data
        fingerprint_data=$(generate_audio_fingerprint "$album_dir" "$metadata_json")
        IFS='|' read -r fingerprint metadata_hash duration files total_size <<< "$fingerprint_data"
        
        # Calculate quality score
        local quality_data
        quality_data=$(calculate_quality_score "$album_dir" "$metadata_json")
        IFS='|' read -r quality_score primary_format avg_bitrate <<< "$quality_data"
        
        # Store in database
        sqlite3 "$db_path" << EOF
INSERT INTO audio_fingerprints (
    album_path, fingerprint, metadata_hash, duration_ms, 
    file_count, total_size, quality_score, format, avg_bitrate
) VALUES (
    '$album_dir', '$fingerprint', '$metadata_hash', $duration,
    $files, $total_size, $quality_score, '$primary_format', $avg_bitrate
);
EOF
        
        ((processed_count++))
        
        # Progress update
        if [[ $((processed_count % 50)) -eq 0 ]]; then
            log $LOG_INFO "Processed $processed_count albums..."
        fi
        
    done < <(find "$source_dir" \( -type d -o -type l \) -print0)
    
    log $LOG_INFO "Fingerprint generation complete: $processed_count albums processed"
}

# Detect duplicate groups
detect_duplicate_groups() {
    local db_path="${1:-$DUPLICATE_DB}"
    
    log $LOG_INFO "Analyzing fingerprints for duplicates..."
    
    # Get all fingerprints for comparison
    local fingerprints
    fingerprints=$(sqlite3 "$db_path" "SELECT id, album_path, fingerprint, metadata_hash, duration_ms, file_count, quality_score, format FROM audio_fingerprints ORDER BY quality_score DESC;")
    
    local group_id=1
    local duplicate_count=0
    
    # Compare each pair of fingerprints
    while IFS='|' read -r fp1_id fp1_path fp1_fingerprint fp1_metadata fp1_duration fp1_files fp1_quality fp1_format; do
        
        # Skip if already in a group
        local existing_group
        existing_group=$(sqlite3 "$db_path" "SELECT group_id FROM duplicate_members WHERE fingerprint_id = $fp1_id;" | head -1)
        if [[ -n "$existing_group" ]]; then
            continue
        fi
        
        local group_members=("$fp1_id|$fp1_path|$fp1_fingerprint|$fp1_metadata|$fp1_duration|$fp1_files|$fp1_quality|$fp1_format")
        local group_found=false
        
        # Compare with all other fingerprints
        while IFS='|' read -r fp2_id fp2_path fp2_fingerprint fp2_metadata fp2_duration fp2_files fp2_quality fp2_format; do
            
            # Skip self-comparison
            if [[ "$fp1_id" == "$fp2_id" ]]; then
                continue
            fi
            
            # Skip if already in a group
            existing_group=$(sqlite3 "$db_path" "SELECT group_id FROM duplicate_members WHERE fingerprint_id = $fp2_id;" | head -1)
            if [[ -n "$existing_group" ]]; then
                continue
            fi
            
            # Calculate duplicate score
            local fp1_data="$fp1_id|$fp1_path|$fp1_fingerprint|$fp1_metadata|$fp1_duration|$fp1_files|$fp1_quality|$fp1_format"
            local fp2_data="$fp2_id|$fp2_path|$fp2_fingerprint|$fp2_metadata|$fp2_duration|$fp2_files|$fp2_quality|$fp2_format"
            
            local duplicate_score
            duplicate_score=$(calculate_duplicate_score "$fp1_data" "$fp2_data")
            
            # Check if above threshold
            if [[ $(echo "$duplicate_score >= $DUPLICATE_THRESHOLD" | bc) -eq 1 ]]; then
                group_members+=("$fp2_data")
                group_found=true
                log $LOG_DEBUG "Duplicate found: $(basename "$fp1_path") <-> $(basename "$fp2_path") (score: $duplicate_score)"
            fi
            
        done <<< "$fingerprints"
        
        # Create group if duplicates found
        if [[ "$group_found" == true ]]; then
            local group_hash=$(echo "${group_members[*]}" | sha256sum | cut -d' ' -f1)
            local best_quality_id
            local total_size=0
            local max_quality=0
            
            # Find best quality member
            for member in "${group_members[@]}"; do
                IFS='|' read -r mem_id mem_path mem_fp mem_meta mem_dur mem_files mem_quality mem_format <<< "$member"
                total_size=$((total_size + $(stat -c%s "$mem_path" 2>/dev/null || echo 0)))
                
                if [[ $mem_quality -gt $max_quality ]]; then
                    max_quality=$mem_quality
                    best_quality_id=$mem_id
                fi
            done
            
            # Create duplicate group
            sqlite3 "$db_path" << EOF
INSERT INTO duplicate_groups (group_hash, album_count, total_size, best_quality_id, duplicate_score)
VALUES ('$group_hash', ${#group_members[@]}, $total_size, $best_quality_id, $duplicate_score);
EOF
            
            # Add members to group
            for member in "${group_members[@]}"; do
                IFS='|' read -r mem_id mem_path mem_fp mem_meta mem_dur mem_files mem_quality mem_format <<< "$member"
                local is_keep=$([[ $mem_id -eq $best_quality_id ]] && echo 1 || echo 0)
                
                sqlite3 "$db_path" << EOF
INSERT INTO duplicate_members (group_id, fingerprint_id, is_recommended_keep)
VALUES ($group_id, $mem_id, $is_keep);
EOF
            done
            
            ((duplicate_count++))
            ((group_id++))
            
            log $LOG_INFO "Created duplicate group $((group_id-1)) with ${#group_members[@]} albums"
        fi
        
    done <<< "$fingerprints"
    
    log $LOG_INFO "Duplicate detection complete: $duplicate_count duplicate groups found"
}

# Generate duplicate report
generate_duplicate_report() {
    local db_path="${1:-$DUPLICATE_DB}"
    local report_file="/tmp/ordr.fm_duplicates_$(date +%Y%m%d_%H%M%S).txt"
    
    log $LOG_INFO "Generating duplicate report: $report_file"
    
    echo "=== ordr.fm Duplicate Detection Report ===" > "$report_file"
    echo "Generated: $(date)" >> "$report_file"
    echo >> "$report_file"
    
    # Overall statistics
    local total_albums
    total_albums=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM audio_fingerprints;")
    local duplicate_groups
    duplicate_groups=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM duplicate_groups;")
    local duplicate_albums
    duplicate_albums=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM duplicate_members;")
    
    echo "SUMMARY:" >> "$report_file"
    echo "  Total Albums Scanned: $total_albums" >> "$report_file"
    echo "  Duplicate Groups Found: $duplicate_groups" >> "$report_file"
    echo "  Albums in Duplicate Groups: $duplicate_albums" >> "$report_file"
    echo "  Unique Albums: $((total_albums - duplicate_albums + duplicate_groups))" >> "$report_file"
    echo >> "$report_file"
    
    # Storage analysis
    local total_size
    total_size=$(sqlite3 "$db_path" "SELECT SUM(total_size) FROM audio_fingerprints;")
    local duplicate_size
    duplicate_size=$(sqlite3 "$db_path" "SELECT SUM(dg.total_size) FROM duplicate_groups dg;")
    local potential_savings
    potential_savings=$(sqlite3 "$db_path" "
        SELECT SUM(af.total_size) 
        FROM audio_fingerprints af 
        JOIN duplicate_members dm ON af.id = dm.fingerprint_id 
        WHERE dm.is_recommended_keep = 0;
    ")
    
    echo "STORAGE ANALYSIS:" >> "$report_file"
    echo "  Total Collection Size: $(numfmt --to=iec $total_size 2>/dev/null || echo "${total_size} bytes")" >> "$report_file"
    echo "  Duplicate Content Size: $(numfmt --to=iec $duplicate_size 2>/dev/null || echo "${duplicate_size} bytes")" >> "$report_file"
    echo "  Potential Space Savings: $(numfmt --to=iec $potential_savings 2>/dev/null || echo "${potential_savings} bytes")" >> "$report_file"
    echo "  Savings Percentage: $(echo "scale=1; $potential_savings * 100 / $total_size" | bc)%" >> "$report_file"
    echo >> "$report_file"
    
    # Detailed duplicate groups
    echo "DUPLICATE GROUPS:" >> "$report_file"
    echo >> "$report_file"
    
    sqlite3 "$db_path" "
        SELECT 
            dg.id,
            dg.album_count,
            dg.duplicate_score,
            af_best.album_path as best_path,
            af_best.quality_score as best_quality,
            af_best.format as best_format
        FROM duplicate_groups dg
        JOIN audio_fingerprints af_best ON dg.best_quality_id = af_best.id
        ORDER BY dg.duplicate_score DESC, dg.total_size DESC;
    " | while IFS='|' read -r group_id album_count score best_path best_quality best_format; do
        
        echo "Group $group_id (Score: $score, Albums: $album_count):" >> "$report_file"
        echo "  RECOMMENDED KEEP: $(basename "$best_path") [$best_format, Quality: $best_quality]" >> "$report_file"
        echo "  SUGGESTED DELETIONS:" >> "$report_file"
        
        sqlite3 "$db_path" "
            SELECT af.album_path, af.quality_score, af.format, af.total_size
            FROM duplicate_members dm
            JOIN audio_fingerprints af ON dm.fingerprint_id = af.id
            WHERE dm.group_id = $group_id AND dm.is_recommended_keep = 0
            ORDER BY af.quality_score DESC;
        " | while IFS='|' read -r dup_path dup_quality dup_format dup_size; do
            echo "    - $(basename "$dup_path") [$dup_format, Quality: $dup_quality, Size: $(numfmt --to=iec $dup_size 2>/dev/null || echo "${dup_size}B")]" >> "$report_file"
        done
        
        echo >> "$report_file"
    done
    
    echo "Report saved to: $report_file"
    echo "$report_file"
}

# Safe duplicate cleanup with user confirmation
cleanup_duplicates() {
    local db_path="${1:-$DUPLICATE_DB}"
    local dry_run="${2:-true}"
    
    log $LOG_INFO "Starting duplicate cleanup (dry_run: $dry_run)"
    
    # Get albums marked for deletion
    local deletion_candidates
    deletion_candidates=$(sqlite3 "$db_path" "
        SELECT af.album_path, af.total_size
        FROM duplicate_members dm
        JOIN audio_fingerprints af ON dm.fingerprint_id = af.id
        WHERE dm.is_recommended_keep = 0 AND dm.is_marked_for_deletion = 0;
    ")
    
    if [[ -z "$deletion_candidates" ]]; then
        log $LOG_INFO "No duplicate albums found for cleanup"
        return 0
    fi
    
    local total_savings=0
    local deletion_count=0
    
    # Process each candidate
    while IFS='|' read -r album_path album_size; do
        ((deletion_count++))
        total_savings=$((total_savings + album_size))
        
        if [[ "$dry_run" == "true" ]]; then
            log $LOG_INFO "Would delete: $album_path ($(numfmt --to=iec $album_size 2>/dev/null || echo "${album_size}B"))"
        else
            # Create backup record before deletion
            log $LOG_WARNING "Deleting duplicate: $album_path"
            
            # Move to unsorted/duplicates instead of permanent deletion
            local duplicate_dir="$UNSORTED_DIR_BASE/duplicates_$(date +%Y%m%d_%H%M%S)"
            mkdir -p "$duplicate_dir"
            
            if mv "$album_path" "$duplicate_dir/$(basename "$album_path")"; then
                log $LOG_INFO "Moved duplicate to: $duplicate_dir/$(basename "$album_path")"
                
                # Mark as deleted in database
                sqlite3 "$db_path" "
                    UPDATE duplicate_members 
                    SET is_marked_for_deletion = 1 
                    WHERE fingerprint_id IN (
                        SELECT id FROM audio_fingerprints WHERE album_path = '$album_path'
                    );
                "
            else
                log $LOG_ERROR "Failed to move duplicate: $album_path"
            fi
        fi
        
    done <<< "$deletion_candidates"
    
    log $LOG_INFO "Duplicate cleanup complete:"
    log $LOG_INFO "  Albums processed: $deletion_count"
    log $LOG_INFO "  Space savings: $(numfmt --to=iec $total_savings 2>/dev/null || echo "${total_savings} bytes")"
    
    if [[ "$dry_run" == "true" ]]; then
        log $LOG_INFO "This was a dry run. Use --cleanup-duplicates --move to actually clean up duplicates."
    fi
}

# Export functions
export -f init_duplicate_detection
export -f generate_audio_fingerprint
export -f calculate_quality_score
export -f fuzzy_match_score
export -f calculate_duplicate_score
export -f scan_for_duplicates
export -f detect_duplicate_groups
export -f generate_duplicate_report
export -f cleanup_duplicates