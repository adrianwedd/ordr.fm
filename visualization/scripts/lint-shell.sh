#\!/bin/bash
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

print_status() {
    printf "${GREEN}[INFO]${NC} %s\n" "$1"
}

main() {
    print_status "🔍 Running ShellCheck on shell scripts..."
    
    cd "$PROJECT_ROOT"
    
    # Find and check all shell scripts
    find . -type f -name "*.sh" \
        \! -path "./visualization/node_modules/*" \
        \! -path "./.git/*" \
        -exec shellcheck -x -e SC1091 -e SC2034 -e SC2154 {} \;
    
    print_status "✅ ShellCheck complete\!"
}

main "$@"
EOF < /dev/null