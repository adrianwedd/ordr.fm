#!/bin/bash
# Performance optimization module for ordr.fm
# Handles large collection processing efficiently

# Source common utilities
source "${BASH_SOURCE%/*}/common.sh"

# Performance configuration
declare -g LARGE_COLLECTION_THRESHOLD=1000
declare -g MEMORY_LIMIT_MB=0  # 0 = no limit
declare -g BATCH_PROCESSING_ENABLED=0
declare -g STREAM_PROCESSING_ENABLED=0
declare -g INDEX_CACHE_ENABLED=1
declare -g PROGRESS_PERSISTENCE_ENABLED=1

# Memory management
check_memory_usage() {
    local current_mem=$(ps -o rss= -p $$ | awk '{print int($1/1024)}')
    local available_mem=$(free -m | awk 'NR==2 {print $7}')
    
    log $LOG_DEBUG "Memory usage: ${current_mem}MB used, ${available_mem}MB available"
    
    if [[ $MEMORY_LIMIT_MB -gt 0 ]] && [[ $current_mem -gt $MEMORY_LIMIT_MB ]]; then
        log $LOG_WARNING "Memory limit exceeded: ${current_mem}MB > ${MEMORY_LIMIT_MB}MB"
        return 1
    fi
    
    # Warn if available memory is low
    if [[ $available_mem -lt 500 ]]; then
        log $LOG_WARNING "Low memory warning: ${available_mem}MB available"
    fi
    
    return 0
}

# Optimize batch size based on system resources
calculate_optimal_batch_size() {
    local total_albums=$1
    local cpu_cores=$(nproc 2>/dev/null || echo 4)
    local available_mem=$(free -m 2>/dev/null | awk 'NR==2 {print $7}' || echo 2048)
    
    # Conservative calculation for resource-constrained systems
    local mem_based_batch=$((available_mem / 20))  # Assume ~20MB per album processing (more conservative)
    local cpu_based_batch=$((cpu_cores * 15))      # 15 albums per core (reduced from 25)
    
    # Take the smaller of the two
    local optimal_batch=$mem_based_batch
    [[ $cpu_based_batch -lt $optimal_batch ]] && optimal_batch=$cpu_based_batch
    
    # Apply bounds
    [[ $optimal_batch -lt 50 ]] && optimal_batch=50
    [[ $optimal_batch -gt 500 ]] && optimal_batch=500
    
    # For very large collections, use smaller batches
    if [[ $total_albums -gt 10000 ]]; then
        optimal_batch=$((optimal_batch / 2))
    fi
    
    # Memory pressure detection - reduce batch size if low memory
    local swap_used=$(free -m | awk 'NR==3 {print $3}')
    if [[ $swap_used -gt 100 ]]; then
        log $LOG_WARNING "Memory pressure detected (${swap_used}MB swap used). Reducing batch size."
        optimal_batch=$((optimal_batch / 2))
    fi
    
    log $LOG_DEBUG "Optimal batch size: $optimal_batch (CPU: $cpu_cores cores, Mem: ${available_mem}MB)"
    echo "$optimal_batch"
}

# Stream processing for huge collections
init_stream_processing() {
    local source_dir="$1"
    local state_file="${STATE_DB%.db}.stream"
    
    STREAM_PROCESSING_ENABLED=1
    
    # Create streaming state file
    cat > "$state_file" << EOF
{
    "source": "$source_dir",
    "position": 0,
    "processed": 0,
    "total": 0,
    "start_time": $(date +%s),
    "checkpoints": []
}
EOF
    
    log $LOG_INFO "Initialized streaming mode for large collection"
}

# Process albums in streaming fashion
stream_process_albums() {
    local source_dir="$1"
    local process_func="$2"
    local batch_size="${3:-100}"
    local state_file="${STATE_DB%.db}.stream"
    
    # Load state
    local position=0
    if [[ -f "$state_file" ]]; then
        position=$(jq -r '.position' "$state_file")
    fi
    
    # Stream albums
    local count=0
    local batch_count=0
    
    find "$source_dir" -type d -print0 | while IFS= read -r -d '' dir; do
        # Skip until we reach our position
        if [[ $count -lt $position ]]; then
            ((count++))
            continue
        fi
        
        # Check if directory has audio files
        if directory_has_audio_files "$dir"; then
            # Process album
            $process_func "$dir"
            
            ((batch_count++))
            ((count++))
            
            # Checkpoint every batch
            if [[ $((batch_count % batch_size)) -eq 0 ]]; then
                # Update state
                jq --arg pos "$count" '.position = ($pos | tonumber)' "$state_file" > "${state_file}.tmp"
                mv "${state_file}.tmp" "$state_file"
                
                # Check memory
                if ! check_memory_usage; then
                    log $LOG_WARNING "Pausing for memory recovery..."
                    sleep 5
                fi
                
                log $LOG_INFO "Streaming progress: $count albums processed"
            fi
        fi
    done
    
    # Final state update
    jq --arg pos "$count" --arg time "$(date +%s)" \
        '.position = ($pos | tonumber) | .end_time = ($time | tonumber)' \
        "$state_file" > "${state_file}.tmp"
    mv "${state_file}.tmp" "$state_file"
}

