#!/bin/bash
# ordr.fm Interactive Setup Wizard
# Guides users through initial configuration and setup

set -euo pipefail

# Colors for better UX
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Default values
CONFIG_FILE="ordr.fm.conf"
WIZARD_VERSION="1.0"

# ASCII Art Header
show_header() {
    clear
    echo -e "${CYAN}"
    cat << 'EOF'
                   _         __          
  ___  _ __ __| |_ __   / _|_ __ ___  
 / _ \| '__/ _` | '__| | |_| '_ ` _ \ 
| (_) | | | (_| | |    |  _| | | | | |
 \___/|_|  \__,_|_| (_)|_| |_| |_| |_|
                                      
EOF
    echo -e "${NC}"
    echo -e "${BOLD}Interactive Setup Wizard v${WIZARD_VERSION}${NC}"
    echo "====================================="
    echo
}

# Progress indicator
show_step() {
    local step=$1
    local total=$2
    local desc=$3
    echo
    echo -e "${BLUE}Step $step of $total: ${BOLD}$desc${NC}"
    echo "-----------------------------------"
}

# Get user input with default value
get_input() {
    local prompt=$1
    local default=$2
    local var_name=$3
    
    if [[ -n "$default" ]]; then
        echo -ne "${prompt} ${YELLOW}[$default]${NC}: "
    else
        echo -ne "${prompt}: "
    fi
    
    read -r user_input
    
    if [[ -z "$user_input" ]]; then
        eval "$var_name='$default'"
    else
        eval "$var_name='$user_input'"
    fi
}

# Yes/No prompt
ask_yes_no() {
    local prompt=$1
    local default=${2:-"n"}
    local response
    
    if [[ "$default" == "y" ]]; then
        echo -ne "${prompt} ${YELLOW}[Y/n]${NC}: "
    else
        echo -ne "${prompt} ${YELLOW}[y/N]${NC}: "
    fi
    
    read -r response
    response=${response:-$default}
    
    [[ "$response" =~ ^[Yy]$ ]]
}

# Check system dependencies
check_dependencies() {
    show_step 1 7 "Checking System Dependencies"
    
    local missing=()
    local optional_missing=()
    
    # Required dependencies
    for cmd in exiftool jq sqlite3; do
        if command -v "$cmd" &> /dev/null; then
            echo -e "  ✓ $cmd: ${GREEN}Found${NC} ($(command -v $cmd))"
        else
            echo -e "  ✗ $cmd: ${RED}Not found${NC}"
            missing+=("$cmd")
        fi
    done
    
    # Optional dependencies
    echo
    echo "Optional dependencies:"
    for cmd in parallel bc rsync curl; do
        if command -v "$cmd" &> /dev/null; then
            echo -e "  ✓ $cmd: ${GREEN}Found${NC}"
        else
            echo -e "  - $cmd: ${YELLOW}Not found${NC} (some features limited)"
            optional_missing+=("$cmd")
        fi
    done
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        echo
        echo -e "${RED}Error: Required dependencies missing: ${missing[*]}${NC}"
        echo
        echo "Install them with:"
        echo "  Ubuntu/Debian: sudo apt-get install ${missing[*]}"
        echo "  macOS: brew install ${missing[*]}"
        echo
        exit 1
    fi
    
    if [[ ${#optional_missing[@]} -gt 0 ]]; then
        echo
        if ask_yes_no "Would you like to see installation instructions for optional dependencies?"; then
            echo
            echo "Install optional dependencies with:"
            echo "  Ubuntu/Debian: sudo apt-get install ${optional_missing[*]}"
            echo "  macOS: brew install ${optional_missing[*]}"
            echo
            read -p "Press Enter to continue..."
        fi
    fi
}

# Configure directories
configure_directories() {
    show_step 2 7 "Configure Directories"
    
    echo "Where is your music collection?"
    echo
    
    # Source directory
    local default_source="$HOME/Music"
    if [[ -d "/media/music" ]]; then
        default_source="/media/music"
    fi
    
    get_input "Source directory (where your unorganized music is)" "$default_source" "SOURCE_DIR"
    
    # Validate source exists
    if [[ ! -d "$SOURCE_DIR" ]]; then
        echo -e "${YELLOW}Warning: $SOURCE_DIR does not exist${NC}"
        if ask_yes_no "Create it now?"; then
            mkdir -p "$SOURCE_DIR"
            echo -e "${GREEN}Created $SOURCE_DIR${NC}"
        fi
    fi
    
    echo
    
    # Destination directory
    local default_dest="$HOME/Music/Organized"
    get_input "Destination directory (where organized music will go)" "$default_dest" "DEST_DIR"
    
    # Validate destination
    if [[ ! -d "$DEST_DIR" ]]; then
        if ask_yes_no "Destination doesn't exist. Create it?" "y"; then
            mkdir -p "$DEST_DIR"
            echo -e "${GREEN}Created $DEST_DIR${NC}"
        fi
    fi
    
    echo
    
    # Unsorted directory
    local default_unsorted="$HOME/Music/Unsorted"
    get_input "Unsorted directory (for albums that can't be organized)" "$default_unsorted" "UNSORTED_BASE_DIR"
    
    if [[ ! -d "$UNSORTED_BASE_DIR" ]]; then
        mkdir -p "$UNSORTED_BASE_DIR"
        echo -e "${GREEN}Created $UNSORTED_BASE_DIR${NC}"
    fi
}

# Configure features
configure_features() {
    show_step 3 7 "Configure Features"
    
    echo "Let's configure some key features:"
    echo
    
    # Parallel processing
    if command -v parallel &> /dev/null || command -v xargs &> /dev/null; then
        if ask_yes_no "Enable parallel processing for faster organization?" "y"; then
            ENABLE_PARALLEL=1
            
            # Auto-detect CPU cores
            local cores=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
            get_input "Number of parallel jobs (0=auto, detected $cores cores)" "0" "PARALLEL_JOBS"
        else
            ENABLE_PARALLEL=0
        fi
    else
        echo -e "${YELLOW}Parallel processing not available (install GNU parallel)${NC}"
        ENABLE_PARALLEL=0
    fi
    
    echo
    
    # Electronic music features
    if ask_yes_no "Do you have electronic/dance music in your collection?"; then
        ENABLE_ELECTRONIC_ORGANIZATION=1
        
        echo
        echo "Organization mode for electronic music:"
        echo "  1) Artist-based (default)"
        echo "  2) Label-based"
        echo "  3) Hybrid (intelligent routing)"
        echo "  4) Auto-detect"
        echo
        
        get_input "Select mode (1-4)" "3" "mode_choice"
        
        case "$mode_choice" in
            1) ORGANIZATION_MODE="artist" ;;
            2) ORGANIZATION_MODE="label" ;;
            3) ORGANIZATION_MODE="hybrid" ;;
            4) ORGANIZATION_MODE="auto" ;;
            *) ORGANIZATION_MODE="hybrid" ;;
        esac
        
        if ask_yes_no "Separate remix collections?" "n"; then
            SEPARATE_REMIXES=1
        else
            SEPARATE_REMIXES=0
        fi
    else
        ENABLE_ELECTRONIC_ORGANIZATION=0
        ORGANIZATION_MODE="artist"
        SEPARATE_REMIXES=0
    fi
}

