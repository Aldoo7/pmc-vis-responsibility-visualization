# PMC-VIS Quick Start Guide

## Start / Stop

```bash
./start.sh    # compiles if needed, starts backend + frontend
./stop.sh     # kills both processes
```

## Access

| Service | URL |
|---------|-----|
| Frontend UI | http://localhost:3000 |
| Backend API | http://localhost:8080 |

## Usage

1. Open http://localhost:3000
2. Upload a PRISM model (`.prism`) and properties (`.props`)
3. Click **Check** to generate the model graph
4. Expand the graph by clicking on nodes
5. In the right panel, configure responsibility:
   - Mode: Optimistic / Pessimistic
   - Power Index: Shapley / Banzhaf / Count
   - Refinement Level: 0–5
6. Click **Start** to compute responsibility
7. Results appear in the state table, component table, and graph coloring

## Logs

```bash
tail -f /tmp/backend.log
tail -f /tmp/frontend.log
```

## Requirements

Java 11+, Node.js 18+, Maven, PRISM (see [BUILD.md](BUILD.md)), and the [`bw-responsibility`](https://zenodo.org/records/13738447) tool.
