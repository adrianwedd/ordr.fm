#!/bin/bash

# ordr.fm Backup Strategy using rclone
# Ensures complete backup before any destructive operations

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_LOG_DIR="$SCRIPT_DIR/backup_logs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_LOG="$BACKUP_LOG_DIR/backup_${TIMESTAMP}.log"

# Create log directory
mkdir -p "$BACKUP_LOG_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1" | tee -a "$BACKUP_LOG"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$BACKUP_LOG"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$BACKUP_LOG"
}

log_backup() {
    echo -e "${BLUE}[BACKUP]${NC} $1" | tee -a "$BACKUP_LOG"
}

# Check if rclone is installed
check_rclone() {
    if ! command -v rclone &> /dev/null; then
        log_error "rclone is not installed!"
        echo "Please install rclone first:"
        echo "  curl https://rclone.org/install.sh | sudo bash"
        echo "Then configure Google Drive:"
        echo "  rclone config"
        exit 1
    fi
    
    log_info "rclone version: $(rclone version | head -n1)"
}

# List configured remotes
list_remotes() {
    log_info "Available rclone remotes:"
    rclone listremotes
    
    if [ "$(rclone listremotes | wc -l)" -eq 0 ]; then
        log_error "No remotes configured!"
        echo ""
        echo "Please configure Google Drive first:"
        echo "  rclone config"
        echo ""
        echo "Follow these steps:"
        echo "1. Choose 'n' for new remote"
        echo "2. Name it 'gdrive' or similar"
        echo "3. Choose '18' for Google Drive"
        echo "4. Follow authentication steps"
        exit 1
    fi
}

# Create backup manifest
create_manifest() {
    local source_dir="$1"
    local manifest_file="$2"
    
    log_info "Creating backup manifest..."
    
    # Generate file list with checksums
    find "$source_dir" -type f \( -name "*.mp3" -o -name "*.flac" -o -name "*.m4a" -o -name "*.wav" -o -name "*.ogg" \) -print0 | \
        while IFS= read -r -d '' file; do
            size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo "0")
            # Use faster checksum for large collections (optional: switch to md5sum for better integrity)
            checksum=$(head -c 1048576 "$file" | md5sum | cut -d' ' -f1)  # First 1MB checksum
            echo "$checksum|$size|$file"
        done > "$manifest_file"
    
    local file_count=$(wc -l < "$manifest_file")
    local total_size=$(awk -F'|' '{sum+=$2} END {print sum}' "$manifest_file")
    local total_gb=$(echo "scale=2; $total_size / 1073741824" | bc)
    
    log_info "Manifest created: $file_count files, ${total_gb}GB total"
}

# Verify existing backup
verify_backup() {
    local remote="$1"
    local remote_path="$2"
    local manifest_file="$3"
    
    log_info "Verifying existing backup on $remote:$remote_path..."
    
    # Check if backup exists
    if ! rclone lsd "$remote:$remote_path" &>/dev/null; then
        log_warning "No existing backup found at $remote:$remote_path"
        return 1
    fi
    
    # Count files in backup
    local remote_count=$(rclone ls "$remote:$remote_path" | wc -l)
    local local_count=$(wc -l < "$manifest_file")
    
    if [ "$remote_count" -lt "$local_count" ]; then
        log_warning "Backup incomplete: $remote_count files on remote, $local_count files locally"
        return 1
    fi
    
    log_info "Backup appears complete: $remote_count files"
    return 0
}

