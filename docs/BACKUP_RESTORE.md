# Backup and Restore Procedures

Complete guide for backing up and restoring ordr.fm music collections and databases.

## 📋 Overview

ordr.fm implements a comprehensive backup strategy to protect your music collection and organization metadata. This document covers setup, automation, monitoring, and recovery procedures.

## 🎯 Backup Strategy (3-2-1 Rule)

- **3 copies**: Original + 2 backups
- **2 different media**: Local drive + Cloud storage  
- **1 offsite**: Google Drive/cloud backup

### What Gets Backed Up

1. **Music Collection** - Complete organized music library
2. **Metadata Databases** - SQLite databases with organization data
3. **Configuration Files** - ordr.fm.conf and custom settings
4. **Cache Data** - Discogs cache and processed metadata
5. **Logs** - Processing logs and operation history

## ⚙️ Initial Setup

### Prerequisites

- **rclone** installed and configured
- **Google Drive API** credentials (recommended)
- Sufficient storage space (3x your collection size minimum)

### Install rclone

```bash
# Ubuntu/Debian
sudo apt install rclone

# macOS
brew install rclone

# Or download directly
curl https://rclone.org/install.sh | sudo bash
```

### Configure Google Drive

```bash
# Interactive setup
rclone config

# Choose: 
# - New remote: gdrive
# - Storage: Google Drive
# - Follow OAuth flow
# - Test with: rclone lsd gdrive:
```

## 🚀 Backup Procedures

### Automated Backup Script

The included `backup_to_gdrive.sh` script provides comprehensive backup functionality:

```bash
#!/bin/bash
# Enhanced backup script with verification

# Configuration
SOURCE_DIR="/path/to/your/music"
BACKUP_NAME="ordr.fm-backup"
LOG_FILE="backup_$(date +%Y%m%d_%H%M%S).log"

# Create timestamped backup
echo "=== ordr.fm Google Drive Backup ===" | tee -a "$LOG_FILE"
echo "Timestamp: $(date)" | tee -a "$LOG_FILE"

# Check disk space
echo "Current disk usage:" | tee -a "$LOG_FILE"
df -h | head -2 | tee -a "$LOG_FILE"

# Estimate backup size
COLLECTION_SIZE=$(du -sh "$SOURCE_DIR" 2>/dev/null | cut -f1)
echo "Music collection size: $COLLECTION_SIZE" | tee -a "$LOG_FILE"

# Test connectivity
echo "Testing Google Drive connection..." | tee -a "$LOG_FILE"
if ! rclone lsd gdrive: > /dev/null 2>&1; then
    echo "❌ Google Drive connection failed" | tee -a "$LOG_FILE"
    exit 1
fi
echo "✅ Google Drive connection successful" | tee -a "$LOG_FILE"

# Perform backup with progress
echo "Starting backup to Google Drive..." | tee -a "$LOG_FILE"
rclone sync "$SOURCE_DIR" "gdrive:$BACKUP_NAME" \
    --progress \
    --transfers 4 \
    --checkers 8 \
    --retries 3 \
    --log-file "$LOG_FILE" \
    --log-level INFO

# Verify backup
echo "Verifying backup integrity..." | tee -a "$LOG_FILE"
rclone check "$SOURCE_DIR" "gdrive:$BACKUP_NAME" --log-file "$LOG_FILE"

echo "Backup completed: $(date)" | tee -a "$LOG_FILE"
```

### Manual Backup Commands

```bash
# Full collection backup
rclone sync /path/to/music gdrive:ordr.fm-backup --progress

# Database backup only
rclone copy ordr.fm.metadata.db gdrive:ordr.fm-backup/databases/
rclone copy ordr.fm.state.db gdrive:ordr.fm-backup/databases/

# Configuration backup
rclone copy ordr.fm.conf gdrive:ordr.fm-backup/config/

# Incremental backup (only changed files)
rclone sync /path/to/music gdrive:ordr.fm-backup --update --progress
```

### Backup Verification

```bash
# Check backup integrity
rclone check /path/to/music gdrive:ordr.fm-backup

# Compare file counts
echo "Local files: $(find /path/to/music -type f | wc -l)"
echo "Backup files: $(rclone ls gdrive:ordr.fm-backup | wc -l)"

# Verify specific directories
rclone lsd gdrive:ordr.fm-backup --max-depth 2
```

## 📅 Backup Scheduling

### Automated Cron Jobs

```bash
# Edit crontab
crontab -e

# Add backup schedules:

# Daily incremental backup at 2 AM
0 2 * * * /path/to/ordr.fm/backup_to_gdrive.sh >> /var/log/ordr.fm-backup.log 2>&1

# Weekly full verification at Sunday 3 AM  
0 3 * * 0 rclone check /path/to/music gdrive:ordr.fm-backup >> /var/log/ordr.fm-verify.log 2>&1

# Monthly cleanup of old logs (keep 90 days)
0 4 1 * * find /path/to/ordr.fm -name "backup_*.log" -mtime +90 -delete
```

