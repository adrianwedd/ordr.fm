#!/bin/bash
# Database operations module for ordr.fm
# Handles SQLite operations for metadata, state, and duplicate tracking

# Source common utilities
if [[ -f "${BASH_SOURCE%/*}/common.sh" ]]; then
    source "${BASH_SOURCE%/*}/common.sh"
elif [[ -f "$(dirname "$0")/common.sh" ]]; then
    source "$(dirname "$0")/common.sh" 
elif [[ -f "./lib/common.sh" ]]; then
    source "./lib/common.sh"
else
    echo "Error: Cannot find common.sh" >&2
    exit 1
fi

# Initialize metadata database
init_metadata_db() {
    local db_path="${METADATA_DB:-ordr.fm.metadata.db}"
    
    log $LOG_INFO "Initializing metadata database: $db_path"
    
    # Create database schema
    sqlite3 "$db_path" <<EOF
-- Albums table for core metadata
CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    directory_path TEXT UNIQUE NOT NULL,
    album_artist TEXT,
    album_title TEXT,
    album_year INTEGER,
    label TEXT,
    catalog_number TEXT,
    genre TEXT,
    track_count INTEGER,
    total_size INTEGER,
    quality_type TEXT CHECK(quality_type IN ('Lossless', 'Lossy', 'Mixed')),
    avg_bitrate INTEGER,
    format_mix TEXT,
    album_hash TEXT,
    organization_mode TEXT,
    organized_path TEXT,
    processed_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    discogs_release_id INTEGER,
    discogs_confidence REAL
);

-- Create indexes for albums table
CREATE INDEX IF NOT EXISTS idx_album_artist ON albums(album_artist);
CREATE INDEX IF NOT EXISTS idx_label ON albums(label);
CREATE INDEX IF NOT EXISTS idx_quality ON albums(quality_type);
CREATE INDEX IF NOT EXISTS idx_year ON albums(album_year);
CREATE INDEX IF NOT EXISTS idx_hash ON albums(album_hash);

-- Tracks table for individual files
CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    track_number INTEGER,
    disc_number INTEGER,
    title TEXT,
    artist TEXT,
    duration_seconds REAL,
    bitrate INTEGER,
    format TEXT,
    file_size INTEGER,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);

-- Create indexes for tracks table
CREATE INDEX IF NOT EXISTS idx_album_id ON tracks(album_id);

-- Artist aliases for grouping
CREATE TABLE IF NOT EXISTS artist_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    primary_artist TEXT NOT NULL,
    alias_name TEXT NOT NULL UNIQUE,
    confidence REAL DEFAULT 1.0,
    source TEXT DEFAULT 'manual'
);

-- Create indexes for artist_aliases table
CREATE INDEX IF NOT EXISTS idx_primary ON artist_aliases(primary_artist);
CREATE INDEX IF NOT EXISTS idx_alias ON artist_aliases(alias_name);

-- Labels for electronic music organization
CREATE TABLE IF NOT EXISTS labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label_name TEXT UNIQUE NOT NULL,
    release_count INTEGER DEFAULT 0,
    primary_genre TEXT,
    is_electronic BOOLEAN DEFAULT 0
);

-- Create indexes for labels table
CREATE INDEX IF NOT EXISTS idx_label_name ON labels(label_name);

-- Move operations for undo/rollback
CREATE TABLE IF NOT EXISTS move_operations (
    operation_id TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    dest_path TEXT NOT NULL,
    status TEXT DEFAULT 'IN_PROGRESS' CHECK(status IN ('IN_PROGRESS', 'SUCCESS', 'FAILED', 'ROLLED_BACK')),
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    rollback_timestamp DATETIME,
    error_message TEXT
);

-- Create indexes for move_operations table
CREATE INDEX IF NOT EXISTS idx_status ON move_operations(status);
CREATE INDEX IF NOT EXISTS idx_timestamp ON move_operations(timestamp);

-- File renames for detailed tracking
CREATE TABLE IF NOT EXISTS file_renames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL,
    old_path TEXT NOT NULL,
    new_path TEXT NOT NULL,
    rename_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (operation_id) REFERENCES move_operations(operation_id)
);

-- Organization statistics
CREATE TABLE IF NOT EXISTS organization_stats (
    date DATE PRIMARY KEY,
    albums_processed INTEGER DEFAULT 0,
    albums_organized INTEGER DEFAULT 0,
    albums_unsorted INTEGER DEFAULT 0,
    total_size_mb INTEGER DEFAULT 0,
    lossless_count INTEGER DEFAULT 0,
    lossy_count INTEGER DEFAULT 0,
    mixed_count INTEGER DEFAULT 0,
    artist_mode_count INTEGER DEFAULT 0,
    label_mode_count INTEGER DEFAULT 0,
    series_mode_count INTEGER DEFAULT 0
);
EOF
    
    if [[ $? -eq 0 ]]; then
        log $LOG_INFO "Metadata database initialized successfully"
        return 0
    else
        log $LOG_ERROR "Failed to initialize metadata database"
        return 1
    fi
}

