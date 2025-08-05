# ordr.fm Production Deployment Guide

## Table of Contents
- [System Requirements](#system-requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Deployment Scenarios](#deployment-scenarios)
- [Performance Tuning](#performance-tuning)
- [Monitoring](#monitoring)
- [Backup & Recovery](#backup--recovery)
- [Troubleshooting](#troubleshooting)
- [Security Best Practices](#security-best-practices)

## System Requirements

### Minimum Requirements
- **OS**: Linux (Ubuntu 20.04+, Debian 10+, RHEL 8+), macOS 10.15+
- **CPU**: 2 cores (4+ cores recommended for parallel processing)
- **RAM**: 2GB minimum (4GB+ recommended)
- **Storage**: 10GB free space + space for music collection
- **Shell**: Bash 4.0+ or Zsh 5.0+

### Required Dependencies
```bash
# Core dependencies
exiftool    # v12.0+ - Metadata extraction
jq          # v1.6+  - JSON processing
sqlite3     # v3.31+ - Database operations

# Optional dependencies
parallel    # GNU Parallel for enhanced performance
bc          # Calculator for statistics
rsync       # For efficient file operations
curl        # For Discogs API
```

### Recommended Setup
- **CPU**: 8+ cores for large collections
- **RAM**: 8GB+ for processing 10,000+ albums
- **Storage**: SSD for database and temp files
- **Network**: Stable internet for Discogs API

## Installation

### 1. Quick Install (Ubuntu/Debian)
```bash
# Install dependencies
sudo apt-get update
sudo apt-get install -y exiftool jq sqlite3 bc rsync curl parallel

# Clone repository
git clone https://github.com/adrianwedd/ordr.fm.git
cd ordr.fm

# Make scripts executable
chmod +x ordr.fm.modular.sh test_runner.sh

# Run tests
./test_runner.sh

# Copy example config
cp ordr.fm.conf.example ordr.fm.conf
```

### 2. macOS Installation
```bash
# Install Homebrew if not installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies
brew install exiftool jq sqlite bc rsync curl parallel

# Clone and setup (same as Linux)
git clone https://github.com/adrianwedd/ordr.fm.git
cd ordr.fm
chmod +x ordr.fm.modular.sh
```

### 3. Docker Installation
```dockerfile
# Dockerfile
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    exiftool jq sqlite3 bc rsync curl parallel \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app/

RUN chmod +x ordr.fm.modular.sh

ENTRYPOINT ["./ordr.fm.modular.sh"]
```

Build and run:
```bash
docker build -t ordr.fm .
docker run -v /path/to/music:/music -v /path/to/output:/output ordr.fm \
    --source /music --destination /output --move
```

### 4. System Service Installation
```bash
# Create system user
sudo useradd -r -s /bin/bash -d /opt/ordr.fm ordrfm

# Install to system location
sudo mkdir -p /opt/ordr.fm
sudo cp -r * /opt/ordr.fm/
sudo chown -R ordrfm:ordrfm /opt/ordr.fm

# Create systemd service (see below)
```

## Configuration

### Basic Configuration
```bash
# Edit configuration
nano ordr.fm.conf

# Essential settings
SOURCE_DIR="/media/music/incoming"
DEST_DIR="/media/music/organized"
UNSORTED_BASE_DIR="/media/music/unsorted"

# Production settings
DRY_RUN=0                    # Disable dry-run for production
ENABLE_PARALLEL=1            # Enable parallel processing
PARALLEL_JOBS=0              # Auto-detect CPU cores
LOG_FILE="/var/log/ordr.fm/ordr.fm.log"
```

### Advanced Configuration

#### Discogs Integration
```bash
# Enable Discogs for metadata enrichment
DISCOGS_ENABLED=1
DISCOGS_TOKEN="your_token_here"  # Get from discogs.com/settings/developers
DISCOGS_CACHE_DIR="/var/cache/ordr.fm/discogs"
DISCOGS_CONFIDENCE_THRESHOLD=0.7
```

#### Electronic Music Features
```bash
# Optimize for electronic music collections
ENABLE_ELECTRONIC_ORGANIZATION=1
ORGANIZATION_MODE="hybrid"       # Intelligent artist/label routing
MIN_LABEL_RELEASES=3            # Prevent sparse label folders
SEPARATE_REMIXES=1              # Organize remixes separately
```

#### Performance Tuning
```bash
# Large collection optimization
BATCH_SIZE=500                  # Process in batches
PARALLEL_JOBS=16               # For 16+ core systems
CHECKSUM_VERIFICATION=0        # Disable for speed
```

### Environment-Specific Configs

Create multiple configs for different environments:
```bash
# Development
cp ordr.fm.conf ordr.fm.dev.conf

# Production
cp ordr.fm.conf ordr.fm.prod.conf

# Use specific config
./ordr.fm.modular.sh --config ordr.fm.prod.conf
```

## Deployment Scenarios

### 1. Personal Music Server
```bash
# One-time organization
./ordr.fm.modular.sh \
    --source "/media/music/downloads" \
    --destination "/media/music/library" \
    --enable-electronic \
    --discogs \
    --parallel \
    --move

# Scheduled runs (crontab)
0 2 * * * /opt/ordr.fm/ordr.fm.modular.sh --config /opt/ordr.fm/ordr.fm.prod.conf --incremental --move
```

### 2. Shared Network Storage (NAS)
```bash
# Mount network storage
sudo mount -t nfs nas.local:/music /mnt/nas-music

# Process with optimized settings
./ordr.fm.modular.sh \
    --source "/mnt/nas-music/incoming" \
    --destination "/mnt/nas-music/organized" \
    --parallel 4 \  # Limit for network I/O
    --batch-size 100 \
    --move
```

### 3. Cloud Storage Integration
```bash
# Example with rclone
rclone sync gdrive:music/incoming /tmp/music-staging

./ordr.fm.modular.sh \
    --source "/tmp/music-staging" \
    --destination "/tmp/music-organized" \
    --move

rclone sync /tmp/music-organized gdrive:music/organized
```

### 4. Multi-User Environment
```bash
# Create shared group
sudo groupadd music-organizers
sudo usermod -a -G music-organizers user1
sudo usermod -a -G music-organizers user2

# Set permissions
sudo chown -R :music-organizers /opt/ordr.fm
sudo chmod -R g+rw /opt/ordr.fm/ordr.fm.*.db

# User-specific configs
/opt/ordr.fm/ordr.fm.modular.sh --config ~/.ordr.fm/user.conf
```

### 5. Systemd Service
Create `/etc/systemd/system/ordr.fm.service`:
```ini
[Unit]
Description=ordr.fm Music Organization Service
After=network.target

[Service]
Type=oneshot
User=ordrfm
Group=ordrfm
WorkingDirectory=/opt/ordr.fm
ExecStart=/opt/ordr.fm/ordr.fm.modular.sh --config /opt/ordr.fm/ordr.fm.prod.conf --incremental --move
StandardOutput=append:/var/log/ordr.fm/service.log
StandardError=append:/var/log/ordr.fm/service-error.log

[Install]
WantedBy=multi-user.target
```

Enable service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable ordr.fm.service
sudo systemctl start ordr.fm.service
```

### 6. Watch Folder Setup
```bash
# Install inotify-tools
sudo apt-get install inotify-tools

# Create watch script
cat > /opt/ordr.fm/watch.sh << 'EOF'
#!/bin/bash
WATCH_DIR="/media/music/incoming"
inotifywait -m -r -e close_write --format '%w%f' "$WATCH_DIR" | while read file; do
    if [[ "$file" =~ \.(mp3|flac|wav|m4a|ogg)$ ]]; then
        echo "New file detected: $file"
        # Wait for album to complete
        sleep 60
        # Process parent directory
        album_dir=$(dirname "$file")
        /opt/ordr.fm/ordr.fm.modular.sh --source "$album_dir" --move
    fi
done
EOF

chmod +x /opt/ordr.fm/watch.sh
```

## Performance Tuning

### CPU Optimization
```bash
# Determine optimal worker count
# CPU-bound tasks: use CPU count
PARALLEL_JOBS=$(nproc)

# I/O-bound tasks: use 2x CPU count
PARALLEL_JOBS=$(($(nproc) * 2))

# Test different configurations
./benchmark_parallel.sh /path/to/test/music
```

### Memory Optimization
```bash
# For systems with limited RAM
# Reduce batch size
BATCH_SIZE=50

# Disable caching
DISCOGS_CACHE_ENABLED=0

# Use streaming processing
ulimit -v 2097152  # Limit to 2GB per process
```

### Storage Optimization
```bash
# SSD optimization
# Place databases on SSD
STATE_DB="/ssd/ordr.fm/state.db"
METADATA_DB="/ssd/ordr.fm/metadata.db"

# HDD optimization
# Limit parallel operations
PARALLEL_JOBS=2

# Enable write caching
hdparm -W 1 /dev/sda
```

### Network Optimization
```bash
# For network storage
# Increase buffer sizes
echo 'net.core.rmem_max = 134217728' | sudo tee -a /etc/sysctl.conf
echo 'net.core.wmem_max = 134217728' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# Mount with optimized options
mount -t nfs -o rsize=1048576,wsize=1048576,async nas:/music /mnt/music
```

## Monitoring

### 1. Basic Monitoring
```bash
# Monitor progress
tail -f ordr.fm.log

# Watch system resources
htop
iotop

# Database size monitoring
watch -n 60 'ls -lah *.db'
```

### 2. Advanced Monitoring

#### Prometheus Metrics
Create metrics exporter:
```bash
#!/bin/bash
# prometheus_exporter.sh
while true; do
    # Extract metrics from database
    albums_processed=$(sqlite3 ordr.fm.state.db "SELECT COUNT(*) FROM processed_directories WHERE status='SUCCESS';")
    albums_failed=$(sqlite3 ordr.fm.state.db "SELECT COUNT(*) FROM processed_directories WHERE status='FAILED';")
    
    cat > /var/lib/prometheus/node_exporter/ordr_fm.prom << EOF
# HELP ordr_fm_albums_processed Total albums processed
# TYPE ordr_fm_albums_processed counter
ordr_fm_albums_processed $albums_processed

# HELP ordr_fm_albums_failed Total albums failed
# TYPE ordr_fm_albums_failed counter
ordr_fm_albums_failed $albums_failed
EOF
    sleep 60
done
```

#### Grafana Dashboard
```json
{
  "dashboard": {
    "title": "ordr.fm Monitoring",
    "panels": [
      {
        "title": "Processing Rate",
        "targets": [
          {
            "expr": "rate(ordr_fm_albums_processed[5m])"
          }
        ]
      },
      {
        "title": "Error Rate",
        "targets": [
          {
            "expr": "rate(ordr_fm_albums_failed[5m])"
          }
        ]
      }
    ]
  }
}
```

### 3. Log Analysis
```bash
# Most common errors
grep ERROR ordr.fm.log | sort | uniq -c | sort -nr | head -10

# Processing statistics
grep "Processing complete" ordr.fm.log | tail -10

# Performance analysis
grep "Throughput:" ordr.fm.log | awk '{print $NF}' | sort -n
```

## Backup & Recovery

### 1. Database Backup
```bash
# Backup script
#!/bin/bash
BACKUP_DIR="/backup/ordr.fm/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# Backup databases
for db in *.db; do
    sqlite3 "$db" ".backup $BACKUP_DIR/$db"
done

# Backup configuration
cp ordr.fm.conf "$BACKUP_DIR/"

# Create archive
tar -czf "$BACKUP_DIR.tar.gz" "$BACKUP_DIR"
rm -rf "$BACKUP_DIR"
```

### 2. Recovery Procedures
```bash
# Restore from backup
tar -xzf backup_20240101.tar.gz
cp backup_20240101/*.db .
cp backup_20240101/ordr.fm.conf .

# Verify integrity
sqlite3 ordr.fm.state.db "PRAGMA integrity_check;"

# Resume processing
./ordr.fm.modular.sh --incremental --move
```

### 3. Rollback Operations
```bash
# List recent operations
sqlite3 ordr.fm.metadata.db "SELECT * FROM move_operations ORDER BY timestamp DESC LIMIT 10;"

# Rollback specific operation
./ordr.fm.modular.sh --undo-operation "OP_20240101_123456"

# Rollback all operations from date
./ordr.fm.modular.sh --undo-since "2024-01-01"
```

## Troubleshooting

### Common Issues

#### 1. Permission Denied
```bash
# Check permissions
ls -la ordr.fm.*.db
ls -la "$DEST_DIR"

# Fix permissions
sudo chown -R $(whoami) ordr.fm.*.db
sudo chmod -R u+rw "$DEST_DIR"
```

#### 2. Database Locked
```bash
# Find process holding lock
fuser ordr.fm.state.db

# Kill if necessary
kill -9 $(fuser ordr.fm.state.db 2>/dev/null)

# Recover database
sqlite3 ordr.fm.state.db "PRAGMA journal_mode=DELETE;"
```

#### 3. Out of Memory
```bash
# Check memory usage
free -h

# Reduce parallel jobs
export PARALLEL_JOBS=2

# Clear caches
sync && echo 3 > /proc/sys/vm/drop_caches
```

#### 4. Slow Performance
```bash
# Profile execution
time ./ordr.fm.modular.sh --source test --destination test_out --dry-run

# Check I/O bottlenecks
iostat -x 1

# Optimize database
sqlite3 ordr.fm.state.db "VACUUM;"
sqlite3 ordr.fm.state.db "ANALYZE;"
```

### Debug Mode
```bash
# Enable maximum debugging
export VERBOSITY=3
export BASH_XTRACEFD=1
set -x

./ordr.fm.modular.sh --verbose 2>&1 | tee debug.log
```

### Health Checks
```bash
#!/bin/bash
# health_check.sh

# Check dependencies
for cmd in exiftool jq sqlite3; do
    command -v $cmd >/dev/null || echo "Missing: $cmd"
done

# Check databases
for db in *.db; do
    sqlite3 "$db" "PRAGMA integrity_check;" || echo "Corrupt: $db"
done

# Check disk space
df -h "$DEST_DIR" | awk 'NR==2 {if ($5+0 > 90) print "Warning: Disk usage " $5}'

# Check recent errors
error_count=$(grep -c ERROR ordr.fm.log 2>/dev/null || echo 0)
echo "Recent errors: $error_count"
```

## Security Best Practices

### 1. File Permissions
```bash
# Secure installation
chmod 750 /opt/ordr.fm
chmod 640 /opt/ordr.fm/*.conf
chmod 660 /opt/ordr.fm/*.db

# Restrict access
chown -R ordrfm:music-admins /opt/ordr.fm
```

### 2. API Security
```bash
# Store tokens securely
chmod 600 ordr.fm.conf

# Use environment variables
export DISCOGS_TOKEN="your_token"
# In config: DISCOGS_TOKEN="${DISCOGS_TOKEN}"
```

### 3. Audit Logging
```bash
# Enable audit logging
auditctl -w /opt/ordr.fm -p rwxa -k ordr_fm_changes

# Review audit logs
ausearch -k ordr_fm_changes
```

### 4. Network Security
```bash
# Firewall rules for API access
sudo ufw allow out 443/tcp comment "Discogs API"

# Use proxy for API calls
export HTTPS_PROXY="http://proxy.company.com:8080"
```

## Maintenance

### Regular Tasks
```bash
# Weekly: Database optimization
0 3 * * 0 sqlite3 /opt/ordr.fm/*.db "VACUUM; ANALYZE;"

# Monthly: Clear old logs
0 2 1 * * find /var/log/ordr.fm -name "*.log" -mtime +30 -delete

# Quarterly: Full integrity check
0 4 1 */3 * /opt/ordr.fm/health_check.sh
```

### Upgrade Procedures
```bash
# Backup before upgrade
./backup.sh

# Update code
cd /opt/ordr.fm
git pull

# Run tests
./test_runner.sh

# Update database schema if needed
./migrate_db.sh

# Restart services
sudo systemctl restart ordr.fm
```

## Performance Benchmarks

Typical performance on various systems:

| System | Collection Size | Time (Sequential) | Time (Parallel) | Speedup |
|--------|----------------|-------------------|-----------------|---------|
| 4-core i5, SSD | 1,000 albums | 15 min | 4 min | 3.75x |
| 8-core i7, SSD | 10,000 albums | 2.5 hours | 25 min | 6x |
| 16-core Xeon, SSD | 50,000 albums | 10 hours | 55 min | 10.9x |
| 4-core Pi 4, SD | 1,000 albums | 45 min | 15 min | 3x |

## Support

For production support:
- GitHub Issues: https://github.com/adrianwedd/ordr.fm/issues
- Documentation: https://github.com/adrianwedd/ordr.fm/docs
- Community: Join our Discord/Slack (coming soon)

Remember to always test in a non-production environment first!