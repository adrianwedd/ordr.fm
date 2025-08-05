#!/bin/bash
# Benchmark script for ordr.fm parallel processing
# Tests performance with different configurations

set -euo pipefail

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source modules
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/parallel_processor.sh"

# Benchmark configuration
BENCHMARK_SOURCE="${1:-$SCRIPT_DIR/test_music}"
BENCHMARK_DEST="/tmp/ordr_fm_benchmark_$$"
BENCHMARK_LOG="/tmp/ordr_fm_benchmark_$$.log"

# Test configurations
WORKER_COUNTS=(1 2 4 8)
METHODS=("builtin" "gnu-parallel" "xargs")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print header
print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}ordr.fm Parallel Processing Benchmark${NC}"
    echo -e "${BLUE}================================${NC}"
    echo
}

# Check if test directory exists
check_test_directory() {
    if [[ ! -d "$BENCHMARK_SOURCE" ]]; then
        echo -e "${RED}Error: Test directory not found: $BENCHMARK_SOURCE${NC}"
        echo "Please provide a directory containing test albums as the first argument"
        exit 1
    fi
    
    # Count albums
    local album_count=0
    while IFS= read -r dir; do
        if directory_has_audio_files "$dir"; then
            ((album_count++))
        fi
    done < <(find "$BENCHMARK_SOURCE" -type d)
    
    if [[ $album_count -eq 0 ]]; then
        echo -e "${RED}Error: No albums found in test directory${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}Found $album_count albums in test directory${NC}"
    echo
    
    return $album_count
}

# Run single benchmark
run_benchmark() {
    local method="$1"
    local workers="$2"
    local album_dirs=("${@:3}")
    
    echo -e "${YELLOW}Testing: $method with $workers workers${NC}"
    
    # Clean destination
    rm -rf "$BENCHMARK_DEST"
    mkdir -p "$BENCHMARK_DEST"
    
    # Configure environment
    export DRY_RUN=1
    export DEST_DIR="$BENCHMARK_DEST"
    export LOG_FILE="$BENCHMARK_LOG"
    export VERBOSITY=$LOG_ERROR
    
    # Initialize parallel processing
    init_parallel_processing "$method" "$workers"
    
    # Run benchmark
    local start_time=$(date +%s%N)
    
    if [[ "$method" == "sequential" ]]; then
        # Sequential processing for baseline
        local processed=0
        for album_dir in "${album_dirs[@]}"; do
            process_single_album "$album_dir" >/dev/null 2>&1
            ((processed++))
        done
    else
        # Parallel processing
        process_albums_parallel_dispatcher "${album_dirs[@]}" >/dev/null 2>&1
    fi
    
    local end_time=$(date +%s%N)
    local duration_ms=$(( (end_time - start_time) / 1000000 ))
    local duration_s=$(echo "scale=3; $duration_ms / 1000" | bc)
    local throughput=$(echo "scale=2; ${#album_dirs[@]} / $duration_s" | bc)
    
    echo -e "  Duration: ${GREEN}${duration_s}s${NC}"
    echo -e "  Throughput: ${GREEN}${throughput} albums/sec${NC}"
    echo
    
    # Clean up
    rm -rf "$BENCHMARK_DEST"
    
    # Return duration in milliseconds
    echo "$duration_ms"
}

# Run comparison benchmark
run_comparison() {
    local album_dirs=()
    
    # Find all albums
    while IFS= read -r dir; do
        if directory_has_audio_files "$dir"; then
            album_dirs+=("$dir")
        fi
    done < <(find "$BENCHMARK_SOURCE" -type d)
    
    echo -e "${BLUE}Running benchmarks on ${#album_dirs[@]} albums...${NC}"
    echo
    
    # Results storage
    declare -A results
    
    # Test sequential baseline
    echo -e "${BLUE}Baseline Test${NC}"
    local seq_time=$(run_benchmark "sequential" 1 "${album_dirs[@]}")
    results["sequential,1"]=$seq_time
    
    # Test parallel methods
    echo -e "${BLUE}Parallel Tests${NC}"
    
    for method in "${METHODS[@]}"; do
        # Check if method is available
        local available_methods=($(check_parallel_methods))
        if [[ ! " ${available_methods[@]} " =~ " $method " ]]; then
            echo -e "${YELLOW}Skipping $method (not available)${NC}"
            echo
            continue
        fi
        
        for workers in "${WORKER_COUNTS[@]}"; do
            local time_ms=$(run_benchmark "$method" "$workers" "${album_dirs[@]}")
            results["$method,$workers"]=$time_ms
        done
    done
    
    # Print summary
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}Benchmark Summary${NC}"
    echo -e "${BLUE}================================${NC}"
    echo
    
    # Calculate speedups
    local baseline=${results["sequential,1"]}
    
    printf "%-20s %-15s %-15s %-15s\n" "Method" "Workers" "Time (s)" "Speedup"
    printf "%-20s %-15s %-15s %-15s\n" "------" "-------" "--------" "-------"
    
    # Sequential baseline
    local time_s=$(echo "scale=3; $baseline / 1000" | bc)
    printf "%-20s %-15s %-15s %-15s\n" "sequential" "1" "$time_s" "1.00x"
    
    # Parallel results
    for method in "${METHODS[@]}"; do
        for workers in "${WORKER_COUNTS[@]}"; do
            local key="$method,$workers"
            if [[ -n "${results[$key]:-}" ]]; then
                local time_ms=${results[$key]}
                local time_s=$(echo "scale=3; $time_ms / 1000" | bc)
                local speedup=$(echo "scale=2; $baseline / $time_ms" | bc)
                printf "%-20s %-15s %-15s %-15s\n" "$method" "$workers" "$time_s" "${speedup}x"
            fi
        done
    done
    
    # Find best configuration
    echo
    local best_time=$baseline
    local best_config="sequential,1"
    
    for key in "${!results[@]}"; do
        if [[ ${results[$key]} -lt $best_time ]]; then
            best_time=${results[$key]}
            best_config=$key
        fi
    done
    
    local best_method=$(echo "$best_config" | cut -d, -f1)
    local best_workers=$(echo "$best_config" | cut -d, -f2)
    local best_speedup=$(echo "scale=2; $baseline / $best_time" | bc)
    
    echo -e "${GREEN}Best configuration: $best_method with $best_workers workers (${best_speedup}x speedup)${NC}"
}

# CPU information
show_system_info() {
    echo -e "${BLUE}System Information${NC}"
    echo -e "CPU: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs)"
    echo -e "Cores: $(nproc)"
    echo -e "Memory: $(free -h | grep Mem | awk '{print $2}')"
    echo
}

# Main execution
main() {
    print_header
    show_system_info
    check_test_directory
    run_comparison
    
    # Cleanup
    rm -f "$BENCHMARK_LOG"
    
    echo
    echo -e "${GREEN}Benchmark complete!${NC}"
}

# Run benchmark
main "$@"