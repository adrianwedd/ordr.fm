# ordr.fm Visualization Dashboard

Web-based visualization for your music organization database.

## Features

- **Collection Overview**: Total albums, tracks, artists, labels
- **Quality Distribution**: Pie chart of Lossless/Lossy/Mixed
- **Organization Modes**: How your music is organized
- **Artist Aliases**: Visual graph of artist relationships
- **Label Rankings**: Top labels by release count
- **Timeline**: Processing history over time
- **Undo History**: Browse and revert moves

## Setup

1. Install dependencies:
```bash
npm install
```

2. Point to your database:
```bash
export ORDRFM_DB="/path/to/ordr.fm.metadata.db"
```

3. Start the server:
```bash
npm start
```

4. Open browser to http://localhost:3000

## API Endpoints

- `GET /api/stats` - Overall statistics
- `GET /api/albums` - Album listing with filters
- `GET /api/artists` - Artist data including aliases
- `GET /api/labels` - Label statistics
- `GET /api/moves` - Move history for undo
- `GET /api/timeline` - Processing timeline

## Visualization Ideas

### Interactive Network Graph
- Nodes: Artists (size by release count)
- Edges: Alias relationships
- Colors: Organization mode
- Click to explore releases

### Sunburst Chart
- Center: Collection root
- Ring 1: Quality (Lossless/Lossy)
- Ring 2: Organization (Artist/Label/Series)
- Ring 3: Individual artists/labels
- Outer: Albums

### Timeline View
- X-axis: Date
- Y-axis: Albums processed
- Color: Success/Error
- Hover: Details

### Label Cloud
- Word cloud of labels
- Size: Release count
- Color: Electronic genre
- Click: Filter collection

## Database Schema

The visualization reads from the SQLite database created by ordr.fm:

- `albums`: Core album metadata and organization
- `tracks`: Individual track information
- `artist_aliases`: Alias relationships
- `labels`: Label statistics
- `moves`: Move history for undo
- `organization_stats`: Daily statistics

## Future Enhancements

- Real-time updates during processing
- Drag-and-drop reorganization
- Batch undo/redo operations
- Export visualization as PDF report
- Mobile-responsive design
- Dark mode for late-night organizing