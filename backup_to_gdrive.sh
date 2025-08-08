#\!/bin/bash
# Backup music collection to Google Drive with progress tracking

set -eu

# Process locking to prevent concurrent runs
LOCK_FILE="/tmp/ordr_fm_backup_gdrive.lock"
PID_FILE="/tmp/ordr_fm_backup_gdrive.pid"

# Function to cleanup on exit
cleanup() {
    rm -f "$LOCK_FILE" "$PID_FILE"
    exit ${1:-0}
}

# Set up signal handlers
trap 'echo "Backup interrupted by user"; cleanup 1' INT TERM

# Check if another backup is running
if [ -f "$LOCK_FILE" ]; then
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if kill -0 "$OLD_PID" 2>/dev/null; then
            echo "❌ ERROR: Backup already running (PID: $OLD_PID)"
            echo "   Use 'kill $OLD_PID' to stop it, or wait for completion"
            exit 1
        else
            echo "⚠️  Removing stale lock file (process $OLD_PID no longer exists)"
            rm -f "$LOCK_FILE" "$PID_FILE"
        fi
    else
        echo "⚠️  Removing orphaned lock file"
        rm -f "$LOCK_FILE"
    fi
fi

# Create lock file and store PID
echo $$ > "$PID_FILE"
touch "$LOCK_FILE"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=== ordr.fm Google Drive Backup ===${NC}"
echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"

# Configuration
MUSIC_DIR="/home/plex/Music"
GDRIVE_DEST="gdrive:ordr.fm-backup/Music"
LOG_FILE="/home/pi/repos/ordr.fm/backup_gdrive_$(date +%Y%m%d_%H%M%S).log"

# Check disk space
echo -e "\n${BLUE}[INFO]${NC} Current disk usage:"
df -h /

# Estimate size
echo -e "\n${BLUE}[INFO]${NC} Estimating backup size..."
TOTAL_SIZE=$(du -sh "$MUSIC_DIR" 2>/dev/null | cut -f1)
echo "Total music collection size: $TOTAL_SIZE"

# Test connection
echo -e "\n${BLUE}[INFO]${NC} Testing Google Drive connection..."
if rclone lsd gdrive: > /dev/null 2>&1; then
    echo -e "${GREEN}[OK]${NC} Google Drive connection successful"
else
    echo -e "${RED}[ERROR]${NC} Failed to connect to Google Drive"
    exit 1
fi

# Perform backup with progress
echo -e "\n${BLUE}[INFO]${NC} Starting backup to Google Drive..."
echo "This may take several hours for 690GB..."
echo "Log file: $LOG_FILE"

# Use rclone with optimal settings for large backup
rclone sync "$MUSIC_DIR" "$GDRIVE_DEST" \
    --progress \
    --transfers 4 \
    --checkers 8 \
    --tpslimit 10 \
    --drive-chunk-size 128M \
    --buffer-size 256M \
    --log-file="$LOG_FILE" \
    --log-level INFO \
    --stats 30s \
    --exclude "*.tmp" \
    --exclude "*.temp" \
    --exclude ".DS_Store" \
    --exclude "Thumbs.db"

# Check result
if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}[SUCCESS]${NC} Backup completed successfully\!"
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Backup to Google Drive completed" > /home/pi/repos/ordr.fm/.last_backup
    
    # Show summary
    echo -e "\n${BLUE}[INFO]${NC} Backup summary:"
    rclone size "$GDRIVE_DEST"
    
    echo -e "\n${BLUE}[INFO]${NC} Disk space after backup:"
    df -h /
    
    # Cleanup and exit successfully
    cleanup 0
else
    echo -e "\n${RED}[ERROR]${NC} Backup failed\! Check log: $LOG_FILE"
    cleanup 1
fi
