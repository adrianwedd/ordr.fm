#!/bin/bash
# Worker Pool Architecture for Parallel Album Processing
# Provides high-performance parallel processing for ordr.fm

# Ensure log levels are defined for workers
readonly LOG_QUIET=${LOG_QUIET:-0}
readonly LOG_INFO=${LOG_INFO:-1}
readonly LOG_DEBUG=${LOG_DEBUG:-2}
readonly LOG_WARNING=${LOG_WARNING:-3}
readonly LOG_ERROR=${LOG_ERROR:-4}

# Worker pool configuration
declare -g WORKER_COUNT=${WORKER_COUNT:-4}
declare -g WORKER_PIDS=()
declare -g JOB_QUEUE_FILE="/tmp/ordr.fm_job_queue_$$"
declare -g RESULT_QUEUE_FILE="/tmp/ordr.fm_results_$$"
declare -g WORKER_STATUS_DIR="/tmp/ordr.fm_workers_$$"
declare -g POOL_ACTIVE=0

# Synchronization
declare -g QUEUE_LOCK_FILE="/tmp/ordr.fm_queue_lock_$$"
declare -g DB_LOCK_FILE="/tmp/ordr.fm_db_lock_$$"
declare -g API_LOCK_FILE="/tmp/ordr.fm_api_lock_$$"

# Performance metrics
declare -g JOBS_COMPLETED=0
declare -g JOBS_FAILED=0
declare -g POOL_START_TIME=0

# Initialize worker pool
init_worker_pool() {
    local num_workers="${1:-$WORKER_COUNT}"
    
    # Adjust worker count based on CPU cores
    local cpu_cores=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
    if [[ $num_workers -gt $cpu_cores ]]; then
        log_warning "Reducing workers from $num_workers to $cpu_cores (CPU core count)"
        num_workers=$cpu_cores
    fi
    
    WORKER_COUNT=$num_workers
    
    # Create work directories
    mkdir -p "$WORKER_STATUS_DIR"
    touch "$JOB_QUEUE_FILE"
    touch "$RESULT_QUEUE_FILE"
    
    # Initialize locks
    touch "$QUEUE_LOCK_FILE"
    touch "$DB_LOCK_FILE"
    touch "$API_LOCK_FILE"
    
    POOL_ACTIVE=1
    POOL_START_TIME=$(date +%s)
    
    log_info "Initializing worker pool with $WORKER_COUNT workers"
    
    # Start workers
    for ((i=1; i<=WORKER_COUNT; i++)); do
        start_worker $i &
        WORKER_PIDS+=($!)
        log_debug "Started worker $i (PID: ${WORKER_PIDS[$((i-1))]})"
    done
    
    # Set up cleanup trap
    trap cleanup_worker_pool EXIT INT TERM
}

# Worker process function
start_worker() {
    local worker_id="$1"
    local worker_status_file="$WORKER_STATUS_DIR/worker_$worker_id"
    
    # Worker main loop
    while [[ -d "$WORKER_STATUS_DIR" ]]; do
        # Get next job from queue
        local job=$(get_next_job)
        
        if [[ -z "$job" ]]; then
            # No job available, wait briefly
            sleep 0.1
            continue
        fi
        
        # Update worker status
        echo "BUSY:$job" > "$worker_status_file"
        
        # Process the album
        local result=$(process_album_job "$job" "$worker_id")
        
        # Add result to results queue
        add_result "$job" "$result"
        
        # Update worker status
        echo "IDLE" > "$worker_status_file"
    done
}

# Get next job from queue (thread-safe)
get_next_job() {
    local job=""
    
    # Acquire lock
    exec 200>"$QUEUE_LOCK_FILE"
    flock 200
    
    # Read and remove first line from queue
    if [[ -s "$JOB_QUEUE_FILE" ]]; then
        job=$(head -n1 "$JOB_QUEUE_FILE")
        sed -i '1d' "$JOB_QUEUE_FILE"
    fi
    
    # Release lock
    flock -u 200
    exec 200>&-
    
    echo "$job"
}

# Add job to queue
add_job() {
    local album_dir="$1"
    
    # Acquire lock
    exec 200>"$QUEUE_LOCK_FILE"
    flock 200
    
    # Add to queue
    echo "$album_dir" >> "$JOB_QUEUE_FILE"
    
    # Release lock
    flock -u 200
    exec 200>&-
}

# Process album job (called by worker)
process_album_job() {
    local album_dir="$1"
    local worker_id="$2"
    
    log_debug "Worker $worker_id processing: $album_dir"
    
    # The main processing function should be available from the parent process
    # through exported functions and environment variables
    
    # Set worker environment
    export WORKER_ID="$worker_id"
    
    # Process the album with resource locking
    local start_time=$(date +%s%N)
    
    # Call a simplified processing function suitable for parallel execution
    process_album_parallel_safe "$album_dir" "$worker_id"
    local result=$?
    
    local end_time=$(date +%s%N)
    local duration=$(( (end_time - start_time) / 1000000 ))
    
    log_threadsafe $LOG_DEBUG "Worker $worker_id completed $album_dir in ${duration}ms"
    
    return $result
}

