# Internals of @casitafeliz/loom-cli

How the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires, and how `cf-loom check` and `cf-loom publish` (see [Commands](README.md#commands)) read and write the registry and the Contract directory (see [Configuration](README.md#configuration)). Which Dependencies form the dependency graph is in [Dependencies](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#dependencies) in the root ARCHITECTURE.md; the Baseline is read as [The Baseline](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-baseline) in COMPATIBILITY.md says.

## Modules

The entry `src/index.ts` (`.`) re-exports from `config/`, and `src/directories/index.ts` (`./directories`) from `contract-directory/`; `src/bin.ts` parses the arguments, runs a command and prints what it ends with.

| Module | Holds | Depends on |
| --- | --- | --- |
| `contract-directory/` | the `ContractDirectory` type, which `./directories` exports | none |
| `loading/` | importing a user's TypeScript file in one line of failure, the project's package.json, where each kind of root sits, the root, and the Definitions Packages a root lists as the root file resolves them | none |
| `config/` | `defineConfig`, `Config`, `ApprovalSource`, and loading `cf-loom.config.ts` | `contract-directory`, `loading` |
| `commands/` | `init`, `generate` and `verify`, each ending with its exit status and the lines it prints | `config`, `loading` |

A command takes where and when it runs (the working directory and the clock) from `bin.ts`; `generate` and `verify` build the declared Snapshot with `@casitafeliz/loom-contract/internal` and only read and write the files.

## Reading the graph

The graph is read from each package's `cfLoom` metadata in the registry (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md); only the Baseline's `snapshot.json` is downloaded.

## Publishing to the directory

`publish` records the package in the directory before publishing to the registry (the git-repository directory writes and pushes), then re-reads the directory and fails if the package is missing from it; the no-op path of `publish` verifies membership too.
