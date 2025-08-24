# Bug Fix: Album Discovery Log Interference Issue

## Problem
The script was failing to detect album directories because log messages were being captured as directory names in the `find_album_directories` function. This occurred due to using command substitution with a function that outputs both log messages and data.

## Root Causes
1. **Log output mixing with data**: The `find_album_directories` function was outputting both log messages and directory paths to stdout
2. **Command substitution capturing everything**: Using `$(find_album_directories)` captured all stdout output, including log messages
3. **Regex issues**: Multiple functions had incorrect regex patterns using unescaped pipes (`|` instead of `\|`)

## Solution Implemented

### 1. Temp File Approach
Modified `find_album_directories` to write results to a temp file instead of returning via stdout:
- Function accepts an output file parameter
- Album directories are written to the temp file
- Only the count is returned via echo for logging purposes

### 2. Main Function Updates
- Creates temp file before calling `find_album_directories`
- Reads album directories from temp file using `mapfile`
- Cleans up temp file on exit using trap

### 3. Regex Fixes
Fixed regex patterns in multiple locations:
- `lib/fileops.sh`: `directory_has_audio_files()` - Changed `mp3|flac` to `mp3\|flac`
- `lib/metadata_extraction.sh`: `count_audio_files()` - Fixed pipe escaping
- `lib/metadata_extraction.sh`: `directory_has_audio_files()` - Fixed duplicate definition

## Files Modified
1. `/home/pi/repos/ordr.fm/ordr.fm.sh` - Lines 261-292, 531-541
2. `/home/pi/repos/ordr.fm/lib/fileops.sh` - Line 196
3. `/home/pi/repos/ordr.fm/lib/metadata_extraction.sh` - Lines 173, 185

## Testing Results
✅ Script now correctly detects album directories
✅ Log messages no longer interfere with data flow
✅ Temp files are properly cleaned up on exit
✅ Works with both single albums and multi-album directory structures

## Before Fix
```
Processing album directory: [2025-08-17 09:32:51] [INFO ] Scanning for album directories in ....
```

## After Fix
```
Processing album directory: /tmp/real_test
```