# Initialize state database for incremental processing
init_state_db() {
    local db_path="${STATE_DB:-ordr.fm.state.db}"
    
    log $LOG_INFO "Initializing state database: $db_path"
    
    sqlite3 "$db_path" <<EOF
CREATE TABLE IF NOT EXISTS processed_directories (
    directory_path TEXT PRIMARY KEY,
    last_processed DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'SUCCESS',
    error_message TEXT
);
EOF
    
    return $?
}

# Initialize duplicates database
init_duplicates_db() {
    local db_path="${DUPLICATES_DB:-ordr.fm.duplicates.db}"
    
    log $LOG_INFO "Initializing duplicates database: $db_path"
    
    sqlite3 "$db_path" <<EOF
CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    directory_path TEXT UNIQUE NOT NULL,
    album_artist TEXT,
    album_title TEXT,
    album_year INTEGER,
    track_count INTEGER,
    total_size INTEGER,
    quality_type TEXT,
    avg_bitrate INTEGER,
    format_mix TEXT,
    album_hash TEXT,
    quality_score REAL,
    processed_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for duplicates table
CREATE INDEX IF NOT EXISTS idx_hash ON albums(album_hash);
CREATE INDEX IF NOT EXISTS idx_artist_title ON albums(album_artist, album_title);
EOF
    
    return $?
}

# Track album metadata
track_album_metadata() {
    local album_data="$1"
    local db_path="${METADATA_DB:-ordr.fm.metadata.db}"
    
    # Parse album data (passed as pipe-delimited string)
    local directory_path=$(echo "$album_data" | cut -d'|' -f1)
    local album_artist=$(echo "$album_data" | cut -d'|' -f2)
    local album_title=$(echo "$album_data" | cut -d'|' -f3)
    local album_year=$(echo "$album_data" | cut -d'|' -f4)
    local track_count=$(echo "$album_data" | cut -d'|' -f5)
    local total_size=$(echo "$album_data" | cut -d'|' -f6)
    local quality_type=$(echo "$album_data" | cut -d'|' -f7)
    local organization_mode=$(echo "$album_data" | cut -d'|' -f8)
    local organized_path=$(echo "$album_data" | cut -d'|' -f9)
    
    # Ensure quality type is valid
    case "$quality_type" in
        "Lossless"|"Lossy"|"Mixed") ;;
        *) quality_type="Mixed" ;;
    esac
    
    # Insert or update album record
    sqlite3 "$db_path" <<EOF
INSERT OR REPLACE INTO albums 
(directory_path, album_artist, album_title, album_year, track_count, total_size, 
 quality_type, organization_mode, organized_path)
VALUES 
('$(sql_escape "$directory_path")', '$(sql_escape "$album_artist")', 
 '$(sql_escape "$album_title")', ${album_year:-NULL}, ${track_count:-0}, ${total_size:-0},
 '$(sql_escape "$quality_type")', '$(sql_escape "$organization_mode")', 
 '$(sql_escape "$organized_path")');
EOF
    
    return $?
}

# Create move operation record
create_move_operation() {
    local operation_id="$1"
    local source_path="$2"
    local dest_path="$3"
    local db_path="${METADATA_DB:-ordr.fm.metadata.db}"
    
    sqlite3 "$db_path" <<EOF
INSERT INTO move_operations (operation_id, source_path, dest_path, status)
VALUES ('$(sql_escape "$operation_id")', '$(sql_escape "$source_path")', 
        '$(sql_escape "$dest_path")', 'IN_PROGRESS');
EOF
    
    return $?
}

# Update move operation status
update_move_operation_status() {
    local operation_id="$1"
    local status="$2"
    local error_message="${3:-}"
    local db_path="${METADATA_DB:-ordr.fm.metadata.db}"
    
    local sql="UPDATE move_operations SET status='$status'"
    if [[ -n "$error_message" ]]; then
        sql="$sql, error_message='$(sql_escape "$error_message")'"
    fi
    sql="$sql WHERE operation_id='$(sql_escape "$operation_id")';"
    
    sqlite3 "$db_path" "$sql"
    return $?
}

# Record file rename
record_file_rename() {
    local operation_id="$1"
    local old_path="$2"
    local new_path="$3"
    local db_path="${METADATA_DB:-ordr.fm.metadata.db}"
    
    sqlite3 "$db_path" <<EOF
INSERT INTO file_renames (operation_id, old_path, new_path)
VALUES ('$(sql_escape "$operation_id")', '$(sql_escape "$old_path")', 
        '$(sql_escape "$new_path")');
EOF
    
    if [[ $? -ne 0 ]]; then
        log $LOG_WARNING "Failed to record file rename"
    fi
}

