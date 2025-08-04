#!/bin/bash

# Create test files for electronic music organization testing
echo "Creating electronic music test files..."

# Function to create a fake MP3 with metadata
create_test_mp3() {
    local dir="$1"
    local filename="$2"
    local artist="$3"
    local album="$4"
    local title="$5"
    local track="$6"
    local album_artist="${7:-$artist}"
    local year="${8:-2023}"
    local label="${9:-}"
    
    # Create a small test file
    echo "Test audio data for $title" > "$dir/$filename"
    
    # Add metadata using exiftool (if available)
    if command -v exiftool &> /dev/null; then
        exiftool -overwrite_original -q \
            -Artist="$artist" \
            -Album="$album" \
            -Title="$title" \
            -Track="$track" \
            -AlbumArtist="$album_artist" \
            -Year="$year" \
            ${label:+-Publisher="$label"} \
            "$dir/$filename" 2>/dev/null || true
    fi
}

# Test Case 1: Standard artist album
echo "Creating standard artist album..."
mkdir -p "tests/electronic_test/artist1/Album 2023"
create_test_mp3 "tests/electronic_test/artist1/Album 2023" "01.mp3" \
    "Test Artist" "Test Album" "Track 1" "1" "Test Artist" "2023" "Small Label"
create_test_mp3 "tests/electronic_test/artist1/Album 2023" "02.mp3" \
    "Test Artist" "Test Album" "Track 2" "2" "Test Artist" "2023" "Small Label"

# Test Case 2: Label release (should trigger label organization if multiple)
echo "Creating label releases..."
mkdir -p "tests/electronic_test/label1/Release 001"
create_test_mp3 "tests/electronic_test/label1/Release 001" "01.mp3" \
    "Label Artist 1" "Label Release 001" "Original Mix" "1" "Label Artist 1" "2022" "Big Electronic Label"

mkdir -p "tests/electronic_test/label1/Release 002"
create_test_mp3 "tests/electronic_test/label1/Release 002" "01.mp3" \
    "Label Artist 2" "Label Release 002" "Deep Mix" "1" "Label Artist 2" "2022" "Big Electronic Label"

# Test Case 3: VA Compilation
echo "Creating VA compilation..."
mkdir -p "tests/electronic_test/va_comp/Compilation 2023"
create_test_mp3 "tests/electronic_test/va_comp/Compilation 2023" "01.mp3" \
    "Artist A" "Summer Compilation 2023" "Opening Track" "1" "Various Artists" "2023" "Compilation Label"
create_test_mp3 "tests/electronic_test/va_comp/Compilation 2023" "02.mp3" \
    "Artist B" "Summer Compilation 2023" "Peak Time" "2" "Various Artists" "2023" "Compilation Label"
create_test_mp3 "tests/electronic_test/va_comp/Compilation 2023" "03.mp3" \
    "Artist C" "Summer Compilation 2023" "Closing Track" "3" "Various Artists" "2023" "Compilation Label"

# Test Case 4: Remix album
echo "Creating remix album..."
mkdir -p "tests/electronic_test/remixes/Remix Album"
create_test_mp3 "tests/electronic_test/remixes/Remix Album" "01.mp3" \
    "Original Artist" "Track Title Remixes" "Track Title (Artist X Remix)" "1" "Original Artist" "2023" "Remix Label"
create_test_mp3 "tests/electronic_test/remixes/Remix Album" "02.mp3" \
    "Original Artist" "Track Title Remixes" "Track Title (Artist Y Dub Mix)" "2" "Original Artist" "2023" "Remix Label"

# Test Case 5: Artist with alias (simulating Atom TM scenario)
echo "Creating artist alias test..."
mkdir -p "tests/electronic_test/aliases/Atom TM Album"
create_test_mp3 "tests/electronic_test/aliases/Atom TM Album" "01.mp3" \
    "Atom TM" "Electronic Album" "Digital Track" "1" "Atom TM" "2021" "Raster Noton"

mkdir -p "tests/electronic_test/aliases/Uwe Schmidt Album"
create_test_mp3 "tests/electronic_test/aliases/Uwe Schmidt Album" "01.mp3" \
    "Uwe Schmidt" "Different Album" "Experimental Track" "1" "Uwe Schmidt" "2020" "Rather Interesting"

# Test Case 6: White label / Underground
echo "Creating white label test..."
mkdir -p "tests/electronic_test/underground/WHITE001"
create_test_mp3 "tests/electronic_test/underground/WHITE001" "A1.mp3" \
    "Unknown" "Untitled" "Untitled A1" "1" "" "2024" "White Label"
create_test_mp3 "tests/electronic_test/underground/WHITE001" "B1.mp3" \
    "Unknown" "Untitled" "Untitled B1" "2" "" "2024" "White Label"

echo "Test files created successfully!"
echo ""
echo "To test electronic organization, run:"
echo "./ordr.fm.sh --source tests/electronic_test --enable-electronic --verbose"
echo ""
echo "To test with artist aliases:"
echo "./ordr.fm.sh --source tests/electronic_test --enable-electronic --group-aliases --alias-groups \"Uwe Schmidt,Atom TM,Atom Heart\" --verbose"