# Build Instructions

## Docker (recommended)

The simplest way to get everything running:

```bash
cd src
docker compose up --build -d
```

This starts the backend (port 8080), frontend (port 3000), and a web-based code editor (port 3002). Open http://localhost:3000 in a Chromium-based browser.

To stop:

```bash
cd src
docker compose down
```

## Building from source

You need Java 11+, Maven 3.9+, Node.js 18+, and Git.

### 1. Build PRISM from source

The backend links against PRISM's Java classes directly, so you need a source build:

```bash
cd src/backend
git clone https://github.com/prismmodelchecker/prism
cd prism/prism
git checkout c541affb994f3ed044ae4e1dce3ed3dd078323be
make
```

### 2. Get the bw-responsibility tool

Download the pre-built binary from the [Zenodo artifact](https://zenodo.org/records/13738447) (DOI: 10.5281/zenodo.13738447), or build it yourself with `cargo build --release` if you have a Rust toolchain.

### 3. Set environment variables

```bash
export DYLD_LIBRARY_PATH=/path/to/prism/lib        # macOS; use LD_LIBRARY_PATH on Linux
export RESP_PRISM_PATH=/path/to/prism/bin/prism
export RESP_TOOL_PATH=/path/to/bw-responsibility    # required for responsibility computation
```

If `RESP_TOOL_PATH` is not set, the backend will start normally but throw an error when you try to compute responsibility values.

### 4. Build and run the backend

```bash
cd src/backend/server
mvn clean compile -DskipTests
mvn package -DskipTests
./bin/run server PRISMDefault.yml
```

The backend listens on port 8080 (REST API) and 8082 (Socket.IO).

### 5. Build and run the frontend

In a separate terminal:

```bash
cd src/frontend
npm install
npm run dev
```

The frontend is available at http://localhost:3000.

### Using the start/stop scripts

Alternatively, `start.sh` and `stop.sh` in the repo root handle compilation, environment setup, and process management:

```bash
./start.sh   # compiles if needed, starts backend + frontend
./stop.sh    # kills both processes
```

You still need to set `RESP_TOOL_PATH` before running `start.sh`.

## Project layout

```
src/
├── backend/server/          Java backend (Dropwizard, PRISM integration)
├── frontend/                JavaScript frontend (Cytoscape.js, D3.js)
├── editor/                  Web-based VS Code with PRISM extension
├── docker-compose.yml
└── Dockerfile
data/                        Example PRISM models
evaluation_corpus/           Evaluation benchmark models with ground truth
```

## Troubleshooting

**Backend fails with NoClassDefFoundError** — PRISM classes are not on the classpath. Make sure you built PRISM from source (step 1) and that `DYLD_LIBRARY_PATH` points to its `lib/` directory.

**Port already in use** — Run `./stop.sh` or kill the processes on ports 3000/8080/8082 manually:
```bash
lsof -ti:3000,8080,8082 | xargs kill -9
```

**Docker build is slow the first time** — This is normal; it downloads PRISM and Maven dependencies. Subsequent builds use cached layers and finish in seconds.

## License

MIT — see [LICENSE](LICENSE).
