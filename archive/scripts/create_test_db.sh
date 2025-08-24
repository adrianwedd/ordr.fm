#!/bin/bash

# Create a test database for visualization testing
DB_FILE="test.metadata.db"

echo "Creating test database: $DB_FILE"

# Remove old database if exists
rm -f "$DB_FILE"

# Create database and schema
sqlite3 "$DB_FILE" <<EOF
-- Albums table
CREATE TABLE albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_path TEXT UNIQUE,
    album_title TEXT,
    album_artist TEXT,
    year INTEGER,
    quality TEXT,
    label TEXT,
    catalog_number TEXT,
    organization_mode TEXT DEFAULT 'artist',
    destination_path TEXT,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tracks table
CREATE TABLE tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER,
    track_number INTEGER,
    track_title TEXT,
    artist TEXT,
    duration INTEGER,
    file_path TEXT,
    FOREIGN KEY (album_id) REFERENCES albums(id)
);

-- Artist aliases table
CREATE TABLE artist_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alias_name TEXT,
    primary_artist TEXT
);

-- Labels table
CREATE TABLE labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label_name TEXT UNIQUE,
    release_count INTEGER DEFAULT 0,
    first_seen DATE,
    last_seen DATE
);

-- Moves table for undo functionality
CREATE TABLE moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT,
    destination_path TEXT,
    move_type TEXT,
    move_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    reversed BOOLEAN DEFAULT 0
);

-- Organization stats table
CREATE TABLE organization_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stat_date DATE,
    total_albums INTEGER,
    total_tracks INTEGER,
    lossless_albums INTEGER,
    lossy_albums INTEGER,
    mixed_albums INTEGER
);

-- Insert test data
-- Albums
INSERT INTO albums (album_path, album_title, album_artist, year, quality, label, catalog_number, organization_mode)
VALUES 
    ('/music/artist1/album1', 'Electronic Dreams', 'Synth Master', 2023, 'Lossless', 'Techno Records', 'TR001', 'artist'),
    ('/music/artist2/album2', 'Deep Vibes', 'Bass Explorer', 2023, 'Lossy', 'House Label', 'HL002', 'label'),
    ('/music/va/comp1', 'Summer Compilation 2023', 'Various Artists', 2023, 'Mixed', 'Compilation Co', 'CC2023', 'series'),
    ('/music/artist3/album3', 'Ambient Journey', 'Chill Producer', 2022, 'Lossless', 'Relax Records', 'RR100', 'artist'),
    ('/music/remixes/album4', 'Remix Collection', 'Original Artist', 2023, 'Lossy', 'Remix Label', 'RMX001', 'remix'),
    ('/music/underground/white001', 'Underground EP', 'Unknown', 2024, 'Lossless', 'White Label', 'WHITE001', 'underground'),
    ('/music/artist4/album5', 'Techno Patterns', 'Beat Maker', 2021, 'Lossless', 'Techno Records', 'TR002', 'label'),
    ('/music/artist5/album6', 'House Sessions', 'DJ Producer', 2023, 'Mixed', 'House Label', 'HL003', 'label'),
    ('/music/aliases/atom1', 'Digital Works', 'Atom TM', 2022, 'Lossless', 'Raster Noton', 'RN001', 'artist'),
    ('/music/aliases/uwe1', 'Experimental Sounds', 'Uwe Schmidt', 2021, 'Lossless', 'Rather Interesting', 'RI001', 'artist');

-- Tracks (sample for a few albums)
INSERT INTO tracks (album_id, track_number, track_title, artist, duration)
VALUES 
    (1, 1, 'Opening', 'Synth Master', 320),
    (1, 2, 'Peak Time', 'Synth Master', 425),
    (1, 3, 'Breakdown', 'Synth Master', 380),
    (2, 1, 'Deep Groove', 'Bass Explorer', 410),
    (2, 2, 'Subwoofer Test', 'Bass Explorer', 395),
    (3, 1, 'Summer Opening', 'Artist A', 300),
    (3, 2, 'Beach Vibes', 'Artist B', 340),
    (3, 3, 'Sunset Mix', 'Artist C', 420);

-- Artist aliases
INSERT INTO artist_aliases (alias_name, primary_artist)
VALUES 
    ('Atom TM', 'Uwe Schmidt'),
    ('Atom Heart', 'Uwe Schmidt'),
    ('Senor Coconut', 'Uwe Schmidt'),
    ('AFX', 'Aphex Twin'),
    ('Polygon Window', 'Aphex Twin'),
    ('Kieran Hebden', 'Four Tet');

-- Labels
INSERT INTO labels (label_name, release_count, first_seen, last_seen)
VALUES 
    ('Techno Records', 2, '2021-01-01', '2023-12-01'),
    ('House Label', 2, '2023-01-01', '2023-12-01'),
    ('Compilation Co', 1, '2023-06-01', '2023-06-01'),
    ('Relax Records', 1, '2022-03-01', '2022-03-01'),
    ('Raster Noton', 1, '2022-05-01', '2022-05-01');

-- Move history
INSERT INTO moves (source_path, destination_path, move_type)
VALUES 
    ('/unsorted/album1', '/music/artist1/album1', 'organize'),
    ('/unsorted/album2', '/music/artist2/album2', 'organize'),
    ('/unsorted/comp1', '/music/va/comp1', 'organize');

-- Stats
INSERT INTO organization_stats (stat_date, total_albums, total_tracks, lossless_albums, lossy_albums, mixed_albums)
VALUES 
    ('2023-12-01', 5, 15, 2, 2, 1),
    ('2023-12-02', 8, 24, 4, 2, 2),
    ('2023-12-03', 10, 30, 5, 3, 2);

EOF

echo "Test database created successfully!"
echo ""
echo "To test the visualization:"
echo "1. Install dependencies: cd visualization && npm install"
echo "2. Run with test database: ORDRFM_DB=./test.metadata.db npm start"
echo "3. Open browser to http://localhost:3000"