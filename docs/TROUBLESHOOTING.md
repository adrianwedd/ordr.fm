# ordr.fm Troubleshooting Guide

## Common Issues and Solutions

### Installation Issues

#### Missing Dependencies
**Problem**: `command not found: exiftool` or similar errors

**Solution**:
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y exiftool jq sqlite3

# macOS
brew install exiftool jq sqlite

# Verify installation
exiftool -ver
jq --version
sqlite3 --version
```

#### Permission Denied
**Problem**: `Permission denied` when running scripts

**Solution**:
```bash
# Make scripts executable
chmod +x ordr.fm.modular.sh
chmod +x test_runner.sh

# Check file ownership
ls -la ordr.fm.modular.sh
```

### Runtime Errors

#### Database Locked
**Problem**: `Error: database is locked`

**Solution**:
```bash
# Find processes using the database
fuser ordr.fm.state.db

# Kill stuck processes (use with caution)
pkill -f ordr.fm

# Reset database lock
sqlite3 ordr.fm.state.db "PRAGMA journal_mode=DELETE;"
sqlite3 ordr.fm.state.db "VACUUM;"
```

#### Out of Memory
**Problem**: Script crashes with memory errors

**Solution**:
```bash
# Check available memory
free -h

# Reduce parallel workers
./ordr.fm.modular.sh --parallel 2  # Instead of auto-detect

# Process in smaller batches
./ordr.fm.modular.sh --batch-size 50
```

#### Disk Space Issues
**Problem**: `No space left on device`

**Solution**:
```bash
# Check disk usage
df -h

# Find large files
du -h --max-depth=1 | sort -hr | head -20

# Clean up logs
find . -name "*.log" -mtime +30 -delete

# Clear database journal files
find . -name "*-journal" -delete
```

### Performance Issues

#### Slow Processing
**Problem**: Processing takes much longer than expected

**Diagnosis**:
```bash
# Check I/O bottlenecks
iostat -x 1

# Monitor CPU usage
top -b -n 1 | head -20

# Check for swapping
vmstat 1 5
```

**Solutions**:
1. Enable parallel processing:
   ```bash
   ./ordr.fm.modular.sh --parallel
   ```

2. Optimize for your storage:
   ```bash
   # For SSDs - more parallel workers
   ./ordr.fm.modular.sh --parallel 8
   
   # For HDDs - fewer workers to avoid thrashing
   ./ordr.fm.modular.sh --parallel 2
   ```

3. Move databases to faster storage:
   ```bash
   # In config file
   STATE_DB="/ssd/ordr.fm/state.db"
   METADATA_DB="/ssd/ordr.fm/metadata.db"
   ```

#### High Memory Usage
**Problem**: System becomes unresponsive during processing

**Solution**:
```bash
# Limit memory per process
ulimit -v 2097152  # 2GB limit

# Reduce batch size
BATCH_SIZE=25

# Disable caching
DISCOGS_CACHE_ENABLED=0
```

### Metadata Issues

#### Missing Metadata
**Problem**: Albums organized into "Unknown Artist" folders

**Diagnosis**:
```bash
# Check file metadata
exiftool -Artist -AlbumArtist -Album "problem_file.mp3"

# View extraction log
grep "insufficient metadata" ordr.fm.log
```

**Solutions**:
1. Fix metadata before processing:
   ```bash
   # Use a tool like Picard or mp3tag
   picard "problem_album/"
   ```

2. Enable Discogs enrichment:
   ```bash
   ./ordr.fm.modular.sh --discogs --discogs-confidence 0.6
   ```

3. Manual override in config:
   ```bash
   # Force specific organization
   ORGANIZATION_MODE="directory"  # Use directory names
   ```

#### Character Encoding Issues
**Problem**: Special characters appear as �� or similar

**Solution**:
```bash
# Set UTF-8 locale
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Convert filenames
convmv -f ISO-8859-1 -t UTF-8 -r /music/path --notest
```

### Discogs API Issues

#### Rate Limiting
**Problem**: `429 Too Many Requests` errors

**Solution**:
```bash
# Increase rate limit delay
DISCOGS_RATE_LIMIT_DELAY=2000  # 2 seconds

# Clear rate limiter
rm discogs_rate_limiter

# Use cached responses
DISCOGS_CACHE_EXPIRY=2592000  # 30 days
```

#### Authentication Failed
**Problem**: `401 Unauthorized` from Discogs

**Solution**:
```bash
# Verify token
curl -H "Authorization: Discogs token=$DISCOGS_TOKEN" \
     https://api.discogs.com/oauth/identity

# Regenerate token at:
# https://www.discogs.com/settings/developers
```

### File Operation Issues

#### Files Not Moving
**Problem**: Dry run works but files don't move with `--move`

**Checklist**:
```bash
# 1. Verify --move flag is set
grep "DRY_RUN" ordr.fm.log

