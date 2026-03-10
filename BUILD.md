# Build Instructions

## Docker (recommended)

```bash
cd src
docker compose up --build -d    # starts backend (8080), frontend (3000), editor (3002)
docker compose down             # stop
```

Open http://localhost:3000 in a Chromium-based browser.

## Building from source

Prerequisites: Java 11+, Maven 3.9+, Node.js 18+, Git, make/gcc.

### 1. Build PRISM

```bash
cd src/backend
git clone https://github.com/prismmodelchecker/prism
cd prism/prism
git checkout c541affb994f3ed044ae4e1dce3ed3dd078323be
make
```

### 2. Get the bw-responsibility tool

Download from the [Zenodo artifact](https://zenodo.org/records/13738447), or build with `cargo build --release` (requires Rust).

### 3. Set environment variables

```bash
export DYLD_LIBRARY_PATH=/path/to/prism/lib        # macOS; use LD_LIBRARY_PATH on Linux
export RESP_PRISM_PATH=/path/to/prism/bin/prism
export RESP_TOOL_PATH=/path/to/bw-responsibility
```

If `RESP_TOOL_PATH` is not set, the backend starts but responsibility computation will fail.

### 4. Build and run

```bash
# Backend
cd src/backend/server
mvn clean package -DskipTests
./bin/run server PRISMDefault.yml    # ports 8080, 8082

# Frontend (separate terminal)
cd src/frontend
npm install
npm run dev                          # port 3000
```

Alternatively, `./start.sh` and `./stop.sh` in the repo root handle compilation and process management. You still need `RESP_TOOL_PATH` set.

## Troubleshooting

- **NoClassDefFoundError** — PRISM not on classpath. Rebuild PRISM (step 1) and check `DYLD_LIBRARY_PATH`.
- **Port in use** — `./stop.sh` or `lsof -ti:3000,8080,8082 | xargs kill -9`.
- **Slow first Docker build** — Normal; subsequent builds use cached layers.

## License

MIT — see [LICENSE](LICENSE).
