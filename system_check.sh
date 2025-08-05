#!/bin/bash
# ordr.fm System Check
# Verifies system is ready for ordr.fm

set -euo pipefail

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
BOLD='\033[1m'

# Scoring
TOTAL_CHECKS=0
PASSED_CHECKS=0
WARNINGS=0

# Check result helper
check_result() {
    local status=$1
    local message=$2
    local details=${3:-""}
    
    ((TOTAL_CHECKS++))
    
    case "$status" in
        "pass")
            echo -e "  ${GREEN}✓${NC} $message"
            [[ -n "$details" ]] && echo -e "    ${details}"
            ((PASSED_CHECKS++))
            ;;
        "fail")
            echo -e "  ${RED}✗${NC} $message"
            [[ -n "$details" ]] && echo -e "    ${RED}${details}${NC}"
            ;;
        "warn")
            echo -e "  ${YELLOW}⚠${NC} $message"
            [[ -n "$details" ]] && echo -e "    ${YELLOW}${details}${NC}"
            ((WARNINGS++))
            ((PASSED_CHECKS++))
            ;;
    esac
}

# Header
show_header() {
    echo -e "${BLUE}ordr.fm System Check${NC}"
    echo "===================="
    echo "Checking if your system is ready for ordr.fm"
    echo
}

# Check OS
check_os() {
    echo -e "${BOLD}Operating System${NC}"
    
    local os_name=""
    local os_version=""
    
    if [[ -f /etc/os-release ]]; then
        source /etc/os-release
        os_name="$NAME"
        os_version="$VERSION_ID"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        os_name="macOS"
        os_version=$(sw_vers -productVersion)
    else
        os_name="Unknown"
    fi
    
    if [[ "$os_name" != "Unknown" ]]; then
        check_result "pass" "OS: $os_name $os_version"
    else
        check_result "warn" "OS: Unknown (may still work)"
    fi
    
    # Check architecture
    local arch=$(uname -m)
    check_result "pass" "Architecture: $arch"
    
    echo
}

# Check shell
check_shell() {
    echo -e "${BOLD}Shell Environment${NC}"
    
    # Bash version
    local bash_version="${BASH_VERSION%%[^0-9.]*}"
    local bash_major="${bash_version%%.*}"
    
    if [[ $bash_major -ge 4 ]]; then
        check_result "pass" "Bash version: $bash_version"
    else
        check_result "fail" "Bash version: $bash_version (need 4.0+)"
    fi
    
    # Check for required shell features
    if [[ -n "${BASH_SOURCE[0]}" ]]; then
        check_result "pass" "Shell features: Modern bash detected"
    else
        check_result "warn" "Shell features: Some features may be limited"
    fi
    
    echo
}

# Check dependencies
check_dependencies() {
    echo -e "${BOLD}Required Dependencies${NC}"
    
    # Required tools
    local required_tools=("exiftool" "jq" "sqlite3")
    
    for tool in "${required_tools[@]}"; do
        if command -v "$tool" &> /dev/null; then
            local version=$("$tool" --version 2>&1 | head -1 || echo "unknown")
            check_result "pass" "$tool: Found" "$version"
        else
            check_result "fail" "$tool: Not found" "Install with: sudo apt-get install $tool"
        fi
    done
    
    echo
}

# Check optional dependencies
check_optional_dependencies() {
    echo -e "${BOLD}Optional Dependencies${NC}"
    
    local optional_tools=(
        "parallel:Performance enhancement"
        "bc:Statistics calculation"
        "rsync:Efficient file operations"
        "curl:Discogs API access"
        "git:Version control"
        "tree:Directory visualization"
    )
    
    for tool_desc in "${optional_tools[@]}"; do
        local tool="${tool_desc%%:*}"
        local desc="${tool_desc#*:}"
        
        if command -v "$tool" &> /dev/null; then
            check_result "pass" "$tool: Found" "$desc"
        else
            check_result "warn" "$tool: Not found" "$desc"
        fi
    done
    
    echo
}

