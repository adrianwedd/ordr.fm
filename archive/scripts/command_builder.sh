#!/bin/bash
# ordr.fm Command Builder
# Interactive tool to build complex ordr.fm commands

set -euo pipefail

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# Command components
declare -a COMMAND_PARTS=("./ordr.fm.modular.sh")
declare -A OPTIONS_SELECTED

# Show header
show_header() {
    clear
    echo -e "${CYAN}ordr.fm Command Builder${NC}"
    echo "======================="
    echo "Build your perfect command interactively!"
    echo
}

# Show current command
show_current_command() {
    echo -e "\n${BOLD}Current command:${NC}"
    echo -e "${GREEN}${COMMAND_PARTS[*]}${NC}\n"
}

# Add option to command
add_option() {
    local option=$1
    local value=${2:-""}
    
    if [[ -n "$value" ]]; then
        COMMAND_PARTS+=("$option" "$value")
        OPTIONS_SELECTED["$option"]="$value"
    else
        COMMAND_PARTS+=("$option")
        OPTIONS_SELECTED["$option"]="true"
    fi
}

# Remove option from command
remove_option() {
    local option=$1
    local new_parts=()
    local skip_next=0
    
    for part in "${COMMAND_PARTS[@]}"; do
        if [[ $skip_next -eq 1 ]]; then
            skip_next=0
            continue
        fi
        
        if [[ "$part" == "$option" ]]; then
            # Check if next part is a value (doesn't start with --)
            local next_idx=$((${#new_parts[@]} + 1))
            if [[ $next_idx -lt ${#COMMAND_PARTS[@]} ]] && [[ ! "${COMMAND_PARTS[$next_idx]}" =~ ^-- ]]; then
                skip_next=1
            fi
            continue
        fi
        
        new_parts+=("$part")
    done
    
    COMMAND_PARTS=("${new_parts[@]}")
    unset OPTIONS_SELECTED["$option"]
}

# Directory configuration
configure_directories() {
    show_header
    echo -e "${BOLD}1. Directory Configuration${NC}"
    echo "=========================="
    echo
    
    # Source directory
    echo -ne "Source directory (leave empty to skip): "
    read -r source_dir
    if [[ -n "$source_dir" ]]; then
        add_option "--source" "$source_dir"
    fi
    
    # Destination directory
    echo -ne "Destination directory (leave empty to skip): "
    read -r dest_dir
    if [[ -n "$dest_dir" ]]; then
        add_option "--destination" "$dest_dir"
    fi
    
    # Unsorted directory
    echo -ne "Unsorted directory (leave empty to skip): "
    read -r unsorted_dir
    if [[ -n "$unsorted_dir" ]]; then
        add_option "--unsorted" "$unsorted_dir"
    fi
    
    show_current_command
}

# Processing mode
configure_mode() {
    show_header
    echo -e "${BOLD}2. Processing Mode${NC}"
    echo "=================="
    echo
    
    echo "Select processing mode:"
    echo "1) Dry run (preview only) - DEFAULT"
    echo "2) Move files (actual organization)"
    echo
    echo -ne "Choice [1]: "
    read -r choice
    
    case "${choice:-1}" in
        2)
            add_option "--move"
            echo -e "${YELLOW}⚠ Files will be moved!${NC}"
            ;;
        *)
            add_option "--dry-run"
            echo -e "${GREEN}✓ Safe mode - preview only${NC}"
            ;;
    esac
    
    show_current_command
}

# Performance options
configure_performance() {
    show_header
    echo -e "${BOLD}3. Performance Options${NC}"
    echo "====================="
    echo
    
    echo "Enable parallel processing?"
    echo "1) No (sequential)"
    echo "2) Yes, auto-detect workers"
    echo "3) Yes, specify worker count"
    echo
    echo -ne "Choice [1]: "
    read -r choice
    
    case "$choice" in
        2)
            add_option "--parallel"
            echo -e "${GREEN}✓ Parallel processing enabled (auto)${NC}"
            ;;
        3)
            echo -ne "Number of workers: "
            read -r workers
            if [[ "$workers" =~ ^[0-9]+$ ]]; then
                add_option "--parallel" "$workers"
                echo -e "${GREEN}✓ Parallel processing with $workers workers${NC}"
            fi
            ;;
        *)
            echo "Sequential processing selected"
            ;;
    esac
    
    show_current_command
}

# Feature selection
configure_features() {
    show_header
    echo -e "${BOLD}4. Feature Selection${NC}"
    echo "==================="
    echo
    
    # Electronic music features
    echo -ne "Enable electronic music features? [y/N]: "
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        add_option "--enable-electronic"
        
        # Organization mode
        echo
        echo "Organization mode:"
        echo "1) Artist-based"
        echo "2) Label-based"
        echo "3) Series-based"
        echo "4) Hybrid (intelligent)"
        echo
        echo -ne "Choice [4]: "
        read -r mode_choice
        
        case "${mode_choice:-4}" in
            1) add_option "--organization-mode" "artist" ;;
            2) add_option "--organization-mode" "label" ;;
            3) add_option "--organization-mode" "series" ;;
            *) add_option "--organization-mode" "hybrid" ;;
        esac
    fi
    
    # Discogs integration
    echo
    echo -ne "Enable Discogs metadata enrichment? [y/N]: "
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        add_option "--discogs"
    fi
    
    # Incremental mode
    echo
    echo -ne "Enable incremental mode (skip processed)? [y/N]: "
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        add_option "--incremental"
    fi
    
    # Duplicate detection
    echo
    echo -ne "Enable duplicate detection? [y/N]: "
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        add_option "--duplicates"
    fi
    
    show_current_command
}