### Systemd Timer (Alternative)

```bash
# Create backup service
sudo tee /etc/systemd/system/ordr-fm-backup.service << 'EOF'
[Unit]
Description=ordr.fm Backup Service
After=network.target

[Service]
Type=oneshot
User=pi
ExecStart=/home/pi/repos/ordr.fm/backup_to_gdrive.sh
WorkingDirectory=/home/pi/repos/ordr.fm
EOF

# Create backup timer
sudo tee /etc/systemd/system/ordr-fm-backup.timer << 'EOF'
[Unit]
Description=ordr.fm Daily Backup
Requires=ordr-fm-backup.service

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
EOF

# Enable and start
sudo systemctl enable ordr-fm-backup.timer
sudo systemctl start ordr-fm-backup.timer
```

## 📊 Backup Monitoring

### Health Checks

```bash
#!/bin/bash
# backup_health_check.sh

# Check last backup age
LAST_BACKUP=$(rclone lsl gdrive:ordr.fm-backup | head -1 | awk '{print $2, $3}')
if [ -z "$LAST_BACKUP" ]; then
    echo "❌ No backup found"
    exit 1
fi

# Check backup size
BACKUP_SIZE=$(rclone size gdrive:ordr.fm-backup | grep "Total size" | awk '{print $3}')
LOCAL_SIZE=$(du -sb /path/to/music | awk '{print $1}')

if [ "$BACKUP_SIZE" -lt $((LOCAL_SIZE * 90 / 100)) ]; then
    echo "⚠️  Backup size significantly smaller than local collection"
fi

echo "✅ Backup health check passed"
echo "Last backup: $LAST_BACKUP"
echo "Backup size: $BACKUP_SIZE bytes"
```

### Monitoring Alerts

```bash
# Email notification on backup failure
if ! /path/to/backup_to_gdrive.sh; then
    echo "ordr.fm backup failed at $(date)" | \
    mail -s "Backup Failure Alert" admin@example.com
fi

# Slack notification (requires webhook URL)
SLACK_WEBHOOK="your_webhook_url"
curl -X POST -H 'Content-type: application/json' \
    --data '{"text":"📦 ordr.fm backup completed successfully"}' \
    $SLACK_WEBHOOK
```

## 🔄 Restore Procedures

### Full Collection Restore

```bash
#!/bin/bash
# restore_from_backup.sh

BACKUP_SOURCE="gdrive:ordr.fm-backup"
RESTORE_TARGET="/path/to/restore/location"
LOG_FILE="restore_$(date +%Y%m%d_%H%M%S).log"

echo "=== ordr.fm Collection Restore ===" | tee -a "$LOG_FILE"
echo "Restore started: $(date)" | tee -a "$LOG_FILE"

# Create restore directory
mkdir -p "$RESTORE_TARGET"

# Verify backup exists
if ! rclone lsd "$BACKUP_SOURCE" > /dev/null 2>&1; then
    echo "❌ Backup not found at $BACKUP_SOURCE" | tee -a "$LOG_FILE"
    exit 1
fi

# Check available space
BACKUP_SIZE=$(rclone size "$BACKUP_SOURCE" | grep "Total size" | awk '{print $3}')
AVAILABLE_SPACE=$(df "$RESTORE_TARGET" | tail -1 | awk '{print $4 * 1024}')

if [ "$BACKUP_SIZE" -gt "$AVAILABLE_SPACE" ]; then
    echo "❌ Insufficient disk space for restore" | tee -a "$LOG_FILE"
    exit 1
fi

# Perform restore
echo "Restoring collection from backup..." | tee -a "$LOG_FILE"
rclone sync "$BACKUP_SOURCE" "$RESTORE_TARGET" \
    --progress \
    --transfers 4 \
    --checkers 8 \
    --log-file "$LOG_FILE" \
    --log-level INFO

# Verify restore
echo "Verifying restored files..." | tee -a "$LOG_FILE"
rclone check "$BACKUP_SOURCE" "$RESTORE_TARGET" --log-file "$LOG_FILE"

# Restore permissions
find "$RESTORE_TARGET" -type f -exec chmod 644 {} \;
find "$RESTORE_TARGET" -type d -exec chmod 755 {} \;

echo "Restore completed: $(date)" | tee -a "$LOG_FILE"
echo "✅ Collection restored to: $RESTORE_TARGET"
```

### Selective Restore

