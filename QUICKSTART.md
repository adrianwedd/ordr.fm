# ordr.fm Quick Start Guide

Get your music collection organized in under 5 minutes!

## 🚀 Installation (Ubuntu/Debian)

```bash
# 1. Install dependencies
sudo apt-get update && sudo apt-get install -y exiftool jq sqlite3

# 2. Clone ordr.fm
git clone https://github.com/adrianwedd/ordr.fm.git
cd ordr.fm

# 3. Make executable
chmod +x ordr.fm.modular.sh
```

## 🎵 Basic Usage

### Test Run (Safe Mode)
```bash
# Preview what would happen (no files are moved)
./ordr.fm.modular.sh --source /path/to/music --destination /path/to/organized
```

### Organize Your Music
```bash
# Actually move and organize files
./ordr.fm.modular.sh --source /path/to/music --destination /path/to/organized --move
```

### Enable Parallel Processing (Faster!)
```bash
# Use multiple CPU cores for speed
./ordr.fm.modular.sh --source /path/to/music --destination /path/to/organized --parallel --move
```

## 🎛️ Common Scenarios

### Electronic Music Collection
```bash
./ordr.fm.modular.sh \
    --source /music/downloads \
    --destination /music/library \
    --enable-electronic \
    --discogs \
    --parallel \
    --move
```

### Large Collection (1000+ albums)
```bash
./ordr.fm.modular.sh \
    --source /music/unsorted \
    --destination /music/organized \
    --parallel 8 \
    --batch-size 500 \
    --move
```

### Incremental Organization
```bash
# Only process new albums
./ordr.fm.modular.sh \
    --source /music/incoming \
    --destination /music/library \
    --incremental \
    --move
```

## 📁 Output Structure

Your music will be organized like this:
```
/music/organized/
├── Lossless/
│   ├── Artist Name/
│   │   └── Album Title (2023)/
│   │       ├── 01 - Track Title.flac
│   │       ├── 02 - Track Title.flac
│   │       └── cover.jpg
├── Lossy/
│   ├── Another Artist/
│   │   └── Album Name (2022)/
│   │       ├── 01 - Song.mp3
│   │       └── 02 - Song.mp3
└── Mixed/
    └── Various Artists/
        └── Compilation (2021)/
```

## ⚙️ Configuration

Create a config file for repeated use:
```bash
# Copy example config
cp ordr.fm.conf.example ordr.fm.conf

# Edit with your settings
nano ordr.fm.conf
```

Key settings:
```bash
SOURCE_DIR="/music/incoming"
DEST_DIR="/music/organized"
ENABLE_PARALLEL=1
DRY_RUN=0  # Set to 0 to actually move files
```

## 🔍 Next Steps

- [Full Documentation](README.md)
- [Production Deployment](docs/DEPLOYMENT.md)
- [Advanced Features](SPECIFICATIONS.md)
- [Parallel Processing](docs/PARALLEL_PROCESSING.md)

## ❓ Need Help?

- Run with `--help` for all options
- Check logs in `ordr.fm.log`
- [Report issues](https://github.com/adrianwedd/ordr.fm/issues)