#!/bin/bash
set -e

# Initialize configuration if not provided
if [ ! -f /app/config/ordr.fm.conf ]; then
    echo "Creating default configuration..."
    cp /app/config/ordr.fm.conf.template /app/config/ordr.fm.conf
    
    # Update paths for container environment
    sed -i 's|SOURCE_DIR=.*|SOURCE_DIR="/app/data/music"|g' /app/config/ordr.fm.conf
    sed -i 's|DEST_DIR=.*|DEST_DIR="/app/data/organized"|g' /app/config/ordr.fm.conf
    sed -i 's|UNSORTED_DIR=.*|UNSORTED_DIR="/app/data/unsorted"|g' /app/config/ordr.fm.conf
    sed -i 's|LOG_FILE=.*|LOG_FILE="/app/logs/ordr.fm.log"|g' /app/config/ordr.fm.conf
fi

# Set environment variables from config
export ORDR_CONFIG_FILE="/app/config/ordr.fm.conf"

# Function to run organization
run_organize() {
    echo "🎵 Starting ordr.fm music organization..."
    ./ordr.fm.sh --config /app/config/ordr.fm.conf "$@"
}

# Function to run web server
run_server() {
    echo "🌐 Starting ordr.fm web server..."
    cd /app/server
    export METADATA_DB="/app/ordr.fm.metadata.db"
    export STATE_DB="/app/ordr.fm.state.db" 
    export PORT="${PORT:-3000}"
    exec node server.js
}

# Main command handler
case "${1:-server}" in
    "organize")
        shift
        run_organize "$@"
        ;;
    "server")
        run_server
        ;;
    "both")
        # Run organization first, then start server
        shift
        echo "🎵 Running organization first..."
        run_organize "$@"
        echo "🌐 Starting web server..."
        run_server
        ;;
    "bash")
        exec /bin/bash
        ;;
    *)
        echo "Usage: $0 {organize|server|both|bash} [options]"
        echo ""
        echo "Commands:"
        echo "  organize  - Run music organization (default: dry-run)"
        echo "  server    - Start web interface server (default)"
        echo "  both      - Run organization then start server"
        echo "  bash      - Open bash shell"
        echo ""
        echo "Examples:"
        echo "  $0 organize --move                    # Organize with actual moves"
        echo "  $0 organize --discogs --move          # With Discogs enrichment"
        echo "  $0 server                             # Web interface only"
        echo "  $0 both --enable-electronic --move    # Full workflow"
        exit 1
        ;;
esac