# Duplicate Detection Enhancement - Deep Analysis

## 🎯 User Request
> "duplicates. I want deep analysis when we have duplicates, so we can select the best quality, and move the rest to duplicates/"

## 🏗️ Proposed Enhancement

### Current Duplicate Detection
The existing system has basic duplicate detection but doesn't do deep quality analysis for selection.

### Enhanced Deep Analysis System

#### 1. **Multi-Factor Quality Scoring**
```bash
# Quality factors (weighted scoring):
- Audio Format: FLAC(100) > ALAC(90) > WAV(85) > MP3-320(70) > MP3-256(60) > MP3-192(50)
- Bitrate: Actual bitrate vs claimed bitrate validation
- File Size: Larger files generally indicate better quality
- Source Quality: Vinyl > CD > Digital > Scene Release
- Metadata Completeness: Complete tags vs incomplete
- Label/Catalog: Official release > Promotional > Bootleg
```

#### 2. **Duplicate Resolution Strategy**
```
For each duplicate set:
1. Calculate quality score for each version
2. Select highest quality version as "master"
3. Move lower quality versions to duplicates/ directory
4. Maintain metadata about why each was moved
5. Create symlinks if needed for organization
```

#### 3. **Implementation Plan**
- **Location**: Enhance existing duplicate detection in `lib/organization.sh`
- **New Function**: `analyze_duplicate_quality()`
- **Config Options**: Quality preferences, duplicate handling strategy
- **Output Directory**: `duplicates/[reason]/[original_path]/`

#### 4. **Duplicate Directory Structure**
```
duplicates/
├── lower_quality/
│   ├── Artist_Name/
│   │   └── Album_Name_[MP3-192]/
├── incomplete_metadata/
│   ├── Artist_Name/
│   │   └── Album_Name_[missing_tags]/
└── scene_releases/
    ├── Artist_Name/
    │   └── Album_Name_[group_tag]/
```

This would integrate with the hybrid reconstruction system to handle both quality selection and metadata reconstruction in a unified workflow.