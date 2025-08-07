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
    
    # Set resource limits for worker
    ulimit -v 524288  # 512MB virtual memory limit
    ulimit -t 300     # 5 minute CPU time limit per album
    ulimit -f 1048576 # 1GB file size limit
    
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
    
    # Process the album with resource locking and performance tracking
    local start_time=$(date +%s%N)
    local metadata_start_time
    local metadata_end_time
    local discogs_start_time
    local discogs_end_time
    local organization_start_time
    local organization_end_time
    
    # Call a simplified processing function suitable for parallel execution
    process_album_parallel_safe "$album_dir" "$worker_id"
    local result=$?
    
    local end_time=$(date +%s%N)
    local duration=$(( (end_time - start_time) / 1000000 ))
    
    log_threadsafe $LOG_DEBUG "Worker $worker_id completed $album_dir in ${duration}ms"
    
    return $result
}

# Full parallel-safe album processing function
process_album_parallel_safe() {
    local album_dir="$1"
    local worker_id="$2"
    
    log_threadsafe $LOG_INFO "Worker $worker_id: Processing album directory: $album_dir"
    
    # Source the metadata module if not already available
    if [[ -z "$(type -t extract_audio_metadata 2>/dev/null)" ]]; then
        if [[ -f "${SCRIPT_DIR:-$(dirname "${BASH_SOURCE[0]}")}/../lib/metadata.sh" ]]; then
            source "${SCRIPT_DIR:-$(dirname "${BASH_SOURCE[0]}")}/../lib/metadata.sh"
        else
            local duration=$(( ($(date +%s%N) - start_time) / 1000000 ))
            log_threadsafe $LOG_ERROR "Worker $worker_id: Could not load metadata module"
            echo "FATAL|$album_dir|METADATA_MODULE_MISSING|${duration}ms|Missing metadata processing module"
            return 1
        fi
    fi
    
    # Extract metadata using the metadata module (with performance tracking)
    local metadata_start=$(date +%s%N)
    local exiftool_output
    exiftool_output=$(extract_audio_metadata "$album_dir")
    local metadata_end=$(date +%s%N)
    local metadata_duration=$(( (metadata_end - metadata_start) / 1000000 ))
    
    if [[ -z "$exiftool_output" ]]; then
        local duration=$(( ($(date +%s%N) - start_time) / 1000000 ))
        log_threadsafe $LOG_WARNING "Worker $worker_id: Could not extract metadata from any files in '$album_dir'"
        echo "SKIP|$album_dir|NO_METADATA|${duration}ms|No extractable audio metadata found"
        return 0
    fi
    
    # Determine album metadata using the metadata module
    local album_metadata
    album_metadata=$(determine_album_metadata "$exiftool_output" "$(basename "$album_dir")")
    
    if [[ -z "$album_metadata" ]]; then
        local duration=$(( ($(date +%s%N) - start_time) / 1000000 ))
        log_threadsafe $LOG_WARNING "Worker $worker_id: Could not determine album metadata for '$album_dir'"
        echo "SKIP|$album_dir|INVALID_METADATA|${duration}ms|Could not parse album metadata structure"
        return 0
    fi
    
    # Extract album information from metadata JSON
    local album_artist=$(echo "$album_metadata" | jq -r '.artist')
    local album_title=$(echo "$album_metadata" | jq -r '.title')
    local album_year=$(echo "$album_metadata" | jq -r '.year')
    
    log_threadsafe $LOG_DEBUG "Worker $worker_id: Album Artist: $album_artist, Title: $album_title, Year: $album_year"
    
    # Validate essential metadata
    if ! validate_album_metadata "$album_metadata"; then
        local duration=$(( ($(date +%s%N) - start_time) / 1000000 ))
        log_threadsafe $LOG_WARNING "Worker $worker_id: Missing essential album tags for '$album_dir'"
        echo "SKIP|$album_dir|MISSING_TAGS|${duration}ms|Missing required metadata fields (artist/title)"
        return 0
    fi
    
    # Determine album quality using the metadata module
    local album_quality
    album_quality=$(determine_album_quality "$exiftool_output")
    log_threadsafe $LOG_DEBUG "Worker $worker_id: Album Quality: $album_quality"
    
    # Resolve artist aliases if enabled (simplified for parallel processing)
    local resolved_artist="$album_artist"
    if [[ $GROUP_ARTIST_ALIASES -eq 1 ]] && [[ -n "$ARTIST_ALIAS_GROUPS" ]]; then
        if command -v resolve_artist_alias >/dev/null 2>&1; then
            resolved_artist=$(resolve_artist_alias "$album_artist")
            if [[ "$resolved_artist" != "$album_artist" ]]; then
                log_threadsafe $LOG_INFO "Worker $worker_id: Resolved artist alias: '$album_artist' -> '$resolved_artist'"
            fi
        fi
    fi
    
    # Discogs enrichment with worker-specific rate limiting (with performance tracking)
    local discogs_start=$(date +%s%N)
    local discogs_metadata="{}"
    local discogs_duration=0
    if [[ $DISCOGS_ENABLED -eq 1 ]]; then
        log_threadsafe $LOG_DEBUG "Worker $worker_id: Attempting Discogs enrichment for: $resolved_artist - $album_title"
        
        # Acquire API lock for rate limiting
        if acquire_api_lock; then
            if command -v enrich_metadata_with_discogs >/dev/null 2>&1; then
                discogs_metadata=$(enrich_metadata_with_discogs "$resolved_artist" "$album_title" "$album_year")
            fi
            release_api_lock
        else
            log_threadsafe $LOG_WARNING "Worker $worker_id: Could not acquire API lock, skipping Discogs enrichment"
        fi
    fi
    local discogs_end=$(date +%s%N)
    discogs_duration=$(( (discogs_end - discogs_start) / 1000000 ))
    
    # Determine organization path using existing logic (with performance tracking)
    local organization_start=$(date +%s%N)
    local proposed_album_path
    if command -v build_organization_path >/dev/null 2>&1; then
        proposed_album_path=$(build_organization_path \
            "$album_quality" "$resolved_artist" "$album_title" "$album_year" \
            "" "" "")
    else
        # Fallback basic organization
        local sanitized_artist=$(sanitize_filename "$resolved_artist")
        local sanitized_title=$(sanitize_filename "$album_title")
        local year_suffix=""
        [[ -n "$album_year" && "$album_year" != "null" ]] && year_suffix=" ($album_year)"
        proposed_album_path="${DEST_DIR:-/tmp/organized}/$album_quality/$sanitized_artist/$sanitized_title$year_suffix"
    fi
    local organization_end=$(date +%s%N)
    local organization_duration=$(( (organization_end - organization_start) / 1000000 ))
    
    log_threadsafe $LOG_INFO "Worker $worker_id: Proposed path for '$(basename "$album_dir")': $proposed_album_path"
    
    # For parallel processing, we only do the analysis and planning
    # Actual file moves are handled by the main process to avoid conflicts
    local files_processed=$(echo "$exiftool_output" | jq length)
    local total_duration=$(( ($(date +%s%N) - start_time) / 1000000 ))
    
    # Include performance breakdown in result
    local perf_data="metadata:${metadata_duration}ms,discogs:${discogs_duration}ms,org:${organization_duration}ms"
    
    echo "SUCCESS|$album_dir|$proposed_album_path|${total_duration}ms|$files_processed|$perf_data"
    return 0
}