# Perform incremental backup
backup_collection() {
    local source_dir="$1"
    local remote="${2:-gdrive}"
    local remote_base_path="${3:-ordrfm_backup}"
    
    # Validate source
    if [ ! -d "$source_dir" ]; then
        log_error "Source directory does not exist: $source_dir"
        exit 1
    fi
    
    log_backup "Starting backup of: $source_dir"
    log_backup "Destination: $remote:$remote_base_path"
    
    # Create manifest
    local manifest_file="$BACKUP_LOG_DIR/manifest_${TIMESTAMP}.txt"
    create_manifest "$source_dir" "$manifest_file"
    
    # Create remote backup directory with timestamp
    local remote_path="$remote_base_path/backup_${TIMESTAMP}"
    local remote_latest="$remote_base_path/latest"
    
    # Check for existing backup
    if verify_backup "$remote" "$remote_latest" "$manifest_file"; then
        log_info "Existing backup found and verified"
        read -p "Skip backup and use existing? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log_info "Using existing backup"
            return 0
        fi
    fi
    
    # Perform backup with progress
    log_backup "Starting rclone sync..."
    
    # Dry-run first to show what will be copied
    log_info "Running dry-run to calculate changes..."
    rclone sync "$source_dir" "$remote:$remote_path" \
        --dry-run \
        --progress \
        --stats 10s \
        --transfers 4 \
        --checkers 8 \
        --include "*.{mp3,flac,m4a,wav,ogg,MP3,FLAC,M4A,WAV,OGG}" \
        --log-file "$BACKUP_LOG_DIR/rclone_dryrun_${TIMESTAMP}.log" 2>&1 | \
        tee -a "$BACKUP_LOG"
    
    # Ask for confirmation
    echo ""
    read -p "Proceed with actual backup? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_warning "Backup cancelled by user"
        exit 1
    fi
    
    # Actual backup
    log_backup "Running actual backup..."
    rclone sync "$source_dir" "$remote:$remote_path" \
        --progress \
        --stats 10s \
        --transfers 4 \
        --checkers 8 \
        --include "*.{mp3,flac,m4a,wav,ogg,MP3,FLAC,M4A,WAV,OGG}" \
        --log-file "$BACKUP_LOG_DIR/rclone_${TIMESTAMP}.log" \
        --stats-log-level INFO
    
    # Update latest symlink
    log_info "Updating latest pointer..."
    rclone copyto "$BACKUP_LOG_DIR/manifest_${TIMESTAMP}.txt" "$remote:$remote_path/manifest.txt"
    
    # Create/update latest marker
    echo "$remote_path" | rclone rcat "$remote:$remote_base_path/LATEST.txt"
    
    log_backup "Backup completed successfully!"
    
    # Verify backup
    verify_backup "$remote" "$remote_path" "$manifest_file"
    
    # Save backup record
    cat >> "$BACKUP_LOG_DIR/backup_history.log" <<EOF
$TIMESTAMP|$source_dir|$remote:$remote_path|$(wc -l < "$manifest_file")|SUCCESS
EOF
    
    return 0
}

# Restore from backup
restore_backup() {
    local remote="${1:-gdrive}"
    local restore_path="${2:-/tmp/music_restore}"
    local backup_path="${3:-ordrfm_backup/latest}"
    
    log_info "Restoring from $remote:$backup_path to $restore_path"
    
    # Create restore directory
    mkdir -p "$restore_path"
    
    # Check backup exists
    if ! rclone lsd "$remote:$backup_path" &>/dev/null; then
        log_error "Backup not found at $remote:$backup_path"
        echo "Available backups:"
        rclone lsd "$remote:ordrfm_backup/" 2>/dev/null || true
        exit 1
    fi
    
    # Show backup info
    log_info "Backup contents:"
    rclone size "$remote:$backup_path"
    
    # Confirm restore
    read -p "Proceed with restore? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_warning "Restore cancelled"
        exit 1
    fi
    
    # Perform restore
    rclone sync "$remote:$backup_path" "$restore_path" \
        --progress \
        --stats 10s \
        --transfers 4 \
        --log-file "$BACKUP_LOG_DIR/restore_${TIMESTAMP}.log"
    
    log_info "Restore completed to: $restore_path"
}

# Create pre-organization snapshot
create_snapshot() {
    local source_dir="$1"
    local snapshot_file="$BACKUP_LOG_DIR/snapshot_${TIMESTAMP}.json"
    
    log_info "Creating pre-organization snapshot..."
    
    # Create detailed snapshot of current state
    {
        echo "{"
        echo "  \"timestamp\": \"$(date -Iseconds)\","
        echo "  \"source_dir\": \"$source_dir\","
        echo "  \"statistics\": {"
        echo "    \"total_files\": $(find "$source_dir" -type f -name "*.mp3" -o -name "*.flac" | wc -l),"
        echo "    \"total_directories\": $(find "$source_dir" -type d | wc -l),"
        echo "    \"total_size_bytes\": $(du -sb "$source_dir" | cut -f1)"
        echo "  },"
        echo "  \"directory_structure\": ["
        
        # Save directory tree
        find "$source_dir" -type d | sort | while read -r dir; do
            echo "    \"$dir\","
        done | sed '$ s/,$//'
        
        echo "  ]"
        echo "}"
    } > "$snapshot_file"
    
    log_info "Snapshot saved to: $snapshot_file"
}

