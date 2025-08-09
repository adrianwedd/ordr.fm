#!/bin/bash
# Shell script linting with ShellCheck
# Part of ordr.fm code quality framework

set -euo pipefail

# Configuration
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly NC='\033[0m' # No Color

# Counters
CHECKED=0
ERRORS=0
WARNINGS=0

print_status() {
    printf "${GREEN}[INFO]${NC} %s\n" "$1"
}

print_warning() {
    printf "${YELLOW}[WARN]${NC} %s\n" "$1"
}

print_error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1"
}

# Function to check a single shell script
check_shell_script() {
    local script="$1"
    local relative_path="${script#$PROJECT_ROOT/}"
    
    ((CHECKED++))
    
    # Run ShellCheck
    if shellcheck \
        -x \
        -e SC1091 \
        -e SC2034 \
        -e SC2154 \
        "$script"; then
        print_status "✓ $relative_path"
    else
        local exit_code=$?
        if [ $exit_code -eq 1 ]; then
            ((WARNINGS++))
            print_warning "⚠ $relative_path (warnings)"
        else
            ((ERRORS++))
            print_error "✗ $relative_path (errors)"
        fi
    fi
}

main() {
    print_status "🔍 Running ShellCheck on shell scripts..."
    
    cd "$PROJECT_ROOT"
    
    # Find all shell scripts (excluding node_modules and .git)
    while IFS= read -r -d '' script; do
        # Skip if file doesn't exist or isn't readable
        [[ -r "$script" ]] || continue
        
        # Skip if it's not actually a shell script
        if ! head -1 "$script" | grep -qE '^#!.*(bash|sh)'; then
            continue
        fi
        
        check_shell_script "$script"
        
    done < <(find . \
        -type f \
        -name "*.sh" \
        ! -path "./visualization/node_modules/*" \
        ! -path "./.git/*" \
        ! -path "./.*/*" \
        -print0)
    
    # Summary
    echo ""
    print_status "📊 ShellCheck Summary:"
    echo "  Scripts checked: $CHECKED"
    echo "  Errors: $ERRORS"
    echo "  Warnings: $WARNINGS"
    
    # Exit with error if there were any errors
    if [ $ERRORS -gt 0 ]; then
        print_error "❌ ShellCheck found $ERRORS error(s)"
        exit 1
    elif [ $WARNINGS -gt 0 ]; then
        print_warning "⚠️ ShellCheck found $WARNINGS warning(s)"
        exit 0
    else
        print_status "✅ All shell scripts passed ShellCheck!"
        exit 0
    fi
}

main "$@"