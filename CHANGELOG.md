# Changelog

All notable changes to ordr.fm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-08-05

### 🎉 Major Release - Production Ready

This release represents a complete architectural overhaul of ordr.fm, transforming it from a monolithic script into a modular, high-performance music organization system.

### ✨ Added

#### Core Features
- **Modular Architecture** (#44) - Complete refactoring into focused, reusable modules
- **Parallel Processing** (#34) - 3-10x performance improvement with multi-core support
- **Interactive Setup Wizard** (#36) - User-friendly configuration and onboarding
- **CI/CD Pipeline** (#35) - Comprehensive automated testing and quality assurance
- **Performance Optimizations** (#40) - Specialized handling for 1000+ album collections
- **Empty Directory Cleanup** (#45) - Post-processing cleanup of source directories

#### Music Organization
- **Electronic Music Features** (#20) - Intelligent label/artist routing for electronic music
- **Discogs Integration** (#19) - Rich metadata enrichment with caching
- **Artist Alias Resolution** (#26) - Handle multiple artist names/pseudonyms
- **Quality-Based Organization** - Automatic Lossless/Lossy/Mixed categorization
- **Remix Separation** - Optional organization of remix collections

#### Safety & Recovery
- **Atomic Operations** - All-or-nothing file moves with rollback capability
- **Undo/Rollback** (#29) - Reverse any organization operation
- **Dry-Run Mode** - Preview all changes before execution
- **Progress Persistence** - Resume interrupted operations

#### Developer Tools
- **Command Builder** - Interactive tool to construct complex commands
- **System Check** - Verify environment readiness
- **Test Runner** - Local testing framework
- **Benchmark Tools** - Performance measurement utilities

### 🔄 Changed

- Renamed main script from `ordr.fm.sh` to `ordr.fm.modular.sh`
- Database schema enhanced with indexes and better structure
- Logging system now thread-safe for parallel operations
- Configuration file format expanded with new options
- Default to dry-run mode for safety

### 🛡️ Security

- Fixed SQL injection vulnerability in database operations
- Added input sanitization for all user inputs
- Secure token storage in configuration
- Permission checking for file operations
- Protected directory safeguards

### 📈 Performance

- **Parallel Processing**: Up to 10x faster on multi-core systems
- **Memory Optimization**: 30-50% reduction for large collections
- **Database Optimization**: WAL mode, indexes, and query optimization
- **Batch Processing**: Efficient handling of 10,000+ albums
- **Streaming Mode**: Process extremely large collections without memory issues

### 📚 Documentation

- Comprehensive deployment guide
- Interactive quick start guide
- Production readiness checklist
- Troubleshooting guide
- Migration guide from v1.x
- API documentation for modules

### 🐛 Fixed

- Single album detection now works correctly
- Quality detection case sensitivity resolved
- Associated files (.asd, .nfo) preservation
- Multi-disc album handling
- Unicode filename support
- Long path handling

### 🔧 Technical Details

#### Dependencies
- Required: `exiftool`, `jq`, `sqlite3`
- Optional: `parallel`, `bc`, `rsync`, `curl`
- Supported OS: Linux (Ubuntu 20.04+), macOS 10.15+

#### Module Structure
```
lib/
├── common.sh           # Core utilities
├── fileops.sh          # File operations
├── database.sh         # Database operations
├── organization.sh     # Organization logic
├── metadata_extraction.sh  # Metadata handling
├── discogs.sh          # Discogs API integration
├── metadata.sh         # Enhanced metadata
├── parallel_processor.sh   # Parallel processing
├── performance.sh      # Performance optimizations
├── cleanup.sh          # Cleanup operations
└── processing/
    └── worker_pool.sh  # Worker pool implementation
```

### 🙏 Acknowledgments

This release was developed with assistance from Claude (Anthropic) through intensive pair programming sessions. Special thanks to the electronic music community for inspiration and use cases.

---

## [1.0.0] - 2024-08-04

### Initial Release
- Basic music organization by metadata
- Dry-run mode
- Simple logging
- Album integrity preservation
- Quality-based categorization