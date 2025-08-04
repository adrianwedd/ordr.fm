#!/bin/bash
# Integrate alias validation into ordr.fm.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_SCRIPT="$SCRIPT_DIR/ordr.fm.sh"
VALIDATION_SCRIPT="$SCRIPT_DIR/alias_validation.sh"

echo "=== Integrating Alias Validation ==="
echo

# Check if scripts exist
if [[ ! -f "$MAIN_SCRIPT" ]]; then
    echo "ERROR: ordr.fm.sh not found"
    exit 1
fi

if [[ ! -f "$VALIDATION_SCRIPT" ]]; then
    echo "ERROR: alias_validation.sh not found"
    exit 1
fi

# Make validation script executable
chmod +x "$VALIDATION_SCRIPT"

# Create backup
cp "$MAIN_SCRIPT" "${MAIN_SCRIPT}.pre_alias_validation"

echo "Adding alias validation..."

# Add source line for alias_validation.sh
sed -i '/source.*alias_optimization.sh/a\
\
# Source alias validation\
if [[ -f "$SCRIPT_DIR/alias_validation.sh" ]]; then\
    source "$SCRIPT_DIR/alias_validation.sh"\
fi' "$MAIN_SCRIPT"

# Add validation check after configuration loading
sed -i '/parse_alias_groups_once/a\
    # Validate alias configuration\
    if [[ "$GROUP_ARTIST_ALIASES" == "1" ]] && [[ -n "$ARTIST_ALIAS_GROUPS" ]]; then\
        if ! validate_artist_aliases "$ARTIST_ALIAS_GROUPS" "0" > /dev/null 2>&1; then\
            Warning "Artist alias configuration has errors. Run: ./alias_validation.sh validate"\
            if [[ "$STRICT_MODE" == "1" ]]; then\
                Error "Exiting due to invalid alias configuration (strict mode)"\
                exit 1\
            fi\
        fi\
    fi' "$MAIN_SCRIPT"

# Add command-line option for validation
sed -i '/^# Parse command-line arguments/a\
        --validate-aliases)\
            source "$SCRIPT_DIR/alias_validation.sh" 2>/dev/null || true\
            validate_artist_aliases "$ARTIST_ALIAS_GROUPS" "1"\
            exit $?\
            ;;\
        --fix-aliases)\
            source "$SCRIPT_DIR/alias_validation.sh" 2>/dev/null || true\
            validate_artist_aliases "$ARTIST_ALIAS_GROUPS" "0"\
            echo\
            suggest_alias_fixes "$ARTIST_ALIAS_GROUPS"\
            exit 0\
            ;;' "$MAIN_SCRIPT"

# Add help text for new options
sed -i '/echo "  --gdrive-backup-dir DIR/a\
  echo "  --validate-aliases       Validate artist alias configuration"\
  echo "  --fix-aliases           Suggest fixes for alias configuration"' "$MAIN_SCRIPT"

# Add strict mode configuration option
if [[ -f "$SCRIPT_DIR/ordr.fm.conf" ]]; then
    if ! grep -q "STRICT_MODE" "$SCRIPT_DIR/ordr.fm.conf"; then
        cat >> "$SCRIPT_DIR/ordr.fm.conf" <<'EOF'

# Validation Configuration
STRICT_MODE=0                                           # Exit on validation errors (0=warn only, 1=strict)
EOF
        echo "Added strict mode configuration to ordr.fm.conf"
    fi
fi

echo
echo "=== Alias Validation Integrated ==="
echo
echo "New features:"
echo "  - Automatic validation on startup"
echo "  - Detection of duplicate aliases across groups"
echo "  - Whitespace and special character warnings"
echo "  - Conflict detection (primary as alias in another group)"
echo
echo "Usage:"
echo "  ./ordr.fm.sh --validate-aliases    # Validate configuration"
echo "  ./ordr.fm.sh --fix-aliases        # Get fix suggestions"
echo "  ./alias_validation.sh test        # Test alias resolution"
echo
echo "To enable strict mode (exit on errors), set STRICT_MODE=1 in ordr.fm.conf"