# Configure Discogs integration
configure_discogs() {
    show_step 4 7 "Configure Discogs Integration"
    
    echo "Discogs can enrich your music metadata with:"
    echo "  • Accurate artist and album information"
    echo "  • Record label data"
    echo "  • Release years and catalog numbers"
    echo
    
    if ask_yes_no "Enable Discogs integration?"; then
        DISCOGS_ENABLED=1
        
        echo
        echo -e "${YELLOW}You'll need a Discogs API token (free)${NC}"
        echo "Get one at: https://www.discogs.com/settings/developers"
        echo
        
        get_input "Discogs API token (or press Enter to add later)" "" "DISCOGS_TOKEN"
        
        if [[ -z "$DISCOGS_TOKEN" ]]; then
            echo -e "${YELLOW}Note: Add your token to $CONFIG_FILE later${NC}"
        fi
        
        # Advanced Discogs settings
        if ask_yes_no "Configure advanced Discogs settings?" "n"; then
            echo
            get_input "Confidence threshold (0.0-1.0)" "0.7" "DISCOGS_CONFIDENCE_THRESHOLD"
            get_input "Cache expiry in days" "7" "cache_days"
            DISCOGS_CACHE_EXPIRY=$((cache_days * 86400))
        else
            DISCOGS_CONFIDENCE_THRESHOLD="0.7"
            DISCOGS_CACHE_EXPIRY="604800"
        fi
    else
        DISCOGS_ENABLED=0
    fi
}

