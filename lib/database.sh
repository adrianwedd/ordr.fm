#!/bin/bash

# Database utility functions with retry logic and WAL mode
# Addresses database locking issues during concurrent operations

# Source logging functions
source "$(dirname "${BASH_SOURCE[0]}")/common.sh" 2>/dev/null || true

# Enable WAL mode for better concurrency
enable_wal_mode() {
    local db_path="$1"
    
    if [[ -f "$db_path" ]]; then
        sqlite3 "$db_path" "PRAGMA journal_mode=WAL;" 2>/dev/null || true
        sqlite3 "$db_path" "PRAGMA synchronous=NORMAL;" 2>/dev/null || true
        sqlite3 "$db_path" "PRAGMA temp_store=MEMORY;" 2>/dev/null || true
        sqlite3 "$db_path" "PRAGMA mmap_size=30000000000;" 2>/dev/null || true
    fi
}

# Execute SQL with retry logic
execute_sql_with_retry() {
    local db_path="$1"
    local sql="$2"
    local max_attempts="${3:-3}"
    local attempt=0
    local delay=100  # Start with 100ms
    
    while [[ $attempt -lt $max_attempts ]]; do
        if result=$(sqlite3 "$db_path" "$sql" 2>&1); then
            echo "$result"
            return 0
        else
            # Check if it's a locking error
            if echo "$result" | grep -q "database is locked\|database table is locked"; then
                ((attempt++))
                if [[ $attempt -lt $max_attempts ]]; then
                    log $LOG_DEBUG "Database locked, retry $attempt/$max_attempts after ${delay}ms"
                    # Sleep for the delay period (convert ms to seconds for sleep)
                    sleep $(echo "scale=3; $delay/1000" | bc)
                    # Exponential backoff
                    delay=$((delay * 2))
                else
                    log $LOG_ERROR "Database lock persisted after $max_attempts attempts"
                    return 1
                fi
            else
                # Not a locking error, fail immediately
                log $LOG_ERROR "Database error: $result"
                return 1
            fi
        fi
    done
    
    return 1
}

