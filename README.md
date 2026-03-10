# PMC-VIS: Responsibility Visualization Extension

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.18945243.svg)](https://doi.org/10.5281/zenodo.18945243)


This repository contains the source code for the Master's thesis:

> **Interactive Visualization of Responsibility within Markov Decision Processes for PMC-VIS**
> Aldo Kurmeta, Technische Universität Dresden, 2026

The thesis extends [PMC-VIS](https://doi.org/10.1007/978-3-031-47115-5_20) (Korn et al., SEFM 2023), an interactive web-based visualization tool for probabilistic model checking, with **backward responsibility analysis** for transition systems based on the framework of [Baier et al. (AAAI 2024)](https://doi.org/10.1609/aaai.v38i18.30013).

## What This Extension Adds

- **Responsibility computation** — integration of the external Rust-based [`bw-responsibility`](https://zenodo.org/records/13738447) tool via a Java backend, with a state-identifier mapping layer that reconciles PRISM numeric IDs, graph database IDs, and variable-value tuples.
- **Layered visualization** — percentile-based graph coloring, threshold filtering, a critical-suspects panel, and a cross-mode comparison table for all four index–mode combinations (Shapley/Banzhaf × optimistic/pessimistic).
- **Switching pair analysis** — safety game construction for coalitions, attractor-based winning region computation, and graph overlays of concrete winning strategies.
- **Parallel coordinates integration** — responsibility values as an additional axis in the existing parallel coordinates plot, enabling brushing-and-linking for multi-attribute analysis.
- **Scalability mechanisms** — state grouping (by module, label, or action) and stochastic sampling for models with thousands of states.

## Repository Structure

```
src/
├── backend/server/
│   └── src/main/java/prism/
│       ├── responsibility/        ← Thesis contribution (17 Java files)
│       │   ├── ResponsibilityEngine.java      Main orchestrator
│       │   ├── RustResponsibilityInvoker.java  Subprocess adapter for bw-responsibility
│       │   ├── PrismStateMapper.java           State ID reconciliation
│       │   ├── SafetyGame.java                 Safety game solver (attractor algorithm)
│       │   ├── OptimisticExactStrategyCorrected.java
│       │   ├── PessimisticExactStrategyCorrected.java
│       │   └── ...
│       └── core/, api/, server/, db/          ← Pre-existing PMC-VIS backend
├── frontend/src/lib/
│   ├── views/responsibility/      ← Thesis contribution (3 JS files)
│   │   ├── responsibility-controls.js   Main UI controller
│   │   ├── comparison.js                Cross-mode comparison table
│   │   └── filtering.js                 Threshold-based filtering
│   └── views/, utils/, style/     ← Pre-existing PMC-VIS frontend
├── Dockerfile
└── docker-compose.yml
data/
├── zenodo-examples/               ← Benchmark models (from Baier et al. Zenodo artifact)
│   ├── dining_philosophers_a.prism/.props
│   ├── brp_1.prism/.props
│   ├── puzzle_box.prism/.props
│   ├── 3_generals_a.prism/.props
│   └── broken_window.prism/.props
└── ...                            ← Additional PRISM example models
evaluation_corpus/                     ← 5 benchmark models with ground-truth bug annotations
```

## Quick Start (Docker)

### Requirements
- Docker Desktop (minimum 2 GB RAM, recommended 4+ GB)
- A Chromium-based browser (e.g., Google Chrome)

### Run

```bash
cd src
docker compose up --build -d
```

Three services start:
| Service  | Port | Description          |
|----------|------|----------------------|
| Backend  | 8080 | Java REST API        |
| Frontend | 3000 | Web visualization UI |
| Editor   | 3002 | VS Code web editor   |

Open **http://localhost:3000** in your browser.

### Stop

```bash
cd src
docker compose down
```

## Building from Source (without Docker)

### Prerequisites

- Java 11+
- Maven 3.9+
- Node.js 18+, npm
- GNU make, gcc, git
- Rust toolchain (for building `bw-responsibility` from source, optional)

### 1. Build PRISM

```bash
cd src/backend
git clone https://github.com/prismmodelchecker/prism
cd prism/prism
git checkout c541affb994f3ed044ae4e1dce3ed3dd078323be
make
```

### 2. Build the `bw-responsibility` Tool

Download from the [Zenodo artifact](https://zenodo.org/records/13738447) (DOI: 10.5281/zenodo.13738447) and build with `cargo build --release`, or use a pre-built binary.

### 3. Build and Run the Backend

```bash
cd src/backend/server
mvn clean compile -DskipTests
mvn package -DskipTests

# Set environment variables pointing to PRISM and bw-responsibility
export DYLD_LIBRARY_PATH=/path/to/prism/lib        # macOS (use LD_LIBRARY_PATH on Linux)
export RESP_PRISM_PATH=/path/to/prism/bin/prism
export RESP_TOOL_PATH=/path/to/bw-responsibility

./bin/run server PRISMDefault.yml
```

The backend starts on port 8080 (HTTP) and port 8082 (Socket.IO).

### 4. Build and Run the Frontend

```bash
cd src/frontend
npm install
npm run dev
```

The frontend starts on **http://localhost:3000**.

## Example Models

The `data/zenodo-examples/` directory contains the PRISM models used in the thesis evaluation, sourced from the [Zenodo artifact](https://zenodo.org/records/13738447) accompanying Baier et al. (AAAI 2024):

| Model | States | Evaluation Focus |
|-------|--------|-----------------|
| Dining Philosophers | 36 | Visual encoding, cross-mode comparison |
| Bounded Retransmission Protocol | 5,192 | Grouping, stochastic sampling |
| Quality Control Pipeline | 6 | Switching pair debugging workflow |

The `evaluation_corpus/` directory contains five PRISM models with seeded bugs and ground-truth annotations (`ground_truth.yaml`), used to validate the tool's ability to identify responsible states.

## External Dependencies

| Tool | Purpose | Source |
|------|---------|--------|
| [PRISM](https://www.prismmodelchecker.org/) | Model checking, state enumeration | GitHub (pinned commit `c541affb`) |
| [`bw-responsibility`](https://zenodo.org/records/13738447) | Backward responsibility computation | Zenodo (DOI: 10.5281/zenodo.13738447) |
| [Cytoscape.js](https://js.cytoscape.org/) | Graph visualization | npm |
| [D3.js](https://d3js.org/) | Parallel coordinates, axes | npm |
| [Dropwizard](https://www.dropwizard.io/) | Java REST framework | Maven |

## References

- Korn, M., Méndez, A., Klüppelholz, S., Langner, R., Baier, C., & Dachselt, R. (2023). *PMC-VIS: Interactive Visualization for Probabilistic Model Checking.* SEFM 2023. [DOI: 10.1007/978-3-031-47115-5_20](https://doi.org/10.1007/978-3-031-47115-5_20)
- Baier, C., van den Bossche, R., Klüppelholz, S., Lehmann, J., & Piribauer, J. (2024). *Backward Responsibility in Transition Systems Using General Power Indices.* AAAI 2024. [DOI: 10.1609/aaai.v38i18.30013](https://doi.org/10.1609/aaai.v38i18.30013)

## License

[MIT License](LICENSE) — © 2023 Interactive Media Lab Dresden

