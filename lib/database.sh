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

# Export functions
export -f enable_wal_mode execute_sql_with_retry batch_insert_albums
export -f init_database_safe check_database_access vacuum_database