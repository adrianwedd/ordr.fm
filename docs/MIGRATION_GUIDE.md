# ordr.fm Migration Guide

## Migrating from v1.x to v2.0

### Overview
Version 2.0 introduces modular architecture, parallel processing, and enhanced safety features. This guide helps you migrate smoothly.

### Breaking Changes
1. **Script Name**: `ordr.fm.sh` → `ordr.fm.modular.sh`
2. **Configuration**: New options added, some defaults changed
3. **Database Schema**: New tables and fields added
4. **Module Structure**: Code split into multiple files

### Migration Steps

#### 1. Backup Your Current Setup
```bash
# Create backup directory
mkdir ordr_fm_backup_$(date +%Y%m%d)
cd ordr_fm_backup_$(date +%Y%m%d)

# Backup databases
cp /path/to/ordr.fm/*.db .

# Backup configuration
cp /path/to/ordr.fm/ordr.fm.conf .

# Backup logs
cp /path/to/ordr.fm/*.log .
```

#### 2. Install v2.0
```bash
# Clone new version
git clone https://github.com/adrianwedd/ordr.fm.git ordr.fm-v2
cd ordr.fm-v2

# Make scripts executable
chmod +x ordr.fm.modular.sh test_runner.sh
```

#### 3. Migrate Configuration
```bash
# Copy old config as base
cp ../ordr.fm/ordr.fm.conf ordr.fm.conf.old

# Create new config from template
cp ordr.fm.conf.example ordr.fm.conf

# Manually merge settings (see below)
```

#### 4. Database Migration
```bash
# The new version will automatically migrate databases
# Just copy them to the new location
cp ../ordr.fm/*.db .

# Verify migration
sqlite3 ordr.fm.state.db "SELECT name FROM sqlite_master WHERE type='table';"
```

### Configuration Changes

#### New Options in v2.0
```bash
# Parallel processing (recommended)
ENABLE_PARALLEL=1
PARALLEL_JOBS=0  # Auto-detect

# Enhanced electronic music features
ORGANIZATION_MODE="hybrid"
MIN_LABEL_RELEASES=3
GROUP_ARTIST_ALIASES=1

# Safety features
ROLLBACK_ON_ERROR=1
BACKUP_BEFORE_MOVE=0
```

#### Deprecated Options
```bash
# Old format
USE_DISCOGS=1  # Now: DISCOGS_ENABLED=1

# Removed options
SKIP_EXISTING=1  # Now: Use --incremental flag
```

### Command Line Changes

#### Old Commands → New Commands
```bash
# Old
./ordr.fm.sh /source /dest

# New (with same behavior)
./ordr.fm.modular.sh --source /source --destination /dest --move

# New (recommended for performance)
./ordr.fm.modular.sh --source /source --destination /dest --parallel --move
```

#### New Features to Enable
```bash
# Parallel processing (much faster)
./ordr.fm.modular.sh --parallel

# Incremental mode (skip processed)
./ordr.fm.modular.sh --incremental

# Electronic music optimizations
./ordr.fm.modular.sh --enable-electronic --discogs
```

### Testing Your Migration

#### 1. Dry Run Test
```bash
# Test on small subset
./ordr.fm.modular.sh \
    --source /music/test_subset \
    --destination /tmp/test_output \
    --dry-run \
    --verbose
```

#### 2. Verify Database Migration
```bash
# Check processed directories
sqlite3 ordr.fm.state.db "SELECT COUNT(*) FROM processed_directories;"

# Verify metadata
sqlite3 ordr.fm.metadata.db "SELECT COUNT(*) FROM albums;"
```

#### 3. Run Test Suite
```bash
./test_runner.sh
```

### Rollback Plan

If you need to rollback to v1.x:
```bash
# Stop any running v2 processes
pkill -f ordr.fm.modular

# Restore v1 databases
cp ordr_fm_backup_*/**.db /path/to/ordr.fm/

# Use v1 script
cd /path/to/ordr.fm
./ordr.fm.sh
```

## Feature Comparison

| Feature | v1.x | v2.0 |
|---------|------|------|
| Basic organization | ✓ | ✓ |
| Dry run mode | ✓ | ✓ |
| Discogs integration | ✓ | ✓ Enhanced |
| Parallel processing | ✗ | ✓ |
| Modular architecture | ✗ | ✓ |
| Artist aliases | Basic | ✓ Advanced |
| Rollback capability | ✗ | ✓ |
| Web dashboard | ✗ | ✓ |
| CI/CD pipeline | ✗ | ✓ |
| Performance | Baseline | 3-10x faster |

## Common Migration Issues

### Issue: Old database not recognized
**Solution**:
```bash
# Force database migration
sqlite3 ordr.fm.state.db < lib/migrations/v1_to_v2.sql
```

### Issue: Configuration not loading
**Solution**:
```bash
# Check config syntax
bash -n ordr.fm.conf

# Verify paths exist
grep "DIR=" ordr.fm.conf | while read line; do
    path=$(echo $line | cut -d'"' -f2)
    [[ -d "$path" ]] || echo "Missing: $path"
done
```

### Issue: Permission errors with new modules
**Solution**:
```bash
# Fix module permissions
chmod +x lib/*.sh
chmod +x lib/*/*.sh
```

## Performance Improvements

Take advantage of v2.0 performance features:

### 1. Enable Parallel Processing
```bash
# Auto-detect optimal workers
ENABLE_PARALLEL=1
PARALLEL_JOBS=0

# Or set manually for your system
PARALLEL_JOBS=8  # For 8-core system
```

### 2. Optimize Database Location
```bash
# Move databases to SSD
STATE_DB="/ssd/ordr.fm/state.db"
METADATA_DB="/ssd/ordr.fm/metadata.db"
```

### 3. Batch Processing
```bash
# For very large collections
BATCH_SIZE=500  # Process 500 albums at a time
```

## New Workflows

### Incremental Processing
```bash
# Only process new albums
./ordr.fm.modular.sh --incremental --move

# Schedule via cron
0 2 * * * /opt/ordr.fm/ordr.fm.modular.sh --incremental --move
```

### Watch Folder
```bash
# Monitor for new music
./watch_folder.sh /music/incoming
```

### Web Dashboard
```bash
# Start web interface
cd visualization
npm install
npm start

# Access at http://localhost:8080
```

## Getting Help

- Check [Troubleshooting Guide](TROUBLESHOOTING.md)
- Review [Deployment Guide](DEPLOYMENT.md)
- Report issues: https://github.com/adrianwedd/ordr.fm/issues

Remember to test thoroughly before processing your entire collection!