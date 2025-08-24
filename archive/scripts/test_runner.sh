#!/bin/bash
# Local test runner for ordr.fm
# Runs the same tests as CI pipeline locally

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test results
PASSED=0
FAILED=0
SKIPPED=0

# Test directory
TEST_DIR="/tmp/ordr_fm_tests_$$"
mkdir -p "$TEST_DIR"

echo -e "${BLUE}ordr.fm Test Runner${NC}"
echo "===================="
echo

# Helper functions
run_test() {
    local test_name="$1"
    local test_command="$2"
    
    echo -ne "Running $test_name... "
    
    if eval "$test_command" > "$TEST_DIR/${test_name}.log" 2>&1; then
        echo -e "${GREEN}PASSED${NC}"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}FAILED${NC}"
        echo "  See: $TEST_DIR/${test_name}.log"
        ((FAILED++))
        return 1
    fi
}

check_dependency() {
    local cmd="$1"
    if ! command -v "$cmd" &> /dev/null; then
        echo -e "${YELLOW}Warning: $cmd not installed (some tests will be skipped)${NC}"
        return 1
    fi
    return 0
}

# Check dependencies
echo -e "${BLUE}Checking dependencies...${NC}"
DEPS_OK=true
for dep in shellcheck exiftool jq bc sqlite3; do
    if ! check_dependency "$dep"; then
        DEPS_OK=false
    fi
done
echo

# 1. Shellcheck tests
if check_dependency "shellcheck"; then
    echo -e "${BLUE}Running shellcheck tests...${NC}"
    
    run_test "shellcheck_main" "shellcheck -x ordr.fm.modular.sh"
    run_test "shellcheck_libs" "find lib -name '*.sh' -type f -exec shellcheck -x {} +"
    
    echo
fi

# 2. Unit tests for modules
echo -e "${BLUE}Running module tests...${NC}"

