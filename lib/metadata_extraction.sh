#!/bin/bash
# Metadata extraction module for ordr.fm
# Handles audio file metadata extraction and analysis

# Source common utilities
source "${BASH_SOURCE%/*}/common.sh"

# Extract metadata from audio files in directory
extract_album_metadata() {
    local album_dir="$1"
    local exiftool_output=""
    
    log $LOG_DEBUG "Extracting metadata from: $album_dir"
    
    # Use exiftool to extract metadata in JSON format from audio and video files
    # Use find with case-insensitive matching instead of shell glob expansion
    local media_files=$(find "$album_dir" -maxdepth 1 -type f -iregex ".*\.\(mp3\|flac\|wav\|m4a\|ogg\|aiff\|alac\|opus\|wma\|ape\|mp4\|mkv\|avi\|mov\|webm\)$" 2>/dev/null)
    
    log $LOG_DEBUG "Media files found: $(echo "$media_files" | wc -l) files"
    log $LOG_DEBUG "Media files list: $media_files"
    
    if [[ -n "$media_files" ]]; then
        # Use null-delimited output and xargs -0 to handle filenames with spaces
        # Add timeout to prevent hanging on corrupted files
        local timeout_cmd=""
        if command -v timeout >/dev/null 2>&1; then
            timeout_cmd="timeout 60s"  # 60 second timeout for metadata extraction
        fi
        
        log $LOG_DEBUG "Running exiftool command on $(echo "$media_files" | wc -l) files"
        exiftool_output=$(find "$album_dir" -maxdepth 1 -type f -iregex ".*\.\(mp3\|flac\|wav\|m4a\|ogg\|aiff\|alac\|opus\|wma\|ape\|mp4\|mkv\|avi\|mov\|webm\)$" -print0 2>/dev/null | \
            xargs -0 $timeout_cmd exiftool -j -Artist -AlbumArtist -Album -Title -Track -DiscNumber \
            -Year -Date -Genre -FileType -AudioBitrate -SampleRate -Duration \
            -FileSize -Label -CatalogNumber -Publisher -Organization 2>/dev/null || echo "[]")
        
        log $LOG_DEBUG "Exiftool output length: ${#exiftool_output} characters"
        log $LOG_DEBUG "Exiftool output starts with: ${exiftool_output:0:100}"
        
        # Validate JSON output
        if ! echo "$exiftool_output" | jq . >/dev/null 2>&1; then
            log $LOG_WARNING "Invalid JSON output from exiftool for: $album_dir"
            log $LOG_DEBUG "Invalid JSON content: ${exiftool_output:0:500}"
            exiftool_output="[]"
        fi
    else
        exiftool_output="[]"
    fi
    
    echo "$exiftool_output"
}

# Analyze album quality based on formats
determine_album_quality() {
    local exiftool_output="$1"
    local has_lossless=0
    local has_lossy=0
    
    # Parse formats from exiftool output
    local formats=$(echo "$exiftool_output" | jq -r '.[].FileType' 2>/dev/null | sort -u)
    
    # Debug logging
    log $LOG_DEBUG "Quality check: formats found: '$formats'"
    
    while IFS= read -r format; do
        [[ -z "$format" ]] && continue
        
        log $LOG_DEBUG "Quality check: processing format '$format' (uppercase: '${format^^}')"
        
        case "${format^^}" in
            FLAC|WAV|AIFF|ALAC|APE)
                has_lossless=1
                log $LOG_DEBUG "Quality check: marked as lossless"
                ;;
            MP3|AAC|M4A|OGG|OPUS|WMA)
                has_lossy=1
                log $LOG_DEBUG "Quality check: marked as lossy"
                ;;
            MP4|MKV|AVI|MOV|WEBM)
                # Video files - treat as lossy for organization purposes
                has_lossy=1
                log $LOG_DEBUG "Quality check: video file marked as lossy"
                ;;
        esac
    done <<< "$formats"
    
    log $LOG_DEBUG "Quality check: has_lossless=$has_lossless, has_lossy=$has_lossy"
    
    # Determine quality type
    if [[ $has_lossless -eq 1 ]] && [[ $has_lossy -eq 1 ]]; then
        echo "Mixed"
    elif [[ $has_lossless -eq 1 ]]; then
        echo "Lossless"
    elif [[ $has_lossy -eq 1 ]]; then
        echo "Lossy"
    else
        echo "Unknown"
    fi
}

