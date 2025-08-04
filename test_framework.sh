#!/bin/bash

# ordr.fm Testing Framework
# Non-destructive testing with persistent database and comprehensive logging

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$SCRIPT_DIR/test_runs"
DB_DIR="$TEST_DIR/databases"
LOG_DIR="$TEST_DIR/logs"
METRICS_DIR="$TEST_DIR/metrics"
SAMPLE_DIR="$TEST_DIR/sample_copies"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Test configuration
declare -a TEST_PATHS=(
    "/home/plex/Music/!Incoming"
    "/home/plex/Music/Artists"
    "/home/pi/Music"
)

# Create test directories
mkdir -p "$DB_DIR" "$LOG_DIR" "$METRICS_DIR" "$SAMPLE_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

# Function to run a test with specific configuration
run_test() {
    local test_name="$1"
    local source_path="$2"
    local extra_args="${3:-}"
    
    local test_id="${test_name}_${TIMESTAMP}"
    local log_file="$LOG_DIR/${test_id}.log"
    local metrics_file="$METRICS_DIR/${test_id}.json"
    local state_db="$DB_DIR/${test_id}_state.db"
    local metadata_db="$DB_DIR/${test_id}_metadata.db"
    
    log_test "Running test: $test_name"
    log_info "Source: $source_path"
    log_info "Log: $log_file"
    log_info "State DB: $state_db"
    log_info "Metadata DB: $metadata_db"
    
    # Run ordr.fm in dry-run mode with full logging
    "$SCRIPT_DIR/ordr.fm.sh" \
        --source "$source_path" \
        --destination "$TEST_DIR/simulated_destination" \
        --log-file "$log_file" \
        --state-db "$state_db" \
        --metadata-db "$metadata_db" \
        --verbose \
        --incremental \
        --discogs \
        --enable-electronic \
        --group-aliases \
        --alias-groups "Uwe Schmidt,Atom TM,Atom Heart,Senor Coconut,Atomu Shinzo,Atom™|Aphex Twin,AFX,Polygon Window|Four Tet,Kieran Hebden" \
        $extra_args 2>&1 | tee "${log_file}.console"
    
    # Extract metrics from log
    extract_metrics "$log_file" "$metrics_file"
    
    # Analyze for anomalies
    analyze_anomalies "$log_file" "$test_name"
    
    # Verify database integrity
    verify_database "$metadata_db" "$test_name"
    
    log_info "Test $test_name completed"
    echo ""
}

# Extract metrics from log file
extract_metrics() {
    local log_file="$1"
    local metrics_file="$2"
    
    log_info "Extracting metrics..."
    
    # Count various events in the log
    local total_albums=$(grep -c "Processing album directory:" "$log_file" 2>/dev/null || echo 0)
    local skipped=$(grep -c "SKIP:" "$log_file" 2>/dev/null || echo 0)
    local errors=$(grep -c "ERROR:" "$log_file" 2>/dev/null || echo 0)
    local warnings=$(grep -c "WARNING:" "$log_file" 2>/dev/null || echo 0)
    local unsorted=$(grep -c "move_to_unsorted" "$log_file" 2>/dev/null || echo 0)
    local discogs_hits=$(grep -c "Discogs match found" "$log_file" 2>/dev/null || echo 0)
    local alias_resolved=$(grep -c "Resolved alias" "$log_file" 2>/dev/null || echo 0)
    local label_org=$(grep -c "organization_mode.*label" "$log_file" 2>/dev/null || echo 0)
    local artist_org=$(grep -c "organization_mode.*artist" "$log_file" 2>/dev/null || echo 0)
    local compilation_detected=$(grep -c "Detected compilation" "$log_file" 2>/dev/null || echo 0)
    local remix_detected=$(grep -c "Detected remix" "$log_file" 2>/dev/null || echo 0)
    
    # Quality distribution
    local lossless=$(grep -c "Quality: Lossless" "$log_file" 2>/dev/null || echo 0)
    local lossy=$(grep -c "Quality: Lossy" "$log_file" 2>/dev/null || echo 0)
    local mixed=$(grep -c "Quality: Mixed" "$log_file" 2>/dev/null || echo 0)
    
    # Create JSON metrics file
    cat > "$metrics_file" <<EOF
{
    "timestamp": "$(date -Iseconds)",
    "log_file": "$log_file",
    "statistics": {
        "total_albums": $total_albums,
        "skipped": $skipped,
        "errors": $errors,
        "warnings": $warnings,
        "unsorted": $unsorted,
        "processed": $((total_albums - skipped))
    },
    "discogs": {
        "matches": $discogs_hits,
        "hit_rate": $(echo "scale=2; $discogs_hits * 100 / ($total_albums + 1)" | bc)
    },
    "organization": {
        "label": $label_org,
        "artist": $artist_org,
        "compilation": $compilation_detected,
        "remix": $remix_detected,
        "alias_resolved": $alias_resolved
    },
    "quality": {
        "lossless": $lossless,
        "lossy": $lossy,
        "mixed": $mixed
    }
}
EOF
    
    log_info "Metrics saved to $metrics_file"
    
    # Display summary
    echo -e "${GREEN}=== Metrics Summary ===${NC}"
    echo "Total Albums: $total_albums"
    echo "Processed: $((total_albums - skipped))"
    echo "Skipped: $skipped"
    echo "Errors: $errors"
    echo "Warnings: $warnings"
    echo "Discogs Hit Rate: $(echo "scale=1; $discogs_hits * 100 / ($total_albums + 1)" | bc)%"
    echo ""
}

