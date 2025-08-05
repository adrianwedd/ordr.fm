#!/bin/bash
# Test script for ordr.fm parallel processing
# Verifies that parallel processing works correctly

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Testing ordr.fm Parallel Processing${NC}"
echo "====================================="
echo

# Test directory setup
TEST_SOURCE="${1:-./test_music}"
TEST_DEST="/tmp/ordr_fm_parallel_test_$$"

# Check if test directory exists
if [[ ! -d "$TEST_SOURCE" ]]; then
    echo -e "${RED}Error: Test directory not found: $TEST_SOURCE${NC}"
    echo "Usage: $0 [source_directory]"
    exit 1
fi

# Count albums
album_count=$(find "$TEST_SOURCE" -type d -exec bash -c '
    for dir; do
        if ls "$dir"/*.{mp3,flac,wav,m4a,ogg,aiff,alac,opus,wma} 2>/dev/null | head -1 >/dev/null; then
            echo "$dir"
        fi
    done
' _ {} + | wc -l)

if [[ $album_count -eq 0 ]]; then
    echo -e "${RED}No albums found in test directory${NC}"
    exit 1
fi

echo -e "${GREEN}Found $album_count albums to process${NC}"
echo

# Test 1: Sequential processing
echo "Test 1: Sequential Processing (baseline)"
echo "----------------------------------------"
start_time=$(date +%s)
./ordr.fm.modular.sh --source "$TEST_SOURCE" --destination "$TEST_DEST" --quiet
end_time=$(date +%s)
seq_duration=$((end_time - start_time))
echo -e "Duration: ${GREEN}${seq_duration}s${NC}"
echo

# Clean up
rm -rf "$TEST_DEST"

# Test 2: Parallel processing with auto-detected workers
echo "Test 2: Parallel Processing (auto workers)"
echo "------------------------------------------"
start_time=$(date +%s)
./ordr.fm.modular.sh --source "$TEST_SOURCE" --destination "$TEST_DEST" --parallel --quiet
end_time=$(date +%s)
par_duration=$((end_time - start_time))
echo -e "Duration: ${GREEN}${par_duration}s${NC}"

# Calculate speedup
if [[ $par_duration -gt 0 ]]; then
    speedup=$(echo "scale=2; $seq_duration / $par_duration" | bc)
    echo -e "Speedup: ${GREEN}${speedup}x${NC}"
fi
echo

# Clean up
rm -rf "$TEST_DEST"

# Test 3: Parallel processing with custom worker count
echo "Test 3: Parallel Processing (4 workers)"
echo "---------------------------------------"
start_time=$(date +%s)
./ordr.fm.modular.sh --source "$TEST_SOURCE" --destination "$TEST_DEST" --parallel 4 --quiet
end_time=$(date +%s)
par4_duration=$((end_time - start_time))
echo -e "Duration: ${GREEN}${par4_duration}s${NC}"

if [[ $par4_duration -gt 0 ]]; then
    speedup=$(echo "scale=2; $seq_duration / $par4_duration" | bc)
    echo -e "Speedup: ${GREEN}${speedup}x${NC}"
fi
echo

# Clean up
rm -rf "$TEST_DEST"

# Test 4: Verify results are identical
echo "Test 4: Verifying Results Consistency"
echo "------------------------------------"

# Run sequential
mkdir -p "${TEST_DEST}_seq"
./ordr.fm.modular.sh --source "$TEST_SOURCE" --destination "${TEST_DEST}_seq" --quiet

# Run parallel
mkdir -p "${TEST_DEST}_par"
./ordr.fm.modular.sh --source "$TEST_SOURCE" --destination "${TEST_DEST}_par" --parallel --quiet

# Compare directory structures
seq_structure=$(cd "${TEST_DEST}_seq" && find . -type d | sort)
par_structure=$(cd "${TEST_DEST}_par" && find . -type d | sort)

if [[ "$seq_structure" == "$par_structure" ]]; then
    echo -e "${GREEN}✓ Directory structures match${NC}"
else
    echo -e "${RED}✗ Directory structures differ${NC}"
    echo "Sequential:"
    echo "$seq_structure" | head -5
    echo "Parallel:"
    echo "$par_structure" | head -5
fi

# Count files
seq_files=$(find "${TEST_DEST}_seq" -type f | wc -l)
par_files=$(find "${TEST_DEST}_par" -type f | wc -l)

if [[ $seq_files -eq $par_files ]]; then
    echo -e "${GREEN}✓ File counts match: $seq_files files${NC}"
else
    echo -e "${RED}✗ File counts differ: sequential=$seq_files, parallel=$par_files${NC}"
fi

# Clean up
rm -rf "${TEST_DEST}_seq" "${TEST_DEST}_par"

echo
echo -e "${GREEN}Parallel processing tests complete!${NC}"
echo
echo "Summary:"
echo "- Sequential: ${seq_duration}s"
echo "- Parallel (auto): ${par_duration}s"
echo "- Parallel (4 workers): ${par4_duration}s"
echo "- Best speedup: $(echo "scale=2; $seq_duration / $par4_duration" | bc)x"