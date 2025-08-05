#!/bin/bash
# Cleanup module for ordr.fm
# Handles post-processing cleanup tasks

# Source common utilities
source "${BASH_SOURCE%/*}/common.sh"

# Cleanup configuration
declare -g CLEANUP_EMPTY_DIRS=0
declare -g CLEANUP_DRY_RUN=1
declare -g CLEANUP_PRESERVE_STRUCTURE=0
declare -g CLEANUP_MAX_DEPTH=10
declare -g CLEANUP_EXCLUDE_PATTERNS=()

# Find empty directories
find_empty_directories() {
    local base_dir="$1"
    local max_depth="${2:-$CLEANUP_MAX_DEPTH}"
    local empty_dirs=()
    
    log $LOG_DEBUG "Searching for empty directories in: $base_dir"
    
    # Find directories that are empty or only contain other empty directories
    while IFS= read -r -d '' dir; do
        # Skip if matches exclude pattern
        local skip=0
        for pattern in "${CLEANUP_EXCLUDE_PATTERNS[@]}"; do
            if [[ "$dir" =~ $pattern ]]; then
                skip=1
                break
            fi
        done
        [[ $skip -eq 1 ]] && continue
        
        # Check if directory is truly empty (no files at any depth)
        if [[ -z $(find "$dir" -type f -print -quit 2>/dev/null) ]]; then
            empty_dirs+=("$dir")
        fi
    done < <(find "$base_dir" -mindepth 1 -maxdepth "$max_depth" -type d -print0 2>/dev/null | sort -zr)
    
    printf '%s\n' "${empty_dirs[@]}"
}

# Check if directory can be safely removed
is_safe_to_remove() {
    local dir="$1"
    
    # Never remove these directories
    local protected_dirs=(
        "$HOME"
        "/"
        "/usr"
        "/etc"
        "/var"
        "/tmp"
        "/bin"
        "/sbin"
        "/lib"
        "/opt"
        "$SOURCE_DIR"  # Don't remove the source root itself
        "$DEST_DIR"    # Don't remove the destination root
    )
    
    # Check against protected directories
    for protected in "${protected_dirs[@]}"; do
        if [[ "$dir" == "$protected" ]] || [[ "$dir" == "$protected/" ]]; then
            log $LOG_WARNING "Skipping protected directory: $dir"
            return 1
        fi
    done
    
    # Check if directory contains hidden files
    if [[ -n $(find "$dir" -name ".*" -not -name "." -not -name ".." -print -quit 2>/dev/null) ]]; then
        log $LOG_DEBUG "Directory contains hidden files: $dir"
        return 1
    fi
    
    # Check if directory is a git repository
    if [[ -d "$dir/.git" ]]; then
        log $LOG_DEBUG "Directory is a git repository: $dir"
        return 1
    fi
    
    # Check if directory has special attributes
    if [[ -n $(lsattr -d "$dir" 2>/dev/null | grep -E '[aAcCdDeijsStTu]') ]]; then
        log $LOG_DEBUG "Directory has special attributes: $dir"
        return 1
    fi
    
    return 0
}

# Remove empty directory with safety checks
remove_empty_directory() {
    local dir="$1"
    
    if [[ ! -d "$dir" ]]; then
        log $LOG_WARNING "Directory no longer exists: $dir"
        return 1
    fi
    
    if ! is_safe_to_remove "$dir"; then
        return 1
    fi
    
    # Double-check it's still empty
    if [[ -n $(find "$dir" -type f -print -quit 2>/dev/null) ]]; then
        log $LOG_WARNING "Directory no longer empty: $dir"
        return 1
    fi
    
    # Remove the directory
    if [[ $CLEANUP_DRY_RUN -eq 1 ]]; then
        log $LOG_INFO "(Dry run) Would remove empty directory: $dir"
        return 0
    else
        if rmdir "$dir" 2>/dev/null; then
            log $LOG_INFO "Removed empty directory: $dir"
            return 0
        else
            log $LOG_ERROR "Failed to remove directory: $dir"
            return 1
        fi
    fi
}

# Clean up empty directories after move operations
cleanup_empty_source_directories() {
    local source_dir="${1:-$SOURCE_DIR}"
    local options="${2:-}"
    
    log $LOG_INFO "Starting empty directory cleanup in: $source_dir"
    
    # Parse options
    if [[ "$options" =~ "preview" ]]; then
        CLEANUP_DRY_RUN=1
    fi
    
    if [[ "$options" =~ "preserve-structure" ]]; then
        CLEANUP_PRESERVE_STRUCTURE=1
    fi
    
    # Find empty directories
    local empty_dirs=()
    while IFS= read -r dir; do
        [[ -n "$dir" ]] && empty_dirs+=("$dir")
    done < <(find_empty_directories "$source_dir")
    
    local total_empty=${#empty_dirs[@]}
    
    if [[ $total_empty -eq 0 ]]; then
        log $LOG_INFO "No empty directories found"
        return 0
    fi
    
    log $LOG_INFO "Found $total_empty empty directories"
    
    # Preview mode - just show what would be removed
    if [[ "$options" =~ "list-only" ]]; then
        echo "Empty directories found:"
        printf '%s\n' "${empty_dirs[@]}"
        return 0
    fi
    
    # Remove empty directories (bottom-up order)
    local removed=0
    local failed=0
    
    for dir in "${empty_dirs[@]}"; do
        # Skip if preserve structure is enabled and dir is a top-level artist folder
        if [[ $CLEANUP_PRESERVE_STRUCTURE -eq 1 ]]; then
            local depth=$(echo "$dir" | awk -F/ '{print NF-1}')
            local base_depth=$(echo "$source_dir" | awk -F/ '{print NF-1}')
            if [[ $((depth - base_depth)) -le 1 ]]; then
                log $LOG_DEBUG "Preserving structure: $dir"
                continue
            fi
        fi
        
        if remove_empty_directory "$dir"; then
            ((removed++))
        else
            ((failed++))
        fi
    done
    
    log $LOG_INFO "Cleanup complete: $removed removed, $failed skipped"
    
    # If we removed directories, check again for newly empty parent directories
    if [[ $removed -gt 0 ]] && [[ $CLEANUP_DRY_RUN -eq 0 ]]; then
        log $LOG_DEBUG "Checking for newly empty parent directories..."
        cleanup_empty_source_directories "$source_dir" "$options"
    fi
    
    return 0
}

# Clean up other artifacts
cleanup_artifacts() {
    local base_dir="${1:-$SOURCE_DIR}"
    
    log $LOG_INFO "Cleaning up artifacts in: $base_dir"
    
    # Common artifact patterns
    local artifact_patterns=(
        "Thumbs.db"
        ".DS_Store"
        "desktop.ini"
        ".directory"
        "*.tmp"
        "*.temp"
        "*~"
        ".*.swp"
        ".*.swo"
    )
    
    local found=0
    local removed=0
    
    for pattern in "${artifact_patterns[@]}"; do
        while IFS= read -r file; do
            ((found++))
            
            if [[ $CLEANUP_DRY_RUN -eq 1 ]]; then
                log $LOG_INFO "(Dry run) Would remove artifact: $file"
            else
                if rm -f "$file" 2>/dev/null; then
                    log $LOG_DEBUG "Removed artifact: $file"
                    ((removed++))
                else
                    log $LOG_WARNING "Failed to remove artifact: $file"
                fi
            fi
        done < <(find "$base_dir" -name "$pattern" -type f 2>/dev/null)
    done
    
    if [[ $found -gt 0 ]]; then
        log $LOG_INFO "Artifact cleanup: found $found, removed $removed"
    else
        log $LOG_INFO "No artifacts found to clean up"
    fi
}

# Interactive cleanup wizard
cleanup_wizard() {
    local source_dir="${1:-$SOURCE_DIR}"
    
    echo "Empty Directory Cleanup Wizard"
    echo "=============================="
    echo
    echo "This will help you clean up empty directories after organizing your music."
    echo
    
    # Find empty directories
    local empty_dirs=()
    while IFS= read -r dir; do
        [[ -n "$dir" ]] && empty_dirs+=("$dir")
    done < <(find_empty_directories "$source_dir")
    
    local total=${#empty_dirs[@]}
    
    if [[ $total -eq 0 ]]; then
        echo "No empty directories found in: $source_dir"
        return 0
    fi
    
    echo "Found $total empty directories:"
    echo
    
    # Show preview (first 10)
    local preview_count=$((total < 10 ? total : 10))
    for ((i=0; i<preview_count; i++)); do
        echo "  ${empty_dirs[$i]}"
    done
    
    if [[ $total -gt 10 ]]; then
        echo "  ... and $((total - 10)) more"
    fi
    
    echo
    echo "Options:"
    echo "  1) Preview all empty directories"
    echo "  2) Remove all empty directories"
    echo "  3) Remove with structure preservation"
    echo "  4) Clean artifacts only"
    echo "  5) Cancel"
    echo
    
    read -p "Choice [5]: " choice
    
    case "${choice:-5}" in
        1)
            echo
            echo "All empty directories:"
            printf '%s\n' "${empty_dirs[@]}" | less
            ;;
        2)
            echo
            read -p "Remove $total empty directories? [y/N]: " confirm
            if [[ "$confirm" =~ ^[Yy]$ ]]; then
                CLEANUP_DRY_RUN=0
                cleanup_empty_source_directories "$source_dir"
            fi
            ;;
        3)
            echo
            echo "Preserving top-level structure..."
            read -p "Remove empty subdirectories only? [y/N]: " confirm
            if [[ "$confirm" =~ ^[Yy]$ ]]; then
                CLEANUP_DRY_RUN=0
                CLEANUP_PRESERVE_STRUCTURE=1
                cleanup_empty_source_directories "$source_dir"
            fi
            ;;
        4)
            echo
            read -p "Clean up artifact files? [y/N]: " confirm
            if [[ "$confirm" =~ ^[Yy]$ ]]; then
                CLEANUP_DRY_RUN=0
                cleanup_artifacts "$source_dir"
            fi
            ;;
        *)
            echo "Cancelled"
            ;;
    esac
}

# Add cleanup options to main script
add_cleanup_arguments() {
    cat << EOF
    --cleanup-empty           Remove empty source directories after processing
    --cleanup-preview         Preview directories that would be removed
    --cleanup-artifacts       Remove system artifacts (Thumbs.db, .DS_Store, etc)
    --preserve-structure      Keep top-level directory structure when cleaning
EOF
}

# Export functions
export -f find_empty_directories
export -f is_safe_to_remove
export -f remove_empty_directory
export -f cleanup_empty_source_directories
export -f cleanup_artifacts
export -f cleanup_wizard