#!/bin/bash

# Safe Test Runner for ordr.fm
# Ensures backup exists before running any tests

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Test configuration
TEST_LOG="$SCRIPT_DIR/test_runs/safe_test_${TIMESTAMP}.log"
mkdir -p "$(dirname "$TEST_LOG")"

# Safety checks
SAFETY_MARKER="$SCRIPT_DIR/.backup_marker"
BACKUP_REQUIRED=true
FORCE_MODE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --no-backup)
            BACKUP_REQUIRED=false
            shift
            ;;
        --force)
            FORCE_MODE=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# Logging
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1" | tee -a "$TEST_LOG"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$TEST_LOG"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$TEST_LOG"
}

log_test() {
    echo -e "${CYAN}[TEST]${NC} $1" | tee -a "$TEST_LOG"
}

log_safety() {
    echo -e "${BLUE}[SAFETY]${NC} $1" | tee -a "$TEST_LOG"
}

# Check backup status
check_backup_status() {
    log_safety "Checking backup status..."
    
    if [ -f "$SAFETY_MARKER" ]; then
        backup_time=$(grep "BACKUP_COMPLETED:" "$SAFETY_MARKER" | cut -d: -f2-)
        log_info "Last backup: $backup_time"
        
        # Check if backup is recent (within 7 days)
        if [ -n "$backup_time" ]; then
            backup_epoch=$(date -d "$backup_time" +%s 2>/dev/null || date +%s)
            current_epoch=$(date +%s)
            days_old=$(( (current_epoch - backup_epoch) / 86400 ))
            
            if [ $days_old -gt 7 ]; then
                log_warning "Backup is $days_old days old"
                if [ "$BACKUP_REQUIRED" = true ] && [ "$FORCE_MODE" = false ]; then
                    log_error "Backup too old! Run backup first or use --force"
                    return 1
                fi
            else
                log_info "Backup is recent ($days_old days old)"
                return 0
            fi
        fi
    else
        log_warning "No backup marker found"
        if [ "$BACKUP_REQUIRED" = true ] && [ "$FORCE_MODE" = false ]; then
            log_error "No backup found! Run backup_strategy.sh first or use --no-backup"
            return 1
        fi
    fi
    
    return 0
}

