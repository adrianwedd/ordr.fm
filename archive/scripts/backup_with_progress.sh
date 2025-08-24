#!/bin/bash
# Enhanced backup script with detailed progress display

set -eu

# Colors for beautiful output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
MUSIC_DIR="/home/plex/Music"
GDRIVE_DEST="gdrive:ordr.fm-backup/Music"
LOG_FILE="backup_progress_$(date +%Y%m%d_%H%M%S).log"
STATS_FILE="/tmp/backup_stats_$$.txt"

# Process locking
LOCK_FILE="/tmp/ordr_fm_backup.lock"
PID_FILE="/tmp/ordr_fm_backup.pid"

# Cleanup function
cleanup() {
    rm -f "$LOCK_FILE" "$PID_FILE" "$STATS_FILE"
    tput cnorm # Show cursor
    echo -e "\n${YELLOW}Backup process ended${NC}"
    exit ${1:-0}
}

# Set up signal handlers
trap cleanup INT TERM

# Check for existing backup
if [ -f "$LOCK_FILE" ]; then
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if kill -0 "$OLD_PID" 2>/dev/null; then
            echo -e "${RED}❌ Backup already running (PID: $OLD_PID)${NC}"
            echo -e "   Use 'kill $OLD_PID' to stop it"
            exit 1
        else
            echo -e "${YELLOW}⚠️  Removing stale lock file${NC}"
            rm -f "$LOCK_FILE" "$PID_FILE"
        fi
    fi
fi

# Create lock
touch "$LOCK_FILE"
echo $$ > "$PID_FILE"

# Hide cursor for cleaner display
tput civis

