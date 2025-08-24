PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE mb_artists (
    mbid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_name TEXT,
    disambiguation TEXT,
    type TEXT, -- person, group, orchestra, choir, character, other
    gender TEXT,
    area_mbid TEXT,
    begin_area_mbid TEXT,
    end_area_mbid TEXT,
    life_span_begin DATE,
    life_span_end DATE,
    life_span_ended BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mb_artist_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_mbid TEXT NOT NULL,
    alias_name TEXT NOT NULL,
    sort_name TEXT,
    type TEXT, -- artist name, legal name, search hint, etc.
    locale TEXT,
    primary_alias BOOLEAN DEFAULT FALSE,
    begin_date DATE,
    end_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (artist_mbid) REFERENCES mb_artists(mbid) ON DELETE CASCADE
);
CREATE TABLE mb_releases (
    mbid TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    disambiguation TEXT,
    artist_credit_mbid TEXT,
    release_group_mbid TEXT,
    date DATE,
    country TEXT,
    barcode TEXT,
    status TEXT, -- official, promotion, bootleg, pseudo-release
    packaging TEXT, -- jewel case, slim jewel case, digipak, etc.
    language TEXT,
    script TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mb_works (
    mbid TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    disambiguation TEXT,
    type TEXT, -- song, symphony, concerto, etc.
    language TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mb_labels (
    mbid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_name TEXT,
    disambiguation TEXT,
    type TEXT, -- original production, bootleg production, reissue production, etc.
    label_code INTEGER,
    country TEXT,
    area_mbid TEXT,
    life_span_begin DATE,
    life_span_end DATE,
    life_span_ended BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mb_relationship_types (
    id TEXT PRIMARY KEY, -- MusicBrainz relationship type UUID
    name TEXT NOT NULL,
    description TEXT,
    link_phrase TEXT,
    reverse_link_phrase TEXT,
    parent_id TEXT,
    child_order INTEGER,
    source_entity_type TEXT, -- artist, release, work, label, etc.
    target_entity_type TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO mb_relationship_types VALUES('5be4c609-9afa-4ea0-910b-12ffb71e3821','member of band','This relationship type is used to link a person to a band of which they are a member.','{entity0} was a member of {entity1}','{entity1} had as a member {entity0}',NULL,0,'artist','artist','2025-08-08 03:59:22');
INSERT INTO mb_relationship_types VALUES('75c09861-6857-4ec0-9729-84eefde7fc86','collaboration','This relationship indicates that two or more artists collaborated on a specific work.','{entity0} collaborated with {entity1}','{entity1} collaborated with {entity0}',NULL,1,'artist','artist','2025-08-08 03:59:22');
INSERT INTO mb_relationship_types VALUES('83e98c69-6a8b-4ae3-95e2-b5b12e2c0ae1','producer','This indicates that an artist produced a recording.','{entity0} produced {entity1}','{entity1} was produced by {entity0}',NULL,2,'artist','release','2025-08-08 03:59:22');
INSERT INTO mb_relationship_types VALUES('59054b9a-edc8-4048-8e75-49f6c33bfbaa','remixer','This indicates that an artist remixed a recording.','{entity0} remixed {entity1}','{entity1} was remixed by {entity0}',NULL,3,'artist','release','2025-08-08 03:59:22');
INSERT INTO mb_relationship_types VALUES('4ddede34-1ee3-4f6e-9492-3d947a2d3f87','founded','This indicates that a person founded a label.','{entity0} founded {entity1}','{entity1} was founded by {entity0}',NULL,4,'artist','label','2025-08-08 03:59:22');
CREATE TABLE mb_artist_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_mbid TEXT NOT NULL,
    target_mbid TEXT NOT NULL,
    relationship_type_id TEXT NOT NULL,
    direction TEXT NOT NULL, -- forward, backward
    begin_date DATE,
    end_date DATE,
    ended BOOLEAN DEFAULT FALSE,
    attributes JSON, -- Stored as JSON for flexibility
    source_credit TEXT,
    target_credit TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (source_mbid) REFERENCES mb_artists(mbid) ON DELETE CASCADE,
    FOREIGN KEY (target_mbid) REFERENCES mb_artists(mbid) ON DELETE CASCADE,
    FOREIGN KEY (relationship_type_id) REFERENCES mb_relationship_types(id),
    UNIQUE(source_mbid, target_mbid, relationship_type_id, direction)
);
CREATE TABLE album_mb_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL,
    mb_release_mbid TEXT NOT NULL,
    confidence REAL NOT NULL,
    mapping_source TEXT DEFAULT 'auto', -- auto, manual, verified
    mapping_method TEXT, -- search, isrc, fingerprint, etc.
    verified_by TEXT, -- user who verified the mapping
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (mb_release_mbid) REFERENCES mb_releases(mbid) ON DELETE CASCADE,
    UNIQUE(album_id, mb_release_mbid)
);
CREATE TABLE artist_mb_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ordr_artist_name TEXT NOT NULL, -- Artist name from ordr.fm albums
    mb_artist_mbid TEXT NOT NULL,
    confidence REAL NOT NULL,
    mapping_source TEXT DEFAULT 'auto',
    verified_by TEXT,
    verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (mb_artist_mbid) REFERENCES mb_artists(mbid) ON DELETE CASCADE,
    UNIQUE(ordr_artist_name, mb_artist_mbid)
);
CREATE TABLE mb_relationship_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    center_mbid TEXT NOT NULL,
    max_depth INTEGER NOT NULL,
    network_data JSON NOT NULL, -- Cached network graph data
    node_count INTEGER,
    link_count INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    
    UNIQUE(center_mbid, max_depth)
);
CREATE TABLE mb_enrichment_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
    priority INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    last_attempt TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);
CREATE TABLE mb_statistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_name TEXT NOT NULL,
    metric_value REAL,
    metadata JSON,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album TEXT,
    artist TEXT,
    album_artist TEXT,
    album_title TEXT,
    year INTEGER,
    label TEXT,
    quality TEXT,
    organization_mode TEXT,
    catalog_number TEXT,
    path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
, processing_date TEXT, quality_type TEXT, genre TEXT, track_count INTEGER DEFAULT 0, total_duration INTEGER DEFAULT 0);
INSERT INTO albums VALUES(1,'Test Album 1','Test Artist','Test Artist','Test Album 1',2024,'Test Label','Lossless','artist',NULL,'/path/to/test1','2025-08-08 03:59:59',NULL,'Lossless','Electronic',10,3600);
INSERT INTO albums VALUES(2,'Test Album 2','Another Artist','Another Artist','Test Album 2',2023,'Another Label','Lossy','artist',NULL,'/path/to/test2','2025-08-08 03:59:59',NULL,'Lossy','Electronic',10,3600);
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES('albums',2);
CREATE INDEX idx_mb_artist_name ON mb_artists(name);
CREATE INDEX idx_mb_artist_sort ON mb_artists(sort_name);
CREATE INDEX idx_mb_artist_type ON mb_artists(type);
CREATE INDEX idx_mb_alias_artist ON mb_artist_aliases(artist_mbid);
CREATE INDEX idx_mb_alias_name ON mb_artist_aliases(alias_name);
CREATE INDEX idx_mb_release_title ON mb_releases(title);
CREATE INDEX idx_mb_release_artist ON mb_releases(artist_credit_mbid);
CREATE INDEX idx_mb_release_date ON mb_releases(date);
CREATE INDEX idx_mb_release_country ON mb_releases(country);
CREATE INDEX idx_mb_work_title ON mb_works(title);
CREATE INDEX idx_mb_work_type ON mb_works(type);
CREATE INDEX idx_mb_label_name ON mb_labels(name);
CREATE INDEX idx_mb_label_code ON mb_labels(label_code);
CREATE INDEX idx_mb_label_country ON mb_labels(country);
CREATE INDEX idx_mb_rel_type_name ON mb_relationship_types(name);
CREATE INDEX idx_mb_rel_type_entities ON mb_relationship_types(source_entity_type, target_entity_type);
CREATE INDEX idx_mb_artist_rel_source ON mb_artist_relationships(source_mbid);
CREATE INDEX idx_mb_artist_rel_target ON mb_artist_relationships(target_mbid);
CREATE INDEX idx_mb_artist_rel_type ON mb_artist_relationships(relationship_type_id);
CREATE INDEX idx_album_mb_album ON album_mb_mappings(album_id);
CREATE INDEX idx_album_mb_release ON album_mb_mappings(mb_release_mbid);
CREATE INDEX idx_album_mb_confidence ON album_mb_mappings(confidence);
CREATE INDEX idx_artist_mb_name ON artist_mb_mappings(ordr_artist_name);
CREATE INDEX idx_artist_mb_mbid ON artist_mb_mappings(mb_artist_mbid);
CREATE INDEX idx_mb_rel_cache_center ON mb_relationship_cache(center_mbid);
CREATE INDEX idx_mb_rel_cache_expires ON mb_relationship_cache(expires_at);
CREATE INDEX idx_mb_queue_status ON mb_enrichment_queue(status);
CREATE INDEX idx_mb_queue_priority ON mb_enrichment_queue(priority);
CREATE INDEX idx_mb_queue_album ON mb_enrichment_queue(album_id);
CREATE INDEX idx_mb_stats_name ON mb_statistics(metric_name);
CREATE INDEX idx_mb_stats_date ON mb_statistics(recorded_at);
CREATE VIEW albums_with_mb AS
SELECT 
    a.*,
    amm.mb_release_mbid,
    amm.confidence as mb_confidence,
    amm.mapping_source,
    amm.verified_at as mb_verified_at,
    mbr.title as mb_title,
    mbr.date as mb_date,
    mbr.country as mb_country,
    mbr.barcode as mb_barcode,
    mbr.status as mb_status
FROM albums a
LEFT JOIN album_mb_mappings amm ON a.id = amm.album_id
LEFT JOIN mb_releases mbr ON amm.mb_release_mbid = mbr.mbid;
CREATE VIEW artist_relationship_network AS
SELECT 
    ar.source_mbid,
    sa.name as source_name,
    ar.target_mbid,
    ta.name as target_name,
    rt.name as relationship_type,
    rt.link_phrase,
    ar.direction,
    ar.begin_date,
    ar.end_date,
    ar.ended,
    ar.attributes
FROM mb_artist_relationships ar
JOIN mb_artists sa ON ar.source_mbid = sa.mbid
JOIN mb_artists ta ON ar.target_mbid = ta.mbid
JOIN mb_relationship_types rt ON ar.relationship_type_id = rt.id;
CREATE TRIGGER update_mb_artists_timestamp 
    AFTER UPDATE ON mb_artists
    BEGIN
        UPDATE mb_artists SET updated_at = CURRENT_TIMESTAMP WHERE mbid = NEW.mbid;
    END;
CREATE TRIGGER update_mb_releases_timestamp 
    AFTER UPDATE ON mb_releases
    BEGIN
        UPDATE mb_releases SET updated_at = CURRENT_TIMESTAMP WHERE mbid = NEW.mbid;
    END;
CREATE TRIGGER update_album_mb_mappings_timestamp 
    AFTER UPDATE ON album_mb_mappings
    BEGIN
        UPDATE album_mb_mappings SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
COMMIT;
