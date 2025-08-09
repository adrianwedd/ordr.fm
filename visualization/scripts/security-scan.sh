#!/bin/bash
#
# Comprehensive Security Scanning for ordr.fm
# Scans both Node.js and Shell components for security vulnerabilities
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Security scan results directory
SCAN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$SCAN_DIR/../security-reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="$RESULTS_DIR/security-scan-$TIMESTAMP.md"

# Create results directory
mkdir -p "$RESULTS_DIR"

echo -e "${BLUE}🔐 ordr.fm Security Scanning Suite${NC}"
echo "============================================================"
echo "Timestamp: $TIMESTAMP"
echo "Report: $REPORT_FILE"
echo ""

# Initialize report
cat > "$REPORT_FILE" << EOF
# ordr.fm Security Scan Report

**Scan Date**: $(date)
**Scan ID**: $TIMESTAMP

## Executive Summary

This report contains the results of comprehensive security scanning across the ordr.fm modular architecture.

EOF

echo -e "${BLUE}📋 Running Security Scans...${NC}"
echo ""

# Function to add section to report
add_section() {
    local title="$1"
    local content="$2"
    
    cat >> "$REPORT_FILE" << EOF

## $title

\`\`\`
$content
\`\`\`

EOF
}

# Function to run command and capture output
run_scan() {
    local name="$1"
    local command="$2"
    local severity="$3"
    
    echo -e "${YELLOW}Running $name...${NC}"
    
    if output=$(eval "$command" 2>&1); then
        if [[ -n "$output" ]]; then
            echo -e "${GREEN}✓${NC} $name completed"
            add_section "$name Results" "$output"
        else
            echo -e "${GREEN}✓${NC} $name - No issues found"
            add_section "$name Results" "No issues detected."
        fi
    else
        echo -e "${RED}✗${NC} $name failed"
        add_section "$name Results (FAILED)" "$output"
    fi
    echo ""
}

# 1. NPM Audit - Dependency Vulnerabilities
echo -e "${BLUE}1. NPM Dependency Vulnerability Scan${NC}"
run_scan "NPM Audit" "npm audit --audit-level=moderate --json 2>/dev/null || npm audit --audit-level=moderate" "HIGH"

# 2. Retire.js - JavaScript vulnerability scanner
echo -e "${BLUE}2. JavaScript Vulnerability Scan (Retire.js)${NC}"
run_scan "Retire.js Scan" "npx retire --path=. --outputformat=json || npx retire --path=." "MEDIUM"

# 3. ESLint Security Plugin Analysis
echo -e "${BLUE}3. ESLint Security Analysis${NC}"
if [[ -f "eslint.config.js" ]]; then
    run_scan "ESLint Security" "npx eslint . --format=json || npx eslint ." "MEDIUM"
else
    add_section "ESLint Security" "ESLint configuration not found."
fi

# 4. Shell Script Security Analysis with ShellCheck
echo -e "${BLUE}4. Shell Script Security Analysis${NC}"
shell_issues=""
shell_count=0
if find ../../ -name "*.sh" -type f | head -20 | while IFS= read -r script; do
    if shellcheck_output=$(shellcheck -f json "$script" 2>/dev/null || shellcheck "$script" 2>&1); then
        if [[ -n "$shellcheck_output" && "$shellcheck_output" != "[]" ]]; then
            shell_issues+="File: $script\n$shellcheck_output\n\n"
            ((shell_count++))
        fi
    fi
done; then
    if [[ $shell_count -gt 0 ]]; then
        add_section "ShellCheck Security Analysis" "$shell_issues"
    else
        add_section "ShellCheck Security Analysis" "No security issues found in shell scripts."
    fi
fi

# 5. Security Headers Validation
echo -e "${BLUE}5. Security Headers Validation${NC}"
if [[ -f "src/middleware/security.js" ]]; then
    security_headers=$(grep -n "helmet\|csp\|hsts\|xss" src/middleware/security.js || echo "No explicit security headers found")
    add_section "Security Headers Analysis" "$security_headers"
else
    add_section "Security Headers Analysis" "Security middleware not found."
fi

# 6. Hardcoded Secrets Detection
echo -e "${BLUE}6. Hardcoded Secrets Detection${NC}"
secrets_found=""
secret_patterns=(
    "password.*=.*['\"][^'\"]*['\"]"
    "api[_-]?key.*=.*['\"][^'\"]*['\"]"
    "secret.*=.*['\"][^'\"]*['\"]"
    "token.*=.*['\"][^'\"]*['\"]"
    "jwt[_-]?secret"
    "private[_-]?key"
)

for pattern in "${secret_patterns[@]}"; do
    if matches=$(grep -r -n -i "$pattern" src/ 2>/dev/null | head -10); then
        if [[ -n "$matches" ]]; then
            secrets_found+="Pattern: $pattern\n$matches\n\n"
        fi
    fi
done

if [[ -n "$secrets_found" ]]; then
    add_section "Hardcoded Secrets Detection" "$secrets_found"
else
    add_section "Hardcoded Secrets Detection" "No hardcoded secrets detected."
fi

# 7. File Permissions Audit
echo -e "${BLUE}7. File Permissions Audit${NC}"
perm_issues=""
# Check for world-writable files
if world_writable=$(find ../../ -type f -perm -002 2>/dev/null | head -10); then
    if [[ -n "$world_writable" ]]; then
        perm_issues+="World-writable files:\n$world_writable\n\n"
    fi
fi

# Check for executable files that shouldn't be
if suspicious_exec=$(find src/ -type f -executable ! -name "*.sh" 2>/dev/null | head -10); then
    if [[ -n "$suspicious_exec" ]]; then
        perm_issues+="Suspicious executable files:\n$suspicious_exec\n\n"
    fi
fi

if [[ -n "$perm_issues" ]]; then
    add_section "File Permissions Audit" "$perm_issues"
else
    add_section "File Permissions Audit" "No permission issues detected."
fi

# 8. Configuration Security Review
echo -e "${BLUE}8. Configuration Security Review${NC}"
config_issues=""

# Check for default passwords or insecure configurations
if [[ -f "src/config/index.js" ]]; then
    config_analysis=$(grep -n -i "default\|password\|secret\|token\|jwt" src/config/index.js || echo "No sensitive configuration found")
    config_issues+="Configuration Analysis:\n$config_analysis\n\n"
fi

# Check environment variables
if env_vars=$(env | grep -i "password\|secret\|token\|key" | head -5); then
    config_issues+="Environment Variables (filtered):\n$env_vars\n\n"
fi

add_section "Configuration Security Review" "$config_issues"

# 9. Dependency License Audit
echo -e "${BLUE}9. Dependency License Audit${NC}"
if license_info=$(npm ls --depth=0 --json 2>/dev/null | jq -r '.dependencies | keys[]' | head -20); then
    add_section "Dependency License Audit" "$license_info"
else
    add_section "Dependency License Audit" "Unable to extract license information."
fi

# 10. API Security Review
echo -e "${BLUE}10. API Security Review${NC}"
api_security=""

# Check for authentication middleware
if auth_analysis=$(find src/controllers/ -name "*.js" -exec grep -l "authenticateToken\|requireRole" {} \; 2>/dev/null); then
    api_security+="Protected Controllers:\n$auth_analysis\n\n"
fi

# Check for input validation
if validation_analysis=$(find src/controllers/ -name "*.js" -exec grep -l "validate\|sanitize" {} \; 2>/dev/null); then
    api_security+="Controllers with Validation:\n$validation_analysis\n\n"
else
    api_security+="Controllers with Validation: None found\n\n"
fi

add_section "API Security Review" "$api_security"

# Generate Summary
echo -e "${BLUE}📊 Generating Security Summary...${NC}"

# Count issues by severity
high_issues=0
medium_issues=0
low_issues=0

# Basic issue counting (would be enhanced with proper parsing)
if grep -q "CRITICAL\|HIGH" "$REPORT_FILE"; then
    ((high_issues++))
fi
if grep -q "MEDIUM\|WARNING" "$REPORT_FILE"; then
    ((medium_issues++))
fi
if grep -q "LOW\|INFO" "$REPORT_FILE"; then
    ((low_issues++))
fi

# Add summary to report
cat >> "$REPORT_FILE" << EOF

## Security Scan Summary

### Issues by Severity
- **High/Critical**: $high_issues
- **Medium**: $medium_issues  
- **Low/Info**: $low_issues

### Recommendations

1. **Immediate Actions**: Address any high/critical severity issues
2. **Regular Monitoring**: Schedule weekly security scans
3. **Dependency Updates**: Keep dependencies updated with automated tools
4. **Code Reviews**: Include security review in development process
5. **Security Headers**: Ensure all security headers are properly configured

### Next Steps

- Review all flagged issues in detail
- Implement fixes for medium and high priority items
- Schedule automated security scanning in CI/CD pipeline
- Consider implementing additional security tools (SAST/DAST)

---

*Scan completed: $(date)*
*ordr.fm Modular Architecture Security Assessment*
EOF

echo -e "${GREEN}✅ Security Scan Complete!${NC}"
echo ""
echo -e "${BLUE}📋 Results Summary:${NC}"
echo "- High/Critical Issues: $high_issues"  
echo "- Medium Issues: $medium_issues"
echo "- Low/Info Issues: $low_issues"
echo ""
echo -e "${BLUE}📄 Full Report: $REPORT_FILE${NC}"
echo ""

# Set exit code based on severity
if [[ $high_issues -gt 0 ]]; then
    echo -e "${RED}⚠️  High severity issues detected!${NC}"
    exit 1
elif [[ $medium_issues -gt 3 ]]; then
    echo -e "${YELLOW}⚠️  Multiple medium severity issues detected!${NC}"  
    exit 1
else
    echo -e "${GREEN}✅ Security scan passed - no critical issues detected${NC}"
    exit 0
fi