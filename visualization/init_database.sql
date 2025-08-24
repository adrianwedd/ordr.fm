-- ordr.fm Database Schema

-- Albums table
CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist TEXT NOT NULL,
    album TEXT NOT NULL,
    year INTEGER,
    genre TEXT,
    label TEXT,
    catalog_number TEXT,
    quality TEXT,
    path TEXT UNIQUE NOT NULL,
    source_path TEXT,
    track_count INTEGER DEFAULT 0,
    total_duration INTEGER DEFAULT 0,
    total_size INTEGER DEFAULT 0,
    organization_mode TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    discogs_id INTEGER,
    musicbrainz_id TEXT
);

-- Tracks table
CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL,
    track_number INTEGER,
    disc_number INTEGER DEFAULT 1,
    title TEXT NOT NULL,
    artist TEXT,
    duration INTEGER,
    file_size INTEGER,
    file_format TEXT,
    bitrate INTEGER,
    sample_rate INTEGER,
    path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);

-- Processing history
CREATE TABLE IF NOT EXISTS processing_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL,
    destination_path TEXT,
    operation TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist);
CREATE INDEX IF NOT EXISTS idx_albums_year ON albums(year);
CREATE INDEX IF NOT EXISTS idx_albums_quality ON albums(quality);
CREATE INDEX IF NOT EXISTS idx_albums_created ON albums(created_at);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_processing_status ON processing_history(status);
CREATE INDEX IF NOT EXISTS idx_processing_created ON processing_history(created_at);