# Logging options
configure_logging() {
    show_header
    echo -e "${BOLD}5. Logging Options${NC}"
    echo "=================="
    echo
    
    echo "Verbosity level:"
    echo "1) Quiet (errors only)"
    echo "2) Normal (default)"
    echo "3) Verbose (detailed)"
    echo
    echo -ne "Choice [2]: "
    read -r choice
    
    case "${choice:-2}" in
        1)
            add_option "--quiet"
            ;;
        3)
            add_option "--verbose"
            ;;
    esac
    
    # Custom log file
    echo
    echo -ne "Custom log file (leave empty for default): "
    read -r log_file
    if [[ -n "$log_file" ]]; then
        add_option "--log-file" "$log_file"
    fi
    
    show_current_command
}

# Advanced options
configure_advanced() {
    show_header
    echo -e "${BOLD}6. Advanced Options${NC}"
    echo "==================="
    echo
    
    echo -ne "Use custom config file? [y/N]: "
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        echo -ne "Config file path: "
        read -r config_file
        if [[ -n "$config_file" ]]; then
            add_option "--config" "$config_file"
        fi
    fi
    
    show_current_command
}

# Command templates
show_templates() {
    show_header
    echo -e "${BOLD}Command Templates${NC}"
    echo "================="
    echo
    echo "Select a template to start with:"
    echo
    echo "1) Basic organization (safe dry-run)"
    echo "2) Fast parallel processing"
    echo "3) Electronic music collection"
    echo "4) Large collection optimization"
    echo "5) Incremental daily run"
    echo "6) Full featured command"
    echo "0) Start from scratch"
    echo
    echo -ne "Choice [0]: "
    read -r choice
    
    case "${choice:-0}" in
        1)
            COMMAND_PARTS=("./ordr.fm.modular.sh" "--dry-run")
            echo -e "${GREEN}✓ Basic dry-run template loaded${NC}"
            ;;
        2)
            COMMAND_PARTS=("./ordr.fm.modular.sh" "--parallel" "--move")
            echo -e "${GREEN}✓ Parallel processing template loaded${NC}"
            ;;
        3)
            COMMAND_PARTS=("./ordr.fm.modular.sh" "--enable-electronic" "--discogs" "--organization-mode" "hybrid" "--move")
            echo -e "${GREEN}✓ Electronic music template loaded${NC}"
            ;;
        4)
            COMMAND_PARTS=("./ordr.fm.modular.sh" "--parallel" "8" "--batch-size" "500" "--incremental" "--move")
            echo -e "${GREEN}✓ Large collection template loaded${NC}"
            ;;
        5)
            COMMAND_PARTS=("./ordr.fm.modular.sh" "--incremental" "--parallel" "--quiet" "--move")
            echo -e "${GREEN}✓ Incremental run template loaded${NC}"
            ;;
        6)
            COMMAND_PARTS=("./ordr.fm.modular.sh" "--enable-electronic" "--discogs" "--parallel" "--incremental" "--verbose" "--move")
            echo -e "${GREEN}✓ Full featured template loaded${NC}"
            ;;
        *)
            COMMAND_PARTS=("./ordr.fm.modular.sh")
            echo "Starting from scratch"
            ;;
    esac
    
    echo
    read -p "Press Enter to continue..."
}

