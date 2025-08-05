#!/bin/bash
# Create GitHub release for ordr.fm

set -euo pipefail

VERSION="2.0.0"
RELEASE_NAME="v${VERSION} - Production Ready"
TAG_NAME="v${VERSION}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}Creating ordr.fm release ${VERSION}${NC}"
echo "================================="

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
    echo -e "${YELLOW}Warning: Not on main branch (currently on $CURRENT_BRANCH)${NC}"
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check for uncommitted changes
if [[ -n $(git status -s) ]]; then
    echo -e "${YELLOW}Warning: Uncommitted changes detected${NC}"
    git status -s
    echo
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Create release package
echo -e "\n${BLUE}Creating release package...${NC}"
PACKAGE_DIR="ordr.fm-v${VERSION}"
PACKAGE_FILE="${PACKAGE_DIR}.tar.gz"

# Clean up any existing package
rm -rf "$PACKAGE_DIR" "$PACKAGE_FILE"

# Create package directory
mkdir -p "$PACKAGE_DIR"

# Copy essential files
echo "Copying files..."
cp -r lib "$PACKAGE_DIR/"
cp ordr.fm.modular.sh "$PACKAGE_DIR/"
cp ordr.fm.conf.example "$PACKAGE_DIR/"
cp setup_wizard.sh "$PACKAGE_DIR/"
cp command_builder.sh "$PACKAGE_DIR/"
cp system_check.sh "$PACKAGE_DIR/"
cp test_runner.sh "$PACKAGE_DIR/"
cp test_parallel.sh "$PACKAGE_DIR/"
cp benchmark_parallel.sh "$PACKAGE_DIR/"

# Copy documentation
mkdir -p "$PACKAGE_DIR/docs"
cp README.md SPECIFICATIONS.md CHANGELOG.md QUICKSTART.md "$PACKAGE_DIR/"
cp docs/*.md "$PACKAGE_DIR/docs/"
cp -r .github "$PACKAGE_DIR/"

# Create minimal .gitignore for package
cat > "$PACKAGE_DIR/.gitignore" << 'EOF'
ordr.fm.conf
*.db
*.log
.env
discogs_cache/
test_*/
EOF

# Create archive
echo -e "\n${BLUE}Creating archive...${NC}"
tar -czf "$PACKAGE_FILE" "$PACKAGE_DIR"
PACKAGE_SIZE=$(ls -lh "$PACKAGE_FILE" | awk '{print $5}')
echo -e "${GREEN}Created $PACKAGE_FILE ($PACKAGE_SIZE)${NC}"

# Calculate checksums
echo -e "\n${BLUE}Calculating checksums...${NC}"
sha256sum "$PACKAGE_FILE" > "${PACKAGE_FILE}.sha256"
md5sum "$PACKAGE_FILE" > "${PACKAGE_FILE}.md5"

# Create release notes
echo -e "\n${BLUE}Creating release notes...${NC}"
cat > RELEASE_NOTES.md << 'EOF'
# ordr.fm v2.0.0 - Production Ready 🎉

## Major Release Highlights

### 🚀 Performance
- **10x faster** with parallel processing on multi-core systems
- Optimized for collections of **10,000+ albums**
- Memory-efficient processing with streaming mode

### 🎯 New Features
- **Interactive Setup Wizard** - Get started in minutes
- **Electronic Music Mode** - Intelligent label/artist organization
- **Discogs Integration** - Rich metadata enrichment
- **Undo/Rollback** - Reverse any operation safely
- **Empty Directory Cleanup** - Automatic post-processing

### 🛡️ Production Ready
- **CI/CD Pipeline** - Comprehensive automated testing
- **Modular Architecture** - Clean, maintainable codebase
- **Thread-Safe Operations** - Reliable parallel processing
- **Progress Persistence** - Resume interrupted operations

## Installation

### Quick Start
```bash
# Extract package
tar -xzf ordr.fm-v2.0.0.tar.gz
cd ordr.fm-v2.0.0

# Run setup wizard
./setup_wizard.sh

# Or check system readiness
./system_check.sh
```

### Dependencies
- Required: `exiftool`, `jq`, `sqlite3`
- Optional: `parallel`, `bc`, `rsync`, `curl`

## What's New

See [CHANGELOG.md](CHANGELOG.md) for the complete list of changes.

## Documentation

- [Quick Start Guide](QUICKSTART.md)
- [Deployment Guide](docs/DEPLOYMENT.md) 
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Migration Guide](docs/MIGRATION_GUIDE.md)

## Checksums

```
SHA256: $(cat ${PACKAGE_FILE}.sha256)
MD5: $(cat ${PACKAGE_FILE}.md5)
```

## Contributors

This release was developed with assistance from Claude (Anthropic).

---

**Full Changelog**: https://github.com/adrianwedd/ordr.fm/compare/v1.0.0...v2.0.0
EOF

# Create git tag
echo -e "\n${BLUE}Creating git tag...${NC}"
if git tag -l "$TAG_NAME" | grep -q "$TAG_NAME"; then
    echo -e "${YELLOW}Tag $TAG_NAME already exists${NC}"
    read -p "Delete and recreate? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git tag -d "$TAG_NAME"
        git push origin --delete "$TAG_NAME" 2>/dev/null || true
    else
        echo "Skipping tag creation"
    fi
fi

if ! git tag -l "$TAG_NAME" | grep -q "$TAG_NAME"; then
    git tag -a "$TAG_NAME" -m "Release version ${VERSION}"
    echo -e "${GREEN}Created tag $TAG_NAME${NC}"
fi

# Push tag
echo -e "\n${BLUE}Pushing tag to GitHub...${NC}"
git push origin "$TAG_NAME"

# Create GitHub release
echo -e "\n${BLUE}Creating GitHub release...${NC}"
gh release create "$TAG_NAME" \
    --title "$RELEASE_NAME" \
    --notes-file RELEASE_NOTES.md \
    "$PACKAGE_FILE" \
    "${PACKAGE_FILE}.sha256" \
    "${PACKAGE_FILE}.md5"

echo -e "\n${GREEN}✅ Release created successfully!${NC}"
echo
echo "Release URL: https://github.com/adrianwedd/ordr.fm/releases/tag/$TAG_NAME"
echo
echo "Next steps:"
echo "1. Review the release on GitHub"
echo "2. Update any documentation links"
echo "3. Announce the release"

# Cleanup
rm -rf "$PACKAGE_DIR"
rm -f RELEASE_NOTES.md