# Get move operation details
get_move_operation() {
    local operation_id="$1"
    local db_path="${METADATA_DB:-ordr.fm.metadata.db}"
    
    sqlite3 "$db_path" -separator '|' \
        "SELECT source_path, dest_path, status FROM move_operations WHERE operation_id='$(sql_escape "$operation_id")';"
}

# List recent move operations
list_move_operations() {
    local limit="${1:-10}"
    local db_path="${METADATA_DB:-ordr.fm.metadata.db}"
    
    sqlite3 "$db_path" -header -column <<EOF
SELECT operation_id, source_path, dest_path, status, timestamp
FROM move_operations
ORDER BY timestamp DESC
LIMIT $limit;
EOF
}

# Export metadata as JSON for visualization
export_metadata_json() {
    local db_path="${METADATA_DB:-ordr.fm.metadata.db}"
    local output_file="${1:-ordr.fm.metadata.json}"
    
    log $LOG_INFO "Exporting metadata to JSON: $output_file"
    
    # Use SQLite JSON functions
    sqlite3 "$db_path" <<EOF > "$output_file"
SELECT json_object(
    'albums', (SELECT json_group_array(json_object(
        'id', id,
        'directory_path', directory_path,
        'album_artist', album_artist,
        'album_title', album_title,
        'album_year', album_year,
        'quality_type', quality_type,
        'organization_mode', organization_mode,
        'organized_path', organized_path
    )) FROM albums),
    'artist_aliases', (SELECT json_group_array(json_object(
        'primary_artist', primary_artist,
        'alias_name', alias_name
    )) FROM artist_aliases),
    'labels', (SELECT json_group_array(json_object(
        'label_name', label_name,
        'release_count', release_count
    )) FROM labels),
    'stats', (SELECT json_object(
        'total_albums', COUNT(*),
        'lossless_count', SUM(CASE WHEN quality_type='Lossless' THEN 1 ELSE 0 END),
        'lossy_count', SUM(CASE WHEN quality_type='Lossy' THEN 1 ELSE 0 END),
        'mixed_count', SUM(CASE WHEN quality_type='Mixed' THEN 1 ELSE 0 END)
    ) FROM albums)
);
EOF
    
    return $?
}

# Update organization statistics
update_organization_stats() {
    local db_path="${METADATA_DB:-ordr.fm.metadata.db}"
    local date=$(date +%Y-%m-%d)
    
    sqlite3 "$db_path" <<EOF
INSERT OR REPLACE INTO organization_stats 
SELECT 
    '$date' as date,
    COUNT(*) as albums_processed,
    SUM(CASE WHEN organized_path IS NOT NULL THEN 1 ELSE 0 END) as albums_organized,
    SUM(CASE WHEN organized_path IS NULL THEN 1 ELSE 0 END) as albums_unsorted,
    SUM(total_size)/1048576 as total_size_mb,
    SUM(CASE WHEN quality_type='Lossless' THEN 1 ELSE 0 END) as lossless_count,
    SUM(CASE WHEN quality_type='Lossy' THEN 1 ELSE 0 END) as lossy_count,
    SUM(CASE WHEN quality_type='Mixed' THEN 1 ELSE 0 END) as mixed_count,
    SUM(CASE WHEN organization_mode='artist' THEN 1 ELSE 0 END) as artist_mode_count,
    SUM(CASE WHEN organization_mode='label' THEN 1 ELSE 0 END) as label_mode_count,
    SUM(CASE WHEN organization_mode='series' THEN 1 ELSE 0 END) as series_mode_count
FROM albums
WHERE DATE(processed_date) = '$date';
EOF
}

# Check if directory was already processed
directory_needs_processing() {
    local dir_path="$1"
    local db_path="${STATE_DB:-ordr.fm.state.db}"
    
    if [[ ! -f "$db_path" ]]; then
        return 0  # Database doesn't exist, needs processing
    fi
    
    local result=$(sqlite3 "$db_path" \
        "SELECT COUNT(*) FROM processed_directories WHERE directory_path='$(sql_escape "$dir_path")' AND status='SUCCESS';")
    
    [[ "$result" -eq 0 ]]
}

# Record directory processing
record_directory_processing() {
    local dir_path="$1"
    local status="${2:-SUCCESS}"
    local error_message="${3:-}"
    local db_path="${STATE_DB:-ordr.fm.state.db}"
    
    sqlite3 "$db_path" <<EOF
INSERT OR REPLACE INTO processed_directories (directory_path, status, error_message)
VALUES ('$(sql_escape "$dir_path")', '$status', '$(sql_escape "$error_message")');
EOF
}

# Initialize all databases (wrapper function for CI)
init_databases() {
    log $LOG_INFO "Initializing all databases"
    init_metadata_db && init_state_db && init_duplicates_db
    return $?
}

# Export all functions
export -f init_databases init_metadata_db init_state_db init_duplicates_db
export -f track_album_metadata create_move_operation update_move_operation_status
export -f record_file_rename get_move_operation list_move_operations
export -f export_metadata_json update_organization_stats
export -f directory_needs_processing record_directory_processing