# Main menu
main_menu() {
    while true; do
        show_header
        show_current_command
        
        echo -e "${BOLD}Build Your Command:${NC}"
        echo "1) Configure directories"
        echo "2) Set processing mode"
        echo "3) Performance options"
        echo "4) Feature selection"
        echo "5) Logging options"
        echo "6) Advanced options"
        echo
        echo "T) Load template"
        echo "R) Reset command"
        echo "S) Save command to file"
        echo "X) Execute command"
        echo "Q) Quit"
        echo
        echo -ne "Choice: "
        read -r choice
        
        case "${choice,,}" in
            1) configure_directories ;;
            2) configure_mode ;;
            3) configure_performance ;;
            4) configure_features ;;
            5) configure_logging ;;
            6) configure_advanced ;;
            t) show_templates ;;
            r) 
                COMMAND_PARTS=("./ordr.fm.modular.sh")
                OPTIONS_SELECTED=()
                echo -e "${YELLOW}Command reset${NC}"
                sleep 1
                ;;
            s) save_command ;;
            x) execute_command ;;
            q) 
                echo -e "\n${GREEN}Your final command:${NC}"
                echo "${COMMAND_PARTS[*]}"
                echo
                exit 0
                ;;
            *)
                echo -e "${RED}Invalid choice${NC}"
                sleep 1
                ;;
        esac
    done
}

# Save command to file
save_command() {
    echo
    echo -ne "Save to file [command.sh]: "
    read -r filename
    filename="${filename:-command.sh}"
    
    cat > "$filename" << EOF
#!/bin/bash
# ordr.fm command generated by Command Builder
# Generated: $(date)

${COMMAND_PARTS[*]}
EOF
    
    chmod +x "$filename"
    echo -e "${GREEN}✓ Command saved to $filename${NC}"
    echo
    read -p "Press Enter to continue..."
}

# Execute command
execute_command() {
    echo
    echo -e "${BOLD}Ready to execute:${NC}"
    echo -e "${CYAN}${COMMAND_PARTS[*]}${NC}"
    echo
    echo -ne "Execute now? [y/N]: "
    read -r response
    
    if [[ "$response" =~ ^[Yy]$ ]]; then
        echo
        echo -e "${YELLOW}Executing...${NC}"
        echo
        
        # Execute the command
        "${COMMAND_PARTS[@]}"
        
        echo
        echo -e "${GREEN}Command completed${NC}"
        echo
        read -p "Press Enter to continue..."
    fi
}

# Quick mode for common scenarios
quick_mode() {
    if [[ "$1" == "--quick" ]] && [[ -n "$2" ]]; then
        case "$2" in
            "basic")
                echo "./ordr.fm.modular.sh --dry-run"
                ;;
            "move")
                echo "./ordr.fm.modular.sh --move"
                ;;
            "parallel")
                echo "./ordr.fm.modular.sh --parallel --move"
                ;;
            "electronic")
                echo "./ordr.fm.modular.sh --enable-electronic --discogs --move"
                ;;
            "full")
                echo "./ordr.fm.modular.sh --enable-electronic --discogs --parallel --incremental --move"
                ;;
            *)
                echo "Unknown quick mode: $2"
                echo "Available: basic, move, parallel, electronic, full"
                exit 1
                ;;
        esac
        exit 0
    fi
}

# Main execution
main() {
    # Check for quick mode
    quick_mode "$@"
    
    # Check if we can find ordr.fm.modular.sh
    if [[ ! -f "./ordr.fm.modular.sh" ]]; then
        echo -e "${RED}Error: ordr.fm.modular.sh not found in current directory${NC}"
        echo "Please run this from the ordr.fm directory"
        exit 1
    fi
    
    # Show templates first
    show_templates
    
    # Start main menu
    main_menu
}

# Run main
main "$@"