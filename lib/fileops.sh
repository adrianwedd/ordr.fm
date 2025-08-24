#!/bin/bash
# File operations module for ordr.fm
# Handles secure file moves, directory operations, and permissions

# Source common utilities
source "${BASH_SOURCE%/*}/common.sh"

# Function to securely move files/directories with permission handling
secure_move_file() {
    local source="$1"
    local dest="$2"
    local max_retries=3
    local retry=0
    
    # Input validation
    if [[ -z "$source" ]] || [[ -z "$dest" ]]; then
        log $LOG_ERROR "Invalid parameters for secure_move_file: source='$source', dest='$dest'"
        return 1
    fi
    
    if [[ ! -e "$source" ]]; then
        log $LOG_ERROR "Source does not exist: $source"
        return 1
    fi
    
    # Check if destination parent directory exists
    local parent_dir=$(dirname "$dest")
    if [[ ! -d "$parent_dir" ]]; then
        log $LOG_ERROR "Destination parent directory does not exist: $parent_dir"
        return 1
    fi
    
    # Check for potential issues
    if [[ "$source" -ef "$dest" ]]; then
        log $LOG_WARNING "Source and destination are the same: $source"
        return 0  # Not an error, just a no-op
    fi
    
    while [[ $retry -lt $max_retries ]]; do
        # Try regular mv first
        if mv "$source" "$dest" 2>/dev/null; then
            log $LOG_DEBUG "Successfully moved: $source -> $dest"
            return 0
        fi
        
        # If that fails, try with sudo if available
        if command -v sudo >/dev/null 2>&1; then
            if sudo mv "$source" "$dest" 2>/dev/null; then
                # Fix ownership to match parent directory
                local parent_owner=$(stat -c '%U:%G' "$parent_dir" 2>/dev/null)
                if [[ -n "$parent_owner" ]]; then
                    sudo chown -R "$parent_owner" "$dest" 2>/dev/null
                fi
                log $LOG_DEBUG "Successfully moved with sudo: $source -> $dest"
                return 0
            fi
        fi
        
        retry=$((retry + 1))
        if [[ $retry -lt $max_retries ]]; then
            log $LOG_WARNING "Move failed, retrying ($retry/$max_retries): $source -> $dest"
            sleep 1
        fi
    done
    
    # If all retries fail, log detailed error
    log $LOG_ERROR "Failed to move after $max_retries attempts: $source -> $dest"
    log $LOG_DEBUG "Source permissions: $(ls -la "$source" 2>/dev/null || echo 'unknown')"
    log $LOG_DEBUG "Destination parent permissions: $(ls -la "$parent_dir" 2>/dev/null || echo 'unknown')"
    return 1
}

# Function to move album to unsorted directory
move_to_unsorted() {
    local album_dir="$1"
    local reason="$2"
    local unsorted_subdir="${UNSORTED_BASE_DIR}/unsorted_${DATE_NOW}"
    
    # Ensure the unsorted directory exists
    if [[ $DRY_RUN -eq 0 ]]; then
        mkdir -p "$unsorted_subdir" || { 
            log $LOG_ERROR "Could not create unsorted directory: $unsorted_subdir"
            return 1
        }
    fi
    
    local album_name=$(basename "$album_dir")
    local unsorted_target="$unsorted_subdir/$album_name"
    
    log $LOG_WARNING "Moving to unsorted due to $reason: $album_dir"
    
    if [[ $DRY_RUN -eq 1 ]]; then
        log $LOG_INFO "(Dry Run) Would move '$album_dir' to '$unsorted_target'"
    else
        mkdir -p "$(dirname "$unsorted_target")" || { 
            log $LOG_ERROR "ERROR: Could not create unsorted target directory for '$album_dir'."
            return 1
        }
        secure_move_file "$album_dir" "$unsorted_target"
        log $LOG_INFO "Moved to unsorted: '$album_dir' -> '$unsorted_target'"
    fi
}

# Function to skip problematic albums instead of moving them
skip_problematic_album() {
    local album_dir="$1"
    local reason="$2"
    
    log $LOG_WARNING "Skipping album due to $reason: $album_dir"
    log $LOG_INFO "Album will remain at original location for manual review"
}

