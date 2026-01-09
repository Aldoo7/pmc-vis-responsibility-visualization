# PMC-VIS Quick Start Guide

## Starting the Application

Simply run:
```bash
./start_all.sh
```

This will:
- Stop any existing processes
- Start the backend server (ports 8080 and 8082)
- Start the frontend dev server (port 3000)
- Display status and log locations

## Stopping the Application

```bash
./stop_all.sh
```

## Accessing the Application

- **Frontend UI**: http://localhost:3000
- **Backend API**: http://localhost:8080
- **Socket.IO**: port 8082

## Viewing Logs

```bash
# Backend logs
tail -f /tmp/backend.log

# Frontend logs
tail -f /tmp/frontend.log
```

## Testing Responsibility Features

1. Open http://localhost:3000
2. Upload a PRISM model (.prism file) and properties (.props file)
3. Click "Check" to generate the model graph
4. Expand the graph by clicking on nodes to explore more states
5. In the right panel, configure responsibility settings:
   - Mode: Optimistic or Pessimistic
   - Power Index: Shapley, Banzhaf, or Count
   - Refinement Level: 0-5
6. Click "Start" to compute responsibility
7. View results in:
   - **State Responsibility Table**: Shows individual state values (top 10)
   - **Component Responsibility Table**: Shows component-level values
   - **Graph Coloring**: High-responsibility states highlighted in red/orange/green

## Graph Visualization Notes

The graph shows the **counterexample trace** (a specific path through the model), not the full state space. To see more states with responsibility values:

1. Click on nodes in the graph to expand and explore
2. The system computes responsibility for all reachable states
3. Only states visible in the graph will be colored
4. A warning appears if <50% of states are visible

## Environment Requirements

- Java 11+
- Node.js 16+
- Maven
- PRISM (installed at `/Users/aldo/opt/prism-source/prism`)
- Responsibility tool (at `/Users/aldo/Downloads/actor-based-responsibility/target/release/bw-responsibility`)

## Troubleshooting

**Backend won't start:**
```bash
# Check logs
cat /tmp/backend.log

# Recompile
cd src/backend/server && mvn clean compile -DskipTests
```

**Frontend won't start:**
```bash
# Check logs
cat /tmp/frontend.log

# Reinstall dependencies
cd src/frontend && npm install
```

**Ports already in use:**
```bash
./stop_all.sh
# Wait 3 seconds
./start_all.sh
```