# Header
clear
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}           🎵 ordr.fm Music Backup to Google Drive 🎵          ${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"

# System info
echo -e "${BLUE}📁 Source:${NC} $MUSIC_DIR"
echo -e "${BLUE}☁️  Destination:${NC} $GDRIVE_DEST"
echo -e "${BLUE}📝 Log file:${NC} $LOG_FILE"
echo -e "${BLUE}🕐 Started:${NC} $(date '+%Y-%m-%d %H:%M:%S')\n"

# Check disk space
echo -e "${YELLOW}Checking disk usage...${NC}"
DISK_INFO=$(df -h "$MUSIC_DIR" | tail -1)
DISK_USED=$(echo "$DISK_INFO" | awk '{print $3}')
DISK_AVAIL=$(echo "$DISK_INFO" | awk '{print $4}')
DISK_PERCENT=$(echo "$DISK_INFO" | awk '{print $5}')

echo -e "${GREEN}💾 Disk:${NC} Used: $DISK_USED | Available: $DISK_AVAIL | Usage: $DISK_PERCENT\n"

# Calculate collection size
echo -e "${YELLOW}Calculating collection size...${NC}"
COLLECTION_SIZE=$(du -sh "$MUSIC_DIR" 2>/dev/null | cut -f1)
FILE_COUNT=$(find "$MUSIC_DIR" -type f 2>/dev/null | wc -l)
DIR_COUNT=$(find "$MUSIC_DIR" -type d 2>/dev/null | wc -l)

echo -e "${GREEN}📊 Collection:${NC} $COLLECTION_SIZE | Files: $FILE_COUNT | Folders: $DIR_COUNT\n"

# Test Google Drive connection
echo -e "${YELLOW}Testing Google Drive connection...${NC}"
if rclone lsd "$GDRIVE_DEST" &>/dev/null; then
    echo -e "${GREEN}✅ Google Drive connected successfully${NC}\n"
else
    echo -e "${RED}❌ Failed to connect to Google Drive${NC}"
    echo "Please check your rclone configuration with: rclone config"
    cleanup 1
fi

echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}                    Starting Backup Process                    ${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"

# Function to format bytes
format_bytes() {
    local bytes=$1
    if [ $bytes -lt 1024 ]; then
        echo "${bytes}B"
    elif [ $bytes -lt 1048576 ]; then
        echo "$(echo "scale=1; $bytes/1024" | bc)KB"
    elif [ $bytes -lt 1073741824 ]; then
        echo "$(echo "scale=1; $bytes/1048576" | bc)MB"
    else
        echo "$(echo "scale=2; $bytes/1073741824" | bc)GB"
    fi
}

# Function to parse rclone output and display progress
show_progress() {
    local line="$1"
    
    # Parse transferred data (e.g., "Transferred:   100.234 MiB / 1.234 GiB, 8%, 1.234 MiB/s, ETA 15m30s")
    if [[ "$line" == *"Transferred:"* ]]; then
        # Extract values
        local transferred=$(echo "$line" | sed -n 's/.*Transferred:[[:space:]]*\([^,]*\).*/\1/p')
        local percent=$(echo "$line" | sed -n 's/.*,[[:space:]]*\([0-9]*\)%.*/\1/p')
        local speed=$(echo "$line" | sed -n 's/.*,[[:space:]]*[0-9]*%,[[:space:]]*\([^,]*\).*/\1/p')
        local eta=$(echo "$line" | sed -n 's/.*ETA[[:space:]]*\(.*\)/\1/p')
        
        # Default values if parsing fails
        percent=${percent:-0}
        
        # Calculate progress bar
        local bar_width=50
        local filled=$((percent * bar_width / 100))
        local empty=$((bar_width - filled))
        
        # Build progress bar
        local bar="${GREEN}"
        for ((i=0; i<filled; i++)); do bar+="█"; done
        bar+="${YELLOW}"
        for ((i=0; i<empty; i++)); do bar+="░"; done
        bar+="${NC}"
        
        # Clear line and print progress
        printf "\r${BOLD}Progress:${NC} %s %3d%% | ${CYAN}%s${NC} | Speed: ${MAGENTA}%s${NC} | ETA: ${YELLOW}%s${NC}    " \
               "$bar" "$percent" "$transferred" "$speed" "$eta"
    fi
    
    # Parse file checks (e.g., "Checks: 1234 / 5678, 21%")
    if [[ "$line" == *"Checks:"* ]]; then
        local checks=$(echo "$line" | sed 's/Checks:[[:space:]]*//')
        printf "\n${BLUE}Checking:${NC} %s" "$checks"
    fi
    
    # Parse transfers (e.g., "Transferred: 12 / 100, 12%")
    if [[ "$line" == *"Transferred:"* ]] && [[ "$line" == *"/"* ]] && [[ "$line" != *"MiB"* ]] && [[ "$line" != *"GiB"* ]]; then
        local transfers=$(echo "$line" | sed 's/Transferred:[[:space:]]*//')
        printf "\n${GREEN}Files:${NC} %s" "$transfers"
    fi
    
    # Show errors
    if [[ "$line" == *"ERROR"* ]]; then
        printf "\n${RED}❌ Error:${NC} %s\n" "$line"
    fi
}

# Start rclone with detailed progress
echo -e "${CYAN}Starting rclone sync...${NC}\n"
echo -e "Press ${BOLD}Ctrl+C${NC} to stop (backup will resume automatically next time)\n"

# Run rclone with progress output
{
    rclone sync "$MUSIC_DIR" "$GDRIVE_DEST" \
        --progress \
        --stats 1s \
        --stats-one-line \
        --log-file="$LOG_FILE" \
        --log-level INFO \
        --transfers 4 \
        --checkers 8 \
        --contimeout 60s \
        --timeout 300s \
        --retries 3 \
        --low-level-retries 10 \
        --track-renames \
        --fast-list \
        2>&1
} | while IFS= read -r line; do
    # Save to stats file for final summary
    echo "$line" >> "$STATS_FILE"
    
    # Display progress
    show_progress "$line"
    
    # Also log the raw output
    echo "$line" >> "$LOG_FILE"
done

# Final summary
echo -e "\n\n${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}                    ✅ Backup Complete! ✅                     ${NC}"
echo -e "${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"

# Show final stats if available
if [ -f "$STATS_FILE" ]; then
    echo -e "${BOLD}Final Statistics:${NC}"
    tail -20 "$STATS_FILE" | grep -E "Transferred:|Checks:|Elapsed" | while read -r line; do
        echo "  $line"
    done
fi

echo -e "\n${GREEN}📁 Backup location:${NC} $GDRIVE_DEST"
echo -e "${GREEN}📝 Full log:${NC} $LOG_FILE"
echo -e "${GREEN}🕐 Completed:${NC} $(date '+%Y-%m-%d %H:%M:%S')"

# Cleanup
cleanup 0