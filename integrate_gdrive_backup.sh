#!/bin/bash
# Integration script to add Google Drive backup support to ordr.fm.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_SCRIPT="$SCRIPT_DIR/ordr.fm.sh"
BACKUP_SCRIPT="$SCRIPT_DIR/gdrive_backup.sh"

echo "=== Integrating Google Drive Backup into ordr.fm.sh ==="
echo

# Check if scripts exist
if [[ ! -f "$MAIN_SCRIPT" ]]; then
    echo "ERROR: ordr.fm.sh not found"
    exit 1
fi

if [[ ! -f "$BACKUP_SCRIPT" ]]; then
    echo "ERROR: gdrive_backup.sh not found"
    exit 1
fi

# Make backup script executable
chmod +x "$BACKUP_SCRIPT"

# Create a backup of the main script
cp "$MAIN_SCRIPT" "${MAIN_SCRIPT}.pre_gdrive_backup"

echo "Adding Google Drive backup integration..."

# Add configuration options to ordr.fm.conf if it exists
if [[ -f "$SCRIPT_DIR/ordr.fm.conf" ]]; then
    if ! grep -q "ENABLE_GDRIVE_BACKUP" "$SCRIPT_DIR/ordr.fm.conf"; then
        cat >> "$SCRIPT_DIR/ordr.fm.conf" <<'EOF'

# Google Drive Backup Configuration
ENABLE_GDRIVE_BACKUP=0                                  # Enable Google Drive backup before moves
GDRIVE_BACKUP_DIR="/ordr.fm_backups"                   # Backup directory in Google Drive
GDRIVE_MOUNT_POINT="/home/pi/gdrive"                   # Local mount point for Google Drive
BACKUP_LOG="./gdrive_backup.log"                       # Backup operation log file
MAX_PARALLEL_UPLOADS=3                                 # Number of parallel upload streams
CHECKSUM_VERIFY=1                                      # Verify backup integrity after upload
BACKUP_DB="./backup_metadata.db"                       # Database for backup metadata
EOF
        echo "Added Google Drive backup configuration to ordr.fm.conf"
    fi
fi

# Add command-line option parsing for --gdrive-backup
sed -i '/^# Parse command-line arguments/a\
        --gdrive-backup)\
            ENABLE_GDRIVE_BACKUP=1\
            Info "Google Drive backup enabled"\
            shift\
            ;;\
        --gdrive-backup-dir)\
            GDRIVE_BACKUP_DIR="$2"\
            shift 2\
            ;;' "$MAIN_SCRIPT"

# Add source line for gdrive_backup.sh after security patch source
sed -i '/source.*security_patch.sh/a\
\
# Source Google Drive backup functions\
if [[ -f "$SCRIPT_DIR/gdrive_backup.sh" ]]; then\
    source "$SCRIPT_DIR/gdrive_backup.sh"\
    [[ "$ENABLE_GDRIVE_BACKUP" == "1" ]] && check_rclone && Info "Google Drive backup integration loaded"\
fi' "$MAIN_SCRIPT"

# Add backup call before actual move operations
# Find the section where actual moves happen and add backup
sed -i '/# Perform the actual move/i\
            # Backup to Google Drive if enabled\
            if [[ "$ENABLE_GDRIVE_BACKUP" == "1" ]] && [[ "$DRY_RUN" != "1" ]]; then\
                Info "Backing up album to Google Drive before move..."\
                if backup_before_move "$album_dir" "$final_album_name" 0; then\
                    Info "Google Drive backup completed"\
                else\
                    Warning "Google Drive backup failed, continuing with move"\
                fi\
            elif [[ "$ENABLE_GDRIVE_BACKUP" == "1" ]] && [[ "$DRY_RUN" == "1" ]]; then\
                Info "(Dry Run) Would backup album to Google Drive: $final_album_name"\
            fi\
' "$MAIN_SCRIPT"

# Add help text for new options
sed -i '/echo "  --verbose/a\
  echo "  --gdrive-backup          Enable Google Drive backup before moves"\
  echo "  --gdrive-backup-dir DIR  Set Google Drive backup directory"' "$MAIN_SCRIPT"

echo
echo "=== Google Drive Backup Integration Complete ==="
echo
echo "To use Google Drive backup:"
echo "  1. Install rclone: curl https://rclone.org/install.sh | sudo bash"
echo "  2. Configure Google Drive: rclone config"
echo "  3. Run with backup: ./ordr.fm.sh --gdrive-backup --move"
echo
echo "Configuration options added to ordr.fm.conf (disabled by default)"
echo "Backup script available at: $BACKUP_SCRIPT"
echo
echo "Standalone backup commands:"
echo "  ./gdrive_backup.sh backup <source_dir> <name>  - Manual backup"
echo "  ./gdrive_backup.sh list                        - List backups"
echo "  ./gdrive_backup.sh restore <backup> <dir>      - Restore backup"