# Validate and clean artist names to prevent bad organization
validate_artist_name() {
    local artist="$1"
    local original_artist="$artist"
    
    # Remove null contamination and control characters - be more aggressive
    artist=$(echo "$artist" | sed 's/0null[0-9.]*//g' | sed 's/null[0-9.]*//g' | sed 's/null//g' | tr -d '\n\r' | sed 's/[[:cntrl:]]//g')
    
    # Remove leading/trailing whitespace
    artist=$(echo "$artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    # Extract real artist from catalog patterns: [CAT] Artist - Album
    if [[ "$artist" =~ ^\[[^\]]*\][[:space:]]*([^-]+)[[:space:]]*-.*$ ]]; then
        artist="${BASH_REMATCH[1]}"
        artist=$(echo "$artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    fi
    
    # Remove special prefix characters and catalog remnants
    artist=$(echo "$artist" | sed 's/^[¥\[\(]*[[:space:]]*//')
    artist=$(echo "$artist" | sed 's/^[0-9][0-9]*[[:space:]]*]//')  # Remove catalog numbers with ]
    artist=$(echo "$artist" | sed 's/[[:space:]]*].*$//')           # Remove trailing brackets
    
    # Handle track title patterns like "05. If You Wan Me To Stay"
    if [[ "$artist" =~ ^[0-9]{1,2}\.[[:space:]]*(.+)$ ]]; then
        # This looks like a track title, reject it completely
        return 1
    fi
    
    # Clean catalog contamination patterns
    # Remove track number prefixes: "02 - Move D" -> "Move D"  
    if [[ "$artist" =~ ^[0-9]{2}[[:space:]]*-[[:space:]]*(.+)$ ]]; then
        artist="${BASH_REMATCH[1]}"
        artist=$(echo "$artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    fi
    
    # Remove catalog prefixes: "025 scorn" -> "scorn", "80 aum" -> "aum"
    if [[ "$artist" =~ ^[0-9]{2,3}[[:space:]]+(.+)$ ]]; then
        local candidate="${BASH_REMATCH[1]}"
        # Only apply if the remaining part looks like a real artist name
        if [[ ${#candidate} -gt 2 ]] && [[ ! "$candidate" =~ ^[0-9]+$ ]]; then
            artist="$candidate"
            artist=$(echo "$artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        fi
    fi
    
    # Remove album/technical info from artist: "herbert - 100 lbs (phono) - THE CLASSIC" -> "herbert"
    if [[ "$artist" =~ ^([^-]+)[[:space:]]*-[[:space:]]*[0-9]+[[:space:]]*lbs.*$ ]]; then
        artist="${BASH_REMATCH[1]}"
        artist=$(echo "$artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    fi
    
    # NEW: Clean uploader contamination patterns
    # Remove "By [uploader]" suffixes: "Adam Beyer - Protechtion - By c4Rnir4Z" -> "Adam Beyer"
    if [[ "$artist" =~ ^(.+)[[:space:]]*-[[:space:]]*By[[:space:]]+[a-zA-Z0-9_]+.*$ ]]; then
        artist="${BASH_REMATCH[1]}"
        artist=$(echo "$artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    fi
    
    # Remove scene/uploader tags: "-Dew-", "sweet", etc.
    artist=$(echo "$artist" | sed 's/[[:space:]]*-[Dd]ew-[[:space:]]*$//' | sed 's/[[:space:]]*-[Ss]weet[[:space:]]*$//')
    artist=$(echo "$artist" | sed 's/[[:space:]]*Musicdonkey[[:space:]]*Org[[:space:]]*$//')
    
    # Remove format/bitrate contamination: "[mp3]", "[256K]", "192Cbr", etc.
    artist=$(echo "$artist" | sed 's/[[:space:]]*\[[0-9]*[Kk][[:space:]]*\][[:space:]]*$//')  # [256K]
    artist=$(echo "$artist" | sed 's/[[:space:]]*\[[Mm][Pp]3\][[:space:]]*$//')              # [mp3]
    artist=$(echo "$artist" | sed 's/[[:space:]]*\[[Ff][Ll][Aa][Cc]\][[:space:]]*$//')      # [flac]
    artist=$(echo "$artist" | sed 's/[[:space:]]*[0-9]*[Kk]bs[[:space:]]*$//')               # 256Kbs
    artist=$(echo "$artist" | sed 's/[[:space:]]*[0-9]*Cbr[[:space:]]*$//')                 # 192Cbr
    artist=$(echo "$artist" | sed 's/[[:space:]]*Lofi-[0-9]*[[:space:]]*$//')               # Lofi-192
    
    # Remove technical info: "(Fullalbum Cover Tags)", "-13Tracks-", "Full Album"
    artist=$(echo "$artist" | sed 's/[[:space:]]*([Ff]ullalbum[[:space:]]*[Cc]over[[:space:]]*[Tt]ags)[[:space:]]*$//')
    artist=$(echo "$artist" | sed 's/[[:space:]]*-[0-9]*[Tt]racks-[[:space:]]*$//')
    artist=$(echo "$artist" | sed 's/[[:space:]]*[Ff]ull[[:space:]]*[Aa]lbum[[:space:]]*$//')
    artist=$(echo "$artist" | sed 's/[[:space:]]*vinyl-[0-9]*[[:space:]]*$//')
    
    # Remove extra dashes and clean up
    artist=$(echo "$artist" | sed 's/[[:space:]]*-[[:space:]]*$//') 
    artist=$(echo "$artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    # Remove catalog prefixes from various artists: "msqcd001 various artists" -> "Various Artists"
    if [[ "$artist" =~ ^[a-z]{2,6}[0-9]{3}[[:space:]]+various[[:space:]]+artists$ ]]; then
        artist="Various Artists"
    fi
    
    # Normalize artist names to consistent format
    # Convert to proper case where appropriate
    case "${artist,,}" in
        "various artists"|"various"|"va")
            artist="Various Artists"
            ;;
        "unknown artist"|"unknown"|"_unknown_")
            artist="Unknown Artist"
            ;;
        # Normalize AGF case variations  
        "agf"|"AGF")
            artist="AGF"
            ;;
        # Normalize Atom TM variants (consolidate to primary alias)
        "atomtm"|"atom™"|"atom tm"|"atom(tm)"|"ATOM™")
            artist="Atom™"
            ;;
    esac
    
    # Reject obviously invalid names - enhanced patterns
    if [[ "$artist" =~ ^[0-9]{1,3}\.?[[:space:]]*$ ]] || \
       [[ -z "$artist" ]] || \
       [[ "$artist" =~ ^[¥\[\(\<].*$ ]] || \
       [[ "$artist" =~ ^\.[[:space:]]*If[[:space:]]*You.*$ ]] || \
       [[ "$artist" == "null" ]] || \
       [[ "$artist" == "0" ]] || \
       [[ "$artist" =~ ^0null.*$ ]] || \
       [[ "$artist" =~ .*0null.*$ ]] || \
       [[ "$artist" =~ ^[0-9]{1,2}\.[[:space:]]*If[[:space:]]*You.*$ ]] || \
       [[ "$artist" =~ ^about[[:space:]]+this[[:space:]]+product$ ]] || \
       [[ "$artist" =~ ^[0-9]{3}[[:space:]]+bass[[:space:]]+mechanics$ ]] || \
       [[ "$artist" =~ ^[0-9]+[[:space:]]+voice$ ]] || \
       [[ "$artist" =~ ^[0-9]+[[:space:]]+dollar[[:space:]]+egg$ ]]; then
        return 1
    fi
    
    # Be more permissive for scene releases - allow if >= 3 characters and not pure numbers/catalog codes
    if [[ ${#artist} -ge 3 ]] && ! [[ "$artist" =~ ^[0-9]+$ ]] && ! [[ "$artist" =~ ^[A-Z0-9]{2,6}$ ]]; then
        log $LOG_DEBUG "Allowing scene release artist name: '$artist'"
        # Clean up spacing
        artist=$(echo "$artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed 's/[[:space:]]\+/ /g')
        
        # Log significant transformations for debugging
        if [[ "$original_artist" != "$artist" ]] && [[ $VERBOSITY -ge $LOG_DEBUG ]]; then
            log $LOG_DEBUG "Artist name cleaned: '$original_artist' -> '$artist'"
        fi
        
        echo "$artist"
        return 0
    fi
    
    # If we reach here, the artist name failed validation
    return 1
}

# Extract artist from directory/file path as fallback
extract_artist_from_path() {
    local path="$1"
    local basename=$(basename "$path")
    
    # Handle catalog prefix patterns: [CAT] Artist - Album  
    if [[ "$basename" =~ ^\[[^\]]*\][[:space:]]*([^-]+)[[:space:]]*-.*$ ]]; then
        local candidate="${BASH_REMATCH[1]}"
        candidate=$(echo "$candidate" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        validate_artist_name "$candidate"
        return $?
    # Handle Artist - Album patterns (enhanced for Albums & EPs directory)
    elif [[ "$basename" =~ ^([^-]+)[[:space:]]*-.*$ ]]; then
        local candidate="${BASH_REMATCH[1]}"
        candidate=$(echo "$candidate" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        
        # Clean the candidate before validation
        candidate=$(clean_directory_name_for_artist_extraction "$candidate")
        
        validate_artist_name "$candidate"
        return $?
    fi
    
    return 1
}

# NEW: Clean directory names specifically for artist extraction from Albums & EPs
clean_directory_name_for_artist_extraction() {
    local name="$1"
    
    # Remove uploader info: "By [uploader]"
    name=$(echo "$name" | sed 's/[[:space:]]*-[[:space:]]*By[[:space:]]+[a-zA-Z0-9_]+.*$//')
    
    # Remove scene tags
    name=$(echo "$name" | sed 's/[[:space:]]*-[Dd]ew-$//' | sed 's/[[:space:]]*-[Ss]weet$//')
    name=$(echo "$name" | sed 's/[[:space:]]*Musicdonkey[[:space:]]*Org$//')
    
    # Remove format info 
    name=$(echo "$name" | sed 's/[[:space:]]*\[[0-9]*[Kk]\]$//')      # [256K]
    name=$(echo "$name" | sed 's/[[:space:]]*\[[Mm][Pp]3\]$//')       # [mp3]
    name=$(echo "$name" | sed 's/[[:space:]]*\[[Ff][Ll][Aa][Cc]\]$//') # [flac]
    name=$(echo "$name" | sed 's/[[:space:]]*[0-9]*[Kk]bs$//')        # 256Kbs
    name=$(echo "$name" | sed 's/[[:space:]]*[0-9]*Cbr$//')           # 192Cbr
    name=$(echo "$name" | sed 's/[[:space:]]*Lofi-[0-9]*$//')         # Lofi-192
    
    # Remove technical contamination
    name=$(echo "$name" | sed 's/[[:space:]]*([Ff]ullalbum[[:space:]]*[Cc]over[[:space:]]*[Tt]ags)$//')
    name=$(echo "$name" | sed 's/[[:space:]]*-[0-9]*[Tt]racks-$//')
    name=$(echo "$name" | sed 's/[[:space:]]*[Ff]ull[[:space:]]*[Aa]lbum$//')
    name=$(echo "$name" | sed 's/[[:space:]]*vinyl-[0-9]*$//')
    
    # Clean up trailing dashes and whitespace
    name=$(echo "$name" | sed 's/[[:space:]]*-[[:space:]]*$//')
    name=$(echo "$name" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    echo "$name"
}

# Extract album-level metadata from track metadata
extract_album_info() {
    local exiftool_output="$1"
    local album_dir="$2"
    
    # Extract album artist (prefer AlbumArtist over Artist)
    local album_artist_debug=$(echo "$exiftool_output" | jq -r '.[] | {Artist, AlbumArtist}' 2>/dev/null | head -3)
    log $LOG_DEBUG "Album artist extraction debug: $album_artist_debug"
    
    # Handle both array and string values for Artist/AlbumArtist (check both capitalizations)
    local raw_album_artist=$(echo "$exiftool_output" | jq -r '
        if .[0].AlbumArtist then 
            if (.[0].AlbumArtist | type) == "array" then 
                .[0].AlbumArtist | join(", ") 
            else 
                .[0].AlbumArtist 
            end
        elif .[0].Albumartist then 
            if (.[0].Albumartist | type) == "array" then 
                .[0].Albumartist | join(", ") 
            else 
                .[0].Albumartist 
            end
        elif .[0].Artist then
            if (.[0].Artist | type) == "array" then 
                .[0].Artist | join(", ") 
            else 
                .[0].Artist 
            end
        else 
            ""
        end' 2>/dev/null)
    
    # Validate and clean the extracted artist
    local album_artist
    if album_artist=$(validate_artist_name "$raw_album_artist"); then
        log $LOG_DEBUG "Validated album artist: '$raw_album_artist' -> '$album_artist'"
    else
        log $LOG_DEBUG "Invalid album artist rejected: '$raw_album_artist', will try path extraction"
        # Try to extract artist from directory path as fallback
        if [[ -n "$album_dir" ]] && album_artist=$(extract_artist_from_path "$album_dir"); then
            log $LOG_DEBUG "Extracted artist from path: '$album_dir' -> '$album_artist'"
        else
            log $LOG_DEBUG "Could not extract valid artist from metadata or path"
            album_artist=""
        fi
    fi
    
    # Extract album title
    local album_title=$(echo "$exiftool_output" | \
        jq -r '[.[] | select(.Album != null) | .Album] | .[0] // ""' 2>/dev/null)
    
    # Extract year - try multiple fields and formats
    local album_year=$(echo "$exiftool_output" | jq -r '.[0].Year // .[0].Date // ""' 2>/dev/null | grep -oE '^[0-9]{4}' | head -1)
    
    # Extract label info
    local label=$(echo "$exiftool_output" | \
        jq -r '[.[] | select(.Label != null) | .Label] | .[0] // 
               [.[] | select(.Publisher != null) | .Publisher] | .[0] // 
               [.[] | select(.Organization != null) | .Organization] | .[0] // ""' 2>/dev/null)
    
    # Extract catalog number
    local catalog=$(echo "$exiftool_output" | \
        jq -r '[.[] | select(.CatalogNumber != null) | .CatalogNumber] | .[0] // ""' 2>/dev/null)
    
    # Extract genre
    local genre=$(echo "$exiftool_output" | \
        jq -r '[.[] | select(.Genre != null) | .Genre] | .[0] // ""' 2>/dev/null)
    
    # Count tracks
    local track_count=$(echo "$exiftool_output" | jq 'length' 2>/dev/null)
    
    # Calculate total size
    local total_size=$(echo "$exiftool_output" | \
        jq '[.[] | select(.FileSize != null) | .FileSize] | map(gsub(" MB"; "") | tonumber * 1048576) | add' 2>/dev/null)
    
    # Calculate average bitrate
    local avg_bitrate=$(echo "$exiftool_output" | \
        jq '[.[] | select(.AudioBitrate != null) | .AudioBitrate | gsub(" kbps"; "") | tonumber] | add / length' 2>/dev/null)
    
    # Clean all variables of newlines and control characters before output
    album_artist=$(echo "$album_artist" | tr -d '\n\r' | sed 's/[[:cntrl:]]//g')
    album_title=$(echo "$album_title" | tr -d '\n\r' | sed 's/[[:cntrl:]]//g')
    album_year=$(echo "$album_year" | tr -d '\n\r' | sed 's/[[:cntrl:]]//g')
    label=$(echo "$label" | tr -d '\n\r' | sed 's/[[:cntrl:]]//g')
    catalog=$(echo "$catalog" | tr -d '\n\r' | sed 's/[[:cntrl:]]//g')
    genre=$(echo "$genre" | tr -d '\n\r' | sed 's/[[:cntrl:]]//g')
    track_count=$(echo "$track_count" | tr -d '\n\r' | sed 's/[[:cntrl:]]//g')
    total_size=$(echo "$total_size" | tr -d '\n\r' | sed 's/[[:cntrl:]]//g')
    avg_bitrate=$(echo "$avg_bitrate" | tr -d '\n\r' | sed 's/[[:cntrl:]]//g')
    
    # Output as pipe-delimited string
    echo "${album_artist}|${album_title}|${album_year}|${label}|${catalog}|${genre}|${track_count}|${total_size}|${avg_bitrate}"
}

# Extract track information
extract_track_info() {
    local exiftool_output="$1"
    local tracks_json=""
    
    # Extract relevant track information
    tracks_json=$(echo "$exiftool_output" | jq -c '[.[] | {
        file: .SourceFile,
        track: .Track,
        disc: .DiscNumber,
        title: .Title,
        artist: .Artist,
        duration: .Duration,
        bitrate: .AudioBitrate,
        format: .FileType,
        size: .FileSize
    }]' 2>/dev/null)
    
    echo "$tracks_json"
}

# Generate album hash for duplicate detection
generate_album_hash() {
    local album_artist="$1"
    local album_title="$2"
    local track_count="$3"
    local total_duration="$4"
    
    # Create a unique identifier for the album
    local hash_input="${album_artist}|${album_title}|${track_count}|${total_duration}"
    local hash=$(echo -n "$hash_input" | md5sum | cut -d' ' -f1)
    
    echo "$hash"
}

# Calculate quality score for duplicate resolution
calculate_quality_score() {
    local quality_type="$1"
    local avg_bitrate="$2"
    local format_mix="$3"
    
    local score=0
    
    # Base score from quality type
    case "$quality_type" in
        "Lossless") score=1000 ;;
        "Mixed") score=500 ;;
        "Lossy") score=0 ;;
    esac
    
    # Add bitrate component (normalized to 0-500)
    if [[ -n "$avg_bitrate" ]]; then
        local bitrate_score=$(echo "scale=2; $avg_bitrate * 500 / 1411" | bc)
        score=$(echo "$score + $bitrate_score" | bc)
    fi
    
    # Bonus for specific formats
    if echo "$format_mix" | grep -i "FLAC" >/dev/null; then
        score=$(echo "$score + 100" | bc)
    fi
    
    echo "$score"
}

# Check if directory contains audio files (removed duplicate - using fileops version)

# Count audio files in directory
count_audio_files() {
    local dir="$1"
    local media_extensions="mp3\|flac\|wav\|m4a\|ogg\|aiff\|alac\|opus\|wma\|ape\|mp4\|mkv\|avi\|mov\|webm"
    
    find "$dir" -maxdepth 1 -type f -iregex ".*\.\($media_extensions\)$" 2>/dev/null | wc -l
}

# Get format distribution
get_format_distribution() {
    local exiftool_output="$1"
    
    # Count each format
    local format_counts=$(echo "$exiftool_output" | \
        jq -r '.[].FileType' 2>/dev/null | \
        sort | uniq -c | \
        awk '{printf "%s:%d ", $2, $1}')
    
    echo "${format_counts% }"
}

# Extract metadata from Jellyfin NFO files as fallback
extract_nfo_metadata() {
    local album_dir="$1"
    local nfo_file=""
    
    # Look for album.nfo (Jellyfin) or other .nfo files
    if [[ -f "$album_dir/album.nfo" ]]; then
        nfo_file="$album_dir/album.nfo"
    else
        nfo_file=$(find "$album_dir" -maxdepth 1 -name "*.nfo" -type f | head -1)
    fi
    
    if [[ -n "$nfo_file" && -f "$nfo_file" ]]; then
        log $LOG_DEBUG "Found NFO file: $nfo_file"
        
        # Try to extract XML metadata (Jellyfin/Emby format)
        # Handle both <artist> and <albumartist> tags
        local title=$(grep -o '<title>[^<]*</title>' "$nfo_file" 2>/dev/null | head -1 | sed 's/<[^>]*>//g')
        local artist=$(grep -o '<artist>[^<]*</artist>' "$nfo_file" 2>/dev/null | head -1 | sed 's/<[^>]*>//g')
        local albumartist=$(grep -o '<albumartist>[^<]*</albumartist>' "$nfo_file" 2>/dev/null | head -1 | sed 's/<[^>]*>//g')
        local year=$(grep -o '<year>[^<]*</year>' "$nfo_file" 2>/dev/null | head -1 | sed 's/<[^>]*>//g')
        local genre=$(grep -o '<genre>[^<]*</genre>' "$nfo_file" 2>/dev/null | head -1 | sed 's/<[^>]*>//g')
        
        # Prefer albumartist over artist
        local final_artist="${albumartist:-$artist}"
        
        # Clean up any XML encoding artifacts
        title=$(echo "$title" | sed 's/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/&#39;/'"'"'/g')
        final_artist=$(echo "$final_artist" | sed 's/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/&#39;/'"'"'/g')
        genre=$(echo "$genre" | sed 's/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g; s/&quot;/"/g; s/&#39;/'"'"'/g')
        
        if [[ -n "$title" || -n "$final_artist" ]]; then
            echo "NFO:${final_artist:-Unknown}|${title:-Unknown}|${year:-}|${genre:-}|||||"
            return 0
        else
            log $LOG_DEBUG "NFO file found but no usable metadata extracted"
        fi
    fi
    
    return 1
}

# Helper function to escape JSON strings
escape_json_string() {
    local input="$1"
    # Escape backslashes, quotes, newlines, tabs, etc.
    echo "$input" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/g' | tr -d '\n' | sed 's/\\n$//'
}

# Function to clean and validate artist names
clean_artist_name() {
    local artist="$1"
    
    # Return empty if input is empty
    [[ -z "$artist" ]] && return 1
    
    # Remove technical prefixes/suffixes commonly found in directory names
    artist=$(echo "$artist" | sed -E '
        # Remove format indicators
        s/^(FLAC|MP3|WAV|WEB|CD|VINYL|24BIT|16BIT|44\.?1?|48|96|192)[[:space:]]*[-_]?[[:space:]]*//i
        s/[[:space:]]*[-_]?[[:space:]]*(FLAC|MP3|WAV|WEB|CD|VINYL|24BIT|16BIT|44\.?1?|48|96|192)$//i
        
        # Remove catalog number patterns (letters+numbers, or just numbers)
        s/^[A-Z]{2,6}[0-9]{2,6}[[:space:]]*[-_]?[[:space:]]*//
        s/[[:space:]]*[-_]?[[:space:]]*[A-Z]{2,6}[0-9]{2,6}$//
        
        # Remove standalone years
        s/^[0-9]{4}$//
        
        # Remove technical descriptors
        s/^(WEB|REMASTER|REMASTERED|VINYL|CD)[[:space:]]*[-_]?[[:space:]]*//i
        s/[[:space:]]*[-_]?[[:space:]]*(WEB|REMASTER|REMASTERED|VINYL|CD)$//i
        
        # Remove bracketed technical info [ABC123], (WEB), etc.
        s/[[:space:]]*\[[^]]*\]//g
        s/[[:space:]]*([^)]*)//g
    ')
    
    # Trim whitespace
    artist=$(echo "$artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    # Reject if it's just a year
    if echo "$artist" | grep -qE '^[0-9]{4}$'; then
        return 1
    fi
    
    # Reject if it's just numbers or catalog codes
    if echo "$artist" | grep -qE '^[0-9]{4,}$|^[A-Z]{2,6}[0-9]{2,6}$'; then
        return 1
    fi
    
    # Reject if it's just technical terms
    if echo "$artist" | grep -qiE '^(FLAC|MP3|WAV|WEB|CD|VINYL|REMASTER|REMASTERED|24BIT|16BIT)$'; then
        return 1
    fi
    
    # Reject if too short (less than 2 characters after cleaning)
    if [[ ${#artist} -lt 2 ]]; then
        return 1
    fi
    
    echo "$artist"
    return 0
}

# Infer metadata from directory name patterns
infer_metadata_from_dirname() {
    local dirname="$1"
    local artist=""
    local title=""
    local year=""
    
    # Pattern 1: Artist - Title (Year) [Catalog]
    if echo "$dirname" | grep -qE '^[^-]+ - [^(]+\([0-9]{4}\)'; then
        artist=$(echo "$dirname" | sed -E 's/^([^-]+) - .*/\1/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        title=$(echo "$dirname" | sed -E 's/^[^-]+ - ([^(]+)\([0-9]{4}\).*/\1/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        year=$(echo "$dirname" | sed -E 's/.*\(([0-9]{4})\).*/\1/')
        
    # Pattern 2: (Year) Title
    elif echo "$dirname" | grep -qE '^\([0-9]{4}\)'; then
        year=$(echo "$dirname" | sed -E 's/^\(([0-9]{4})\).*/\1/')
        title=$(echo "$dirname" | sed -E 's/^\([0-9]{4}\)[[:space:]]*(.*)/\1/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        
    # Pattern 3: Artist – Title [Catalog] (em dash)
    elif echo "$dirname" | grep -qE '.* – .*\['; then
        artist=$(echo "$dirname" | sed -E 's/(.*) – .*\[.*/\1/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        title=$(echo "$dirname" | sed -E 's/[^–]* – ([^[]*)\[.*/\1/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        
    # Pattern 4: (Catalog) Artist - Title (Year) 
    elif echo "$dirname" | grep -qE '^\([^)]+\).*-.*\([0-9]{4}\)'; then
        artist=$(echo "$dirname" | sed -E 's/^\([^)]+\)[[:space:]]*([^-]+) -.*/\1/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        title=$(echo "$dirname" | sed -E 's/^\([^)]+\)[[:space:]]*[^-]+ - ([^(]+)\([0-9]{4}\).*/\1/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        year=$(echo "$dirname" | sed -E 's/.*\(([0-9]{4})\).*/\1/')
        
    # Pattern 5: Scene Release - artist-title-catalog-year-group (theo_parrish-the_twin_cities_ep-hp007-2004-sweet)
    elif echo "$dirname" | grep -qE '^[a-z_]+.*-[a-z_]+.*-[a-z0-9]+-[0-9]{4}-[a-z]+$'; then
        artist=$(echo "$dirname" | sed -E 's/^([a-z_]+)-.*/\1/' | tr '_' ' ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        # Extract everything between first dash and catalog/year part
        local middle_part=$(echo "$dirname" | sed -E 's/^[a-z_]+-([^-]+.*)-[a-z0-9]+-[0-9]{4}-.*/\1/')
        title=$(echo "$middle_part" | tr '_' ' ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        year=$(echo "$dirname" | sed -E 's/.*-([0-9]{4})-.*/\1/')
        
    # Pattern 6: Scene Release - simpler pattern artist-title-year-group
    elif echo "$dirname" | grep -qE '^[a-z_]+.*-[0-9]{4}-[a-z]+$'; then
        artist=$(echo "$dirname" | sed -E 's/^([a-z_]+)-.*/\1/' | tr '_' ' ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        # Extract everything between artist and year-group
        title=$(echo "$dirname" | sed -E 's/^[a-z_]+-(.+)-[0-9]{4}-.*/\1/' | tr '_' ' ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        year=$(echo "$dirname" | sed -E 's/.*-([0-9]{4})-.*/\1/')
        
    # Pattern 7: Artist - Title (generic fallback)
    elif echo "$dirname" | grep -qE '^[^-]+ - '; then
        # Clean the directory name first to remove contamination
        local cleaned_dir
        cleaned_dir=$(clean_directory_name_for_artist_extraction "$dirname")
        artist=$(echo "$cleaned_dir" | sed -E 's/^([^-]+) - .*/\1/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        title=$(echo "$cleaned_dir" | sed -E 's/^[^-]+ - (.*)/\1/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        
    # Pattern 8: Complex scene release with underscores - artist___collaborator_-_title__details
    elif echo "$dirname" | grep -qE '^[a-z_]+___[a-z_]+_-_[a-z_]+__'; then
        # Extract first artist from triple underscore pattern
        artist=$(echo "$dirname" | sed -E 's/^([a-z_]+)___.*/\1/' | tr '_' ' ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        # Extract title after the _-_ separator
        title=$(echo "$dirname" | sed -E 's/^[a-z_]+___[a-z_]+_-_([a-z_]+)__.*/\1/' | tr '_' ' ' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        
    # Pattern 9: Fallback - treat whole name as title if no clear artist separation
    else
        # Clean the directory name and use as title
        local cleaned_dir
        cleaned_dir=$(clean_directory_name_for_artist_extraction "$dirname")
        if [[ -n "$cleaned_dir" ]] && [[ "$cleaned_dir" != "$dirname" ]]; then
            title="$cleaned_dir"
        fi
    fi
    
    # Extract year from title if not found and title contains (YYYY)
    if [[ -z "$year" ]] && echo "$title" | grep -qE '\([0-9]{4}\)'; then
        year=$(echo "$title" | sed -E 's/.*\(([0-9]{4})\).*/\1/')
        title=$(echo "$title" | sed -E 's/(.*)\([0-9]{4}\)(.*)/\1\2/' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    fi
    
    # Remove catalog patterns from title
    title=$(echo "$title" | sed -E 's/[[:space:]]*\[[^]]*\][[:space:]]*/ /g' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    
    # Clean and validate the artist name before returning
    if [[ -n "$artist" ]]; then
        local cleaned_artist
        if cleaned_artist=$(validate_artist_name "$artist"); then
            artist="$cleaned_artist"
        else
            log $LOG_DEBUG "Rejected invalid inferred artist name: '$artist' from directory: $dirname"
            # For scene releases, be more permissive - allow if it's not obviously garbage
            if [[ ${#artist} -ge 3 ]] && ! echo "$artist" | grep -qE '^[0-9]+$|^[A-Z0-9]{2,6}$'; then
                log $LOG_DEBUG "Allowing scene release artist name: '$artist'"
                # Basic cleanup only
                artist=$(echo "$artist" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed 's/[[:space:]]\+/ /g')
            else
                artist=""
            fi
        fi
    fi
    
    # Return inferred data - allow title-only albums for compilation organization
    if [[ -z "$artist" ]] && [[ -n "$title" ]]; then
        log $LOG_DEBUG "No valid artist found in directory inference, title only: '$title'"
        echo "|${title}|${year}"
    else
        echo "${artist}|${title}|${year}"
    fi
}

# Export all functions
export -f extract_album_metadata determine_album_quality extract_album_info
export -f extract_track_info generate_album_hash calculate_quality_score
export -f directory_has_audio_files count_audio_files get_format_distribution
export -f extract_nfo_metadata escape_json_string infer_metadata_from_dirname clean_artist_name