# Database operations need locking
acquire_db_lock() {
    exec 201>"$DB_LOCK_FILE"
    flock 201
}

release_db_lock() {
    flock -u 201
    exec 201>&-
}

# Enhanced API rate limiting with token bucket algorithm
acquire_api_lock() {
    local token_file="$API_LOCK_FILE.tokens"
    local bucket_size=5  # Allow burst of 5 requests
    local refill_rate=1  # 1 token per second
    local now=$(date +%s)
    
    exec 202>"$API_LOCK_FILE"
    flock 202
    
    # Initialize token bucket if not exists
    if [[ ! -f "$token_file" ]]; then
        echo "$bucket_size,$now" > "$token_file"
    fi
    
    # Read current token state
    local tokens
    local last_refill
    IFS=',' read -r tokens last_refill < "$token_file"
    
    # Calculate tokens to add based on time elapsed
    local time_diff=$((now - last_refill))
    local tokens_to_add=$((time_diff * refill_rate))
    tokens=$((tokens + tokens_to_add))
    
    # Cap at bucket size
    [[ $tokens -gt $bucket_size ]] && tokens=$bucket_size
    
    # Check if we have tokens available
    if [[ $tokens -lt 1 ]]; then
        local wait_time=$((1 - tokens / refill_rate))
        log_threadsafe $LOG_DEBUG "API rate limit reached, waiting ${wait_time}s for token"
        sleep "$wait_time"
        tokens=1
    fi
    
    # Consume token
    tokens=$((tokens - 1))
    echo "$tokens,$now" > "$token_file"
    
    return 0
}

