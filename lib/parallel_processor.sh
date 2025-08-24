#!/bin/bash
# Parallel processing integration for ordr.fm
# Provides high-performance parallel album processing

# Source required modules
source "${BASH_SOURCE%/*}/common.sh"
source "${BASH_SOURCE%/*}/processing/worker_pool.sh"
source "${BASH_SOURCE%/*}/thread_safe_logging.sh"

# Global variables for parallel processing
declare -g PARALLEL_ENABLED=0
declare -g PARALLEL_METHOD="builtin"  # builtin, gnu-parallel, or xargs
declare -g MAX_PARALLEL_JOBS=4
declare -g BATCH_SIZE=100
declare -g PROGRESS_UPDATE_INTERVAL=2

# Check available parallel processing methods
check_parallel_methods() {
    local methods=()
    
    # Check for GNU parallel
    if command -v parallel &>/dev/null; then
        methods+=("gnu-parallel")
        log $LOG_DEBUG "GNU parallel available"
    fi
    
    # Check for xargs with parallel support
    if xargs --help 2>&1 | grep -q "max-procs"; then
        methods+=("xargs")
        log $LOG_DEBUG "xargs with parallel support available"
    fi
    
    # Built-in worker pool is always available
    methods+=("builtin")
    
    echo "${methods[@]}"
}

# Initialize parallel processing
init_parallel_processing() {
    local method="${1:-auto}"
    local max_jobs="${2:-$MAX_PARALLEL_JOBS}"
    
    # Auto-detect best method
    if [[ "$method" == "auto" ]]; then
        local available_methods=($(check_parallel_methods))
        if [[ " ${available_methods[@]} " =~ " gnu-parallel " ]]; then
            method="gnu-parallel"
        else
            method="builtin"
        fi
    fi
    
    PARALLEL_METHOD="$method"
    MAX_PARALLEL_JOBS="$max_jobs"
    PARALLEL_ENABLED=1
    
    # Force single worker to fix metadata extraction issues
    local max_recommended=1
    
    if [[ $MAX_PARALLEL_JOBS -gt $max_recommended ]]; then
        log $LOG_INFO "Using single worker to ensure reliable metadata extraction"
        MAX_PARALLEL_JOBS=$max_recommended
    fi
    
    log $LOG_INFO "Initialized parallel processing: method=$PARALLEL_METHOD, max_jobs=$MAX_PARALLEL_JOBS"
}