# Analyze log for anomalies
analyze_anomalies() {
    local log_file="$1"
    local test_name="$2"
    local anomaly_file="$LOG_DIR/${test_name}_anomalies.txt"
    
    log_info "Analyzing for anomalies..."
    
    echo "=== Anomaly Report for $test_name ===" > "$anomaly_file"
    echo "Generated: $(date)" >> "$anomaly_file"
    echo "" >> "$anomaly_file"
    
    # Check for various anomalies
    
    # 1. Albums with missing metadata
    echo "### Albums with Missing Metadata ###" >> "$anomaly_file"
    grep -B2 -A2 "Missing required metadata" "$log_file" 2>/dev/null >> "$anomaly_file" || echo "None found" >> "$anomaly_file"
    echo "" >> "$anomaly_file"
    
    # 2. Duplicate albums
    echo "### Potential Duplicates ###" >> "$anomaly_file"
    grep -i "duplicate" "$log_file" 2>/dev/null >> "$anomaly_file" || echo "None found" >> "$anomaly_file"
    echo "" >> "$anomaly_file"
    
    # 3. Very long paths (>200 chars)
    echo "### Excessively Long Paths ###" >> "$anomaly_file"
    grep -E "Would organize to: .{200,}" "$log_file" 2>/dev/null >> "$anomaly_file" || echo "None found" >> "$anomaly_file"
    echo "" >> "$anomaly_file"
    
    # 4. Special characters in paths
    echo "### Paths with Special Characters ###" >> "$anomaly_file"
    grep -E "Would organize to:.*[<>:\"|?*]" "$log_file" 2>/dev/null >> "$anomaly_file" || echo "None found" >> "$anomaly_file"
    echo "" >> "$anomaly_file"
    
    # 5. Failed Discogs lookups
    echo "### Failed Discogs Lookups ###" >> "$anomaly_file"
    grep "Discogs search failed\|No Discogs match" "$log_file" 2>/dev/null | head -20 >> "$anomaly_file" || echo "None found" >> "$anomaly_file"
    echo "" >> "$anomaly_file"
    
    # 6. Inconsistent album metadata
    echo "### Inconsistent Album Metadata ###" >> "$anomaly_file"
    grep -E "Different album titles found|Multiple years found" "$log_file" 2>/dev/null >> "$anomaly_file" || echo "None found" >> "$anomaly_file"
    echo "" >> "$anomaly_file"
    
    # 7. Empty directories
    echo "### Empty Directories ###" >> "$anomaly_file"
    grep "No audio files found" "$log_file" 2>/dev/null >> "$anomaly_file" || echo "None found" >> "$anomaly_file"
    echo "" >> "$anomaly_file"
    
    # Count anomalies
    local anomaly_count=$(grep -c "###" "$anomaly_file")
    
    if [ -s "$anomaly_file" ]; then
        log_warning "Found anomalies - see $anomaly_file"
        
        # Show summary
        echo -e "${YELLOW}=== Anomaly Summary ===${NC}"
        grep "###" "$anomaly_file" | while read -r line; do
            section=$(echo "$line" | sed 's/### //g' | sed 's/ ###//g')
            count=$(sed -n "/$line/,/^###/p" "$anomaly_file" | grep -v "###\|None found" | wc -l)
            if [ "$count" -gt 0 ]; then
                echo "  - $section: $count issues"
            fi
        done
        echo ""
    else
        log_info "No anomalies detected"
    fi
}