# Configure safety options
configure_safety() {
    show_step 5 7 "Configure Safety Options"
    
    echo "Safety features protect your music collection:"
    echo
    
    # Dry run default
    if ask_yes_no "Default to dry-run mode? (recommended for safety)" "y"; then
        DRY_RUN=1
        echo -e "${GREEN}✓ Dry-run enabled by default (use --move to actually move files)${NC}"
    else
        DRY_RUN=0
        echo -e "${YELLOW}⚠ Dry-run disabled - files will be moved by default${NC}"
    fi
    
    echo
    
    # Incremental mode
    if ask_yes_no "Enable incremental mode? (skip already processed albums)" "y"; then
        INCREMENTAL=1
    else
        INCREMENTAL=0
    fi
    
    # Rollback capability
    if ask_yes_no "Enable rollback capability? (undo moves if needed)" "y"; then
        ROLLBACK_ON_ERROR=1
    else
        ROLLBACK_ON_ERROR=0
    fi
}

# Test configuration
test_configuration() {
    show_step 6 7 "Test Configuration"
    
    echo "Let's test your configuration with a sample run:"
    echo
    
    # Check for sample music
    local test_albums=$(find "$SOURCE_DIR" -name "*.mp3" -o -name "*.flac" -o -name "*.m4a" 2>/dev/null | head -5)
    
    if [[ -z "$test_albums" ]]; then
        echo -e "${YELLOW}No music files found in source directory${NC}"
        echo "Skipping test run"
        return
    fi
    
    if ask_yes_no "Run a test on a few albums?" "y"; then
        echo
        echo "Running test (dry-run mode)..."
        echo
        
        # Create temporary test config
        write_config "/tmp/ordr_test.conf"
        
        # Run test
        ./ordr.fm.modular.sh \
            --config "/tmp/ordr_test.conf" \
            --source "$SOURCE_DIR" \
            --destination "$DEST_DIR" \
            --dry-run \
            --verbose \
            2>&1 | head -50
        
        echo
        echo -e "${GREEN}Test complete!${NC}"
        echo "Check the output above to see how your music would be organized."
        
        rm -f "/tmp/ordr_test.conf"
    fi
}

# Write configuration file
write_config() {
    local config_path="${1:-$CONFIG_FILE}"
    
    cat > "$config_path" << EOF
# ordr.fm Configuration File
# Generated by Setup Wizard on $(date)

# Directory Configuration
SOURCE_DIR="$SOURCE_DIR"
DEST_DIR="$DEST_DIR"
UNSORTED_BASE_DIR="$UNSORTED_BASE_DIR"

# Logging Configuration
LOG_FILE="ordr.fm.log"
VERBOSITY=2  # 0=ERROR, 1=WARNING, 2=INFO, 3=DEBUG

# Processing Options
DRY_RUN=$DRY_RUN
INCREMENTAL=$INCREMENTAL
DUPLICATE_DETECTION=0

# Electronic Music Organization
ENABLE_ELECTRONIC_ORGANIZATION=$ENABLE_ELECTRONIC_ORGANIZATION
ORGANIZATION_MODE="$ORGANIZATION_MODE"
MIN_LABEL_RELEASES=3
SEPARATE_REMIXES=$SEPARATE_REMIXES
VINYL_SIDE_MARKERS=0

# Discogs Integration
DISCOGS_ENABLED=$DISCOGS_ENABLED
DISCOGS_TOKEN="${DISCOGS_TOKEN}"
DISCOGS_CACHE_DIR="\$HOME/.cache/ordr.fm/discogs"
DISCOGS_CACHE_EXPIRY=$DISCOGS_CACHE_EXPIRY
DISCOGS_CONFIDENCE_THRESHOLD=$DISCOGS_CONFIDENCE_THRESHOLD
DISCOGS_RATE_LIMIT_DELAY=1000

# Performance Settings
ENABLE_PARALLEL=$ENABLE_PARALLEL
PARALLEL_JOBS=$PARALLEL_JOBS
PARALLEL_METHOD="auto"
BATCH_SIZE=100

# Database Paths
STATE_DB="ordr.fm.state.db"
METADATA_DB="ordr.fm.metadata.db"
DUPLICATES_DB="ordr.fm.duplicates.db"

# Safety Features
ROLLBACK_ON_ERROR=$ROLLBACK_ON_ERROR
BACKUP_BEFORE_MOVE=0
REQUIRE_CONFIRMATION=0
MAX_MOVES_PER_RUN=0
EOF
    
    echo -e "${GREEN}✓ Configuration saved to $config_path${NC}"
}

