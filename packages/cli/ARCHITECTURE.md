# Internals of @casitafeliz/loom-cli

How `cf-loom check` and `cf-loom publish` (see [Commands](README.md#commands)) read and write the registry and the Contract directory (see [Configuration](README.md#configuration)). Which Dependencies form the dependency graph is in [Dependencies](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#dependencies) in the root ARCHITECTURE.md; the Baseline is read as [The Baseline](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-baseline) in COMPATIBILITY.md says.

## Reading the graph

The graph is read from each package's `cfLoom` metadata in the registry (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md); only the Baseline's `snapshot.json` is downloaded.

## Publishing to the directory

`publish` records the package in the directory before publishing to the registry (the git-repository directory writes and pushes), then re-reads the directory and fails if the package is missing from it; the no-op path of `publish` verifies membership too.
