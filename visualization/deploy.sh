#!/bin/bash

# ordr.fm PWA Production Deployment Script
# Usage: ./deploy.sh [start|stop|restart|status|logs]

set -e

ACTION=${1:-start}
PWA_NAME="ordr-fm-visualization"
PWA_PORT=3001
PM2_HOME="/tmp/.pm2"

echo "🎵 ordr.fm PWA Deployment Manager"
echo "=================================="

# Check if databases exist
if [ ! -f "../ordr.fm.metadata.db" ]; then
    echo "⚠️  Warning: Main database not found at ../ordr.fm.metadata.db"
    echo "   Make sure to run ordr.fm.sh at least once to create the database"
fi

# Function to check PWA health
check_health() {
    echo "🏥 Checking PWA health..."
    if curl -f -s "http://localhost:${PWA_PORT}/api/health" > /dev/null 2>&1; then
        echo "✅ PWA is healthy and responding"
        return 0
    else
        echo "❌ PWA health check failed"
        return 1
    fi
}

# Function to wait for service
wait_for_service() {
    echo "⏳ Waiting for PWA to start..."
    for i in {1..30}; do
        if check_health; then
            return 0
        fi
        sleep 2
        echo "   Attempt $i/30..."
    done
    echo "❌ PWA failed to start within 60 seconds"
    return 1
}

case "$ACTION" in
    start)
        echo "🚀 Starting ordr.fm PWA in production mode..."
        
        # Install dependencies if needed
        if [ ! -d "node_modules" ]; then
            echo "📦 Installing dependencies..."
            npm install --production
        fi
        
        # Stop existing instance if running
        PM2_HOME=$PM2_HOME npx pm2 stop $PWA_NAME 2>/dev/null || true
        
        # Start with PM2
        NODE_ENV=production PM2_HOME=$PM2_HOME npx pm2 start ecosystem.config.js --env production
        
        # Wait for startup
        if wait_for_service; then
            echo "✅ PWA started successfully!"
            echo "🌐 Access at: http://localhost:${PWA_PORT}"
            echo "📱 PWA install prompt available on HTTPS"
        else
            echo "❌ PWA startup failed"
            exit 1
        fi
        ;;
    
    stop)
        echo "🛑 Stopping ordr.fm PWA..."
        PM2_HOME=$PM2_HOME npx pm2 stop $PWA_NAME
        echo "✅ PWA stopped"
        ;;
    
    restart)
        echo "🔄 Restarting ordr.fm PWA..."
        PM2_HOME=$PM2_HOME npx pm2 restart $PWA_NAME
        
        if wait_for_service; then
            echo "✅ PWA restarted successfully!"
        else
            echo "❌ PWA restart failed"
            exit 1
        fi
        ;;
    
    status)
        echo "📊 PWA Status:"
        PM2_HOME=$PM2_HOME npx pm2 status $PWA_NAME
        echo ""
        check_health
        ;;
    
    logs)
        echo "📋 PWA Logs:"
        PM2_HOME=$PM2_HOME npx pm2 logs $PWA_NAME --lines 50
        ;;
    
    health)
        check_health
        ;;
    
    *)
        echo "Usage: $0 {start|stop|restart|status|logs|health}"
        echo ""
        echo "Commands:"
        echo "  start   - Start PWA in production mode"
        echo "  stop    - Stop PWA"
        echo "  restart - Restart PWA"
        echo "  status  - Show PM2 status and health check"
        echo "  logs    - Show recent logs"
        echo "  health  - Check if PWA is responding"
        exit 1
        ;;
esac