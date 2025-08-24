#!/bin/bash

# Script to consolidate duplicate artist directories with different cases/symbols
# Merges AGF variants and Atom™ variants into canonical forms

source "lib/common.sh"

# Initialize logging
LOG_FILE="consolidate_duplicate_artists.log"
exec > >(tee -a "$LOG_FILE")
exec 2>&1

log $LOG_INFO "--- Duplicate Artist Consolidation Started ---"

# Function to consolidate artist directories
consolidate_artist_variants() {
    local canonical_name="$1"
    local quality_dir="$2"
    shift 2
    local -a variant_patterns=("$@")
    
    local canonical_dir="$quality_dir/$canonical_name"
    local temp_consolidation_dir="/tmp/consolidate_${canonical_name// /_}_$(date +%s)"
    
    log $LOG_INFO "Consolidating $canonical_name variants in $quality_dir..."
    
    # Create temporary consolidation directory
    mkdir -p "$temp_consolidation_dir"
    
    local found_variants=()
    local consolidated_albums=0
    
    # Find all variant directories
    for pattern in "${variant_patterns[@]}"; do
        while IFS= read -r -d '' variant_dir; do
            if [[ -d "$variant_dir" ]]; then
                variant_name=$(basename "$variant_dir")
                log $LOG_INFO "Found variant: '$variant_name' at '$variant_dir'"
                found_variants+=("$variant_dir")
            fi
        done < <(find "$quality_dir" -maxdepth 1 -type d -iname "$pattern" -print0 2>/dev/null)
    done
    
    if [[ ${#found_variants[@]} -eq 0 ]]; then
        log $LOG_INFO "No variants found for $canonical_name in $quality_dir"
        return 0
    fi
    
    # Move all albums from variants to temporary directory
    for variant_dir in "${found_variants[@]}"; do
        variant_name=$(basename "$variant_dir")
        log $LOG_INFO "Processing variant: $variant_name"
        
        # Move all albums from this variant
        for album_dir in "$variant_dir"/*; do
            if [[ -d "$album_dir" ]]; then
                album_name=$(basename "$album_dir")
                temp_album_dir="$temp_consolidation_dir/$album_name"
                
                # Handle naming conflicts by adding variant suffix
                local counter=1
                while [[ -d "$temp_album_dir" ]]; do
                    temp_album_dir="$temp_consolidation_dir/${album_name}_v${counter}"
                    ((counter++))
                done
                
                log $LOG_INFO "Moving album: '$album_dir' -> '$temp_album_dir'"
                if mv "$album_dir" "$temp_album_dir"; then
                    ((consolidated_albums++))
                else
                    log $LOG_ERROR "Failed to move album: $album_dir"
                fi
            fi
        done
        
        # Remove empty variant directory
        if rmdir "$variant_dir" 2>/dev/null; then
            log $LOG_INFO "Removed empty variant directory: $variant_dir"
        else
            log $LOG_WARNING "Could not remove variant directory (not empty?): $variant_dir"
        fi
    done
    
    # Create canonical directory if it doesn't exist
    if [[ ! -d "$canonical_dir" ]]; then
        mkdir -p "$canonical_dir"
        log $LOG_INFO "Created canonical directory: $canonical_dir"
    fi
    
    # Move all consolidated albums to canonical directory
    for temp_album in "$temp_consolidation_dir"/*; do
        if [[ -d "$temp_album" ]]; then
            album_name=$(basename "$temp_album")
            target_album="$canonical_dir/$album_name"
            
            # Handle naming conflicts in canonical directory
            local counter=1
            while [[ -d "$target_album" ]]; do
                target_album="$canonical_dir/${album_name}_${counter}"
                ((counter++))
            done
            
            log $LOG_INFO "Moving to canonical location: '$temp_album' -> '$target_album'"
            if mv "$temp_album" "$target_album"; then
                log $LOG_INFO "Successfully consolidated album: $album_name"
            else
                log $LOG_ERROR "Failed to move to canonical location: $temp_album"
            fi
        fi
    done
    
    # Clean up temporary directory
    rmdir "$temp_consolidation_dir" 2>/dev/null
    
    log $LOG_INFO "Consolidated $consolidated_albums albums for $canonical_name"
    return 0
}

# Consolidate AGF variants
for quality_dir in "/home/plex/Music/sorted_music/Lossless" "/home/plex/Music/sorted_music/Lossy" "/home/plex/Music/sorted_music/Unknown"; do
    if [[ -d "$quality_dir" ]]; then
        consolidate_artist_variants "AGF" "$quality_dir" "agf" "AGF" "agf*" "AGF*"
    fi
done

# Consolidate Atom™ variants  
for quality_dir in "/home/plex/Music/sorted_music/Lossless" "/home/plex/Music/sorted_music/Lossy" "/home/plex/Music/sorted_music/Unknown"; do
    if [[ -d "$quality_dir" ]]; then
        consolidate_artist_variants "Atom™" "$quality_dir" "AtomTM" "Atom™" "ATOM™" "Atom*TM*" "atom*" "ATOM*"
    fi
done

# Consolidate Various Artists variants
for quality_dir in "/home/plex/Music/sorted_music/Lossless" "/home/plex/Music/sorted_music/Lossy" "/home/plex/Music/sorted_music/Unknown"; do
    if [[ -d "$quality_dir" ]]; then
        consolidate_artist_variants "Various Artists" "$quality_dir" "Various" "various" "Various Artists" "VA"
    fi
done

log $LOG_INFO "--- Duplicate Artist Consolidation Finished ---"