```bash
# Restore specific artist
rclone copy "gdrive:ordr.fm-backup/Lossless/Artist Name" \
    "/path/to/restore/Artist Name" --progress

# Restore specific album
rclone copy "gdrive:ordr.fm-backup/Lossless/Artist/Album (Year)" \
    "/path/to/restore/" --progress

# Restore databases only
rclone copy "gdrive:ordr.fm-backup/databases/" . --progress

# Restore configuration
rclone copy "gdrive:ordr.fm-backup/config/ordr.fm.conf" . --progress
```

### Emergency Recovery

```bash
#!/bin/bash
# emergency_recovery.sh - Minimal restore for immediate access

TEMP_RESTORE="/tmp/ordr-fm-emergency"
mkdir -p "$TEMP_RESTORE"

echo "🚨 Emergency Recovery Mode"
echo "Restoring essential files to $TEMP_RESTORE"

# Restore databases first (small, critical)
rclone copy gdrive:ordr.fm-backup/databases/ "$TEMP_RESTORE/" --progress

# Restore recent additions (last 30 days)
rclone copy gdrive:ordr.fm-backup/ "$TEMP_RESTORE/" \
    --max-age 30d --progress

echo "✅ Emergency files restored"
echo "Database: $TEMP_RESTORE/ordr.fm.metadata.db"
echo "Recent music: $TEMP_RESTORE/"
```

## 🔧 Troubleshooting

### Common Issues

#### Authentication Expired
```bash
# Re-authenticate with Google Drive
rclone config reconnect gdrive:
```

#### Backup Hangs or Fails
```bash
# Check network connectivity
rclone lsd gdrive: --timeout 30s

# Resume interrupted backup
rclone sync /path/to/music gdrive:ordr.fm-backup --progress --retries 3
```

#### Insufficient Storage
```bash
# Check Google Drive quota
rclone about gdrive:

# Clean old backups
rclone delete gdrive:ordr.fm-backup-old --dry-run
```

#### Corrupted Files
```bash
# Find and fix corrupted files
rclone check /path/to/music gdrive:ordr.fm-backup --one-way

# Re-upload specific files
rclone copy /path/to/file gdrive:ordr.fm-backup/path/ --progress
```

### Recovery Testing

Monthly recovery tests ensure backups are viable:

```bash
#!/bin/bash
# monthly_recovery_test.sh

TEST_DIR="/tmp/recovery-test-$(date +%Y%m)"
SAMPLE_FILES=10

echo "🧪 Monthly Recovery Test"

# Create test directory
mkdir -p "$TEST_DIR"

# Download random sample files
rclone lsl gdrive:ordr.fm-backup | shuf -n $SAMPLE_FILES | while read line; do
    file=$(echo "$line" | awk '{print $4}')
    rclone copy "gdrive:ordr.fm-backup/$file" "$TEST_DIR/" --progress
done

# Verify downloads
FILES_DOWNLOADED=$(find "$TEST_DIR" -type f | wc -l)
if [ "$FILES_DOWNLOADED" -eq "$SAMPLE_FILES" ]; then
    echo "✅ Recovery test passed: $FILES_DOWNLOADED/$SAMPLE_FILES files"
else
    echo "❌ Recovery test failed: $FILES_DOWNLOADED/$SAMPLE_FILES files"
fi

# Cleanup
rm -rf "$TEST_DIR"
```

## 📈 Best Practices

### Security
- Use encrypted rclone configuration: `rclone config`
- Limit backup script permissions: `chmod 700 backup_to_gdrive.sh`
- Store API credentials securely
- Enable 2FA on cloud storage accounts

### Performance
- Use `--transfers 4` for parallel uploads
- Set `--checkers 8` for faster verification
- Use `--update` for incremental backups
- Monitor bandwidth with `--bwlimit`

### Retention
- Keep 3 months of daily backups
- Keep 1 year of weekly backups  
- Keep 5 years of monthly backups
- Document major collection changes

### Documentation
- Log all backup and restore operations
- Document any custom configurations
- Keep offline copy of this documentation
- Test restore procedures annually

## 🔗 Integration

### ordr.fm Integration

```bash
# Pre-organization backup
./ordr.fm.sh --pre-backup --source /music --destination /organized

# Post-organization backup  
./ordr.fm.sh --post-backup --verify-backup

# Include in CLAUDE.md
echo "BACKUP_BEFORE_ORGANIZATION=1" >> ordr.fm.conf
```

### CI/CD Integration

```yaml
# .github/workflows/backup-verification.yml
name: Backup Verification
on:
  schedule:
    - cron: '0 6 * * 1'  # Weekly Monday 6 AM
    
jobs:
  verify-backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Verify backup integrity
        run: |
          rclone check gdrive:ordr.fm-backup /dev/null --dry-run
```

---

**Remember**: Backups are only as good as your ability to restore from them. Test your restore procedures regularly!