#!/bin/bash
# Quick cleanup utility for ordr.fm
# Performs immediate cleanup of resources, processes, and temporary files

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🧹 ordr.fm Resource Cleanup Utility"
echo "=================================="

# Clean up lock files
echo "🔒 Cleaning up lock files..."
find /tmp -name "ordr.fm*.lock" -type f -delete 2>/dev/null || true
echo "   ✓ Removed lock files"

# Clean up temporary files
echo "📁 Cleaning up temporary files..."
find /tmp -name "ordr.fm.*" -type f -delete 2>/dev/null || true
find /tmp -name "ordr.fm.*" -type d -exec rm -rf {} + 2>/dev/null || true
echo "   ✓ Removed temporary files"

# Clean up test artifacts
echo "🧪 Cleaning up test artifacts..."
find /tmp -name "playwright*" -type d -exec rm -rf {} + 2>/dev/null || true
find /tmp -name "chromium*" -type d -exec rm -rf {} + 2>/dev/null || true
echo "   ✓ Removed test artifacts"

# Kill test processes
echo "🔄 Cleaning up test processes..."
pkill -f chromium 2>/dev/null || true
pkill -f playwright 2>/dev/null || true
echo "   ✓ Killed test processes"

# Clean up database locks
echo "🗄️  Cleaning up database locks..."
find "$PROJECT_DIR" -name "*.db-wal" -delete 2>/dev/null || true
find "$PROJECT_DIR" -name "*.db-shm" -delete 2>/dev/null || true
echo "   ✓ Removed database lock files"

# Show current resource usage
echo ""
echo "📊 Current Resource Usage:"
echo "-------------------------"
free -h | grep -E "(Mem|Swap):" | awk '{printf "%-8s %s used of %s (%.1f%%)\n", $1, $3, $2, ($3/$2)*100}'

echo ""
echo "🔋 Top Memory Consumers:"
echo "----------------------"
ps aux --sort=-%mem | head -6 | awk 'NR==1 {print $0} NR>1 {printf "%-8s %6.1fMB %s\n", $2, $6/1024, $11}'

echo ""
echo "✅ Cleanup completed!"

# Check if ordr.fm processes are running
ordr_processes=$(ps aux | grep -E "ordr\.fm|node.*server" | grep -v grep | wc -l)
if [[ $ordr_processes -gt 0 ]]; then
    echo ""
    echo "ℹ️  Note: $ordr_processes ordr.fm processes still running"
    ps aux | grep -E "ordr\.fm|node.*server" | grep -v grep | awk '{printf "   PID %-8s %s\n", $2, $11}'
fi