# Test common module
run_test "module_common" "bash -c '
    source lib/common.sh
    
    # Test logging
    log \$LOG_INFO \"Test message\" >/dev/null
    
    # Test sanitization
    result=\$(sanitize_filename \"Test/File:Name*.mp3\")
    [[ \"\$result\" == \"Test_File_Name_.mp3\" ]] || exit 1
    
    # Test SQL escaping
    result=\$(sql_escape \"It'\''s a test\")
    [[ \"\$result\" == \"It'\'''\''s a test\" ]] || exit 1
'"

# Test fileops module
run_test "module_fileops" "bash -c '
    source lib/common.sh
    source lib/fileops.sh
    
    # Test directory operations
    TEST_DIR=\$(mktemp -d)
    
    # Test empty directory
    directory_has_audio_files \"\$TEST_DIR\" && exit 1
    
    # Add audio file and test again
    touch \"\$TEST_DIR/test.mp3\"
    directory_has_audio_files \"\$TEST_DIR\" || exit 1
    
    rm -rf \"\$TEST_DIR\"
'"

# Test database module
run_test "module_database" "bash -c '
    source lib/common.sh
    source lib/database.sh
    
    # Test database initialization
    export STATE_DB=\"$TEST_DIR/test_state.db\"
    export METADATA_DB=\"$TEST_DIR/test_metadata.db\"
    
    init_databases
    
    # Verify tables exist
    sqlite3 \"\$STATE_DB\" \"SELECT name FROM sqlite_master WHERE type='\''table'\'';\" | grep -q processed_directories || exit 1
    sqlite3 \"\$METADATA_DB\" \"SELECT name FROM sqlite_master WHERE type='\''table'\'';\" | grep -q albums || exit 1
'"

echo

# 3. Integration tests
echo -e "${BLUE}Running integration tests...${NC}"

# Create test music structure
TEST_MUSIC="$TEST_DIR/music"
mkdir -p "$TEST_MUSIC"/{album1,album2,album3}
touch "$TEST_MUSIC"/album1/{01_track.mp3,02_track.mp3,cover.jpg}
touch "$TEST_MUSIC"/album2/{01_song.flac,02_song.flac,album.nfo}
touch "$TEST_MUSIC"/album3/{01_mix.mp3,02_mix.flac}

# Test dry run
run_test "integration_dry_run" "./ordr.fm.modular.sh --source '$TEST_MUSIC' --destination '$TEST_DIR/output' --dry-run --quiet"

# Test with organization
run_test "integration_organization" "./ordr.fm.modular.sh --source '$TEST_MUSIC' --destination '$TEST_DIR/output2' --enable-electronic --dry-run --quiet"

# Test parallel processing
run_test "integration_parallel" "./ordr.fm.modular.sh --source '$TEST_MUSIC' --destination '$TEST_DIR/output3' --parallel 2 --dry-run --quiet"

echo

# 4. Performance tests
echo -e "${BLUE}Running performance tests...${NC}"

# Create larger test set
PERF_TEST="$TEST_DIR/perf_test"
mkdir -p "$PERF_TEST"
for i in {1..20}; do
    mkdir -p "$PERF_TEST/album_$i"
    for j in {1..5}; do
        touch "$PERF_TEST/album_$i/track_$j.mp3"
    done
done

# Sequential baseline
START_TIME=$(date +%s%N)
./ordr.fm.modular.sh --source "$PERF_TEST" --destination "$TEST_DIR/perf_seq" --dry-run --quiet
END_TIME=$(date +%s%N)
SEQ_TIME=$(( (END_TIME - START_TIME) / 1000000 ))

# Parallel test
START_TIME=$(date +%s%N)
./ordr.fm.modular.sh --source "$PERF_TEST" --destination "$TEST_DIR/perf_par" --parallel --dry-run --quiet
END_TIME=$(date +%s%N)
PAR_TIME=$(( (END_TIME - START_TIME) / 1000000 ))

if [[ $PAR_TIME -lt $SEQ_TIME ]]; then
    echo -e "Performance: ${GREEN}PASSED${NC} (Parallel ${PAR_TIME}ms < Sequential ${SEQ_TIME}ms)"
    ((PASSED++))
else
    echo -e "Performance: ${YELLOW}WARNING${NC} (Parallel not faster: ${PAR_TIME}ms vs ${SEQ_TIME}ms)"
fi

echo

# 5. Security tests
echo -e "${BLUE}Running security tests...${NC}"

# Check for hardcoded secrets
if grep -r "password\|secret\|key\|token" --include="*.sh" . | grep -v "^#" | grep "=" > "$TEST_DIR/secrets_check.log" 2>&1; then
    echo -e "Security check: ${RED}FAILED${NC} (potential secrets found)"
    echo "  See: $TEST_DIR/secrets_check.log"
    ((FAILED++))
else
    echo -e "Security check: ${GREEN}PASSED${NC}"
    ((PASSED++))
fi

# Check for SQL injection vulnerabilities
if grep -r "sqlite3.*\"\$" --include="*.sh" lib/ | grep -v "sql_escape" > "$TEST_DIR/sql_injection.log" 2>&1; then
    echo -e "SQL injection check: ${YELLOW}WARNING${NC} (unescaped variables in SQL)"
    echo "  See: $TEST_DIR/sql_injection.log"
else
    echo -e "SQL injection check: ${GREEN}PASSED${NC}"
    ((PASSED++))
fi

echo

# 6. Documentation tests
echo -e "${BLUE}Running documentation tests...${NC}"

# Check required files exist
DOCS_OK=true
for doc in README.md SPECIFICATIONS.md CLAUDE.md; do
    if [[ -f "$doc" ]]; then
        echo -e "  $doc: ${GREEN}EXISTS${NC}"
    else
        echo -e "  $doc: ${RED}MISSING${NC}"
        DOCS_OK=false
        ((FAILED++))
    fi
done

if $DOCS_OK; then
    ((PASSED++))
fi

echo

# Summary
echo -e "${BLUE}Test Summary${NC}"
echo "============"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo -e "Skipped: ${YELLOW}$SKIPPED${NC}"
echo

if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}All tests passed!${NC}"
    
    # Clean up on success
    if [[ "${KEEP_LOGS:-0}" != "1" ]]; then
        rm -rf "$TEST_DIR"
    else
        echo "Test logs kept in: $TEST_DIR"
    fi
    
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    echo "Test logs available in: $TEST_DIR"
    exit 1
fi