# Next Steps for ordr.fm

**Last Updated:** 2025-08-04  
**Current Status:** Testing phase with core fixes complete

## 🎯 Immediate Priorities (Next Session)

### 1. Configure Discogs API Authentication
```bash
# Get your token from: https://www.discogs.com/settings/developers
# Update ordr.fm.conf:
DISCOGS_ENABLED=1
DISCOGS_USER_TOKEN="your_token_here"
```
**Why:** Critical for metadata enrichment, catalog numbers, and label information

### 2. Set Up Artist Alias Configuration
```bash
# Add to ordr.fm.conf:
GROUP_ARTIST_ALIASES=1
ARTIST_ALIAS_GROUPS="Uwe Schmidt,Atom TM,Atom Heart,Eyephone,Senor Coconut,Atomu Shinzo,Atom™|Aphex Twin,AFX,Polygon Window,Caustic Window|Four Tet,Kieran Hebden,00110100 01010100"
```
**Why:** Essential for electronic music with many artist pseudonyms

### 3. Create Google Drive Backup
```bash
# Step 1: Test backup with small subset
./backup_strategy.sh --backup /tmp/test_music gdrive

# Step 2: Create full backup (may take hours)
./backup_strategy.sh --backup "/home/plex/Music" gdrive
```
**Why:** Safety before any production moves

## 📋 Testing Checklist

### Phase 1: Metadata Enrichment
- [ ] Configure Discogs API token
- [ ] Test Discogs search on known releases
- [ ] Verify catalog number extraction
- [ ] Check label information accuracy
- [ ] Test confidence scoring

### Phase 2: Artist Alias Resolution
- [ ] Configure known alias groups
- [ ] Test Atom Heart → Uwe Schmidt resolution
- [ ] Verify primary artist selection
- [ ] Test with multiple alias groups
- [ ] Check organization consistency

### Phase 3: Electronic Organization
- [ ] Test label-based organization
- [ ] Verify MIN_LABEL_RELEASES threshold
- [ ] Test compilation detection
- [ ] Check remix identification
- [ ] Validate hybrid mode decisions

### Phase 4: Large-Scale Testing
- [ ] Run on 10-20 album subset
- [ ] Check for anomalies
- [ ] Verify database capture
- [ ] Review organization decisions
- [ ] Test incremental processing

## 🐛 Known Issues to Address

### High Priority
1. **Artist Pseudonyms (#26)**
   - Example: Eyephone vs Atom Heart
   - Need robust alias resolution
   - Consider automated detection

2. **Associated File Handling**
   - .asd files (Ableton Live)
   - .nfo files (album info)
   - Should move with albums

3. **Incomplete File Handling**
   - Files with INCOMPLETE~ prefix
   - Should these be excluded or marked?

### Medium Priority
4. **Discogs Rate Limiting**
   - Implement proper backoff
   - Cache responses effectively
   - Handle API errors gracefully

5. **Multi-Disc Albums**
   - Detect disc numbers
   - Create disc subdirectories
   - Maintain track order

### Low Priority
6. **Visualization Enhancements**
   - Real-time processing updates
   - Drag-and-drop reorganization
   - Mobile responsive design

## 📊 Success Metrics

Before moving to production (--move flag):

| Metric | Target | Current |
|--------|--------|---------|
| Backup Complete | 100% | 0% |
| Discogs Hit Rate | >90% | N/A (no auth) |
| Alias Resolution | >95% | 0% (not configured) |
| Quality Detection | 100% | ✅ Fixed |
| Single Album Detection | 100% | ✅ Fixed |
| Anomaly Rate | <5% | Unknown |
| Test Coverage | >100 albums | 1 album |

## 🚀 Production Readiness Checklist

- [ ] Full backup to Google Drive verified
- [ ] Discogs API working with good hit rate
- [ ] Artist aliases configured and tested
- [ ] 100+ albums tested in dry-run
- [ ] Anomalies reviewed and acceptable
- [ ] Database integrity verified
- [ ] Recovery plan documented
- [ ] User approval for organization structure

## 📝 Configuration Template

```bash
# Recommended settings for electronic music collection
# Add to ordr.fm.conf

# Discogs API (get token from discogs.com/settings/developers)
DISCOGS_ENABLED=1
DISCOGS_USER_TOKEN="your_token_here"
DISCOGS_CONFIDENCE_THRESHOLD=0.7
DISCOGS_CATALOG_NUMBERS=1
DISCOGS_REMIX_ARTISTS=1
DISCOGS_LABEL_SERIES=1

# Electronic Music Organization
ORGANIZATION_MODE="hybrid"
MIN_LABEL_RELEASES=3
SEPARATE_REMIXES=1
SEPARATE_COMPILATIONS=1
VINYL_SIDE_MARKERS=0
UNDERGROUND_DETECTION=1

# Artist Aliases (customize for your collection)
GROUP_ARTIST_ALIASES=1
USE_PRIMARY_ARTIST_NAME=1
ARTIST_ALIAS_GROUPS="Uwe Schmidt,Atom TM,Atom Heart,Eyephone,Senor Coconut|Aphex Twin,AFX,Polygon Window|Four Tet,Kieran Hebden"

# Safety
INCREMENTAL_MODE=1
STATE_DB="ordr.fm.state.db"
```

## 🔄 Workflow for Next Session

```bash
# 1. Configure Discogs and aliases
vim ordr.fm.conf  # Add tokens and aliases

# 2. Create test backup
./backup_strategy.sh --backup /tmp/test_music gdrive

# 3. Run comprehensive test
./safe_test_runner.sh --no-backup  # Since we just backed up

# 4. Review results
cat test_runs/reports/report_*.md

# 5. If all good, test on larger subset
./ordr.fm.sh --source "/home/plex/Music/Artists/Atom*" \
             --discogs \
             --enable-electronic \
             --group-aliases \
             --verbose \
             --dry-run

# 6. Create full backup before production
./backup_strategy.sh --backup "/home/plex/Music" gdrive

# 7. Final production run (only after verification)
# ./ordr.fm.sh --move ...  # DO NOT RUN YET
```

## 📈 Progress Tracking

### Completed
- ✅ Testing framework created
- ✅ Backup strategy implemented
- ✅ Visualization dashboard built
- ✅ Single album detection fixed
- ✅ Quality detection fixed
- ✅ Electronic organization implemented
- ✅ Artist alias functions added

### In Progress
- 🔄 Discogs API configuration needed
- 🔄 Artist alias testing
- 🔄 Google Drive backup pending

### Not Started
- ⏳ Large-scale testing
- ⏳ Production moves
- ⏳ Automated alias detection (#24)

---

**Remember:** Always test in dry-run mode first. Never use --move without a verified backup!