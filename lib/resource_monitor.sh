#!/bin/bash
#
# Resource monitoring and throttling for ordr.fm
#

# Check system resource usage and recommend throttling
check_system_load() {
    local load_1min=$(uptime | awk -F'load average:' '{print $2}' | awk -F',' '{print $1}' | tr -d ' ')
    local cpu_cores=$(nproc 2>/dev/null || echo 4)
    local load_threshold=$((cpu_cores * 75 / 100))  # 75% of available cores
    
    # Convert load to integer for comparison (multiply by 100)
    local load_int=$(echo "$load_1min * 100" | bc 2>/dev/null | cut -d'.' -f1)
    local threshold_int=$((load_threshold * 100))
    
    if [[ $load_int -gt $threshold_int ]]; then
        log $LOG_WARNING "High system load detected: $load_1min (threshold: $load_threshold)"
        return 1
    fi
    
    return 0
}

# Check memory pressure
check_memory_pressure() {
    local available_mem=$(free -m | awk 'NR==2 {print $7}')
    local swap_used=$(free -m | awk 'NR==3 {print $3}')
    
    # Memory pressure if less than 500MB available or swap usage > 100MB
    if [[ $available_mem -lt 500 ]] || [[ $swap_used -gt 100 ]]; then
        log $LOG_WARNING "Memory pressure detected: ${available_mem}MB available, ${swap_used}MB swap used"
        return 1
    fi
    
    return 0
}

# Intelligent throttling
should_throttle_processing() {
    local reasons=()
    
    if ! check_system_load; then
        reasons+=("high CPU load")
    fi
    
    if ! check_memory_pressure; then
        reasons+=("memory pressure")
    fi
    
    if [[ ${#reasons[@]} -gt 0 ]]; then
        log $LOG_INFO "Throttling processing due to: ${reasons[*]}"
        return 0
    fi
    
    return 1
}

# Smart sleep with resource monitoring
smart_sleep() {
    local duration=${1:-5}
    local check_interval=${2:-1}
    
    for ((i=0; i<duration; i+=check_interval)); do
        sleep $check_interval
        
        # Exit early if resources become available
        if ! should_throttle_processing; then
            break
        fi
    done
}

export -f check_system_load check_memory_pressure should_throttle_processing smart_sleep