# Simplified parallel-safe processing function
process_album_parallel_safe() {
    local album_dir="$1"
    local worker_id="$2"
    
    log_threadsafe $LOG_DEBUG "Worker $worker_id: Processing $album_dir"
    
    # For now, simulate processing to test the worker pool infrastructure
    # In a real implementation, this would call the actual album processing logic
    
    # Simulate some work
    sleep 0.5
    
    # Check if the directory contains audio files
    local audio_count=$(find "$album_dir" -maxdepth 1 -type f \( -iname "*.mp3" -o -iname "*.flac" -o -iname "*.m4a" -o -iname "*.aac" -o -iname "*.ogg" -o -iname "*.wav" -o -iname "*.aiff" -o -iname "*.alac" \) 2>/dev/null | wc -l)
    
    if [[ $audio_count -gt 0 ]]; then
        log_threadsafe $LOG_INFO "Worker $worker_id: Found $audio_count audio files in $(basename "$album_dir")"
        echo "SUCCESS"
        return 0
    else
        log_threadsafe $LOG_DEBUG "Worker $worker_id: No audio files found in $(basename "$album_dir")"
        echo "SKIPPED"
        return 0
    fi
}

# Add result to results queue
add_result() {
    local job="$1"
    local result="$2"
    
    # Acquire lock
    exec 203>"$RESULT_QUEUE_FILE.lock"
    flock 203
    
    # Add result
    echo "$job|$result" >> "$RESULT_QUEUE_FILE"
    
    # Update counters
    if [[ "$result" == "SUCCESS" ]]; then
        ((JOBS_COMPLETED++))
    else
        ((JOBS_FAILED++))
    fi
    
    # Release lock
    flock -u 203
    exec 203>&-
}

# Wait for all jobs to complete
wait_for_completion() {
    log_info "Waiting for workers to complete..."
    
    while true; do
        # Check if job queue is empty
        if [[ ! -s "$JOB_QUEUE_FILE" ]]; then
            # Check if all workers are idle
            local busy_workers=0
            for ((i=1; i<=WORKER_COUNT; i++)); do
                local status_file="$WORKER_STATUS_DIR/worker_$i"
                if [[ -f "$status_file" ]]; then
                    local status=$(cat "$status_file")
                    [[ "$status" != "IDLE" ]] && ((busy_workers++))
                fi
            done
            
            if [[ $busy_workers -eq 0 ]]; then
                break
            fi
        fi
        
        # Show progress
        local queue_size=$(wc -l < "$JOB_QUEUE_FILE" 2>/dev/null || echo 0)
        local total_processed=$((JOBS_COMPLETED + JOBS_FAILED))
        log_progress $total_processed $((total_processed + queue_size)) "Processing albums"
        
        sleep 1
    done
    
    log_info "All jobs completed"
}

# Get worker pool statistics
get_pool_statistics() {
    local end_time=$(date +%s)
    local duration=$((end_time - POOL_START_TIME))
    
    echo "Worker Pool Statistics:"
    echo "  Workers: $WORKER_COUNT"
    echo "  Duration: ${duration}s"
    echo "  Jobs Completed: $JOBS_COMPLETED"
    echo "  Jobs Failed: $JOBS_FAILED"
    echo "  Throughput: $(echo "scale=2; $JOBS_COMPLETED / $duration" | bc) albums/second"
    
    # Per-worker statistics
    for ((i=1; i<=WORKER_COUNT; i++)); do
        local worker_jobs=$(grep -c "Worker $i" "$RESULT_QUEUE_FILE" 2>/dev/null || echo 0)
        echo "  Worker $i: $worker_jobs jobs"
    done
}

# Cleanup worker pool
cleanup_worker_pool() {
    if [[ $POOL_ACTIVE -eq 0 ]]; then
        return
    fi
    
    log_info "Shutting down worker pool..."
    
    # Signal workers to stop
    rm -rf "$WORKER_STATUS_DIR"
    
    # Wait for workers to finish
    for pid in "${WORKER_PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -TERM "$pid" 2>/dev/null
            wait "$pid" 2>/dev/null
        fi
    done
    
    # Show final statistics
    get_pool_statistics
    
    # Cleanup temporary files
    rm -f "$JOB_QUEUE_FILE" "$RESULT_QUEUE_FILE" "$QUEUE_LOCK_FILE" "$DB_LOCK_FILE" "$API_LOCK_FILE"
    rm -f "$API_LOCK_FILE.last" "$RESULT_QUEUE_FILE.lock"
    
    POOL_ACTIVE=0
}

# Batch processing with worker pool
process_albums_parallel() {
    local album_dirs=("$@")
    local total_albums=${#album_dirs[@]}
    
    log_info "Starting parallel processing of $total_albums albums"
    
    # Initialize worker pool
    init_worker_pool
    
    # Add all albums to job queue
    for album_dir in "${album_dirs[@]}"; do
        add_job "$album_dir"
    done
    
    # Wait for completion
    wait_for_completion
    
    # Cleanup
    cleanup_worker_pool
    
    log_info "Parallel processing complete: $JOBS_COMPLETED succeeded, $JOBS_FAILED failed"
    
    return $([ $JOBS_FAILED -eq 0 ])
}

# Export functions
export -f init_worker_pool
export -f start_worker
export -f get_next_job
export -f add_job
export -f process_album_job
export -f process_album_parallel_safe
export -f add_result
export -f wait_for_completion
export -f get_pool_statistics
export -f cleanup_worker_pool
export -f process_albums_parallel