release_api_lock() {
    flock -u 202
    exec 202>&-
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
    
    # Update counters based on structured result format
    local result_type=$(echo "$result" | cut -d'|' -f1)
    case "$result_type" in
        "SUCCESS")
            ((JOBS_COMPLETED++))
            ;;
        "SKIP"|"FATAL"|"RETRY")
            ((JOBS_FAILED++))
            ;;
        *)
            # Legacy format compatibility
            if [[ "$result" == "SUCCESS" ]]; then
                ((JOBS_COMPLETED++))
            else
                ((JOBS_FAILED++))
            fi
            ;;
    esac
    
    # Release lock
    flock -u 203
    exec 203>&-
}

# Wait for all jobs to complete
wait_for_completion() {
    log_info "Waiting for workers to complete..."
    local health_check_counter=0
    
    while true; do
        # Check worker health every 30 seconds
        ((health_check_counter++))
        if [[ $((health_check_counter % 30)) -eq 0 ]]; then
            for ((i=1; i<=WORKER_COUNT; i++)); do
                check_worker_health "$i"
            done
        fi
        
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
    
    # Generate error report if there were failures
    if [[ $JOBS_FAILED -gt 0 ]]; then
        generate_error_report
    fi
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
    rm -f "$API_LOCK_FILE.last" "$API_LOCK_FILE.tokens" "$RESULT_QUEUE_FILE.lock"
    
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

# Worker health monitoring
check_worker_health() {
    local worker_id="$1"
    local worker_pid="${WORKER_PIDS[$((worker_id-1))]}"
    local status_file="$WORKER_STATUS_DIR/worker_$worker_id"
    
    # Check if process is still alive
    if ! kill -0 "$worker_pid" 2>/dev/null; then
        log_warning "Worker $worker_id (PID: $worker_pid) has died, restarting..."
        restart_worker "$worker_id"
        return 1
    fi
    
    # Check for stuck workers (same status for too long)
    if [[ -f "$status_file" ]]; then
        local status=$(cat "$status_file")
        local status_timestamp=$(stat -c %Y "$status_file" 2>/dev/null || echo 0)
        local current_time=$(date +%s)
        local stuck_threshold=300  # 5 minutes
        
        if [[ $((current_time - status_timestamp)) -gt $stuck_threshold ]] && [[ "$status" != "IDLE" ]]; then
            log_warning "Worker $worker_id appears stuck (status: $status for $((current_time - status_timestamp))s), restarting..."
            restart_worker "$worker_id"
            return 1
        fi
    fi
    
    return 0
}

restart_worker() {
    local worker_id="$1"
    local old_pid="${WORKER_PIDS[$((worker_id-1))]}"
    
    # Kill old worker if still alive
    if kill -0 "$old_pid" 2>/dev/null; then
        kill -TERM "$old_pid" 2>/dev/null
        sleep 1
        kill -KILL "$old_pid" 2>/dev/null
    fi
    
    # Start new worker
    start_worker "$worker_id" &
    WORKER_PIDS[$((worker_id-1))]=$!
    
    log_info "Restarted worker $worker_id (new PID: ${WORKER_PIDS[$((worker_id-1))]})"
}

# Enhanced error reporting and analysis
generate_error_report() {
    local report_file="/tmp/ordr.fm_error_report_$$.txt"
    
    echo "=== ordr.fm Parallel Processing Error Report ===" > "$report_file"
    echo "Generated: $(date)" >> "$report_file"
    echo >> "$report_file"
    
    # Overall statistics
    echo "OVERALL STATISTICS:" >> "$report_file"
    echo "  Total Jobs: $((JOBS_COMPLETED + JOBS_FAILED))" >> "$report_file"
    echo "  Successful: $JOBS_COMPLETED" >> "$report_file"
    echo "  Failed: $JOBS_FAILED" >> "$report_file"
    echo "  Success Rate: $(echo "scale=1; $JOBS_COMPLETED * 100 / ($JOBS_COMPLETED + $JOBS_FAILED)" | bc)%" >> "$report_file"
    echo >> "$report_file"
    
    # Error breakdown by type
    echo "ERROR BREAKDOWN:" >> "$report_file"
    if [[ -f "$RESULT_QUEUE_FILE" ]]; then
        local skip_count=$(grep -c "|SKIP|" "$RESULT_QUEUE_FILE" || echo 0)
        local fatal_count=$(grep -c "|FATAL|" "$RESULT_QUEUE_FILE" || echo 0)
        local retry_count=$(grep -c "|RETRY|" "$RESULT_QUEUE_FILE" || echo 0)
        
        echo "  SKIP errors: $skip_count (recoverable, albums moved to unsorted)" >> "$report_file"
        echo "  FATAL errors: $fatal_count (system issues, need attention)" >> "$report_file"
        echo "  RETRY errors: $retry_count (transient, may succeed on retry)" >> "$report_file"
        echo >> "$report_file"
        
        # Most common error types
        echo "MOST COMMON ERROR TYPES:" >> "$report_file"
        grep "|SKIP\||FATAL\||RETRY" "$RESULT_QUEUE_FILE" | cut -d'|' -f3 | sort | uniq -c | sort -nr | head -10 >> "$report_file"
        echo >> "$report_file"
        
        # Sample failed albums with details
        echo "SAMPLE FAILED ALBUMS:" >> "$report_file"
        grep -v "|SUCCESS|" "$RESULT_QUEUE_FILE" | head -20 | while IFS='|' read -r album result_type album_path error_code duration reason; do
            echo "  Album: $(basename "$album")" >> "$report_file"
            echo "    Error: $error_code - $reason" >> "$report_file"
            echo "    Duration: $duration" >> "$report_file"
            echo >> "$report_file"
        done
        
        # Performance analysis from successful albums
        echo "PERFORMANCE ANALYSIS:" >> "$report_file"
        if grep -q "|SUCCESS|" "$RESULT_QUEUE_FILE"; then
            local avg_duration=$(grep "|SUCCESS|" "$RESULT_QUEUE_FILE" | cut -d'|' -f4 | sed 's/ms//' | awk '{sum+=$1} END {printf "%.0f", sum/NR}')
            local max_duration=$(grep "|SUCCESS|" "$RESULT_QUEUE_FILE" | cut -d'|' -f4 | sed 's/ms//' | sort -n | tail -1)
            local min_duration=$(grep "|SUCCESS|" "$RESULT_QUEUE_FILE" | cut -d'|' -f4 | sed 's/ms//' | sort -n | head -1)
            
            echo "  Average processing time: ${avg_duration}ms" >> "$report_file"
            echo "  Fastest album: ${min_duration}ms" >> "$report_file"
            echo "  Slowest album: ${max_duration}ms" >> "$report_file"
            
            # Analyze performance breakdown if available
            if grep -q "metadata:" "$RESULT_QUEUE_FILE"; then
                echo "  Performance breakdown (averages):" >> "$report_file"
                grep "|SUCCESS|" "$RESULT_QUEUE_FILE" | grep "metadata:" | while IFS='|' read -r _ _ _ _ _ perf_data; do
                    local metadata_time=$(echo "$perf_data" | grep -o "metadata:[0-9]*ms" | cut -d':' -f2 | sed 's/ms//')
                    local discogs_time=$(echo "$perf_data" | grep -o "discogs:[0-9]*ms" | cut -d':' -f2 | sed 's/ms//')
                    local org_time=$(echo "$perf_data" | grep -o "org:[0-9]*ms" | cut -d':' -f2 | sed 's/ms//')
                    echo "$metadata_time $discogs_time $org_time"
                done | awk '
                {
                    metadata+=$1; discogs+=$2; org+=$3; count++
                } 
                END {
                    printf "    Metadata extraction: %.0fms\n", metadata/count
                    printf "    Discogs enrichment: %.0fms\n", discogs/count  
                    printf "    Path organization: %.0fms\n", org/count
                }' >> "$report_file"
            fi
        fi
    fi
    
    echo "Full error report saved to: $report_file"
    log_info "Generated error report: $report_file"
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
export -f check_worker_health
export -f restart_worker
export -f generate_error_report