# Check system resources
check_system_resources() {
    echo -e "${BOLD}System Resources${NC}"
    
    # CPU cores
    local cpu_cores=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)
    if [[ $cpu_cores -ge 4 ]]; then
        check_result "pass" "CPU cores: $cpu_cores" "Good for parallel processing"
    elif [[ $cpu_cores -ge 2 ]]; then
        check_result "warn" "CPU cores: $cpu_cores" "Limited parallel processing"
    else
        check_result "warn" "CPU cores: $cpu_cores" "Sequential processing recommended"
    fi
    
    # Memory
    local total_mem_kb=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)
    local total_mem_gb=$((total_mem_kb / 1024 / 1024))
    
    if [[ $total_mem_gb -ge 8 ]]; then
        check_result "pass" "Memory: ${total_mem_gb}GB" "Excellent for large collections"
    elif [[ $total_mem_gb -ge 4 ]]; then
        check_result "pass" "Memory: ${total_mem_gb}GB" "Good for most collections"
    elif [[ $total_mem_gb -ge 2 ]]; then
        check_result "warn" "Memory: ${total_mem_gb}GB" "May be limited for large collections"
    else
        check_result "warn" "Memory: ${total_mem_gb}GB" "Consider upgrading for better performance"
    fi
    
    # Disk space
    local home_space=$(df -BG "$HOME" 2>/dev/null | awk 'NR==2 {print $4}' | sed 's/G//')
    if [[ -n "$home_space" ]] && [[ $home_space -ge 10 ]]; then
        check_result "pass" "Free space in \$HOME: ${home_space}GB"
    else
        check_result "warn" "Free space in \$HOME: ${home_space}GB" "Ensure adequate space for music"
    fi
    
    echo
}

# Check file system
check_filesystem() {
    echo -e "${BOLD}File System${NC}"
    
    # Check if we can create files with special characters
    local test_dir="/tmp/ordr_fm_test_$$"
    mkdir -p "$test_dir"
    
    # Test Unicode support
    if touch "$test_dir/test_üñíçødé.mp3" 2>/dev/null; then
        check_result "pass" "Unicode filenames: Supported"
    else
        check_result "warn" "Unicode filenames: May have issues"
    fi
    
    # Test long filenames
    local long_name="a"
    for i in {1..255}; do long_name="${long_name}a"; done
    
    if touch "$test_dir/${long_name:0:255}" 2>/dev/null; then
        check_result "pass" "Long filenames: Supported (255 chars)"
    else
        check_result "warn" "Long filenames: Limited support"
    fi
    
    # Cleanup
    rm -rf "$test_dir"
    
    # Check file descriptor limit
    local fd_limit=$(ulimit -n)
    if [[ $fd_limit -ge 1024 ]]; then
        check_result "pass" "File descriptors: $fd_limit"
    else
        check_result "warn" "File descriptors: $fd_limit" "Consider increasing with: ulimit -n 4096"
    fi
    
    echo
}

# Check permissions
check_permissions() {
    echo -e "${BOLD}Permissions${NC}"
    
    # Check script permissions
    if [[ -x "./ordr.fm.modular.sh" ]]; then
        check_result "pass" "Script executable: Yes"
    else
        check_result "fail" "Script executable: No" "Run: chmod +x ordr.fm.modular.sh"
    fi
    
    # Check if we can write logs
    if touch "test_write_$$" 2>/dev/null; then
        rm -f "test_write_$$"
        check_result "pass" "Write permission: Current directory"
    else
        check_result "fail" "Write permission: Cannot write to current directory"
    fi
    
    echo
}