# Database optimization for large collections
optimize_database_performance() {
    local db_file="$1"
    
    log $LOG_INFO "Optimizing database performance..."
    
    # Set optimal pragmas
    sqlite3 "$db_file" << EOF
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;  -- 64MB cache
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;  -- 256MB memory map
PRAGMA page_size = 4096;
PRAGMA busy_timeout = 10000;
EOF
    
    # Create indexes only for tables that exist in this database
    local tables_check=$(sqlite3 "$db_file" "SELECT name FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "")
    
    if echo "$tables_check" | grep -q "processed_directories"; then
        sqlite3 "$db_file" "CREATE INDEX IF NOT EXISTS idx_processed_path ON processed_directories(directory_path);" 2>/dev/null || true
        sqlite3 "$db_file" "CREATE INDEX IF NOT EXISTS idx_processed_status ON processed_directories(status);" 2>/dev/null || true
        sqlite3 "$db_file" "CREATE INDEX IF NOT EXISTS idx_processed_timestamp ON processed_directories(last_processed);" 2>/dev/null || true
    fi
    
    if echo "$tables_check" | grep -q "albums"; then
        sqlite3 "$db_file" "CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(album_artist);" 2>/dev/null || true
        sqlite3 "$db_file" "CREATE INDEX IF NOT EXISTS idx_albums_path ON albums(directory_path);" 2>/dev/null || true
    fi
    
    if echo "$tables_check" | grep -q "move_operations"; then
        sqlite3 "$db_file" "CREATE INDEX IF NOT EXISTS idx_moves_operation ON move_operations(operation_id);" 2>/dev/null || true
    fi
    
    # Analyze for query optimization
    sqlite3 "$db_file" "ANALYZE;"
    
    log $LOG_INFO "Database optimization complete"
}

# Progress persistence for resumable operations
save_progress_checkpoint() {
    local checkpoint_file="${STATE_DB%.db}.checkpoint"
    local current_album="$1"
    local processed_count="$2"
    local total_count="$3"
    
    cat > "$checkpoint_file" << EOF
{
    "timestamp": $(date +%s),
    "current_album": "$current_album",
    "processed": $processed_count,
    "total": $total_count,
    "progress_percent": $(echo "scale=2; $processed_count * 100 / $total_count" | bc)
}
EOF
}

# Resume from checkpoint
load_progress_checkpoint() {
    local checkpoint_file="${STATE_DB%.db}.checkpoint"
    
    if [[ -f "$checkpoint_file" ]]; then
        local last_album=$(jq -r '.current_album' "$checkpoint_file")
        local processed=$(jq -r '.processed' "$checkpoint_file")
        
        log $LOG_INFO "Resuming from checkpoint: $processed albums processed, last: $last_album"
        echo "$processed"
    else
        echo "0"
    fi
}

# Parallel batch processor optimized for large collections
process_large_collection_parallel() {
    local album_dirs=("$@")
    local total_albums=${#album_dirs[@]}
    
    # Check if this is a large collection
    if [[ $total_albums -lt $LARGE_COLLECTION_THRESHOLD ]]; then
        # Use standard parallel processing
        process_albums_parallel "${album_dirs[@]}"
        return $?
    fi
    
    log $LOG_INFO "Large collection detected: $total_albums albums. Enabling optimizations..."
    
    # Optimize database
    optimize_database_performance "$STATE_DB"
    optimize_database_performance "$METADATA_DB"
    
    # Calculate optimal batch size
    local batch_size=$(calculate_optimal_batch_size "$total_albums")
    
    # Enable progress persistence
    PROGRESS_PERSISTENCE_ENABLED=1
    
    # Load checkpoint if resuming
    local start_position=$(load_progress_checkpoint)
    
    # Process in optimized batches
    local processed=0
    local failed=0
    
    for ((i=start_position; i<total_albums; i+=batch_size)); do
        # Resource monitoring and throttling
        if command -v should_throttle_processing >/dev/null 2>&1 && should_throttle_processing; then
            log $LOG_INFO "System under load - pausing for 10 seconds"
            command -v smart_sleep >/dev/null 2>&1 && smart_sleep 10 || sleep 10
        fi
        
        local batch_end=$((i + batch_size))
        [[ $batch_end -gt $total_albums ]] && batch_end=$total_albums
        
        log $LOG_INFO "Processing batch: albums $((i+1))-$batch_end of $total_albums"
        
        # Extract batch
        local batch=("${album_dirs[@]:i:batch_size}")
        
        # Check memory before processing
        if ! check_memory_usage; then
            log $LOG_WARNING "Memory pressure detected, reducing batch size"
            batch_size=$((batch_size / 2))
            continue
        fi
        
        # Process batch with parallel workers
        if process_albums_parallel "${batch[@]}"; then
            processed=$((processed + ${#batch[@]}))
        else
            failed=$((failed + ${#batch[@]}))
        fi
        
        # Save checkpoint
        save_progress_checkpoint "${batch[-1]}" $((i + ${#batch[@]})) "$total_albums"
        
        # Progress report
        local percent=$(echo "scale=1; ($i + ${#batch[@]}) * 100 / $total_albums" | bc)
        log $LOG_INFO "Overall progress: ${percent}% ($((i + ${#batch[@]}))/$total_albums)"
        
        # Brief pause between batches to prevent system overload
        sleep 0.5
    done
    
    # Clean up checkpoint
    rm -f "${STATE_DB%.db}.checkpoint"
    
    log $LOG_INFO "Large collection processing complete: $processed succeeded, $failed failed"
    
    return $([ $failed -eq 0 ])
}

# Index cache for faster lookups
build_album_index_cache() {
    local source_dir="$1"
    local cache_file="${STATE_DB%.db}.index_cache"
    
    log $LOG_INFO "Building album index cache..."
    
    # Create cache with album paths and basic metadata
    find "$source_dir" -type d -exec bash -c '
        for dir; do
            if ls "$dir"/*.{mp3,flac,wav,m4a,ogg,aiff,alac,opus,wma} 2>/dev/null | head -1 >/dev/null; then
                count=$(ls "$dir"/*.{mp3,flac,wav,m4a,ogg,aiff,alac,opus,wma} 2>/dev/null | wc -l)
                size=$(du -sb "$dir" | cut -f1)
                echo "{\"path\": \"$dir\", \"track_count\": $count, \"size\": $size}"
            fi
        done
    ' _ {} + > "$cache_file"
    
    local album_count=$(wc -l < "$cache_file")
    log $LOG_INFO "Index cache built: $album_count albums indexed"
}

# Memory-efficient album metadata extraction
extract_metadata_lightweight() {
    local album_dir="$1"
    local sample_size=3  # Only sample a few tracks for large albums
    
    # Count tracks
    local track_count=$(find "$album_dir" -name "*.mp3" -o -name "*.flac" -o -name "*.m4a" | wc -l)
    
    if [[ $track_count -gt 20 ]]; then
        # For large albums, sample subset
        log $LOG_DEBUG "Large album detected ($track_count tracks), using sampling"
        
        # Get sample of files
        local sample_files=$(find "$album_dir" -name "*.mp3" -o -name "*.flac" -o -name "*.m4a" | \
            sort | awk "NR==1 || NR==$((track_count/2)) || NR==$track_count")
        
        # Extract metadata from sample
        exiftool -j -Artist -AlbumArtist -Album -Year $sample_files 2>/dev/null
    else
        # Normal extraction for smaller albums
        extract_album_metadata "$album_dir"
    fi
}

# Cleanup orphaned data
cleanup_orphaned_data() {
    log $LOG_INFO "Cleaning up orphaned data..."
    
    # Remove old checkpoints
    find . -name "*.checkpoint" -mtime +7 -delete
    
    # Remove old stream state files
    find . -name "*.stream" -mtime +7 -delete
    
    # Vacuum databases
    for db in "$STATE_DB" "$METADATA_DB" "$DUPLICATES_DB"; do
        if [[ -f "$db" ]]; then
            log $LOG_DEBUG "Vacuuming $db"
            sqlite3 "$db" "VACUUM;"
        fi
    done
}

# Performance monitoring
monitor_performance() {
    local start_time=$1
    local processed_count=$2
    
    local current_time=$(date +%s)
    local elapsed=$((current_time - start_time))
    
    if [[ $elapsed -gt 0 ]]; then
        local rate=$(echo "scale=2; $processed_count / $elapsed" | bc)
        local eta=$(echo "scale=0; ($TOTAL_ALBUMS - $processed_count) / $rate" | bc 2>/dev/null || echo "unknown")
        
        log $LOG_INFO "Performance: $rate albums/sec, ETA: ${eta}s"
    fi
}

# Export functions
export -f check_memory_usage
export -f calculate_optimal_batch_size
export -f init_stream_processing
export -f stream_process_albums
export -f optimize_database_performance
export -f save_progress_checkpoint
export -f load_progress_checkpoint
export -f process_large_collection_parallel
export -f build_album_index_cache
export -f extract_metadata_lightweight
export -f cleanup_orphaned_data
export -f monitor_performance