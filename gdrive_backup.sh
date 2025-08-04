#!/bin/bash
# Google Drive Backup Integration for ordr.fm
# Provides backup functionality before moving files

set -e

# Configuration
GDRIVE_BACKUP_DIR="${GDRIVE_BACKUP_DIR:-/home/pi/gdrive/ordr.fm_backups}"
GDRIVE_MOUNT_POINT="${GDRIVE_MOUNT_POINT:-/home/pi/gdrive}"
BACKUP_LOG="${BACKUP_LOG:-./gdrive_backup.log}"
MAX_PARALLEL_UPLOADS="${MAX_PARALLEL_UPLOADS:-3}"
CHECKSUM_VERIFY="${CHECKSUM_VERIFY:-1}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging function
log_message() {
    local level="$1"
    local message="$2"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" >> "$BACKUP_LOG"
    
    case "$level" in
        ERROR) echo -e "${RED}[ERROR]${NC} $message" >&2 ;;
        WARNING) echo -e "${YELLOW}[WARNING]${NC} $message" >&2 ;;
        INFO) echo -e "${GREEN}[INFO]${NC} $message" ;;
        DEBUG) [[ "$VERBOSE" == "1" ]] && echo "[DEBUG] $message" ;;
    esac
}

# Check if rclone is installed and configured
check_rclone() {
    if ! command -v rclone &> /dev/null; then
        log_message "ERROR" "rclone is not installed. Please install it first:"
        echo "  curl https://rclone.org/install.sh | sudo bash"
        return 1
    fi
    
    # Check if Google Drive remote is configured
    if ! rclone listremotes | grep -q "gdrive:"; then
        log_message "ERROR" "Google Drive remote not configured. Run: rclone config"
        return 1
    fi
    
    return 0
}

# Mount Google Drive if not already mounted
mount_gdrive() {
    if [[ ! -d "$GDRIVE_MOUNT_POINT" ]]; then
        mkdir -p "$GDRIVE_MOUNT_POINT"
    fi
    
    # Check if already mounted
    if mountpoint -q "$GDRIVE_MOUNT_POINT"; then
        log_message "INFO" "Google Drive already mounted at $GDRIVE_MOUNT_POINT"
        return 0
    fi
    
    log_message "INFO" "Mounting Google Drive..."
    rclone mount gdrive: "$GDRIVE_MOUNT_POINT" \
        --daemon \
        --vfs-cache-mode writes \
        --vfs-cache-max-size 100M \
        --allow-other \
        --allow-non-empty
    
    # Wait for mount to be ready
    sleep 2
    
    if mountpoint -q "$GDRIVE_MOUNT_POINT"; then
        log_message "INFO" "Google Drive mounted successfully"
        return 0
    else
        log_message "ERROR" "Failed to mount Google Drive"
        return 1
    fi
}

# Calculate MD5 checksum
calculate_checksum() {
    local file="$1"
    md5sum "$file" | cut -d' ' -f1
}

# Backup a single album directory to Google Drive
backup_album() {
    local source_dir="$1"
    local backup_name="$2"
    local dry_run="${3:-0}"
    
    if [[ ! -d "$source_dir" ]]; then
        log_message "ERROR" "Source directory does not exist: $source_dir"
        return 1
    fi
    
    # Create backup path with timestamp
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    local album_name=$(basename "$source_dir")
    local backup_path="$GDRIVE_BACKUP_DIR/${timestamp}_${backup_name}"
    
    if [[ "$dry_run" == "1" ]]; then
        log_message "INFO" "(DRY RUN) Would backup: $source_dir -> gdrive:$backup_path"
        
        # Show what would be backed up
        local file_count=$(find "$source_dir" -type f | wc -l)
        local total_size=$(du -sh "$source_dir" | cut -f1)
        log_message "INFO" "(DRY RUN) Album: $album_name ($file_count files, $total_size)"
        
        return 0
    fi
    
    log_message "INFO" "Backing up album: $album_name"
    
    # Use rclone for direct upload (no need for local mount)
    rclone copy "$source_dir" "gdrive:$backup_path" \
        --progress \
        --transfers "$MAX_PARALLEL_UPLOADS" \
        --checkers 8 \
        --buffer-size 16M \
        --drive-chunk-size 32M \
        --log-file "$BACKUP_LOG" \
        --log-level INFO
    
    local result=$?
    
    if [[ $result -eq 0 ]]; then
        log_message "INFO" "Backup completed: $album_name -> $backup_path"
        
        # Verify backup if enabled
        if [[ "$CHECKSUM_VERIFY" == "1" ]]; then
            verify_backup "$source_dir" "gdrive:$backup_path"
        fi
        
        # Record backup in database
        record_backup_metadata "$source_dir" "$backup_path" "$timestamp"
        
        return 0
    else
        log_message "ERROR" "Backup failed for: $album_name (exit code: $result)"
        return 1
    fi
}

# Verify backup integrity
verify_backup() {
    local source_dir="$1"
    local backup_path="$2"
    
    log_message "INFO" "Verifying backup integrity..."
    
    # Use rclone check for verification
    rclone check "$source_dir" "$backup_path" \
        --one-way \
        --size-only \
        --log-file "$BACKUP_LOG" \
        --log-level ERROR
    
    if [[ $? -eq 0 ]]; then
        log_message "INFO" "Backup verification successful"
        return 0
    else
        log_message "WARNING" "Backup verification found differences"
        return 1
    fi
}