# Verify database integrity and completeness
verify_database() {
    local db_file="$1"
    local test_name="$2"
    
    log_info "Verifying database integrity..."
    
    if [ ! -f "$db_file" ]; then
        log_error "Database file not found: $db_file"
        return 1
    fi
    
    # Run integrity checks
    local integrity_report="$METRICS_DIR/${test_name}_db_integrity.txt"
    
    sqlite3 "$db_file" <<EOF > "$integrity_report" 2>&1
.headers on
.mode column

-- Check database integrity
PRAGMA integrity_check;

-- Album statistics
SELECT 'Total Albums' as metric, COUNT(*) as count FROM albums;
SELECT 'Albums with Artist' as metric, COUNT(*) as count FROM albums WHERE album_artist IS NOT NULL;
SELECT 'Albums with Label' as metric, COUNT(*) as count FROM albums WHERE label IS NOT NULL;
SELECT 'Albums with Year' as metric, COUNT(*) as count FROM albums WHERE year IS NOT NULL;

-- Quality distribution
SELECT quality, COUNT(*) as count FROM albums GROUP BY quality;

-- Organization mode distribution
SELECT organization_mode, COUNT(*) as count FROM albums GROUP BY organization_mode;

-- Check for orphaned tracks
SELECT 'Orphaned Tracks' as metric, COUNT(*) as count 
FROM tracks WHERE album_id NOT IN (SELECT id FROM albums);

-- Check for albums without tracks
SELECT 'Albums without Tracks' as metric, COUNT(*) as count 
FROM albums WHERE id NOT IN (SELECT DISTINCT album_id FROM tracks);

-- Artist alias statistics
SELECT 'Total Aliases' as metric, COUNT(*) as count FROM artist_aliases;
SELECT 'Unique Primary Artists' as metric, COUNT(DISTINCT primary_artist) as count FROM artist_aliases;

-- Label statistics
SELECT 'Total Labels' as metric, COUNT(*) as count FROM labels;

-- Top 10 artists by release count
SELECT 'Top Artists:' as info;
SELECT album_artist, COUNT(*) as releases 
FROM albums 
WHERE album_artist IS NOT NULL 
GROUP BY album_artist 
ORDER BY releases DESC 
LIMIT 10;

-- Top 10 labels
SELECT 'Top Labels:' as info;
SELECT label, COUNT(*) as releases 
FROM albums 
WHERE label IS NOT NULL 
GROUP BY label 
ORDER BY releases DESC 
LIMIT 10;
EOF
    
    log_info "Database integrity report saved to $integrity_report"
    
    # Display key stats
    echo -e "${GREEN}=== Database Summary ===${NC}"
    sqlite3 "$db_file" <<EOF
SELECT 'Total Albums: ' || COUNT(*) FROM albums;
SELECT 'Total Tracks: ' || COUNT(*) FROM tracks;
SELECT 'Total Artists: ' || COUNT(DISTINCT album_artist) FROM albums WHERE album_artist IS NOT NULL;
SELECT 'Total Labels: ' || COUNT(DISTINCT label) FROM albums WHERE label IS NOT NULL;
EOF
    echo ""
}

# Copy sample files for actual move testing
copy_sample_files() {
    local source_dir="$1"
    local sample_count="${2:-10}"
    
    log_info "Copying $sample_count sample albums for move testing..."
    
    local sample_dest="$SAMPLE_DIR/test_${TIMESTAMP}"
    mkdir -p "$sample_dest"
    
    # Find and copy sample albums
    find "$source_dir" -type d -name "*.mp3" -o -name "*.flac" 2>/dev/null | \
        head -n "$sample_count" | \
        while read -r file; do
            album_dir=$(dirname "$file")
            album_name=$(basename "$album_dir")
            
            if [ ! -d "$sample_dest/$album_name" ]; then
                log_info "Copying $album_name..."
                cp -r "$album_dir" "$sample_dest/" 2>/dev/null || true
            fi
        done
    
    log_info "Sample files copied to $sample_dest"
    echo "$sample_dest"
}

# Generate HTML report
generate_html_report() {
    local report_file="$TEST_DIR/test_report_${TIMESTAMP}.html"
    
    log_info "Generating HTML report..."
    
    cat > "$report_file" <<'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>ordr.fm Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        h1 { color: #333; }
        .test-run { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .metric { background: #f9f9f9; padding: 15px; border-radius: 4px; }
        .metric-value { font-size: 24px; font-weight: bold; color: #4CAF50; }
        .metric-label { color: #666; font-size: 12px; }
        .warning { color: #ff9800; }
        .error { color: #f44336; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f0f0f0; }
    </style>
</head>
<body>
    <h1>ordr.fm Test Report - TIMESTAMP_PLACEHOLDER</h1>
EOF
    
    # Add test results
    for metrics_file in "$METRICS_DIR"/*.json; do
        if [ -f "$metrics_file" ]; then
            test_name=$(basename "$metrics_file" .json)
            
            # Parse JSON metrics
            total_albums=$(jq -r '.statistics.total_albums' "$metrics_file")
            errors=$(jq -r '.statistics.errors' "$metrics_file")
            warnings=$(jq -r '.statistics.warnings' "$metrics_file")
            discogs_rate=$(jq -r '.discogs.hit_rate' "$metrics_file")
            
            cat >> "$report_file" <<EOF
    <div class="test-run">
        <h2>Test: $test_name</h2>
        <div class="metrics">
            <div class="metric">
                <div class="metric-value">$total_albums</div>
                <div class="metric-label">Total Albums</div>
            </div>
            <div class="metric">
                <div class="metric-value class="error">$errors</div>
                <div class="metric-label">Errors</div>
            </div>
            <div class="metric">
                <div class="metric-value" class="warning">$warnings</div>
                <div class="metric-label">Warnings</div>
            </div>
            <div class="metric">
                <div class="metric-value">${discogs_rate}%</div>
                <div class="metric-label">Discogs Hit Rate</div>
            </div>
        </div>
    </div>
EOF
        fi
    done
    
    echo "</body></html>" >> "$report_file"
    
    # Update timestamp
    sed -i "s/TIMESTAMP_PLACEHOLDER/$TIMESTAMP/g" "$report_file"
    
    log_info "HTML report saved to $report_file"
}

# Main test execution
main() {
    echo -e "${BLUE}=== ordr.fm Testing Framework ===${NC}"
    echo "Test ID: $TIMESTAMP"
    echo "Test Directory: $TEST_DIR"
    echo ""
    
    # Test 1: Small subset - Incoming directory
    if [ -d "/home/plex/Music/!Incoming" ]; then
        run_test "incoming_subset" "/home/plex/Music/!Incoming" ""
    fi
    
    # Test 2: Artist directory with potential aliases
    if [ -d "/home/plex/Music/Artists" ]; then
        # Focus on specific artists if they exist
        for artist_dir in "/home/plex/Music/Artists/Atom"* "/home/plex/Music/Artists/Uwe"*; do
            if [ -d "$artist_dir" ]; then
                artist_name=$(basename "$artist_dir")
                run_test "artist_${artist_name// /_}" "$artist_dir" ""
            fi
        done
    fi
    
    # Test 3: Sample copy with actual moves (small subset)
    if [ -d "/home/plex/Music/!Incoming" ]; then
        sample_path=$(copy_sample_files "/home/plex/Music/!Incoming" 5)
        if [ -n "$sample_path" ]; then
            run_test "sample_with_moves" "$sample_path" "--move"
        fi
    fi
    
    # Test 4: Full directory scan (dry-run only)
    if [ -d "/home/pi/Music" ] && [ "$(find /home/pi/Music -type f -name "*.mp3" -o -name "*.flac" 2>/dev/null | wc -l)" -gt 0 ]; then
        run_test "pi_music_full" "/home/pi/Music" ""
    fi
    
    # Generate reports
    generate_html_report
    
    # Summary
    echo -e "${GREEN}=== Test Summary ===${NC}"
    echo "Test runs completed: $(ls -1 "$LOG_DIR"/*.log 2>/dev/null | wc -l)"
    echo "Databases created: $(ls -1 "$DB_DIR"/*.db 2>/dev/null | wc -l)"
    echo "Metrics files: $(ls -1 "$METRICS_DIR"/*.json 2>/dev/null | wc -l)"
    
    # Check for critical issues
    total_errors=$(grep -h "ERROR:" "$LOG_DIR"/*.log 2>/dev/null | wc -l || echo 0)
    if [ "$total_errors" -gt 0 ]; then
        log_warning "Total errors across all tests: $total_errors"
        echo "Most common errors:"
        grep -h "ERROR:" "$LOG_DIR"/*.log 2>/dev/null | sort | uniq -c | sort -rn | head -5
    fi
    
    echo ""
    echo "Test results saved to: $TEST_DIR"
    echo "View detailed logs in: $LOG_DIR"
    echo "Database files in: $DB_DIR"
    echo "Metrics in: $METRICS_DIR"
}

# Run main function
main "$@"