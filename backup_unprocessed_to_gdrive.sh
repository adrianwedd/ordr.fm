#!/bin/bash

# Backup Unprocessed Music Folders to Google Drive
# This script backs up folders that haven't been processed by ordr.fm yet

set -e

# Configuration
SOURCE_DIRS=(
    "/home/plex/Music/Unsorted and Incomplete/Unsorted Tracks"
    "/home/plex/Music/Unsorted and Incomplete/Incomplete Albums"
    "/home/plex/Music/Music"
)
GDRIVE_BACKUP_FOLDER="ordr.fm-unprocessed-backup"
LOG_FILE="backup_unprocessed.log"
DRY_RUN=${1:-false}

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to check if rclone is configured
check_rclone() {
    if ! command -v rclone >/dev/null 2>&1; then
        log "ERROR: rclone is not installed. Please install: curl https://rclone.org/install.sh | sudo bash"
        exit 1
    fi
    
    if ! rclone listremotes | grep -q "gdrive:"; then
        log "ERROR: Google Drive remote 'gdrive' not configured."
        log "Please run: rclone config"
        log "And set up a Google Drive remote named 'gdrive'"
        exit 1
    fi
    
    log "✅ rclone configured with Google Drive"
}

# Function to get folder size
get_folder_size() {
    local folder="$1"
    if [ -d "$folder" ]; then
        du -sh "$folder" 2>/dev/null | cut -f1 || echo "0B"
    else
        echo "0B"
    fi
}

# Function to count audio files
count_audio_files() {
    local folder="$1"
    if [ -d "$folder" ]; then
        find "$folder" -type f \( -iname "*.mp3" -o -iname "*.flac" -o -iname "*.wav" -o -iname "*.m4a" -o -iname "*.aac" -o -iname "*.ogg" -o -iname "*.aiff" -o -iname "*.alac" \) 2>/dev/null | wc -l
    else
        echo "0"
    fi
}

# Function to backup a directory
backup_directory() {
    local source_dir="$1"
    local dir_name=$(basename "$source_dir")
    local gdrive_path="gdrive:${GDRIVE_BACKUP_FOLDER}/${dir_name}"
    
    if [ ! -d "$source_dir" ]; then
        log "⚠️  Source directory not found: $source_dir"
        return 1
    fi
    
    local size=$(get_folder_size "$source_dir")
    local audio_count=$(count_audio_files "$source_dir")
    
    log "📁 Backing up: $source_dir"
    log "   Size: $size | Audio files: $audio_count"
    
    if [ "$audio_count" -eq 0 ]; then
        log "   ⚠️  No audio files found, skipping"
        return 0
    fi
    
    if [ "$DRY_RUN" = "true" ]; then
        log "   🔍 DRY RUN: Would sync to $gdrive_path"
        return 0
    fi
    
    # Create backup folder if it doesn't exist
    if ! rclone lsf "gdrive:${GDRIVE_BACKUP_FOLDER}/" >/dev/null 2>&1; then
        log "   📂 Creating backup folder: $GDRIVE_BACKUP_FOLDER"
        rclone mkdir "gdrive:${GDRIVE_BACKUP_FOLDER}/"
    fi
    
    # Sync directory to Google Drive
    log "   ⬆️  Syncing to Google Drive..."
    if rclone sync "$source_dir" "$gdrive_path" \
        --progress \
        --exclude "*.log" \
        --exclude "**/.*" \
        --exclude "**/*.tmp" \
        --transfers 4 \
        --checkers 8 \
        --contimeout 60s \
        --timeout 300s \
        --retries 3; then
        log "   ✅ Successfully backed up $dir_name"
        
        # Create backup manifest
        local manifest_file="/tmp/${dir_name}_backup_manifest.txt"
        cat > "$manifest_file" << EOF
# ordr.fm Unprocessed Backup Manifest
# Generated: $(date '+%Y-%m-%d %H:%M:%S')

Source: $source_dir
Destination: $gdrive_path
Size: $size
Audio Files: $audio_count
Backup Date: $(date -Iseconds)
Host: $(hostname)
Script Version: 1.0.0

# Directory Structure:
$(find "$source_dir" -type d 2>/dev/null | head -20)

# Audio Files Sample (first 10):
$(find "$source_dir" -type f \( -iname "*.mp3" -o -iname "*.flac" \) 2>/dev/null | head -10)
EOF
        
        # Upload manifest
        rclone copy "$manifest_file" "gdrive:${GDRIVE_BACKUP_FOLDER}/" --no-traverse
        rm -f "$manifest_file"
        
        return 0
    else
        log "   ❌ Failed to backup $dir_name"
        return 1
    fi
}

# Function to verify backup
verify_backup() {
    local source_dir="$1"
    local dir_name=$(basename "$source_dir")
    local gdrive_path="gdrive:${GDRIVE_BACKUP_FOLDER}/${dir_name}"
    
    log "🔍 Verifying backup: $dir_name"
    
    # Check if backup exists
    if ! rclone lsf "$gdrive_path" >/dev/null 2>&1; then
        log "   ❌ Backup not found in Google Drive"
        return 1
    fi
    
    # Get file counts
    local source_count=$(find "$source_dir" -type f 2>/dev/null | wc -l)
    local backup_count=$(rclone size "$gdrive_path" --json 2>/dev/null | jq -r '.count // 0')
    
    log "   Files - Source: $source_count | Backup: $backup_count"
    
    if [ "$source_count" -eq "$backup_count" ]; then
        log "   ✅ File count matches"
        return 0
    else
        log "   ⚠️  File count mismatch - backup may be incomplete"
        return 1
    fi
}

# Main execution
main() {
    log "🎵 Starting ordr.fm unprocessed folders backup to Google Drive"
    log "Mode: $([ "$DRY_RUN" = "true" ] && echo "DRY RUN" || echo "LIVE BACKUP")"
    
    # Check prerequisites
    check_rclone
    
    local success_count=0
    local total_count=0
    local total_size=0
    
    # Backup each source directory
    for source_dir in "${SOURCE_DIRS[@]}"; do
        ((total_count++))
        
        if backup_directory "$source_dir"; then
            ((success_count++))
            
            # Verify backup unless it's a dry run
            if [ "$DRY_RUN" != "true" ]; then
                verify_backup "$source_dir"
            fi
        fi
    done
    
    # Summary
    log ""
    log "📊 Backup Summary:"
    log "   Total directories: $total_count"
    log "   Successfully backed up: $success_count"
    log "   Failed: $((total_count - success_count))"
    
    if [ "$success_count" -eq "$total_count" ]; then
        log "🎉 All unprocessed folders backed up successfully!"
        exit 0
    else
        log "⚠️  Some backups failed. Check logs above."
        exit 1
    fi
}

# Command line usage
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    cat << EOF
ordr.fm Unprocessed Folders Backup Script

Usage: $0 [dry-run]

Arguments:
  dry-run    Run in dry-run mode (show what would be done)

Examples:
  $0                # Live backup
  $0 dry-run       # Dry run mode
  $0 --help        # Show this help

Prerequisites:
- rclone installed and configured with 'gdrive' remote
- Access to source directories
- Internet connection for Google Drive upload

The script backs up these directories:
- /home/plex/Music/Unsorted and Incomplete/Unsorted Tracks
- /home/plex/Music/Unsorted and Incomplete/Incomplete Albums  
- /home/plex/Music/Music

Backup destination: gdrive:ordr.fm-unprocessed-backup/
EOF
    exit 0
fi

# Run main function
main "$@"