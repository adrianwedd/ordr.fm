#!/bin/bash
# File operations module for ordr.fm
# Handles secure file moves, directory operations, and permissions

# Source common utilities
source "${BASH_SOURCE%/*}/common.sh"

# Function to securely move files/directories with permission handling
secure_move_file() {
    local source="$1"
    local dest="$2"
    
    # Try regular mv first
    if mv "$source" "$dest" 2>/dev/null; then
        return 0
    fi
    
    # If that fails, try with sudo if available
    if command -v sudo >/dev/null 2>&1; then
        if sudo mv "$source" "$dest" 2>/dev/null; then
            # Fix ownership to match parent directory
            local parent_dir=$(dirname "$dest")
            local parent_owner=$(stat -c '%U:%G' "$parent_dir" 2>/dev/null)
            if [[ -n "$parent_owner" ]]; then
                sudo chown -R "$parent_owner" "$dest" 2>/dev/null
            fi
            return 0
        fi
    fi
    
    # If all else fails, log error
    log $LOG_ERROR "Failed to move: $source -> $dest"
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

# Function to perform atomic directory move using rsync
perform_atomic_directory_move() {
    local source_dir="$1"
    local dest_dir="$2"
    local operation_id="$3"
    
    log $LOG_DEBUG "Performing atomic directory move: $operation_id"
    
    # Use rsync for atomic move with verification
    # --archive preserves permissions, timestamps, etc.
    # --verbose for detailed logging
    # --progress for progress tracking
    # --checksum for integrity verification
    local rsync_options="--archive --verbose --progress --checksum --remove-source-files"
    
    if [[ $VERBOSITY -ge $LOG_DEBUG ]]; then
        rsync_options="$rsync_options --stats"
    fi
    
    # Create temporary destination to ensure atomicity
    local temp_dest="${dest_dir}.tmp.${operation_id}"
    
    log $LOG_INFO "Using rsync to move directory atomically..."
    # Try rsync, and if it fails due to permissions, try with sudo
    if rsync $rsync_options "$source_dir/" "$temp_dest/" 2>/dev/null; then
        log $LOG_DEBUG "rsync succeeded without sudo"
    elif command -v sudo >/dev/null 2>&1 && sudo rsync $rsync_options "$source_dir/" "$temp_dest/" 2>/dev/null; then
        log $LOG_DEBUG "rsync succeeded with sudo"
        # Fix ownership to match parent directory
        local parent_owner=$(stat -c '%U:%G' "$(dirname "$dest_dir")" 2>/dev/null)
        if [[ -n "$parent_owner" ]]; then
            sudo chown -R "$parent_owner" "$temp_dest" 2>/dev/null
        fi
    else
        log $LOG_ERROR "rsync failed during directory move"
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
    local audio_exts="${AUDIO_EXTENSIONS:-mp3|flac|wav|m4a|aac|ogg|wma}"
    
    if [[ ! -d "$dir" ]]; then
        return 1
    fi
    
    # Check for audio files
    if find "$dir" -type f -iregex ".*\.\($audio_exts\)" -print -quit | grep -q .; then
        return 0
    fi
    
    return 1
}

# Export all functions
export -f secure_move_file move_to_unsorted perform_atomic_directory_move
export -f check_directory_permissions create_directory_safe directory_has_audio_files