# Record backup metadata in SQLite database
record_backup_metadata() {
    local source_path="$1"
    local backup_path="$2"
    local timestamp="$3"
    
    local db_file="${BACKUP_DB:-./backup_metadata.db}"
    
    # Create database if it doesn't exist
    if [[ ! -f "$db_file" ]]; then
        sqlite3 "$db_file" <<EOF
CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL,
    backup_path TEXT NOT NULL,
    backup_timestamp TEXT NOT NULL,
    file_count INTEGER,
    total_size INTEGER,
    status TEXT DEFAULT 'COMPLETED',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_source_path ON backups(source_path);
CREATE INDEX idx_timestamp ON backups(backup_timestamp);
EOF
    fi
    
    # Calculate statistics
    local file_count=$(find "$source_path" -type f | wc -l)
    local total_size=$(du -sb "$source_path" | cut -f1)
    
    # Escape paths for SQL
    source_path=$(echo "$source_path" | sed "s/'/''/g")
    backup_path=$(echo "$backup_path" | sed "s/'/''/g")
    
    sqlite3 "$db_file" <<EOF
INSERT INTO backups (source_path, backup_path, backup_timestamp, file_count, total_size)
VALUES ('$source_path', '$backup_path', '$timestamp', $file_count, $total_size);
EOF
    
    log_message "DEBUG" "Backup metadata recorded in database"
}

# Restore album from Google Drive backup
restore_album() {
    local backup_path="$1"
    local restore_dir="$2"
    
    log_message "INFO" "Restoring from backup: $backup_path"
    
    rclone copy "gdrive:$backup_path" "$restore_dir" \
        --progress \
        --transfers "$MAX_PARALLEL_UPLOADS" \
        --checkers 8 \
        --buffer-size 16M \
        --log-file "$BACKUP_LOG" \
        --log-level INFO
    
    if [[ $? -eq 0 ]]; then
        log_message "INFO" "Restore completed: $backup_path -> $restore_dir"
        return 0
    else
        log_message "ERROR" "Restore failed from: $backup_path"
        return 1
    fi
}

# List available backups
list_backups() {
    local filter="${1:-}"
    
    log_message "INFO" "Listing available backups..."
    
    if [[ -n "$filter" ]]; then
        rclone ls "gdrive:$GDRIVE_BACKUP_DIR" --max-depth 1 | grep "$filter"
    else
        rclone ls "gdrive:$GDRIVE_BACKUP_DIR" --max-depth 1
    fi
}

# Clean up old backups (keep last N backups per album)
cleanup_old_backups() {
    local keep_count="${1:-5}"
    local db_file="${BACKUP_DB:-./backup_metadata.db}"
    
    if [[ ! -f "$db_file" ]]; then
        log_message "WARNING" "No backup database found"
        return 1
    fi
    
    log_message "INFO" "Cleaning up old backups (keeping last $keep_count per album)..."
    
    # Get unique source paths
    local source_paths=$(sqlite3 "$db_file" "SELECT DISTINCT source_path FROM backups;")
    
    while IFS= read -r source_path; do
        # Get backup paths to delete (older than keep_count)
        local old_backups=$(sqlite3 "$db_file" "
            SELECT backup_path FROM backups 
            WHERE source_path = '$source_path'
            ORDER BY backup_timestamp DESC
            LIMIT -1 OFFSET $keep_count;
        ")
        
        while IFS= read -r backup_path; do
            if [[ -n "$backup_path" ]]; then
                log_message "INFO" "Removing old backup: $backup_path"
                rclone delete "gdrive:$backup_path" --rmdirs
                
                # Update database
                sqlite3 "$db_file" "UPDATE backups SET status = 'DELETED' WHERE backup_path = '$backup_path';"
            fi
        done <<< "$old_backups"
    done <<< "$source_paths"
    
    log_message "INFO" "Cleanup completed"
}

# Integration function for ordr.fm.sh
backup_before_move() {
    local source_dir="$1"
    local album_name="$2"
    local dry_run="${3:-0}"
    
    # Check if backup is enabled
    if [[ "${ENABLE_GDRIVE_BACKUP:-0}" != "1" ]]; then
        return 0
    fi
    
    # Check rclone
    if ! check_rclone; then
        log_message "WARNING" "Google Drive backup disabled - rclone not configured"
        return 0
    fi
    
    # Perform backup
    backup_album "$source_dir" "$album_name" "$dry_run"
    
    return $?
}

# Main function for standalone usage
main() {
    local command="${1:-}"
    shift || true
    
    case "$command" in
        backup)
            backup_album "$@"
            ;;
        restore)
            restore_album "$@"
            ;;
        list)
            list_backups "$@"
            ;;
        cleanup)
            cleanup_old_backups "$@"
            ;;
        mount)
            mount_gdrive
            ;;
        verify)
            verify_backup "$@"
            ;;
        *)
            echo "Usage: $0 {backup|restore|list|cleanup|mount|verify} [options]"
            echo ""
            echo "Commands:"
            echo "  backup <source_dir> <backup_name> [dry_run]  - Backup album to Google Drive"
            echo "  restore <backup_path> <restore_dir>           - Restore album from backup"
            echo "  list [filter]                                 - List available backups"
            echo "  cleanup [keep_count]                         - Remove old backups"
            echo "  mount                                        - Mount Google Drive"
            echo "  verify <source> <backup>                    - Verify backup integrity"
            exit 1
            ;;
    esac
}

# Export functions for use in ordr.fm.sh
export -f backup_before_move
export -f check_rclone
export -f backup_album
export -f restore_album

# Run main if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi