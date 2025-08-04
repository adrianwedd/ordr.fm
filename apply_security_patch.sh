#!/bin/bash
# Apply security patches to ordr.fm.sh
# This script updates the vulnerable functions with secure versions

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_SCRIPT="$SCRIPT_DIR/ordr.fm.sh"
BACKUP_SCRIPT="$SCRIPT_DIR/ordr.fm.sh.backup_$(date +%Y%m%d_%H%M%S)"
PATCH_SCRIPT="$SCRIPT_DIR/security_patch.sh"

echo "=== Applying Security Patches to ordr.fm.sh ==="
echo

# Check if main script exists
if [[ ! -f "$MAIN_SCRIPT" ]]; then
    echo "ERROR: ordr.fm.sh not found at $MAIN_SCRIPT"
    exit 1
fi

# Check if patch script exists
if [[ ! -f "$PATCH_SCRIPT" ]]; then
    echo "ERROR: security_patch.sh not found at $PATCH_SCRIPT"
    exit 1
fi

# Create backup
echo "Creating backup: $BACKUP_SCRIPT"
cp "$MAIN_SCRIPT" "$BACKUP_SCRIPT"

# Source the security patch to load functions
source "$PATCH_SCRIPT"

echo "Applying patches..."

# Create a temporary file for the patched version
TEMP_FILE=$(mktemp)
trap "rm -f $TEMP_FILE" EXIT

# Read the main script and apply patches
{
    # Add security patch source at the beginning (after shebang and initial comments)
    awk '
    BEGIN { patch_added = 0 }
    /^#!/ { print; next }
    /^#/ && !patch_added { print; next }
    !patch_added {
        print "# Source security patches"
        print "SCRIPT_DIR=\"$(cd \"$(dirname \"${BASH_SOURCE[0]}\")\" && pwd)\""
        print "source \"$SCRIPT_DIR/security_patch.sh\" || { echo \"ERROR: Failed to load security patches\"; exit 1; }"
        print ""
        patch_added = 1
    }
    { print }
    ' "$MAIN_SCRIPT"
} > "$TEMP_FILE"

# Replace vulnerable function calls with secure versions
echo "Replacing vulnerable function calls..."

# Function replacements mapping
declare -A replacements=(
    ["record_album_metadata"]="secure_record_album_metadata"
    ["record_track_metadata"]="secure_record_track_metadata"
    ["create_move_record"]="secure_create_move_record"
    ["update_move_record_status"]="secure_update_move_record_status"
)

# Apply replacements
for old_func in "${!replacements[@]}"; do
    new_func="${replacements[$old_func]}"
    echo "  Replacing $old_func with $new_func"
    sed -i "s/\b${old_func}(/\s*${new_func}(/g" "$TEMP_FILE"
done

# Fix direct SQL queries with inline escaping
echo "Fixing inline SQL queries..."

# Fix the duplicate detection INSERT (line ~1709)
sed -i '/VALUES.*album_dir.*album_artist.*album_title/s/"\$\([^"]*\)"/"\$(sql_escape "\$\1")"/g' "$TEMP_FILE"

# Fix the hash-based duplicate query (line ~1733)
sed -i "/SELECT.*FROM albums WHERE album_hash/s/'\$hash'/'\$(sql_escape \"\$hash\")'/" "$TEMP_FILE"

# Fix mv and rm commands to use secure versions
echo "Replacing unsafe file operations..."
sed -i 's/\bmv\s\+"\$\([^"]*\)"\s\+"\$\([^"]*\)"/secure_move_file "\$\1" "\$\2"/g' "$TEMP_FILE"
sed -i 's/\brm\s\+-f\s\+"\$\([^"]*\)"/secure_remove_file "\$\1"/g' "$TEMP_FILE"

# Comment out the original vulnerable function definitions
echo "Disabling original vulnerable functions..."
awk '
/^record_album_metadata\(\)/ { in_func = 1; print "# DEPRECATED - Using secure version"; print "# " $0; next }
/^record_track_metadata\(\)/ { in_func = 1; print "# DEPRECATED - Using secure version"; print "# " $0; next }
/^create_move_record\(\)/ { in_func = 1; print "# DEPRECATED - Using secure version"; print "# " $0; next }
/^update_move_record_status\(\)/ { in_func = 1; print "# DEPRECATED - Using secure version"; print "# " $0; next }
in_func && /^}$/ { print "# " $0; in_func = 0; next }
in_func { print "# " $0; next }
{ print }
' "$TEMP_FILE" > "${TEMP_FILE}.2"
mv "${TEMP_FILE}.2" "$TEMP_FILE"

# Move patched file to replace original
mv "$TEMP_FILE" "$MAIN_SCRIPT"
chmod +x "$MAIN_SCRIPT"

echo
echo "=== Security Patches Applied Successfully ==="
echo
echo "Summary of changes:"
echo "  1. Added SQL escape function for all string inputs"
echo "  2. Replaced vulnerable database functions with secure versions"
echo "  3. Added input validation for numeric fields"
echo "  4. Fixed command injection vulnerabilities in file operations"
echo "  5. Original script backed up to: $BACKUP_SCRIPT"
echo
echo "IMPORTANT: Test the patched script thoroughly before production use!"
echo "Run: ./ordr.fm.sh --dry-run to verify functionality"
echo
echo "To revert changes: cp $BACKUP_SCRIPT $MAIN_SCRIPT"