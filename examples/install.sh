#!/bin/bash
# Installation script for ordr.fm automation

set -e

# Configuration
INSTALL_DIR="${INSTALL_DIR:-/opt/ordr.fm}"
LOG_DIR="${LOG_DIR:-/var/log/ordr.fm}"
USER="${USER:-plex}"
GROUP="${GROUP:-plex}"

echo "Installing ordr.fm automation..."

# Create directories
sudo mkdir -p "$INSTALL_DIR"
sudo mkdir -p "$LOG_DIR"
sudo mkdir -p "/etc/ordr.fm/profiles"

# Copy main script and configuration
sudo cp ordr.fm.sh "$INSTALL_DIR/"
sudo cp ordr.fm.conf "$INSTALL_DIR/"
sudo cp -r profiles/* "/etc/ordr.fm/profiles/"

# Make script executable
sudo chmod +x "$INSTALL_DIR/ordr.fm.sh"

# Set ownership
sudo chown -R "$USER:$GROUP" "$INSTALL_DIR"
sudo chown -R "$USER:$GROUP" "$LOG_DIR"
sudo chown -R "$USER:$GROUP" "/etc/ordr.fm"

# Install systemd service (optional)
if [[ -d /etc/systemd/system ]]; then
    echo "Installing systemd service..."
    sudo cp systemd/ordr.fm.service /etc/systemd/system/
    sudo cp systemd/ordr.fm.timer /etc/systemd/system/
    sudo systemctl daemon-reload
    
    echo "To enable automatic processing:"
    echo "  sudo systemctl enable ordr.fm.timer"
    echo "  sudo systemctl start ordr.fm.timer"
fi

# Install logrotate configuration (optional)
if [[ -d /etc/logrotate.d ]]; then
    echo "Installing logrotate configuration..."
    sudo cp logrotate/ordr.fm /etc/logrotate.d/
fi

# Create symlink for easy access
sudo ln -sf "$INSTALL_DIR/ordr.fm.sh" /usr/local/bin/ordr.fm

echo "Installation complete!"
echo ""
echo "Configuration:"
echo "  Main config: $INSTALL_DIR/ordr.fm.conf"
echo "  Profiles: /etc/ordr.fm/profiles/"
echo "  Logs: $LOG_DIR"
echo ""
echo "Test installation:"
echo "  ordr.fm --validate-config"
echo "  ordr.fm --list-profiles"
echo ""
echo "Example usage:"
echo "  ordr.fm --profile vinyl --incremental --dry-run"
echo "  ordr.fm --batch --profile downloads --find-duplicates"