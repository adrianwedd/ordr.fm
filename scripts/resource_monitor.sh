#!/bin/bash
# Resource monitoring and cleanup script for ordr.fm
# Monitors system resources and cleans up runaway processes

# Configuration
MAX_MEMORY_PERCENT=90
MAX_CPU_PERCENT=80
MAX_PROCESS_AGE_HOURS=12
CLEANUP_INTERVAL=300  # 5 minutes

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Source logging functions
source "$PROJECT_DIR/lib/common.sh" 2>/dev/null || {
    # Fallback logging if common.sh not available
    log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$2] $3"; }
    LOG_INFO=2
    LOG_WARNING=1
    LOG_ERROR=0
}

# Check system resources
check_system_resources() {
    local memory_usage=$(free | awk '/^Mem:/ {printf "%.1f", ($3/$2) * 100}')
    local cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
    
    log $LOG_INFO "System usage: Memory: ${memory_usage}%, CPU: ${cpu_usage}%"
    
    # Check memory usage
    if (( $(echo "$memory_usage > $MAX_MEMORY_PERCENT" | bc -l) )); then
        log $LOG_WARNING "High memory usage detected: ${memory_usage}%"
        cleanup_memory_hogs
    fi
    
    # Check CPU usage
    if (( $(echo "$cpu_usage > $MAX_CPU_PERCENT" | bc -l) )); then
        log $LOG_WARNING "High CPU usage detected: ${cpu_usage}%"
        cleanup_cpu_hogs
    fi
}

# Clean up memory-hungry processes
cleanup_memory_hogs() {
    log $LOG_INFO "Cleaning up memory-intensive processes..."
    
    # Find processes using >500MB memory
    local memory_hogs=$(ps aux --sort=-%mem | awk 'NR>1 && $6 > 500000 {print $2 ":" $6 ":" $11}')
    
    while IFS=':' read -r pid mem_kb cmd; do
        [[ -z "$pid" ]] && continue
        
        local mem_mb=$((mem_kb / 1024))
        log $LOG_INFO "High memory process: PID $pid ($mem_mb MB) - $cmd"
        
        # Kill test browsers and orphaned processes
        if [[ "$cmd" =~ (chromium|playwright|test) ]]; then
            log $LOG_WARNING "Killing test process: PID $pid ($cmd)"
            kill -TERM "$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
        fi
    done <<< "$memory_hogs"
}

# Clean up CPU-intensive processes
cleanup_cpu_hogs() {
    log $LOG_INFO "Monitoring CPU-intensive processes..."
    
    # Find processes using >50% CPU for extended periods
    local cpu_hogs=$(ps aux --sort=-%cpu | awk 'NR>1 && $3 > 50 {print $2 ":" $3 ":" $11}')
    
    while IFS=':' read -r pid cpu_percent cmd; do
        [[ -z "$pid" ]] && continue
        
        log $LOG_INFO "High CPU process: PID $pid ($cpu_percent%) - $cmd"
        
        # Kill runaway test processes
        if [[ "$cmd" =~ (chromium|playwright) ]]; then
            log $LOG_WARNING "Killing runaway test process: PID $pid ($cmd)"
            kill -TERM "$pid" 2>/dev/null
        fi
    done <<< "$cpu_hogs"
}

# Clean up old temporary files
cleanup_temp_files() {
    log $LOG_INFO "Cleaning up temporary files..."
    
    # Clean up ordr.fm temporary files
    find /tmp -name "ordr.fm.*" -type f -mtime +1 -delete 2>/dev/null || true
    find /tmp -name "ordr.fm.*" -type d -mtime +1 -exec rm -rf {} + 2>/dev/null || true
    
    # Clean up test artifacts
    find /tmp -name "playwright*" -type d -mtime +1 -exec rm -rf {} + 2>/dev/null || true
    find /tmp -name "chromium*" -type d -mtime +1 -exec rm -rf {} + 2>/dev/null || true
    
    # Clean up old log files (keep last 30 days)
    find "$PROJECT_DIR" -name "*.log" -type f -mtime +30 -delete 2>/dev/null || true
    
    log $LOG_INFO "Temporary file cleanup completed"
}

# Clean up old processes
cleanup_old_processes() {
    log $LOG_INFO "Checking for old processes..."
    
    # Find old ordr.fm processes
    local old_processes=$(ps aux | awk -v max_hours=$MAX_PROCESS_AGE_HOURS '
        /ordr\.fm/ && $10 ~ /[0-9]+:[0-9]+/ {
            split($10, time, ":")
            if (time[1] >= max_hours) print $2 ":" $11
        }')
    
    while IFS=':' read -r pid cmd; do
        [[ -z "$pid" ]] && continue
        
        log $LOG_WARNING "Found old process: PID $pid ($cmd)"
        kill -TERM "$pid" 2>/dev/null
    done <<< "$old_processes"
}

# Clean up database locks and connections
cleanup_database() {
    log $LOG_INFO "Cleaning up database resources..."
    
    # Check for .db-wal and .db-shm files that might indicate locked databases
    local db_locks=$(find "$PROJECT_DIR" -name "*.db-wal" -o -name "*.db-shm" 2>/dev/null)
    
    if [[ -n "$db_locks" ]]; then
        log $LOG_WARNING "Found potential database locks:"
        echo "$db_locks" | while read -r lock_file; do
            log $LOG_WARNING "  $lock_file"
            # Remove old lock files (older than 1 hour)
            find "$(dirname "$lock_file")" -name "$(basename "$lock_file")" -mmin +60 -delete 2>/dev/null || true
        done
    fi
}

# Monitor Node.js processes
monitor_nodejs() {
    log $LOG_INFO "Monitoring Node.js processes..."
    
    local node_processes=$(ps aux | grep node | grep -v grep)
    
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        
        local pid=$(echo "$line" | awk '{print $2}')
        local mem_mb=$(echo "$line" | awk '{print int($6/1024)}')
        local cpu=$(echo "$line" | awk '{print $3}')
        
        if [[ $mem_mb -gt 1000 ]]; then  # >1GB memory
            log $LOG_WARNING "High memory Node.js process: PID $pid (${mem_mb}MB, ${cpu}% CPU)"
        fi
    done <<< "$node_processes"
}

# Main monitoring loop
main() {
    log $LOG_INFO "Starting resource monitor (PID: $$)"
    log $LOG_INFO "Monitoring thresholds: Memory: $MAX_MEMORY_PERCENT%, CPU: $MAX_CPU_PERCENT%"
    
    # Initial cleanup
    cleanup_temp_files
    cleanup_old_processes
    cleanup_database
    
    # Continuous monitoring
    while true; do
        check_system_resources
        monitor_nodejs
        
        # Periodic cleanup
        if [[ $(($(date +%s) % 1800)) -eq 0 ]]; then  # Every 30 minutes
            cleanup_temp_files
            cleanup_old_processes
            cleanup_database
        fi
        
        sleep $CLEANUP_INTERVAL
    done
}

# Signal handling
trap 'log $LOG_INFO "Resource monitor stopping..."; exit 0' INT TERM

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi