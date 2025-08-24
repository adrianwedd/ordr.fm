#!/bin/bash

# Script to identify and fix remaining problematic artist directories
# Focuses on catalog contamination, null contamination, and malformed names

source "lib/common.sh"

# Initialize logging
LOG_FILE="cleanup_remaining_issues.log"
exec > >(tee -a "$LOG_FILE")
exec 2>&1

log $LOG_INFO "--- Remaining Issues Cleanup Started ---"

# Define additional problematic patterns
declare -a REMAINING_BAD_PATTERNS=(
    ".*0null.*"                     # Null contamination: "Beige0null3774873.6"
    "^[a-z]{3,6}[0-9]{3}$"         # Pure catalog codes: "playcd018", "bnr370", "deta003"
    ".*\\) [a-z]+ [a-z]+$"         # Malformed: "deta003) claude young"
    ".*- full album -.*"           # Album titles as artists
    ".*[Ff]eat\\. .* - .*"        # Feature tracks as artists
)

# Define known valid artists that might look like catalog codes
declare -a VALID_ARTISTS=(
    "Shuttle358"
    "duo505"
    "buckfunk3000"
    "Sonmi451"
    "808 State"
    "4Hero"
    "4 Voice"
)

# Function to check if directory name matches remaining bad patterns
is_remaining_problematic() {
    local dir_name="$1"
    
    # First check if it's a known valid artist
    for valid_artist in "${VALID_ARTISTS[@]}"; do
        if [[ "$dir_name" == "$valid_artist" ]]; then
            return 1  # Is valid, not problematic
        fi
    done
    
    # Then check against problematic patterns
    for pattern in "${REMAINING_BAD_PATTERNS[@]}"; do
        if [[ "$dir_name" =~ $pattern ]]; then
            return 0  # Is problematic
        fi
    done
    
    return 1  # Is okay
}

# Function to suggest fixes for problematic names
suggest_fix() {
    local problematic_name="$1"
    
    # Extract real artist from catalog contamination
    if [[ "$problematic_name" =~ ^[a-z]{3,6}[0-9]{3}\)[[:space:]]+(.+)$ ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi
    
    # Clean catalog prefix: "playcd018" -> skip (no real artist)
    if [[ "$problematic_name" =~ ^[a-z]{3,6}[0-9]{3}$ ]]; then
        echo "SKIP_NO_ARTIST"
        return 1
    fi
    
    # These should not reach here due to VALID_ARTISTS check, but just in case
    for valid_artist in "${VALID_ARTISTS[@]}"; do
        if [[ "$problematic_name" == "$valid_artist" ]]; then
            echo "$problematic_name"
            return 1  # Don't change valid artists
        fi
    done
    
    # Remove null contamination
    if [[ "$problematic_name" =~ (.+)0null.* ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi
    
    # Extract artist from album titles: "Repeat (plaid & mark broom) - full album - 1993"
    if [[ "$problematic_name" =~ ^(.+)[[:space:]]-[[:space:]]full[[:space:]]album[[:space:]]- ]]; then
        # Extract artist from parentheses
        local content="${BASH_REMATCH[1]}"
        if [[ "$content" =~ \\(([^)]+)\\) ]]; then
            echo "${BASH_REMATCH[1]}"
            return 0
        fi
    fi
    
    # Extract main artist from featuring: "Round Four Feat. Paul St. Hilaire - Find A Way"
    if [[ "$problematic_name" =~ ^([^-]+)\ [Ff]eat\..*\ -\ .* ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi
    
    echo "$problematic_name"
    return 1
}

# Scan for remaining problematic artists
log $LOG_INFO "Scanning for remaining problematic artist directories..."

FOUND_ISSUES=0
declare -a PROBLEMATIC_DIRS=()
declare -a SUGGESTED_FIXES=()

for quality_dir in "/home/plex/Music/sorted_music/Lossless" "/home/plex/Music/sorted_music/Lossy" "/home/plex/Music/sorted_music/Mixed" "/home/plex/Music/sorted_music/Unknown"; do
    if [[ ! -d "$quality_dir" ]]; then
        continue
    fi
    
    while IFS= read -r -d '' artist_dir; do
        artist_name=$(basename "$artist_dir")
        
        if is_remaining_problematic "$artist_name"; then
            suggested_fix=$(suggest_fix "$artist_name")
            fix_status=$?
            
            log $LOG_WARNING "Found problematic artist: '$artist_name' -> suggested: '$suggested_fix'"
            PROBLEMATIC_DIRS+=("$artist_dir")
            SUGGESTED_FIXES+=("$suggested_fix:$fix_status")
            ((FOUND_ISSUES++))
            
            # Show album count
            album_count=$(ls "$artist_dir" 2>/dev/null | wc -l)
            echo "  -> $album_count albums"
        fi
    done < <(find "$quality_dir" -mindepth 1 -maxdepth 1 -type d -print0)
done

log $LOG_INFO "Found $FOUND_ISSUES remaining problematic artist directories"

if [[ $FOUND_ISSUES -eq 0 ]]; then
    log $LOG_INFO "No remaining problematic artist directories found!"
    exit 0
fi

# Show summary with suggested fixes
echo
echo "=== REMAINING ISSUES SUMMARY ==="
for i in "${!PROBLEMATIC_DIRS[@]}"; do
    dir="${PROBLEMATIC_DIRS[$i]}"
    artist_name=$(basename "$dir")
    fix_info="${SUGGESTED_FIXES[$i]}"
    suggested_fix=$(echo "$fix_info" | cut -d':' -f1)
    should_fix=$(echo "$fix_info" | cut -d':' -f2)
    
    echo "  $((i+1)). '$artist_name'"
    if [[ "$should_fix" == "0" ]]; then
        echo "     -> CAN FIX: '$suggested_fix'"
    elif [[ "$suggested_fix" == "SKIP_NO_ARTIST" ]]; then
        echo "     -> MOVE TO UNSORTED: No real artist name found"
    else
        echo "     -> KEEP AS IS: '$suggested_fix'"
    fi
done

echo
echo "Options:"
echo "1. Apply suggested fixes and move unfixable to unsorted"
echo "2. Move all problematic artists to unsorted for manual review"  
echo "3. Just report (dry run)"
echo "4. Exit without action"
echo
read -p "Choose option (1-4): " choice

case "$choice" in
    1|2)
        if [[ "$choice" == "1" ]]; then
            log $LOG_INFO "Applying suggested fixes and moving unfixable to unsorted..."
            action="fix"
        else
            log $LOG_INFO "Moving all problematic artists to unsorted..."
            action="move_all"
        fi
        
        CLEANUP_DIR="/home/plex/Music/sorted_music/unsorted/remaining_cleanup_$(date +%Y%m%d_%H%M%S)"
        mkdir -p "$CLEANUP_DIR"
        
        for i in "${!PROBLEMATIC_DIRS[@]}"; do
            dir="${PROBLEMATIC_DIRS[$i]}"
            artist_name=$(basename "$dir")
            fix_info="${SUGGESTED_FIXES[$i]}"
            suggested_fix=$(echo "$fix_info" | cut -d':' -f1)
            should_fix=$(echo "$fix_info" | cut -d':' -f2)
            
            if [[ "$action" == "move_all" ]] || [[ "$should_fix" != "0" ]] || [[ "$suggested_fix" == "SKIP_NO_ARTIST" ]]; then
                # Move to unsorted
                log $LOG_INFO "Moving to unsorted: '$dir' -> '$CLEANUP_DIR/'"
                if mv "$dir" "$CLEANUP_DIR/"; then
                    log $LOG_INFO "Successfully moved $artist_name"
                else
                    log $LOG_ERROR "Failed to move $artist_name"
                fi
            elif [[ "$action" == "fix" ]] && [[ "$should_fix" == "0" ]]; then
                # Apply fix by renaming directory
                quality_parent=$(dirname "$dir")
                new_dir="$quality_parent/$suggested_fix"
                
                # Handle naming conflicts
                counter=1
                while [[ -d "$new_dir" ]]; do
                    new_dir="$quality_parent/${suggested_fix}_${counter}"
                    ((counter++))
                done
                
                log $LOG_INFO "Fixing artist name: '$dir' -> '$new_dir'"
                if mv "$dir" "$new_dir"; then
                    log $LOG_INFO "Successfully fixed: '$artist_name' -> '$suggested_fix'"
                else
                    log $LOG_ERROR "Failed to fix $artist_name"
                fi
            fi
        done
        
        log $LOG_INFO "Cleanup completed. Problematic artists moved to: $CLEANUP_DIR"
        ;;
    3)
        log $LOG_INFO "Dry run completed. No changes made."
        ;;
    4)
        log $LOG_INFO "User chose to exit. No changes made."
        exit 0
        ;;
    *)
        log $LOG_ERROR "Invalid choice. Exiting."
        exit 1
        ;;
esac

log $LOG_INFO "--- Remaining Issues Cleanup Finished ---"