# Check network (for Discogs)
check_network() {
    echo -e "${BOLD}Network (for Discogs API)${NC}"
    
    # Check internet connectivity
    if curl -s --head --connect-timeout 5 https://api.discogs.com > /dev/null; then
        check_result "pass" "Internet connection: Working"
        check_result "pass" "Discogs API: Reachable"
    else
        check_result "warn" "Internet connection: Not available or slow" "Discogs features will be limited"
    fi
    
    # Check for proxy
    if [[ -n "${HTTP_PROXY:-}" ]] || [[ -n "${HTTPS_PROXY:-}" ]]; then
        check_result "warn" "Proxy detected" "Ensure proxy allows HTTPS traffic"
    fi
    
    echo
}

# Performance recommendations
show_recommendations() {
    echo -e "${BOLD}Recommendations${NC}"
    echo
    
    local cpu_cores=$(nproc 2>/dev/null || echo 2)
    
    # Parallel processing recommendation
    if command -v parallel &> /dev/null; then
        echo -e "${GREEN}✓${NC} Parallel processing available"
        echo "  Recommended: --parallel $cpu_cores"
    else
        echo -e "${YELLOW}⚠${NC} Install GNU parallel for better performance:"
        echo "  sudo apt-get install parallel"
    fi
    
    echo
    
    # Performance tips based on system
    local total_mem_gb=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print int($2/1024/1024)}' || echo 4)
    
    if [[ $total_mem_gb -lt 4 ]]; then
        echo "Memory optimization tips:"
        echo "  • Use smaller batch sizes: --batch-size 50"
        echo "  • Limit parallel workers: --parallel 2"
    fi
    
    if [[ $cpu_cores -lt 4 ]]; then
        echo "CPU optimization tips:"
        echo "  • Consider processing during off-hours"
        echo "  • Use incremental mode for large collections"
    fi
    
    echo
}

# Generate system report
generate_report() {
    local report_file="system_check_report_$(date +%Y%m%d_%H%M%S).txt"
    
    {
        echo "ordr.fm System Check Report"
        echo "Generated: $(date)"
        echo "============================"
        echo
        echo "System Information:"
        uname -a
        echo
        echo "Check Results:"
        echo "Total checks: $TOTAL_CHECKS"
        echo "Passed: $PASSED_CHECKS"
        echo "Warnings: $WARNINGS"
        echo "Failed: $((TOTAL_CHECKS - PASSED_CHECKS))"
        echo
        echo "Dependencies:"
        for cmd in exiftool jq sqlite3 parallel bc rsync curl; do
            if command -v "$cmd" &> /dev/null; then
                echo "  $cmd: $(command -v $cmd)"
            else
                echo "  $cmd: NOT FOUND"
            fi
        done
    } > "$report_file"
    
    echo -e "${GREEN}Report saved to: $report_file${NC}"
}

# Main execution
main() {
    show_header
    
    # Run all checks
    check_os
    check_shell
    check_dependencies
    check_optional_dependencies
    check_system_resources
    check_filesystem
    check_permissions
    check_network
    
    # Summary
    echo -e "${BOLD}Summary${NC}"
    echo "======="
    
    local failed=$((TOTAL_CHECKS - PASSED_CHECKS))
    local score=$((PASSED_CHECKS * 100 / TOTAL_CHECKS))
    
    echo "Total checks: $TOTAL_CHECKS"
    echo -e "Passed: ${GREEN}$PASSED_CHECKS${NC}"
    echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"
    echo -e "Failed: ${RED}$failed${NC}"
    echo
    
    if [[ $failed -eq 0 ]]; then
        echo -e "${GREEN}${BOLD}✓ System is ready for ordr.fm!${NC}"
        echo
        show_recommendations
    else
        echo -e "${RED}${BOLD}✗ System needs attention${NC}"
        echo
        echo "Please fix the failed checks before running ordr.fm."
        echo "See installation guide: docs/DEPLOYMENT.md"
    fi
    
    echo
    
    # Ask to generate report
    echo -ne "Generate detailed report? [y/N]: "
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        generate_report
    fi
    
    exit $failed
}

# Run main
main