# 2. Check destination permissions
touch "$DEST_DIR/test" && rm "$DEST_DIR/test"

# 3. Check source permissions
ls -la "$SOURCE_DIR"

# 4. Verify filesystem compatibility
df -T "$SOURCE_DIR" "$DEST_DIR"
```

#### Duplicate Files
**Problem**: Same album appears in multiple locations

**Solution**:
```bash
# Enable duplicate detection
./ordr.fm.modular.sh --duplicates

# Find duplicates manually
find "$DEST_DIR" -name "*.mp3" -exec md5sum {} \; | \
    sort | uniq -d -w 32

# Clean up duplicates
fdupes -r -d "$DEST_DIR"
```

### Database Issues

#### Corrupted Database
**Problem**: `database disk image is malformed`

**Recovery**:
```bash
# Backup corrupted database
cp ordr.fm.state.db ordr.fm.state.db.corrupt

# Try to recover
sqlite3 ordr.fm.state.db.corrupt ".dump" | sqlite3 ordr.fm.state.db.new
mv ordr.fm.state.db.new ordr.fm.state.db

# If recovery fails, recreate
rm ordr.fm.state.db
./ordr.fm.modular.sh --init-db
```

#### Growing Database Size
**Problem**: Database files becoming very large

**Solution**:
```bash
# Check database size
ls -lah *.db

# Vacuum databases
for db in *.db; do
    echo "Optimizing $db..."
    sqlite3 "$db" "VACUUM;"
    sqlite3 "$db" "ANALYZE;"
done

# Archive old data
sqlite3 ordr.fm.state.db "DELETE FROM processed_directories WHERE timestamp < date('now', '-90 days');"
```

## Debug Mode

### Enable Maximum Debugging
```bash
# Set debug environment
export VERBOSITY=3
export DEBUG=1
set -x

# Run with full output
./ordr.fm.modular.sh --verbose 2>&1 | tee debug.log

# Analyze debug log
grep -E "ERROR|WARNING|FAILED" debug.log
```

### Trace Specific Issues
```bash
# Trace file operations
strace -e trace=file ./ordr.fm.modular.sh 2>&1 | grep -E "open|rename|unlink"

# Trace system calls
strace -c ./ordr.fm.modular.sh

# Profile performance
time -v ./ordr.fm.modular.sh
```

## Getting Help

### Collect Diagnostic Information
```bash
# Create diagnostic bundle
cat > collect_diagnostics.sh << 'EOF'
#!/bin/bash
DIAG_DIR="ordr_fm_diagnostics_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$DIAG_DIR"

# System info
uname -a > "$DIAG_DIR/system.txt"
free -h >> "$DIAG_DIR/system.txt"
df -h >> "$DIAG_DIR/system.txt"

# Dependencies
for cmd in exiftool jq sqlite3 parallel; do
    echo "$cmd: $(command -v $cmd && $cmd --version 2>&1 | head -1)" >> "$DIAG_DIR/dependencies.txt"
done

# Config (sanitized)
grep -v "TOKEN\|PASSWORD" ordr.fm.conf > "$DIAG_DIR/config.txt"

# Recent logs
tail -n 1000 ordr.fm.log > "$DIAG_DIR/recent.log"
grep ERROR ordr.fm.log > "$DIAG_DIR/errors.log"

# Database info
for db in *.db; do
    sqlite3 "$db" "SELECT name FROM sqlite_master WHERE type='table';" > "$DIAG_DIR/${db}_tables.txt"
    sqlite3 "$db" "SELECT COUNT(*) FROM processed_directories;" >> "$DIAG_DIR/${db}_stats.txt" 2>&1
done

tar -czf "$DIAG_DIR.tar.gz" "$DIAG_DIR"
rm -rf "$DIAG_DIR"
echo "Diagnostics saved to $DIAG_DIR.tar.gz"
EOF

chmod +x collect_diagnostics.sh
./collect_diagnostics.sh
```

### Report Issues
When reporting issues, include:
1. Diagnostic bundle (from above)
2. Exact command that failed
3. Expected vs actual behavior
4. Steps to reproduce

Report at: https://github.com/adrianwedd/ordr.fm/issues

## Quick Fixes

### Reset Everything
```bash
# WARNING: This removes all processing history!
rm -f ordr.fm.*.db
rm -f ordr.fm.log
rm -rf /tmp/ordr_fm_*
```

### Safe Mode
```bash
# Process single album with maximum safety
./ordr.fm.modular.sh \
    --source "/single/album/path" \
    --destination "/tmp/test_output" \
    --dry-run \
    --verbose
```

### Emergency Stop
```bash
# Stop all ordr.fm processes
pkill -f ordr.fm

# Clean up locks
rm -f /tmp/ordr.fm_*lock*
```