# PMC-VIS Backend

Java backend built with Dropwizard. Wraps the PRISM model checker and exposes a REST + Socket.IO API for the frontend.

## Build and run

```bash
mvn clean compile -DskipTests
mvn package -DskipTests
./bin/run server PRISMDefault.yml
```

`PRISMDefault.yml` is the server configuration file. Use `DockerDefault.yml` inside Docker.

## Package structure

| Package | Description |
|---------|-------------|
| `prism/server` | Dropwizard application entry point and server utilities |
| `prism/resources` | REST API endpoints (HTTP/HTTPS) |
| `prism/core` | Core PMC-VIS logic: model checker wrapper, graph operations, views |
| `prism/database` | SQLite database access and result mappers |
| `prism/responsibility` | **Thesis contribution** — backward responsibility computation, state mapping, safety game solver, switching pair analysis (17 files) |

/src/main/java/prism/api: contains the data-objects that are
send to the frontend (via a json-wrapper transforming these
objects into json).

/src/main/java/prism/cli: contains other main functions that can be
used in order to achive some of the PMC-Vis functionality without
needing to start the server.

/src/main/java/prism/misc: Contains utility classes and functions
that do not fit into any of the other packages.