# Process albums in parallel using GNU parallel
process_albums_gnu_parallel() {
    local album_dirs=("$@")
    local total_albums=${#album_dirs[@]}
    local temp_script="/tmp/ordr_fm_parallel_$$"
    
    log $LOG_INFO "Processing $total_albums albums using GNU parallel"
    
    # Create a temporary script for parallel execution
    cat > "$temp_script" << 'EOF'
#!/bin/bash
source "$(dirname "$0")/ordr.fm.modular.sh" --source-only
process_single_album "$1"
EOF
    chmod +x "$temp_script"
    
    # Process albums with progress bar
    printf '%s\n' "${album_dirs[@]}" | \
        parallel --progress --bar --jobs "$MAX_PARALLEL_JOBS" \
        --joblog "/tmp/ordr_fm_parallel_log_$$" \
        "$temp_script" {}
    
    local result=$?
    
    # Cleanup
    rm -f "$temp_script"
    
    # Show summary
    if [[ -f "/tmp/ordr_fm_parallel_log_$$" ]]; then
        local completed=$(grep -c "0$" "/tmp/ordr_fm_parallel_log_$$" || echo 0)
        local failed=$((total_albums - completed))
        log $LOG_INFO "Parallel processing complete: $completed succeeded, $failed failed"
        rm -f "/tmp/ordr_fm_parallel_log_$$"
    fi
    
    return $result
}

# Process albums in parallel using xargs
process_albums_xargs() {
    local album_dirs=("$@")
    local total_albums=${#album_dirs[@]}
    
    log $LOG_INFO "Processing $total_albums albums using xargs"
    
    # Create progress tracking
    local progress_file="/tmp/ordr_fm_progress_$$"
    echo "0" > "$progress_file"
    
    # Process function for xargs
    process_with_progress() {
        local album_dir="$1"
        process_single_album "$album_dir"
        local result=$?
        
        # Update progress
        local count=$(cat "$progress_file")
        echo $((count + 1)) > "$progress_file"
        
        return $result
    }
    export -f process_with_progress
    
    # Process albums
    printf '%s\n' "${album_dirs[@]}" | \
        xargs -P "$MAX_PARALLEL_JOBS" -I {} bash -c 'process_with_progress "$@"' _ {}
    
    local result=$?
    
    # Cleanup
    rm -f "$progress_file"
    
    return $result
}

# Main parallel processing dispatcher
process_albums_parallel_dispatcher() {
    local album_dirs=("$@")
    
    if [[ ${#album_dirs[@]} -eq 0 ]]; then
        log $LOG_WARNING "No albums to process"
        return 0
    fi
    
    # Initialize if not already done
    if [[ $PARALLEL_ENABLED -eq 0 ]]; then
        init_parallel_processing "auto"
    fi
    
    # Dispatch to appropriate method
    case "$PARALLEL_METHOD" in
        "gnu-parallel")
            process_albums_gnu_parallel "${album_dirs[@]}"
            ;;
        "xargs")
            process_albums_xargs "${album_dirs[@]}"
            ;;
        "builtin")
            process_albums_parallel "${album_dirs[@]}"  # From worker_pool.sh
            ;;
        *)
            log $LOG_ERROR "Unknown parallel method: $PARALLEL_METHOD"
            return 1
            ;;
    esac
}

# Process single album (wrapper for parallel execution)
process_single_album() {
    local album_dir="$1"
    
    # Ensure all modules are loaded
    if [[ -z "$(type -t process_album_directory)" ]]; then
        source "${BASH_SOURCE%/*}/parallel_wrapper.sh" --source-only
    fi
    
    # Process the album
    process_album_directory "$album_dir"
}

# Batch processing with optimal chunking
process_albums_in_batches() {
    local album_dirs=("$@")
    local total_albums=${#album_dirs[@]}
    local batch_size="${BATCH_SIZE:-100}"
    local batches=$(( (total_albums + batch_size - 1) / batch_size ))
    
    log $LOG_INFO "Processing $total_albums albums in $batches batches of $batch_size"
    
    for ((i=0; i<total_albums; i+=batch_size)); do
        local batch_num=$((i/batch_size + 1))
        local batch_end=$((i + batch_size))
        [[ $batch_end -gt $total_albums ]] && batch_end=$total_albums
        
        log $LOG_INFO "Processing batch $batch_num/$batches (albums $((i+1))-$batch_end)"
        
        # Extract batch
        local batch=("${album_dirs[@]:i:batch_size}")
        
        # Process batch in parallel
        process_albums_parallel_dispatcher "${batch[@]}"
        
        # Optional: Add delay between batches to prevent resource exhaustion
        [[ $batch_num -lt $batches ]] && sleep 1
    done
}

# Progress monitoring for parallel operations
monitor_parallel_progress() {
    local total_jobs="$1"
    local progress_callback="${2:-show_progress}"
    
    while [[ $POOL_ACTIVE -eq 1 ]]; do
        local completed=$((JOBS_COMPLETED + JOBS_FAILED))
        $progress_callback $completed $total_jobs "Processing albums"
        sleep "$PROGRESS_UPDATE_INTERVAL"
    done
}

# Benchmark parallel processing performance
benchmark_parallel_processing() {
    local test_dirs=("$@")
    local methods=("builtin" "gnu-parallel" "xargs")
    
    echo "Benchmarking parallel processing methods..."
    echo "Test set: ${#test_dirs[@]} albums"
    echo
    
    for method in "${methods[@]}"; do
        # Check if method is available
        local available_methods=($(check_parallel_methods))
        if [[ ! " ${available_methods[@]} " =~ " $method " ]]; then
            echo "$method: Not available"
            continue
        fi
        
        # Initialize method
        init_parallel_processing "$method"
        
        # Run benchmark
        local start_time=$(date +%s%N)
        process_albums_parallel_dispatcher "${test_dirs[@]}"
        local end_time=$(date +%s%N)
        
        local duration=$(( (end_time - start_time) / 1000000000 ))
        local throughput=$(echo "scale=2; ${#test_dirs[@]} / $duration" | bc)
        
        echo "$method: ${duration}s (${throughput} albums/sec)"
    done
}

# Export functions
export -f check_parallel_methods
export -f init_parallel_processing
export -f process_albums_gnu_parallel
export -f process_albums_xargs
export -f process_albums_parallel_dispatcher
export -f process_single_album
export -f process_albums_in_batches
export -f monitor_parallel_progress
export -f benchmark_parallel_processing