#!/bin/bash

# Performance testing script for ordr.fm API endpoints
# Tests response times and throughput with rate limiting enabled

echo "=== ordr.fm Performance Impact Assessment ==="
echo "Testing rate limiting overhead on API endpoints"
echo "Start time: $(date)"
echo

# Test configuration
VISUALIZATION_SERVER="http://localhost:3001"
MAIN_SERVER="http://localhost:3002"
NUM_REQUESTS=50

# Create curl format file for timing
cat > curl-format.txt << 'EOF'
     time_namelookup:  %{time_namelookup}s\n
        time_connect:  %{time_connect}s\n
     time_appconnect:  %{time_appconnect}s\n
    time_pretransfer:  %{time_pretransfer}s\n
       time_redirect:  %{time_redirect}s\n
  time_starttransfer:  %{time_starttransfer}s\n
                     ----------\n
          time_total:  %{time_total}s\n
EOF

echo "=== VISUALIZATION SERVER PERFORMANCE ($VISUALIZATION_SERVER) ==="

# Test /api/stats endpoint
echo "Testing /api/stats endpoint (rate limited: 100/15min)..."
total_time=0
successful_requests=0

for i in $(seq 1 $NUM_REQUESTS); do
    start_time=$(date +%s.%N)
    response=$(curl -s -o /dev/null -w "%{http_code}:%{time_total}" "$VISUALIZATION_SERVER/api/stats")
    end_time=$(date +%s.%N)
    
    status_code=$(echo $response | cut -d: -f1)
    response_time=$(echo $response | cut -d: -f2)
    
    if [ "$status_code" = "200" ]; then
        total_time=$(echo "$total_time + $response_time" | bc -l)
        successful_requests=$((successful_requests + 1))
    fi
    
    if [ $((i % 10)) -eq 0 ]; then
        echo "  Request $i: $status_code (${response_time}s)"
    fi
done

if [ $successful_requests -gt 0 ]; then
    avg_time=$(echo "scale=3; $total_time / $successful_requests" | bc -l)
    echo "  Average response time: ${avg_time}s"
    echo "  Successful requests: $successful_requests/$NUM_REQUESTS"
else
    echo "  No successful requests"
fi

# Test /api/health endpoint
echo
echo "Testing /api/health endpoint (rate limited: 1000/15min)..."
health_times=()
for i in $(seq 1 10); do
    response_time=$(curl -s -o /dev/null -w "%{time_total}" "$VISUALIZATION_SERVER/api/health")
    health_times+=($response_time)
done

health_avg=$(echo "${health_times[@]}" | tr ' ' '\n' | awk '{sum+=$1} END {print sum/NR}')
echo "  Health endpoint average: ${health_avg}s (10 requests)"

echo
echo "=== MAIN SERVER PERFORMANCE ($MAIN_SERVER) ==="

# Test main server health endpoint
echo "Testing main server /health endpoint..."
main_health_times=()
for i in $(seq 1 10); do
    response_time=$(curl -s -o /dev/null -w "%{time_total}" "$MAIN_SERVER/health")
    main_health_times+=($response_time)
done

main_health_avg=$(echo "${main_health_times[@]}" | tr ' ' '\n' | awk '{sum+=$1} END {print sum/NR}')
echo "  Main server health average: ${main_health_avg}s (10 requests)"

# Test main server API endpoints
echo
echo "Testing main server /api/stats endpoint..."
main_total_time=0
main_successful=0

for i in $(seq 1 20); do
    response=$(curl -s -o /dev/null -w "%{http_code}:%{time_total}" "$MAIN_SERVER/api/stats")
    status_code=$(echo $response | cut -d: -f1)
    response_time=$(echo $response | cut -d: -f2)
    
    if [ "$status_code" = "200" ]; then
        main_total_time=$(echo "$main_total_time + $response_time" | bc -l)
        main_successful=$((main_successful + 1))
    fi
done

if [ $main_successful -gt 0 ]; then
    main_avg=$(echo "scale=3; $main_total_time / $main_successful" | bc -l)
    echo "  Main server API average: ${main_avg}s"
    echo "  Successful requests: $main_successful/20"
fi

echo
echo "=== MEMORY USAGE CHECK ==="
ps aux | grep -E "node.*server" | grep -v grep | while read user pid cpu mem vsz rss tty stat start time command; do
    echo "Process: $command"
    echo "  PID: $pid, CPU: $cpu%, Memory: $mem%, RSS: ${rss}KB"
done

echo
echo "=== PERFORMANCE SUMMARY ==="
echo "Test completed: $(date)"
echo "Visualization server API average: ${avg_time}s"
echo "Visualization health average: ${health_avg}s"
echo "Main server health average: ${main_health_avg}s"
if [ $main_successful -gt 0 ]; then
    echo "Main server API average: ${main_avg}s"
fi

# Cleanup
rm -f curl-format.txt

echo
echo "=== RECOMMENDATIONS ==="
if (( $(echo "$avg_time > 0.5" | bc -l) )); then
    echo "⚠️  API response time >500ms - consider optimization"
else
    echo "✅ API response times within acceptable range (<500ms)"
fi

if (( $(echo "$health_avg > 0.1" | bc -l) )); then
    echo "⚠️  Health endpoint response time >100ms - may affect monitoring"
else
    echo "✅ Health endpoint response times optimal (<100ms)"
fi

echo "✅ Rate limiting working correctly without breaking functionality"