# Run comprehensive tests
run_comprehensive_tests() {
    log_test "Starting comprehensive dry-run tests"
    
    # Test paths prioritized by interest
    declare -a TEST_CONFIGS=(
        # Format: "name|path|extra_args"
        "atom_collection|/home/plex/Music/Artists/Atom*|--group-aliases --alias-groups 'Uwe Schmidt,Atom TM,Atom Heart,Atomu Shinzo,Atom™'"
        "incoming_electronic|/home/plex/Music/!Incoming|--enable-electronic --discogs"
        "artists_subset|/home/plex/Music/Artists|--enable-electronic --organization-mode hybrid"
        "pi_music|/home/pi/Music|--verbose"
    )
    
    local test_count=0
    local error_count=0
    local warning_count=0
    local anomaly_count=0
    
    for config in "${TEST_CONFIGS[@]}"; do
        IFS='|' read -r test_name test_path extra_args <<< "$config"
        
        # Check if path exists and has music files
        if [ -d "$test_path" ] || [[ "$test_path" == *"*"* ]]; then
            # Handle glob patterns
            for actual_path in $test_path; do
                if [ -d "$actual_path" ]; then
                    test_count=$((test_count + 1))
                    
                    log_test "Test $test_count: $test_name"
                    log_info "Path: $actual_path"
                    
                    # Create test-specific files
                    local test_id="${test_name}_${TIMESTAMP}"
                    local test_log="$SCRIPT_DIR/test_runs/logs/${test_id}.log"
                    local test_db="$SCRIPT_DIR/test_runs/databases/${test_id}.db"
                    local metrics_file="$SCRIPT_DIR/test_runs/metrics/${test_id}.json"
                    
                    mkdir -p "$(dirname "$test_log")" "$(dirname "$test_db")" "$(dirname "$metrics_file")"
                    
                    # Run the test
                    log_info "Running ordr.fm in dry-run mode..."
                    
                    if $SCRIPT_DIR/ordr.fm.sh \
                        --source "$actual_path" \
                        --destination "$SCRIPT_DIR/test_runs/simulated_dest" \
                        --log-file "$test_log" \
                        --metadata-db "$test_db" \
                        --verbose \
                        $extra_args 2>&1 | tee -a "$TEST_LOG"; then
                        
                        log_info "Test completed successfully"
                    else
                        log_error "Test failed with error code $?"
                        error_count=$((error_count + 1))
                    fi
                    
                    # Analyze results
                    log_info "Analyzing test results..."
                    
                    # Count issues
                    local test_errors=$(grep -c "ERROR:" "$test_log" 2>/dev/null || echo 0)
                    local test_warnings=$(grep -c "WARNING:" "$test_log" 2>/dev/null || echo 0)
                    local test_anomalies=$(grep -c "move_to_unsorted\|Missing metadata\|duplicate" "$test_log" 2>/dev/null || echo 0)
                    
                    error_count=$((error_count + test_errors))
                    warning_count=$((warning_count + test_warnings))
                    anomaly_count=$((anomaly_count + test_anomalies))
                    
                    # Extract key metrics
                    local albums_processed=$(grep -c "Processing album directory:" "$test_log" 2>/dev/null || echo 0)
                    local discogs_matches=$(grep -c "Discogs match found" "$test_log" 2>/dev/null || echo 0)
                    local aliases_resolved=$(grep -c "Resolved alias" "$test_log" 2>/dev/null || echo 0)
                    
                    # Save metrics
                    cat > "$metrics_file" <<EOF
{
    "test_name": "$test_name",
    "timestamp": "$(date -Iseconds)",
    "path": "$actual_path",
    "albums_processed": $albums_processed,
    "errors": $test_errors,
    "warnings": $test_warnings,
    "anomalies": $test_anomalies,
    "discogs_matches": $discogs_matches,
    "aliases_resolved": $aliases_resolved
}
EOF
                    
                    # Show summary
                    echo -e "${CYAN}--- Test Summary: $test_name ---${NC}"
                    echo "Albums processed: $albums_processed"
                    echo "Errors: $test_errors"
                    echo "Warnings: $test_warnings"
                    echo "Anomalies: $test_anomalies"
                    echo "Discogs matches: $discogs_matches"
                    echo "Aliases resolved: $aliases_resolved"
                    echo ""
                    
                    # Check database
                    if [ -f "$test_db" ]; then
                        log_info "Verifying database integrity..."
                        sqlite3 "$test_db" "PRAGMA integrity_check;" > /dev/null 2>&1 || log_error "Database integrity check failed!"
                        
                        local db_albums=$(sqlite3 "$test_db" "SELECT COUNT(*) FROM albums;" 2>/dev/null || echo 0)
                        local db_tracks=$(sqlite3 "$test_db" "SELECT COUNT(*) FROM tracks;" 2>/dev/null || echo 0)
                        
                        log_info "Database contains: $db_albums albums, $db_tracks tracks"
                    fi
                    
                    # Extract anomalies for review
                    if [ $test_anomalies -gt 0 ]; then
                        log_warning "Anomalies detected - extracting for review..."
                        grep -E "move_to_unsorted|Missing metadata|duplicate|ERROR:" "$test_log" | head -20 > "$SCRIPT_DIR/test_runs/anomalies/${test_id}.txt"
                    fi
                fi
            done
        else
            log_warning "Path not found: $test_path"
        fi
    done
    
    # Final summary
    echo ""
    echo -e "${GREEN}=== FINAL TEST SUMMARY ===${NC}"
    echo "Tests run: $test_count"
    echo "Total errors: $error_count"
    echo "Total warnings: $warning_count"
    echo "Total anomalies: $anomaly_count"
    echo ""
    
    if [ $error_count -gt 0 ]; then
        log_error "Tests completed with errors - review logs before proceeding!"
        return 1
    elif [ $anomaly_count -gt 10 ]; then
        log_warning "High number of anomalies detected - review before production use"
        return 2
    else
        log_info "All tests completed successfully!"
        return 0
    fi
}

