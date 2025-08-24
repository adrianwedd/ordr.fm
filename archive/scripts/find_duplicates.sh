#!/bin/bash
# Advanced Duplicate Detection Script for ordr.fm
# Provides a simple interface for comprehensive duplicate detection

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_SCRIPT="$SCRIPT_DIR/ordr.fm.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

show_banner() {
    echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║       🎵 Advanced Duplicate         ║${NC}"
    echo -e "${BLUE}║          Detection Engine           ║${NC}"  
    echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
    echo
}

show_help() {
    show_banner
    echo "Usage: $(basename "$0") [COMMAND] [OPTIONS]"
    echo
    echo -e "${YELLOW}Commands:${NC}"
    echo "  scan     Scan collection and generate fingerprints"
    echo "  detect   Find duplicate groups from fingerprints" 
    echo "  report   Generate detailed duplicate analysis report"
    echo "  cleanup  Clean up duplicates (dry-run by default)"
    echo "  full     Run complete workflow: scan → detect → report"
    echo
    echo -e "${YELLOW}Options:${NC}"
    echo "  -s, --source DIR        Source directory to scan (default: from config)"
    echo "  --duplicates-db FILE    Database file for duplicates (default: auto)"
    echo "  --threshold N           Similarity threshold 0.0-1.0 (default: 0.85)"
    echo "  --move                  Enable actual file operations (cleanup only)"
    echo "  --verbose              Enable detailed logging"
    echo
    echo -e "${YELLOW}Examples:${NC}"
    echo "  $(basename "$0") scan -s \"/music/collection\""
    echo "  $(basename "$0") detect --threshold 0.9"
    echo "  $(basename "$0") report"
    echo "  $(basename "$0") cleanup --move  # Actually delete duplicates"
    echo "  $(basename "$0") full -s \"/music\" --verbose"
    echo
    echo -e "${GREEN}Safe Workflow:${NC}"
    echo "  1. Run 'scan' to fingerprint your collection"
    echo "  2. Run 'detect' to find duplicate groups"  
    echo "  3. Run 'report' to review findings"
    echo "  4. Run 'cleanup' to preview deletions"
    echo "  5. Run 'cleanup --move' to actually clean up"
}

run_command() {
    local cmd="$1"
    shift
    local args=("$@")
    
    echo -e "${BLUE}→${NC} Running: ordr.fm.sh $cmd ${args[*]}"
    echo
    
    if ! "$MAIN_SCRIPT" "$cmd" "${args[@]}"; then
        echo -e "${RED}✗ Command failed: $cmd${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✓ Command completed: $cmd${NC}"
    echo
    return 0
}

estimate_time() {
    local source_dir="$1"
    
    if [[ -d "$source_dir" ]]; then
        local album_count
        album_count=$(find "$source_dir" -type d -name "*" | wc -l)
        local estimated_minutes=$((album_count / 100))  # Rough estimate: 100 albums per minute
        
        if [[ $estimated_minutes -lt 1 ]]; then
            echo "Estimated time: < 1 minute"
        elif [[ $estimated_minutes -lt 60 ]]; then
            echo "Estimated time: ~$estimated_minutes minutes"
        else
            local hours=$((estimated_minutes / 60))
            local mins=$((estimated_minutes % 60))
            echo "Estimated time: ~${hours}h ${mins}m"
        fi
        echo "Albums to process: ~$album_count"
        echo
    fi
}

# Parse arguments
COMMAND=""
SOURCE_DIR=""
DUPLICATES_DB=""
THRESHOLD=""
MOVE_FLAG=""
VERBOSE_FLAG=""
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
    case $1 in
        scan|detect|report|cleanup|full)
            COMMAND="$1"
            shift
            ;;
        -s|--source)
            SOURCE_DIR="$2"
            shift 2
            ;;
        --duplicates-db)
            DUPLICATES_DB="$2"
            shift 2
            ;;
        --threshold)
            THRESHOLD="$2"
            shift 2
            ;;
        --move)
            MOVE_FLAG="--move"
            shift
            ;;
        --verbose|-v)
            VERBOSE_FLAG="--verbose"
            shift
            ;;
        -h|--help|help)
            show_help
            exit 0
            ;;
        *)
            EXTRA_ARGS+=("$1")
            shift
            ;;
    esac
