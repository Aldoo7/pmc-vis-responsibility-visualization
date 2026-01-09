# PMC-VIS Build Instructions

This document provides step-by-step instructions to build and run the PMC-VIS (Probabilistic Model Checker Visualization) project.

## Prerequisites

Ensure you have the following installed on your system:

- **Java 11** (or higher)
- **Maven 3.9+**
- **Node.js 24+** and **npm 11+**
- **Docker Desktop** (for containerized deployment)
- **Git**

### Verify Prerequisites

```bash
java -version    # Should show Java 11 or higher
mvn -version     # Should show Maven 3.9+
node -version    # Should show v24+
npm -version     # Should show 11+
docker --version # Should show Docker 20+
```

## Quick Start with Docker (Recommended)

The easiest way to run PMC-VIS is using Docker Compose:

```bash
cd /path/to/pmc-vis2/src
docker-compose up -d
```

This will start three services:
- **Backend server** (ports 8080, 8082, 8081)
- **Frontend** (port 3000)
- **VS Code editor** (port 3002)

Access the application at: **http://localhost:3000**

### Stop Services

```bash
cd /path/to/pmc-vis2/src
docker-compose down
```

### Rebuild After Code Changes

```bash
cd /path/to/pmc-vis2/src
docker-compose up --build -d
```

## Manual Build (Without Docker)

If you prefer to build and run manually:

### 1. Build Backend

```bash
cd /path/to/pmc-vis2/src/backend/server
mvn clean compile -DskipTests
mvn package -DskipTests
```

### 2. Build Frontend

```bash
cd /path/to/pmc-vis2/src/frontend
npm ci
npm run build
```

### 3. Run Backend

**Important:** Set required environment variables first:

```bash
export DYLD_LIBRARY_PATH=/Users/aldo/opt/prism-source/prism/lib
export RESP_PRISM_PATH=~/opt/prism-source/prism/bin/prism
# Optional: export RESP_TOOL_PATH=/path/to/bw-responsibility
```

Update classpath in `start_server_direct.sh` to include PRISM classes:

```bash
CLASSPATH="target/classes:/Users/aldo/opt/prism-source/prism/classes:../prism/prism/lib/prism.jar:$CLASSPATH"
```

Then start the backend:

```bash
cd /path/to/pmc-vis2
./start_server_direct.sh
```

The backend will start on:
- HTTP API: http://localhost:8080
- Socket.IO: http://localhost:8082
- Admin: http://localhost:8081

### 4. Run Frontend

```bash
cd /path/to/pmc-vis2/src/frontend
npm run dev
```

The frontend will start on: http://localhost:3000

## Project Structure

```
pmc-vis2/
├── src/
│   ├── backend/server/      # Java backend (Dropwizard + PRISM)
│   ├── frontend/            # Vue.js frontend with Cytoscape
│   ├── editor/              # VS Code web editor with PRISM extension
│   ├── docker-compose.yml   # Docker orchestration
│   └── scripts/             # Build and deployment scripts
├── data/                    # Example PRISM models and properties
└── evaluation_corpus/       # Test models with ground truth
```

## Docker Services

### Backend (pmc-vis-server)
- **Image**: Built from `src/backend/server/Dockerfile`
- **Base**: Debian 11
- **Contains**: PRISM model checker (from GitHub), Java backend, Maven dependencies
- **Ports**: 8080 (HTTP), 8082 (Socket.IO), 8081 (admin)

### Frontend (pmc-vis-node)
- **Image**: Built from `src/frontend/Dockerfile`
- **Base**: Node 20 Alpine
- **Contains**: Vite dev server, Vue.js application
- **Port**: 3000

### Editor (pmc-vis-editor)
- **Image**: Built from `src/editor/Dockerfile`
- **Base**: Debian 11 with code-server
- **Contains**: VS Code web with PRISM language extension
- **Port**: 3002

## Environment Variables

### For Backend

- `DYLD_LIBRARY_PATH`: Path to PRISM native libraries (macOS)
  - Example: `/Users/aldo/opt/prism-source/prism/lib`
  
- `RESP_PRISM_PATH`: Path to PRISM binary executable
  - Example: `~/opt/prism-source/prism/bin/prism`
  
- `RESP_TOOL_PATH`: Path to Rust responsibility analysis tool (optional)
  - Example: `/path/to/bw-responsibility`
  - If not set, backend runs in MOCK mode with demo data

### For Frontend

- `VITE_BACKEND_RESTFUL`: Backend REST API URL
  - Default: `http://localhost:8080`
  
- `VITE_HIDE_TODOS`: Hide development TODO markers
  - Values: `true` or `false`

## Troubleshooting

### Backend fails with "NoClassDefFoundError"

**Problem**: PRISM classes not in classpath

**Solution**: Update `start_server_direct.sh` to include PRISM source classes:
```bash
CLASSPATH="target/classes:/path/to/prism/classes:$CLASSPATH"
```

### Frontend crashes when run with nohup/background

**Problem**: Vite dev server not designed for detached processes

**Solution**: Use Docker Compose instead of manual background processes

### Nodes not colored in responsibility visualization

**Problem**: State ID mismatch or backend in mock mode

**Current Status**: Fixed in latest build. Backend mock now uses correct state IDs.

**For Production**: Configure `RESP_TOOL_PATH` environment variable to use real Rust responsibility tool instead of mock data.

### Docker build is slow

**Solution**: Docker caches layers. First build takes ~2 minutes (downloads PRISM, Maven deps). Subsequent builds are much faster unless you change Dockerfile.

### Port already in use

**Problem**: Ports 3000, 8080, 8081, 8082 already occupied

**Solution**:
```bash
# Kill processes on these ports
lsof -ti:3000,8080,8081,8082 | xargs kill -9

# Or change ports in docker-compose.yml
```

## Verification

After starting services, verify they're running:

```bash
# Check Docker containers
docker ps

# Test backend API
curl http://localhost:8080/0/status

# Test Socket.IO connection
curl http://localhost:8082/socket.io/

# Open frontend in browser
open http://localhost:3000
```

## Development Workflow

1. **Make code changes** in `src/backend/server/` or `src/frontend/src/`
2. **Rebuild affected service**:
   ```bash
   docker-compose up --build -d server  # Backend only
   docker-compose up --build -d node    # Frontend only
   ```
3. **Check logs**:
   ```bash
   docker logs pmc-vis-server-1
   docker logs pmc-vis-node-1
   ```
4. **Refresh browser** to see changes

## Clean Build

To remove all Docker images and rebuild from scratch:

```bash
cd /path/to/pmc-vis2/src
docker-compose down
docker system prune -f
docker-compose up --build -d
```

## Known Limitations

- **Mock Mode**: Backend currently runs in MOCK mode with demo responsibility values. For real analysis, configure the Rust `bw-responsibility` tool.
- **Manual Startup**: Frontend Vite dev server is unstable when run with `nohup` or `&`. Use Docker for reliable background execution.
- **PRISM Dependency**: Backend requires PRISM model checker source build, not just the binary distribution.

## Support

For issues or questions:
- Check the console logs in browser DevTools (F12)
- Check Docker container logs: `docker logs <container-name>`
- Review backend logs for Java exceptions
- Verify all prerequisites are installed

## License

See LICENSE file in the repository root.