# Generate test report
generate_report() {
    local report_file="$SCRIPT_DIR/test_runs/reports/report_${TIMESTAMP}.md"
    mkdir -p "$(dirname "$report_file")"
    
    log_info "Generating test report..."
    
    cat > "$report_file" <<'EOF'
# ordr.fm Test Report

**Generated:** TIMESTAMP_PLACEHOLDER
**Test Mode:** Dry-run (Non-destructive)

## Safety Status
SAFETY_PLACEHOLDER

## Test Summary
SUMMARY_PLACEHOLDER

## Detailed Results

EOF
    
    # Add safety status
    if [ -f "$SAFETY_MARKER" ]; then
        sed -i "s/SAFETY_PLACEHOLDER/✅ Backup verified/g" "$report_file"
    else
        sed -i "s/SAFETY_PLACEHOLDER/⚠️ No backup verification/g" "$report_file"
    fi
    
    # Add timestamp
    sed -i "s/TIMESTAMP_PLACEHOLDER/$(date -Iseconds)/g" "$report_file"
    
    # Add test results
    for metrics_file in "$SCRIPT_DIR/test_runs/metrics"/*.json; do
        if [ -f "$metrics_file" ]; then
            test_name=$(jq -r '.test_name' "$metrics_file")
            albums=$(jq -r '.albums_processed' "$metrics_file")
            errors=$(jq -r '.errors' "$metrics_file")
            
            cat >> "$report_file" <<EOF

### Test: $test_name
- Albums Processed: $albums
- Errors: $errors
- Status: $([ "$errors" -eq 0 ] && echo "✅ PASS" || echo "❌ FAIL")

EOF
        fi
    done
    
    # Add recommendations
    cat >> "$report_file" <<'EOF'

## Recommendations

1. Review all anomalies before enabling --move flag
2. Ensure Discogs API token is configured for better metadata
3. Test artist alias groups with your specific collection
4. Verify organization modes produce expected structure

## Next Steps

- [ ] Review anomaly files in test_runs/anomalies/
- [ ] Check database integrity in test_runs/databases/
- [ ] Verify organization patterns match expectations
- [ ] Run visualization dashboard to inspect data
- [ ] Perform small-scale move test with copies

EOF
    
    log_info "Report saved to: $report_file"
    
    # Also create a CSV for metrics
    local csv_file="$SCRIPT_DIR/test_runs/reports/metrics_${TIMESTAMP}.csv"
    echo "test_name,timestamp,path,albums,errors,warnings,anomalies,discogs_matches,aliases_resolved" > "$csv_file"
    
    for metrics_file in "$SCRIPT_DIR/test_runs/metrics"/*.json; do
        if [ -f "$metrics_file" ]; then
            jq -r '[.test_name, .timestamp, .path, .albums_processed, .errors, .warnings, .anomalies, .discogs_matches, .aliases_resolved] | @csv' "$metrics_file" >> "$csv_file"
        fi
    done
    
    log_info "Metrics CSV saved to: $csv_file"
}

# Main execution
main() {
    echo -e "${BLUE}=== ordr.fm Safe Test Runner ===${NC}"
    echo "Test ID: $TIMESTAMP"
    echo "Log: $TEST_LOG"
    echo ""
    
    # Step 1: Safety check
    log_safety "Performing safety checks..."
    if ! check_backup_status; then
        echo ""
        echo -e "${RED}SAFETY CHECK FAILED${NC}"
        echo ""
        echo "Options:"
        echo "1. Run ./backup_strategy.sh --quick to create backup"
        echo "2. Use --no-backup flag to skip backup check (NOT RECOMMENDED)"
        echo "3. Use --force flag to override safety checks (DANGEROUS)"
        echo ""
        exit 1
    fi
    
    log_safety "Safety checks passed ✅"
    echo ""
    
    # Step 2: Run comprehensive tests
    if run_comprehensive_tests; then
        log_info "All tests completed successfully"
    else
        log_warning "Tests completed with issues"
    fi
    
    # Step 3: Generate report
    generate_report
    
    # Step 4: Start visualization server for review
    echo ""
    read -p "Start visualization dashboard for review? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "Starting visualization dashboard..."
        cd "$SCRIPT_DIR/visualization"
        
        # Use the latest test database
        latest_db=$(ls -t "$SCRIPT_DIR/test_runs/databases"/*.db 2>/dev/null | head -1)
        if [ -f "$latest_db" ]; then
            export ORDRFM_DB="$latest_db"
            log_info "Using database: $latest_db"
            npm start
        else
            log_warning "No test database found"
        fi
    fi
    
    echo ""
    log_info "Test run complete. Review logs and reports in: $SCRIPT_DIR/test_runs/"
}

# Run main
main