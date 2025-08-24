# Archive Directory

This directory contains archived files from the ordr.fm project cleanup on 2025-08-16.

## Directory Structure

### `/backups/`
- Original script backups (ordr.fm-original-backup.sh)
- Configuration file backups (ordr.fm.conf.backup.*, ordr.fm.conf.local)
- Server code backups (server-original-backup.js, server-new.js)
- Test HTML files and workflow documentation

### `/logs/`
- Backup operation logs (backup_gdrive_*.log, backup_progress.log)
- Server logs (server.log, server_test.log)
- Test logs (auth-test.log, fuzzy-search-test.log)
- Application logs (ordr.fm.log)

### `/scripts/`
- Test and validation scripts (test_*.sh, validate_*.sh)
- Optimization scripts (alias_optimization.sh, benchmark_parallel.sh)
- Integration scripts (integrate_*.sh)
- Utility scripts (command_builder.sh, groom_issues.sh)
- Old backup scripts (backup_strategy.sh, backup_with_progress.sh)

### `/session_files/`
- Claude session continuation files (2025-08-*-this-session-*.txt)
- Session summaries (SESSION_SUMMARY_*.md)

### `/test_files/`
- Test databases (test-metadata.db, test.metadata.db)
- Test directories (test_music/, test-results/)
- Coverage reports (coverage/)
- Playwright reports (playwright-report/)

## Purpose

These files were archived during project cleanup to:
1. Keep the main directory organized and focused on production code
2. Preserve development history and test artifacts
3. Maintain backups of original implementations before refactoring
4. Store logs for future reference if needed

## Note

These files are kept for reference but are not actively used in the current implementation.
The main working files are in the parent directories.