#!/bin/bash
# Stop servers

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/.pmc-vis.pids"

echo "Stopping PMC-VIS..."

# Kill by saved PIDs
if [ -f "$PID_FILE" ]; then
    echo "   Stopping saved processes..."
    while read pid; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null
            echo "   Killed PID $pid"
        fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
fi

# Kill by port
echo "   Checking ports..."

for port in 8080 8081 8082 3000; do
    pids=$(lsof -ti:$port 2>/dev/null)
    if [ -n "$pids" ]; then
        echo "   Killing processes on port $port: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null
    fi
done

# Kill any remaining java/node processes related to PMC
pkill -9 -f "pmc-vis" 2>/dev/null || true

sleep 1

# Verify
still_running=false
for port in 8080 3000; do
    if lsof -i:$port > /dev/null 2>&1; then
        echo "   WARNING: Port $port still in use"
        still_running=true
    fi
done

if [ "$still_running" = false ]; then
    echo "All servers stopped"
else
    echo "Some processes may still be running"
fi
