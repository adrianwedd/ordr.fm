# ordr.fm Improvement Plan - Phase 2

## Based on Processing of 6,000+ Albums

### Success Metrics Achieved
- **98.3% automatic processing success rate** (goal was 95%)
- **6,070+ albums successfully processed**
- **Only 98 albums requiring manual review** (<2%)
- **Processing rate: ~15 albums/minute**

## Priority 1: Critical Fixes

### 1.1 Remix/Feature Detection Enhancement
**Problem**: "(carl craig remix)" treated as catalog number instead of part of title
**Solution**: Add remix/feature patterns to exclusion list in catalog extraction
**Files**: `lib/metadata_extraction.sh`

### 1.2 Empty Directory Cleanup
**Problem**: Parent directories left empty after nested album processing
**Solution**: Add post-processing cleanup phase to remove empty directories
**Files**: `ordr.fm.sh` (add cleanup function)

### 1.3 Database Locking Mitigation
**Problem**: Occasional "database is locked" errors during concurrent operations
**Solution**: Implement retry logic and batch database operations
**Files**: `lib/database.sh` (new), refactor database calls

## Priority 2: Enhancement Features

### 2.1 Improved Artist Extraction
**Problem**: Albums without metadata use parent directory as artist (e.g., "!Incoming")
**Current Behavior**: Falls back to parent directory name
**Improved Logic**:
- Check for common parent directory names to ignore (!Incoming, Downloads, etc.)
- Try extracting from first audio file if directory parsing fails
- Use "Unknown Artist" instead of parent directory for common paths

### 2.2 Smart Catalog Number Validation
**Current Issues**:
- Remix indicators: "(carl craig remix)", "(DJ Koze mix)"
- Version indicators: "(instrumental)", "(radio edit)"
- Format indicators: "(12 inch)", "(vinyl only)"

**New Exclusion Patterns**:
```bash
# Add to catalog extraction exclusion
- *remix*
- *mix*
- *edit*
- *version*
- *instrumental*
- *vocal*
- *inch*
- *vinyl*
```

## Priority 3: Quality of Life Improvements

### 3.1 Progress Reporting Enhancement
- Add ETA calculation based on current processing rate
- Show number of files being moved per album
- Display size of data being processed

### 3.2 Duplicate Detection Enhancement
- Compare file sizes and checksums, not just paths
- Offer merge option for duplicate albums with different tracks
- Create duplicate report file

### 3.3 Discogs API Optimization
**Current**: <1% enrichment success rate
**Improvements**:
- Better query formatting (remove special characters)
- Implement fuzzy matching
- Cache negative results to avoid repeated failures
- Add retry with simplified queries

## Implementation Schedule

### Phase 1: Critical Fixes (Today)
1. Fix remix/feature detection (30 min)
2. Add empty directory cleanup (20 min)
3. Implement database retry logic (45 min)

### Phase 2: Artist Extraction (Today)
1. Implement smart artist fallback (45 min)
2. Add common directory name exclusions (20 min)
3. Test with edge cases (30 min)

### Phase 3: Catalog Validation (Tomorrow)
1. Expand catalog exclusion patterns (30 min)
2. Test with real data (30 min)
3. Update documentation (20 min)

## Testing Strategy

### Test Cases to Create
1. Albums with remix in parentheses
2. Albums with no metadata in common parent dirs
3. Nested album structures
4. Concurrent processing (database locking)
5. Various catalog number formats

## Success Criteria
- Reduce manual review rate from 1.7% to <1%
- Eliminate database locking errors
- No empty directories left after processing
- Correct handling of remix/feature annotations
- Smart artist name extraction without parent directory pollution