# Generate command examples
generate_commands() {
    show_step 7 7 "Your Custom Commands"
    
    echo "Based on your configuration, here are some useful commands:"
    echo
    
    # Basic command
    echo -e "${BOLD}1. Preview organization (safe):${NC}"
    echo -e "${CYAN}./ordr.fm.modular.sh${NC}"
    echo
    
    # Move command
    echo -e "${BOLD}2. Actually organize your music:${NC}"
    if [[ $DRY_RUN -eq 1 ]]; then
        echo -e "${CYAN}./ordr.fm.modular.sh --move${NC}"
    else
        echo -e "${CYAN}./ordr.fm.modular.sh${NC}"
    fi
    echo
    
    # Parallel command
    if [[ $ENABLE_PARALLEL -eq 1 ]]; then
        echo -e "${BOLD}3. Fast processing with parallel:${NC}"
        echo -e "${CYAN}./ordr.fm.modular.sh --parallel --move${NC}"
        echo
    fi
    
    # Electronic music command
    if [[ $ENABLE_ELECTRONIC_ORGANIZATION -eq 1 ]]; then
        echo -e "${BOLD}4. Electronic music with Discogs:${NC}"
        echo -e "${CYAN}./ordr.fm.modular.sh --enable-electronic --discogs --move${NC}"
        echo
    fi
    
    # Incremental command
    if [[ $INCREMENTAL -eq 1 ]]; then
        echo -e "${BOLD}5. Process only new albums:${NC}"
        echo -e "${CYAN}./ordr.fm.modular.sh --incremental --move${NC}"
        echo
    fi
    
    # Schedule command
    echo -e "${BOLD}6. Schedule automatic organization:${NC}"
    echo -e "${CYAN}crontab -e${NC}"
    echo "Add this line:"
    echo -e "${CYAN}0 2 * * * $(pwd)/ordr.fm.modular.sh --incremental --move${NC}"
}

# Save setup summary
save_summary() {
    local summary_file="setup_summary_$(date +%Y%m%d_%H%M%S).txt"
    
    cat > "$summary_file" << EOF
ordr.fm Setup Summary
Generated: $(date)

Configuration:
- Source: $SOURCE_DIR
- Destination: $DEST_DIR
- Unsorted: $UNSORTED_BASE_DIR
- Parallel Processing: $([ $ENABLE_PARALLEL -eq 1 ] && echo "Enabled" || echo "Disabled")
- Electronic Features: $([ $ENABLE_ELECTRONIC_ORGANIZATION -eq 1 ] && echo "Enabled" || echo "Disabled")
- Discogs Integration: $([ $DISCOGS_ENABLED -eq 1 ] && echo "Enabled" || echo "Disabled")
- Default Mode: $([ $DRY_RUN -eq 1 ] && echo "Dry-run (safe)" || echo "Move files")

Next Steps:
1. Review configuration: cat $CONFIG_FILE
2. Test with dry run: ./ordr.fm.modular.sh
3. Organize music: ./ordr.fm.modular.sh --move

For help: ./ordr.fm.modular.sh --help
EOF
    
    echo -e "${GREEN}Setup summary saved to: $summary_file${NC}"
}

# Main setup flow
main() {
    show_header
    
    echo "Welcome to the ordr.fm setup wizard!"
    echo "This will help you configure ordr.fm for your music collection."
    echo
    
    if [[ -f "$CONFIG_FILE" ]]; then
        echo -e "${YELLOW}Warning: Configuration file already exists: $CONFIG_FILE${NC}"
        if ! ask_yes_no "Overwrite existing configuration?" "n"; then
            CONFIG_FILE="ordr.fm.conf.new"
            echo -e "${BLUE}New configuration will be saved to: $CONFIG_FILE${NC}"
        fi
    fi
    
    echo
    read -p "Press Enter to begin setup..."
    
    # Run setup steps
    check_dependencies
    configure_directories
    configure_features
    configure_discogs
    configure_safety
    test_configuration
    
    # Save configuration
    echo
    write_config
    
    # Show commands
    generate_commands
    
    # Save summary
    save_summary
    
    echo
    echo -e "${GREEN}${BOLD}Setup complete!${NC}"
    echo
    echo "Quick start:"
    echo "  1. Review your configuration: ${CYAN}cat $CONFIG_FILE${NC}"
    echo "  2. Test with a dry run: ${CYAN}./ordr.fm.modular.sh${NC}"
    echo "  3. Organize your music: ${CYAN}./ordr.fm.modular.sh --move${NC}"
    echo
    echo "For more help, see:"
    echo "  • Quick Start Guide: ${CYAN}cat QUICKSTART.md${NC}"
    echo "  • Full Documentation: ${CYAN}cat README.md${NC}"
    echo "  • Troubleshooting: ${CYAN}cat docs/TROUBLESHOOTING.md${NC}"
    echo
    echo -e "${BOLD}Happy organizing! 🎵${NC}"
}

# Run the wizard
main