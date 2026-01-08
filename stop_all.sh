#!/bin/bash

# PMC-VIS Stop Script
# Stops all backend and frontend servers

echo "🛑 Stopping PMC-VIS..."

killall -9 java node 2>/dev/null || true

sleep 2

# Verify ports are free
if lsof -i:8080 > /dev/null 2>&1 || lsof -i:8082 > /dev/null 2>&1 || lsof -i:3000 > /dev/null 2>&1; then
    echo "⚠️  Warning: Some ports still in use. Forcing cleanup..."
    lsof -ti:8080,8082,3000 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

echo "✅ All servers stopped"
