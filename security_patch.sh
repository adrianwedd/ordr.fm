#!/bin/bash
# Security patch for ordr.fm.sh - Fixes SQL injection vulnerabilities
# This file contains secure functions to replace vulnerable database operations

# Secure SQL escape function - properly escapes single quotes for SQLite
sql_escape() {
    local input="$1"
    # Replace single quotes with two single quotes (SQLite escape method)
    # Also handle null bytes and other problematic characters
    echo "$input" | sed "s/'/\'\'/g; s/\x00//g"
}

# Secure function to record album metadata with proper escaping
secure_record_album_metadata() {
    local metadata_db="$1"
    local original_path="$(sql_escape "$2")"
    local new_path="$(sql_escape "$3")"
    local artist="$(sql_escape "$4")"
    local artist_resolved="$(sql_escape "$5")"
    local album="$(sql_escape "$6")"
    local year="${7:-NULL}"  # Use NULL if empty
    local quality="$(sql_escape "$8")"
    local label="$(sql_escape "$9")"
    local catalog="$(sql_escape "${10}")"
    local series="$(sql_escape "${11}")"
    local org_mode="$(sql_escape "${12}")"
    local confidence="${13:-0}"
    local move_executed="${14:-0}"
    
    # Validate numeric fields
    [[ ! "$year" =~ ^[0-9]+$|^NULL$ ]] && year="NULL"
    [[ ! "$confidence" =~ ^[0-9.]+$ ]] && confidence="0"
    [[ ! "$move_executed" =~ ^[01]$ ]] && move_executed="0"
    
    sqlite3 "$metadata_db" <<EOF
INSERT INTO albums (
    original_path, new_path, artist, artist_resolved, album, year,
    quality, label, catalog_number, series, organization_mode,
    discogs_confidence, move_executed
) VALUES (
    '$original_path', '$new_path', '$artist', '$artist_resolved', '$album', $year,
    '$quality', '$label', '$catalog', '$series', '$org_mode',
    $confidence, $move_executed
);
EOF
    
    sqlite3 "$metadata_db" "SELECT last_insert_rowid();"
}

# Secure function to record track metadata
secure_record_track_metadata() {
    local metadata_db="$1"
    local album_id="$2"
    local original_filename="$(sql_escape "$3")"
    local new_filename="$(sql_escape "$4")"
    local track_data="$5"  # JSON from exiftool
    
    # Validate album_id is numeric
    if [[ ! "$album_id" =~ ^[0-9]+$ ]]; then
        echo "ERROR: Invalid album_id: $album_id" >&2
        return 1
    fi
    
    local track_number=$(echo "$track_data" | jq -r '.Track // 0')
    local disc_number=$(echo "$track_data" | jq -r '.DiscNumber // 1')
    local title="$(sql_escape "$(echo "$track_data" | jq -r '.Title // empty')")"
    local artist="$(sql_escape "$(echo "$track_data" | jq -r '.Artist // empty')")"
    local duration=$(echo "$track_data" | jq -r '.Duration // 0' | sed 's/[^0-9]//g')
    local bitrate="$(sql_escape "$(echo "$track_data" | jq -r '.AudioBitrate // empty')")"
    local format="$(sql_escape "$(echo "$track_data" | jq -r '.FileTypeExtension // empty')")"
    
    # Validate numeric fields
    [[ ! "$track_number" =~ ^[0-9]+$ ]] && track_number="0"
    [[ ! "$disc_number" =~ ^[0-9]+$ ]] && disc_number="1"
    [[ ! "$duration" =~ ^[0-9]*$ ]] && duration="0"
    
    sqlite3 "$metadata_db" <<EOF
INSERT INTO tracks (
    album_id, original_filename, new_filename, track_number, disc_number,
    title, artist, duration, bitrate, format
) VALUES (
    $album_id, '$original_filename', '$new_filename', $track_number, $disc_number,
    '$title', '$artist', $duration, '$bitrate', '$format'
);
EOF
}

# Secure function for move operations
secure_create_move_record() {
    local metadata_db="$1"
    local operation_id="$(sql_escape "$2")"
    local source_path="$(sql_escape "$3")"
    local dest_path="$(sql_escape "$4")"
    
    sqlite3 "$metadata_db" <<EOF
INSERT INTO move_operations (operation_id, source_path, dest_path, timestamp, status) 
VALUES ('$operation_id', '$source_path', '$dest_path', datetime('now'), 'IN_PROGRESS');
EOF
}

# Secure function to update move record status
secure_update_move_record_status() {
    local metadata_db="$1"
    local operation_id="$(sql_escape "$2")"
    local status="$(sql_escape "$3")"
    
    # Validate status value
    if [[ ! "$status" =~ ^(IN_PROGRESS|COMPLETED|FAILED|ROLLED_BACK)$ ]]; then
        echo "ERROR: Invalid status: $status" >&2
        return 1
    fi
    
    sqlite3 "$metadata_db" <<EOF
UPDATE move_operations SET status='$status', updated_at=datetime('now') 
WHERE operation_id='$operation_id';
EOF
}

# Secure function for duplicate detection
secure_insert_album_duplicate() {
    local duplicates_db="$1"
    local album_dir="$(sql_escape "$2")"
    local album_artist="$(sql_escape "$3")"
    local album_title="$(sql_escape "$4")"
    local album_year="${5:-NULL}"
    local track_count="${6:-0}"
    local total_size="${7:-0}"
    local quality_type="$(sql_escape "$8")"
    local avg_bitrate="${9:-0}"
    local format_mix="$(sql_escape "${10}")"
    local album_hash="$(sql_escape "${11}")"
    
    # Validate numeric fields
    [[ ! "$album_year" =~ ^[0-9]+$|^NULL$ ]] && album_year="NULL"
    [[ ! "$track_count" =~ ^[0-9]+$ ]] && track_count="0"
    [[ ! "$total_size" =~ ^[0-9]+$ ]] && total_size="0"
    [[ ! "$avg_bitrate" =~ ^[0-9]+$ ]] && avg_bitrate="0"
    
    sqlite3 "$duplicates_db" <<EOF
INSERT OR IGNORE INTO albums (
    directory_path, album_artist, album_title, album_year, track_count,
    total_size, quality_type, avg_bitrate, format_mix, album_hash
) VALUES (
    '$album_dir', '$album_artist', '$album_title', $album_year, $track_count,
    $total_size, '$quality_type', $avg_bitrate, '$format_mix', '$album_hash'
);
EOF
}

# Secure function to query duplicates by hash
secure_query_duplicates_by_hash() {
    local duplicates_db="$1"
    local hash="$(sql_escape "$2")"
    
    sqlite3 "$duplicates_db" <<EOF
SELECT id, directory_path, album_artist, album_title, album_year, 
       track_count, quality_type, avg_bitrate, total_size, format_mix 
FROM albums 
WHERE album_hash = '$hash';
EOF
}

# Secure file operations with proper quoting
secure_move_file() {
    local source="$1"
    local dest="$2"
    
    # Validate paths don't contain null bytes
    if [[ "$source" == *$'\0'* ]] || [[ "$dest" == *$'\0'* ]]; then
        echo "ERROR: Path contains null bytes" >&2
        return 1
    fi
    
    # Use -- to prevent interpretation of filenames as options
    mv -- "$source" "$dest"
}

secure_remove_file() {
    local file="$1"
    
    # Validate path doesn't contain null bytes
    if [[ "$file" == *$'\0'* ]]; then
        echo "ERROR: Path contains null bytes" >&2
        return 1
    fi
    
    # Use -- to prevent interpretation of filenames as options
    rm -f -- "$file"
}

# Export functions for use in main script
export -f sql_escape
export -f secure_record_album_metadata
export -f secure_record_track_metadata
export -f secure_create_move_record
export -f secure_update_move_record_status
export -f secure_insert_album_duplicate
export -f secure_query_duplicates_by_hash
export -f secure_move_file
export -f secure_remove_file

echo "Security patch functions loaded successfully"