# Function to perform atomic directory move using rsync
perform_atomic_directory_move() {
    local source_dir="$1"
    local dest_dir="$2"
    local operation_id="$3"
    
    log $LOG_DEBUG "Performing atomic directory move: $operation_id"
    
    # Input validation
    if [[ -z "$source_dir" ]] || [[ -z "$dest_dir" ]] || [[ -z "$operation_id" ]]; then
        log $LOG_ERROR "Invalid parameters for atomic directory move"
        return 1
    fi
    
    if [[ ! -d "$source_dir" ]]; then
        log $LOG_ERROR "Source directory does not exist: $source_dir"
        return 1
    fi
    
    # Use rsync for atomic move with verification and timeout
    local rsync_options="--archive --verbose --progress --checksum --remove-source-files --timeout=300"
    
    if [[ $VERBOSITY -ge $LOG_DEBUG ]]; then
        rsync_options="$rsync_options --stats"
    fi
    
    # Create temporary destination to ensure atomicity
    local temp_dest="${dest_dir}.tmp.${operation_id}"
    local rsync_success=false
    local max_retries=2
    local retry=0
    
    # Clean up any existing temp destination
    if [[ -d "$temp_dest" ]]; then
        log $LOG_WARNING "Cleaning up existing temporary destination: $temp_dest"
        rm -rf "$temp_dest" 2>/dev/null || sudo rm -rf "$temp_dest" 2>/dev/null
    fi
    
    log $LOG_INFO "Using rsync to move directory atomically..."
    
    while [[ $retry -lt $max_retries ]] && [[ "$rsync_success" == "false" ]]; do
        # Try rsync with timeout
        if timeout 600s rsync $rsync_options "$source_dir/" "$temp_dest/" 2>/dev/null; then
            log $LOG_DEBUG "rsync succeeded without sudo (attempt $((retry + 1)))"
            rsync_success=true
        elif command -v sudo >/dev/null 2>&1 && timeout 600s sudo rsync $rsync_options "$source_dir/" "$temp_dest/" 2>/dev/null; then
            log $LOG_DEBUG "rsync succeeded with sudo (attempt $((retry + 1)))"
            # Fix ownership to match parent directory
            local parent_owner=$(stat -c '%U:%G' "$(dirname "$dest_dir")" 2>/dev/null)
            if [[ -n "$parent_owner" ]]; then
                sudo chown -R "$parent_owner" "$temp_dest" 2>/dev/null
            fi
            rsync_success=true
        else
            retry=$((retry + 1))
            if [[ $retry -lt $max_retries ]]; then
                log $LOG_WARNING "rsync failed, retrying ($retry/$max_retries): $source_dir -> $temp_dest"
                # Clean up partial temp destination
                rm -rf "$temp_dest" 2>/dev/null || sudo rm -rf "$temp_dest" 2>/dev/null
                sleep 2
            fi
        fi
    done
    
    if [[ "$rsync_success" == "false" ]]; then
        log $LOG_ERROR "rsync failed after $max_retries attempts during directory move"
        # Clean up failed temp destination
        rm -rf "$temp_dest" 2>/dev/null || sudo rm -rf "$temp_dest" 2>/dev/null
        return 1
    fi
    
    if true; then
        # Atomic rename to final destination
        if secure_move_file "$temp_dest" "$dest_dir"; then
            # Remove empty source directory
            if rmdir "$source_dir" 2>/dev/null; then
                log $LOG_DEBUG "Successfully removed source directory: $source_dir"
            else
                log $LOG_WARNING "Could not remove source directory (may not be empty): $source_dir"
            fi
            return 0
        else
            log $LOG_ERROR "Failed to rename temporary directory to final destination"
            # Cleanup temporary directory
            rm -rf "$temp_dest" 2>/dev/null
            return 1
        fi
    else
        log $LOG_ERROR "rsync failed during directory move"
        return 1
    fi
}

# Function to perform atomic directory move with individual file renaming
perform_atomic_directory_move_with_renaming() {
    local source_dir="$1"
    local dest_dir="$2"
    local operation_id="$3"
    local album_metadata="$4"  # Pipe-delimited: artist|title|label|catalog|year
    local exiftool_output="$5"  # Full exiftool JSON for track metadata
    local enable_file_renaming="${6:-0}"  # Default disabled for safety
    
    log $LOG_DEBUG "Performing atomic directory move with file renaming: $operation_id"
    
    # If file renaming is disabled, use standard move
    if [[ "$enable_file_renaming" != "1" ]]; then
        perform_atomic_directory_move "$source_dir" "$dest_dir" "$operation_id"
        return $?
    fi
    
    # Input validation
    if [[ -z "$source_dir" ]] || [[ -z "$dest_dir" ]] || [[ -z "$operation_id" ]]; then
        log $LOG_ERROR "Invalid parameters for atomic directory move with renaming"
        return 1
    fi
    
    if [[ ! -d "$source_dir" ]]; then
        log $LOG_ERROR "Source directory does not exist: $source_dir"
        return 1
    fi
    
    # Parse album metadata
    local artist=$(echo "$album_metadata" | cut -d'|' -f1)
    local album_title=$(echo "$album_metadata" | cut -d'|' -f2)
    
    # Create temporary destination
    local temp_dest="${dest_dir}.tmp.${operation_id}"
    
    # Clean up any existing temp destination
    if [[ -d "$temp_dest" ]]; then
        log $LOG_WARNING "Cleaning up existing temporary destination: $temp_dest"
        rm -rf "$temp_dest" 2>/dev/null || sudo rm -rf "$temp_dest" 2>/dev/null
    fi
    
    # Create destination directory
    mkdir -p "$temp_dest" || {
        log $LOG_ERROR "Failed to create destination directory: $temp_dest"
        return 1
    }
    
    log $LOG_INFO "Moving and renaming files atomically..."
    
    # Process each file individually
    local success=true
    for source_file in "$source_dir"/*; do
        [[ ! -f "$source_file" ]] && continue
        
        local filename=$(basename "$source_file")
        local extension="${filename##*.}"
        
        # Check if this is an audio file that should be renamed
        # Other files (.asd, .nfo, images, etc.) will be moved as-is
        if [[ "$extension" =~ ^(flac|mp3|wav|aiff|alac|aac|m4a|ogg)$ ]]; then
            # Extract track metadata from exiftool output
            local raw_track_number=$(echo "$exiftool_output" | jq -r --arg file "$source_file" '.[] | select(.SourceFile == $file) | .Track // .TrackNumber // ""' 2>/dev/null)
            # Extract just the track number part before any slash and keep only digits
            local track_number=$(echo "$raw_track_number" | sed 's|/.*||' | sed 's/[^0-9]//g')
            [[ $VERBOSITY -ge $LOG_DEBUG ]] && log $LOG_DEBUG "Track number processing: '$raw_track_number' -> '$track_number' for file: $(basename "$source_file")"
            local track_title=$(echo "$exiftool_output" | jq -r --arg file "$source_file" '.[] | select(.SourceFile == $file) | .Title // ""' 2>/dev/null)
            
            # Generate new filename if we have complete metadata
            if [[ -n "$track_number" ]] && [[ -n "$track_title" ]] && [[ -n "$album_title" ]] && [[ -n "$artist" ]]; then
                local new_filename=$(generate_track_filename "$source_file" "$track_number" "$track_title" "$album_title" "$artist" "1")
                local dest_file="$temp_dest/$new_filename"
                log $LOG_DEBUG "Renaming: $filename -> $new_filename"
            else
                local dest_file="$temp_dest/$filename"
                log $LOG_DEBUG "Keeping original filename (incomplete metadata): $filename"
            fi
        else
            # Non-audio files keep their original names
            local dest_file="$temp_dest/$filename"
        fi
        
        # Copy file with metadata preservation
        if ! cp -p "$source_file" "$dest_file" 2>/dev/null; then
            if command -v sudo >/dev/null 2>&1 && sudo cp -p "$source_file" "$dest_file" 2>/dev/null; then
                # Fix ownership
                local parent_owner=$(stat -c '%U:%G' "$(dirname "$dest_dir")" 2>/dev/null)
                [[ -n "$parent_owner" ]] && sudo chown "$parent_owner" "$dest_file" 2>/dev/null
            else
                log $LOG_ERROR "Failed to copy file: $source_file -> $dest_file"
                success=false
                break
            fi
        fi
    done
    
    if [[ "$success" == "true" ]]; then
        # Atomic rename to final destination
        if secure_move_file "$temp_dest" "$dest_dir"; then
            # Remove source files
            rm -rf "$source_dir" 2>/dev/null || sudo rm -rf "$source_dir" 2>/dev/null
            
            # Clean up empty parent directories
            cleanup_empty_parent_directories "$source_dir"
            
            log $LOG_DEBUG "Successfully completed atomic move with file renaming"
            return 0
        else
            log $LOG_ERROR "Failed to perform atomic rename during move with file renaming"
            rm -rf "$temp_dest" 2>/dev/null || sudo rm -rf "$temp_dest" 2>/dev/null
            return 1
        fi
    else
        log $LOG_ERROR "File copying failed during move with renaming"
        rm -rf "$temp_dest" 2>/dev/null || sudo rm -rf "$temp_dest" 2>/dev/null
        return 1
    fi
}

# Function to check directory permissions
check_directory_permissions() {
    local dir="$1"
    local required_perm="${2:-rwx}"
    
    if [[ ! -d "$dir" ]]; then
        log $LOG_ERROR "Directory does not exist: $dir"
        return 1
    fi
    
    # Check read permission
    if [[ "$required_perm" == *"r"* ]] && [[ ! -r "$dir" ]]; then
        log $LOG_ERROR "No read permission for directory: $dir"
        return 1
    fi
    
    # Check write permission
    if [[ "$required_perm" == *"w"* ]] && [[ ! -w "$dir" ]]; then
        log $LOG_ERROR "No write permission for directory: $dir"
        return 1
    fi
    
    # Check execute permission
    if [[ "$required_perm" == *"x"* ]] && [[ ! -x "$dir" ]]; then
        log $LOG_ERROR "No execute permission for directory: $dir"
        return 1
    fi
    
    return 0
}

# Function to create directory with proper permissions
create_directory_safe() {
    local dir="$1"
    local mode="${2:-755}"
    
    if [[ -d "$dir" ]]; then
        log $LOG_DEBUG "Directory already exists: $dir"
        return 0
    fi
    
    if mkdir -p "$dir" 2>/dev/null; then
        chmod "$mode" "$dir" 2>/dev/null
        log $LOG_DEBUG "Created directory: $dir"
        return 0
    fi
    
    # Try with sudo if needed
    if command -v sudo >/dev/null 2>&1; then
        if sudo mkdir -p "$dir" 2>/dev/null; then
            sudo chmod "$mode" "$dir" 2>/dev/null
            # Fix ownership to match parent
            local parent_dir=$(dirname "$dir")
            local parent_owner=$(stat -c '%U:%G' "$parent_dir" 2>/dev/null)
            if [[ -n "$parent_owner" ]]; then
                sudo chown "$parent_owner" "$dir" 2>/dev/null
            fi
            log $LOG_DEBUG "Created directory with sudo: $dir"
            return 0
        fi
    fi
    
    log $LOG_ERROR "Failed to create directory: $dir"
    return 1
}

# Check if directory contains audio files
directory_has_audio_files() {
    local dir="$1"
    local media_exts="${AUDIO_EXTENSIONS:-mp3\|flac\|wav\|m4a\|aac\|ogg\|wma\|ape\|mp4\|mkv\|avi\|mov\|webm}"
    
    if [[ ! -d "$dir" ]]; then
        return 1
    fi
    
    # Check for audio and video files (using escaped pipes for regex alternation)
    if find "$dir" -type f -iregex ".*\.\($media_exts\)$" -print -quit | grep -q .; then
        return 0
    fi
    
    return 1
}

# Function to clean up empty parent directories after album move
cleanup_empty_parent_directories() {
    local source_dir="$1"
    local max_depth="${2:-3}"  # Maximum depth to clean (default 3 levels up)
    
    if [[ -z "$source_dir" ]]; then
        return 1
    fi
    
    # Start from parent directory
    local parent_dir=$(dirname "$source_dir")
    local depth=0
    
    while [[ "$depth" -lt "$max_depth" ]] && [[ "$parent_dir" != "/" ]] && [[ "$parent_dir" != "." ]]; do
        # Check if directory is empty (no files, no subdirs)
        if [[ -d "$parent_dir" ]]; then
            # Count items in directory (excluding . and ..)
            local item_count=$(find "$parent_dir" -maxdepth 1 -mindepth 1 2>/dev/null | wc -l)
            
            if [[ "$item_count" -eq 0 ]]; then
                # Directory is empty, safe to remove
                log $LOG_DEBUG "Removing empty parent directory: $parent_dir"
                rmdir "$parent_dir" 2>/dev/null
                
                # Move up to next parent
                parent_dir=$(dirname "$parent_dir")
                ((depth++))
            else
                # Directory not empty, stop cleanup
                break
            fi
        else
            # Directory doesn't exist, stop
            break
        fi
    done
    
    return 0
}

# Export all functions
export -f secure_move_file move_to_unsorted skip_problematic_album perform_atomic_directory_move
export -f check_directory_permissions create_directory_safe directory_has_audio_files cleanup_empty_parent_directories