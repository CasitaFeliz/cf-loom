# Internals of @casitafeliz/loom-cli

How the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires, and how `cf-loom check` and `cf-loom publish` (see [Commands](README.md#commands)) read and write the registry and the Contract directory (see [Configuration](README.md#configuration)). Which Dependencies form the dependency graph is in [Dependencies](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#dependencies) in the root ARCHITECTURE.md; the Baseline is read as [The Baseline](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-baseline) in COMPATIBILITY.md says.

## Modules

The entry `src/index.ts` (`.`) re-exports from `config/`, and `src/directories/index.ts` (`./directories`) from `contract-directory/`; `src/bin.ts` parses the arguments, runs a command and prints what it ends with.

| Module | Holds | Depends on |
| --- | --- | --- |
| `contract-directory/` | the `ContractDirectory` type, which `./directories` exports | none |
| `loading/` | importing a user's TypeScript file in one line of failure, the project's package.json, where each kind of root sits, the root, the Definitions Packages a root lists as the root file resolves them, the version of an installed package, and where each declaration is exported | none |
| `config/` | `defineConfig`, `Config`, `ApprovalSource`, and loading `cf-loom.config.ts` | `contract-directory`, `loading` |
| `source-text/` | spelling generated TypeScript: the header line, string and JSON literals, identifiers, import lines and relative `.ts` specifiers, a module from its imports and body | none |
| `schema-code/` | a Snapshot node as a zod expression, `declared` or `reader`, the Unknown cases of readers, and the recursive defs with their types | `source-text` |
| `service-code/` | what `generate` writes into a Service: the Handler map, the readers, each stub, and the Handler paths its declarations name | `source-text` |
| `contract-package/` | the Contract Package's files from a Snapshot: package.json with `cfLoom` and the hash, `snapshot.json`, tsconfig, the entry and one file per exported Endpoint, reached Guard and code | `source-text`, `schema-code` |
| `commands/` | `init`, `generate`, `verify` and `package`, each ending with its exit status and the lines it prints | `config`, `loading`, `service-code`, `contract-package` |

A command takes where and when it runs (the working directory and the clock) from `bin.ts`. Every command but `init` first builds the project: its valid root and the declared Snapshot, with `@casitafeliz/loom-contract/internal`; then `generate` and `verify` write or compare the generated files and `package` writes the Contract Package, each from that Snapshot.

## Reading the graph

The graph is read from each package's `cfLoom` metadata in the registry (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md); only the Baseline's `snapshot.json` is downloaded.

## Publishing to the directory

`publish` records the package in the directory before publishing to the registry (the git-repository directory writes and pushes), then re-reads the directory and fails if the package is missing from it; the no-op path of `publish` verifies membership too.