# Batch insert for multiple records
batch_insert_albums() {
    local db_path="$1"
    shift  # Remove first argument
    local records=("$@")
    
    if [[ ${#records[@]} -eq 0 ]]; then
        return 0
    fi
    
    # Start transaction
    local sql="BEGIN TRANSACTION;"
    
    # Add all insert statements
    for record in "${records[@]}"; do
        sql="${sql}${record};"
    done
    
    # Commit transaction
    sql="${sql}COMMIT;"
    
    # Execute with retry
    execute_sql_with_retry "$db_path" "$sql"
}

# Safe database initialization with WAL mode
init_database_safe() {
    local db_path="$1"
    local schema="$2"
    
    # Create database if it doesn't exist
    if [[ ! -f "$db_path" ]]; then
        touch "$db_path"
        chmod 664 "$db_path"
    fi
    
    # Enable WAL mode for better concurrency
    enable_wal_mode "$db_path"
    
    # Apply schema with retry
    if [[ -n "$schema" ]]; then
        execute_sql_with_retry "$db_path" "$schema"
    fi
}

# Check if database is accessible
check_database_access() {
    local db_path="$1"
    
    if [[ ! -f "$db_path" ]]; then
        log $LOG_ERROR "Database not found: $db_path"
        return 1
    fi
    
    if [[ ! -r "$db_path" ]]; then
        log $LOG_ERROR "Database not readable: $db_path"
        return 1
    fi
    
    if [[ ! -w "$db_path" ]]; then
        log $LOG_ERROR "Database not writable: $db_path"
        return 1
    fi
    
    # Test with a simple query
    if ! execute_sql_with_retry "$db_path" "SELECT 1;" >/dev/null 2>&1; then
        log $LOG_ERROR "Database not accessible: $db_path"
        return 1
    fi
    
    return 0
}

# Vacuum database to optimize and reduce fragmentation
vacuum_database() {
    local db_path="$1"
    
    log $LOG_INFO "Optimizing database: $db_path"
    execute_sql_with_retry "$db_path" "VACUUM;"
    execute_sql_with_retry "$db_path" "ANALYZE;"
}

# Initialize state database for tracking processed directories
init_state_db() {
    local state_db="${1:-ordr.fm.state.db}"
    
    if [[ ! -f "$state_db" ]]; then
        log $LOG_INFO "Initializing state database: $state_db"
        sqlite3 "$state_db" <<EOF
CREATE TABLE IF NOT EXISTS processed_directories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    directory_path TEXT UNIQUE NOT NULL,
    last_modified INTEGER NOT NULL,
    directory_hash TEXT NOT NULL,
    processed_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS processed_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT UNIQUE NOT NULL,
    file_size INTEGER NOT NULL,
    file_hash TEXT NOT NULL,
    directory_id INTEGER NOT NULL,
    processed_at INTEGER NOT NULL,
    FOREIGN KEY (directory_id) REFERENCES processed_directories(id)
);

CREATE INDEX IF NOT EXISTS idx_processed_directories_path ON processed_directories(directory_path);
CREATE INDEX IF NOT EXISTS idx_processed_files_path ON processed_files(file_path);
EOF
        enable_wal_mode "$state_db"
    fi
}

# Initialize metadata database for album information
init_metadata_db() {
    local metadata_db="${1:-ordr.fm.metadata.db}"
    
    log $LOG_INFO "Initializing metadata database: $metadata_db"
    sqlite3 "$metadata_db" <<EOF
CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_path TEXT NOT NULL,
    new_path TEXT,
    artist TEXT,
    artist_resolved TEXT,
    album TEXT,
    year INTEGER,
    quality TEXT,
    label TEXT,
    catalog_number TEXT,
    series TEXT,
    discogs_release_id TEXT,
    discogs_confidence REAL,
    track_count INTEGER,
    total_duration INTEGER,
    file_size_mb REAL,
    processed_at INTEGER DEFAULT (strftime('%s', 'now')),
    move_operation_id TEXT,
    status TEXT DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS move_operations (
    id TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    destination_path TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    started_at INTEGER DEFAULT (strftime('%s', 'now')),
    completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist);
CREATE INDEX IF NOT EXISTS idx_albums_status ON albums(status);
CREATE INDEX IF NOT EXISTS idx_move_operations_status ON move_operations(status);
EOF
    enable_wal_mode "$metadata_db"
    log $LOG_INFO "Metadata database initialized successfully"
}

# Track album metadata
track_album_metadata() {
    local album_data="$1"
    local metadata_db="${METADATA_DB:-ordr.fm.metadata.db}"
    
    # Parse album data (format: path|artist|album|year|quality|...)
    local original_path=$(echo "$album_data" | cut -d'|' -f1)
    local new_path=$(echo "$album_data" | cut -d'|' -f2)
    local artist=$(echo "$album_data" | cut -d'|' -f3)
    local album=$(echo "$album_data" | cut -d'|' -f4)
    local year=$(echo "$album_data" | cut -d'|' -f5)
    local quality=$(echo "$album_data" | cut -d'|' -f6)
    
    execute_sql_with_retry "$metadata_db" "INSERT INTO albums (original_path, new_path, artist, album, year, quality) VALUES ('$original_path', '$new_path', '$artist', '$album', '$year', '$quality');"
}

# Create move operation record
create_move_operation() {
    local operation_id="$1"
    local source_path="$2"
    local dest_path="$3"
    local metadata_db="${METADATA_DB:-ordr.fm.metadata.db}"
    
    execute_sql_with_retry "$metadata_db" "INSERT INTO move_operations (id, source_path, destination_path, status) VALUES ('$operation_id', '$source_path', '$dest_path', 'IN_PROGRESS');"
}

# Update move operation status
update_move_operation_status() {
    local operation_id="$1"
    local status="$2"
    local error_msg="${3:-}"
    local metadata_db="${METADATA_DB:-ordr.fm.metadata.db}"
    
    local sql="UPDATE move_operations SET status='$status', completed_at=strftime('%s', 'now')"
    if [[ -n "$error_msg" ]]; then
        sql="$sql, error_message='$error_msg'"
    fi
    sql="$sql WHERE id='$operation_id';"
    
    execute_sql_with_retry "$metadata_db" "$sql"
}

# Record directory processing
record_directory_processing() {
    local dir_path="$1"
    local status="$2"
    local state_db="${STATE_DB:-ordr.fm.state.db}"
    local current_mtime=$(stat -c "%Y" "$dir_path" 2>/dev/null || echo "0")
    local current_hash=$(find "$dir_path" -maxdepth 1 -type f -exec stat -c "%Y %s %n" {} \; 2>/dev/null | sort | md5sum | cut -d' ' -f1)
    local processed_at=$(date +%s)
    
    execute_sql_with_retry "$state_db" "INSERT OR REPLACE INTO processed_directories (directory_path, last_modified, directory_hash, processed_at, status) VALUES ('$dir_path', $current_mtime, '$current_hash', $processed_at, '$status');"
    
    log $LOG_DEBUG "Recorded processing result for '$dir_path': $status"
}

# Export functions
export -f enable_wal_mode execute_sql_with_retry batch_insert_albums
export -f init_database_safe check_database_access vacuum_database
export -f init_state_db init_metadata_db track_album_metadata
export -f create_move_operation update_move_operation_status record_directory_processing