# Main menu
show_menu() {
    echo -e "${BLUE}=== ordr.fm Backup Manager ===${NC}"
    echo ""
    echo "1. Setup rclone for Google Drive"
    echo "2. Backup music collection"
    echo "3. Verify existing backup"
    echo "4. Restore from backup"
    echo "5. Create pre-organization snapshot"
    echo "6. Show backup history"
    echo "7. Exit"
    echo ""
    read -p "Select option: " choice
    
    case $choice in
        1)
            log_info "Launching rclone config..."
            rclone config
            ;;
        2)
            read -p "Enter source directory path: " source_dir
            read -p "Enter remote name (default: gdrive): " remote
            remote=${remote:-gdrive}
            backup_collection "$source_dir" "$remote"
            ;;
        3)
            read -p "Enter remote name (default: gdrive): " remote
            remote=${remote:-gdrive}
            read -p "Enter backup path (default: ordrfm_backup/latest): " backup_path
            backup_path=${backup_path:-ordrfm_backup/latest}
            
            manifest_temp="/tmp/manifest_verify.txt"
            read -p "Enter local directory to verify against: " local_dir
            create_manifest "$local_dir" "$manifest_temp"
            verify_backup "$remote" "$backup_path" "$manifest_temp"
            ;;
        4)
            read -p "Enter remote name (default: gdrive): " remote
            remote=${remote:-gdrive}
            read -p "Enter restore path (default: /tmp/music_restore): " restore_path
            restore_path=${restore_path:-/tmp/music_restore}
            restore_backup "$remote" "$restore_path"
            ;;
        5)
            read -p "Enter source directory path: " source_dir
            create_snapshot "$source_dir"
            ;;
        6)
            if [ -f "$BACKUP_LOG_DIR/backup_history.log" ]; then
                echo -e "${BLUE}=== Backup History ===${NC}"
                column -t -s'|' "$BACKUP_LOG_DIR/backup_history.log"
            else
                log_info "No backup history found"
            fi
            ;;
        7)
            exit 0
            ;;
        *)
            log_error "Invalid option"
            ;;
    esac
}

# Quick backup function for integration with ordr.fm
quick_backup() {
    local source_dir="${1:-/home/plex/Music}"
    local remote="${2:-gdrive}"
    
    log_backup "Quick backup initiated for: $source_dir"
    
    # Check rclone
    check_rclone
    
    # Check if we have a configured remote
    if ! rclone listremotes | grep -q "$remote"; then
        log_error "Remote '$remote' not configured"
        log_info "Running rclone config..."
        rclone config
    fi
    
    # Create snapshot
    create_snapshot "$source_dir"
    
    # Perform backup
    backup_collection "$source_dir" "$remote"
    
    # Create safety marker
    echo "BACKUP_COMPLETED: $(date -Iseconds)" > "$SCRIPT_DIR/.backup_marker"
    
    log_backup "Quick backup completed. Safe to proceed with organization."
}

# Main execution
main() {
    echo -e "${BLUE}=== ordr.fm Backup Strategy ===${NC}"
    echo "Backup Log: $BACKUP_LOG"
    echo ""
    
    # Check for rclone
    check_rclone
    
    # If called with arguments, run quick backup
    if [ $# -gt 0 ]; then
        case "$1" in
            --quick)
                quick_backup "${2:-/home/plex/Music}"
                ;;
            --backup)
                backup_collection "$2" "${3:-gdrive}"
                ;;
            --restore)
                restore_backup "${2:-gdrive}" "${3:-/tmp/music_restore}"
                ;;
            --verify)
                # Quick verify of last backup
                if [ -f "$BACKUP_LOG_DIR/backup_history.log" ]; then
                    last_backup=$(tail -n1 "$BACKUP_LOG_DIR/backup_history.log")
                    echo "Last backup: $last_backup"
                fi
                ;;
            *)
                echo "Usage: $0 [--quick|--backup SOURCE|--restore|--verify]"
                exit 1
                ;;
        esac
    else
        # Interactive menu
        while true; do
            show_menu
            echo ""
            read -p "Press Enter to continue..."
        done
    fi
}

# Run main
main "$@"