done

# Show help if no command
if [[ -z "$COMMAND" ]]; then
    show_help
    exit 1
fi

# Build arguments
ARGS=()
[[ -n "$SOURCE_DIR" ]] && ARGS+=("--source" "$SOURCE_DIR")
[[ -n "$DUPLICATES_DB" ]] && ARGS+=("--duplicates-db" "$DUPLICATES_DB")
[[ -n "$THRESHOLD" ]] && ARGS+=("--duplicate-threshold" "$THRESHOLD")
[[ -n "$MOVE_FLAG" ]] && ARGS+=("$MOVE_FLAG")
[[ -n "$VERBOSE_FLAG" ]] && ARGS+=("$VERBOSE_FLAG")
ARGS+=("${EXTRA_ARGS[@]}")

show_banner

case "$COMMAND" in
    scan)
        echo -e "${YELLOW}🔍 Scanning collection for duplicates...${NC}"
        [[ -n "$SOURCE_DIR" ]] && estimate_time "$SOURCE_DIR"
        run_command "--scan-duplicates" "${ARGS[@]}"
        echo -e "${GREEN}Next step: Run '$(basename "$0") detect' to find duplicate groups${NC}"
        ;;
        
    detect)
        echo -e "${YELLOW}🎯 Detecting duplicate groups...${NC}"
        run_command "--detect-duplicates" "${ARGS[@]}"
        echo -e "${GREEN}Next step: Run '$(basename "$0") report' to see detailed results${NC}"
        ;;
        
    report)
        echo -e "${YELLOW}📊 Generating duplicate analysis report...${NC}"
        run_command "--duplicate-report" "${ARGS[@]}"
        ;;
        
    cleanup)
        if [[ -n "$MOVE_FLAG" ]]; then
            echo -e "${RED}⚠️  WARNING: This will actually delete duplicate files!${NC}"
            echo -e "${YELLOW}🧹 Cleaning up duplicates (LIVE MODE)...${NC}"
        else
            echo -e "${YELLOW}🧹 Preview duplicate cleanup (dry-run)...${NC}"
        fi
        run_command "--cleanup-duplicates" "${ARGS[@]}"
        
        if [[ -z "$MOVE_FLAG" ]]; then
            echo -e "${GREEN}To actually clean up duplicates, add --move flag${NC}"
        fi
        ;;
        
    full)
        echo -e "${YELLOW}🚀 Running complete duplicate detection workflow...${NC}"
        [[ -n "$SOURCE_DIR" ]] && estimate_time "$SOURCE_DIR"
        
        echo -e "${BLUE}Step 1/4: Scanning collection...${NC}"
        run_command "--scan-duplicates" "${ARGS[@]}" || exit 1
        
        echo -e "${BLUE}Step 2/4: Detecting duplicates...${NC}"
        run_command "--detect-duplicates" "${ARGS[@]}" || exit 1
        
        echo -e "${BLUE}Step 3/4: Generating report...${NC}"
        run_command "--duplicate-report" "${ARGS[@]}" || exit 1
        
        echo -e "${BLUE}Step 4/4: Preview cleanup...${NC}"
        # Remove --move flag for safety in full workflow
        SAFE_ARGS=("${ARGS[@]}")
        SAFE_ARGS=("${SAFE_ARGS[@]//--move}")
        run_command "--cleanup-duplicates" "${SAFE_ARGS[@]}"
        
        echo -e "${GREEN}🎉 Complete duplicate analysis finished!${NC}"
        echo -e "${YELLOW}Review the report, then run 'cleanup --move' to actually remove duplicates${NC}"
        ;;
        
    *)
        echo -e "${RED}Unknown command: $COMMAND${NC}"
        echo
        show_help
        exit 1
        ;;
esac
