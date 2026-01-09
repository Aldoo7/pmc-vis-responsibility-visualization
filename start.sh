#!/bin/bash
# Start backend and frontend

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting PMC-VIS..."
echo ""

# Stop any existing processes
echo "Cleaning up existing processes..."
./stop.sh 2>/dev/null || true
sleep 2

# Environment variables
export RESP_TOOL_PATH=/Users/aldo/Downloads/actor-based-responsibility/target/release/bw-responsibility
export RESP_PRISM_PATH=~/opt/prism-source/prism/bin/prism
export DYLD_LIBRARY_PATH=/Users/aldo/opt/prism-source/prism/lib

# Check if backend needs compilation
if [ ! -d "src/backend/server/target/classes" ] || [ ! -f "src/backend/server/target/classes/prism/core/View/ViewType.class" ]; then
    echo "Compiling backend..."
    cd src/backend/server
    mvn clean compile -DskipTests -q
    cd "$SCRIPT_DIR"
    echo "Backend compiled"
fi

# Save PIDs to file for stop script
PID_FILE="$SCRIPT_DIR/.pmc-vis.pids"
rm -f "$PID_FILE"

# Start backend
echo ""
echo "Starting backend server..."
cd "$SCRIPT_DIR/src/backend/server"
nohup ./bin/run server PRISMDefault.yml > /tmp/pmc-backend.log 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" >> "$PID_FILE"
cd "$SCRIPT_DIR"
echo "   PID: $BACKEND_PID"

# Wait for backend
echo -n "Waiting for backend"
for i in {1..20}; do
    if lsof -i:8080 > /dev/null 2>&1; then
        echo ""
        echo "Backend running on port 8080"
        break
    fi
    echo -n "."
    sleep 1
done

if ! lsof -i:8080 > /dev/null 2>&1; then
    echo ""
    echo "ERROR: Backend failed to start!"
    echo "Last 30 lines of log:"
    tail -30 /tmp/pmc-backend.log
    exit 1
fi

# Start frontend
echo ""
echo "Starting frontend..."
cd "$SCRIPT_DIR/src/frontend"
nohup npm run dev > /tmp/pmc-frontend.log 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" >> "$PID_FILE"
cd "$SCRIPT_DIR"
echo "   PID: $FRONTEND_PID"

# Wait for frontend
echo -n "Waiting for frontend"
for i in {1..15}; do
    if lsof -i:3000 > /dev/null 2>&1; then
        echo ""
        echo "Frontend running on port 3000"
        break
    fi
    echo -n "."
    sleep 1
done

if ! lsof -i:3000 > /dev/null 2>&1; then
    echo ""
    echo "ERROR: Frontend failed to start!"
    echo "Last 20 lines of log:"
    tail -20 /tmp/pmc-frontend.log
    exit 1
fi

echo ""
echo "========================================================"
echo "  PMC-VIS is running!"
echo "========================================================"
echo ""
echo "  Frontend:   http://localhost:3000"
echo "  Backend:    http://localhost:8080"
echo "  Socket.IO:  port 8082"
echo "  Admin:      http://localhost:8081"
echo ""
echo "  Logs:"
echo "     Backend:  tail -f /tmp/pmc-backend.log"
echo "     Frontend: tail -f /tmp/pmc-frontend.log"
echo ""
echo "  To stop:  ./stop.sh"
echo ""
echo "========================================================"
