# Internals of @casitafeliz/loom-cli

How the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires, and how `cf-loom check` and `cf-loom publish` (see [Commands](README.md#commands)) read and write the registry and the Contract directory (see [Configuration](README.md#configuration)). Which Dependencies form the dependency graph is in [Dependencies](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#dependencies) in the root ARCHITECTURE.md; the Baseline is read as [The Baseline](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-baseline) in COMPATIBILITY.md says.

## Modules

The entry `src/index.ts` (`.`) re-exports from `config/`, and `src/directories/index.ts` (`./directories`) from `contract-directory/`; `src/bin.ts` parses the arguments, runs a command and prints what it ends with.

| Module | Holds | Depends on |
| --- | --- | --- |
| `contract-directory/` | the `ContractDirectory` type, which `./directories` exports | none |
| `loading/` | importing a user's TypeScript file in one line of failure, the project's package.json, where each kind of root sits, the root, the Definitions Packages a root lists as the root file resolves them, the version of an installed package, the files under a folder through linked folders, and where each declaration is exported | none |
| `config/` | `defineConfig`, `Config`, `ApprovalSource`, and loading `cf-loom.config.ts` | `contract-directory`, `loading` |
| `project/` | a project as every command but `init` reads it: its package, configuration and root, the committed `contract.snapshot.json` as read, and the valid root with its canonical Snapshot; a failure is a closed value, the root's rules broken or a tooling error | `config`, `loading` |
| `source-text/` | spelling generated TypeScript: the header line, string and JSON literals, identifiers, import lines and relative `.ts` specifiers, a module from its imports and body | none |
| `schema-code/` | a Snapshot node as a zod expression, `declared` or `reader`, the Unknown cases of readers, what generated code imports, and the recursive defs with their types | `source-text` |
| `service-code/` | what `generate` writes into a Service: the Handler map, the readers, each stub, and the Handler paths its declarations name | `source-text`, `loading` |
| `contract-package/` | the Contract Package's files from a canonical Snapshot and its text: package.json with `cfLoom` and the hash, `snapshot.json`, tsconfig, the entry with the types of the defs it reaches, the Standard Rejections, one file per exported Endpoint, per Guard they attach and per code they answer, the recursive defs they reach; an Application's Snapshot alone; the paths a package holds; and the codes or recursion ids that cannot be named in code | `source-text`, `schema-code` |
| `writing/` | writing generated files atomically, a stub only where none is, and the Contract Package over a missing, empty or previous output, its install and build kept | `contract-package`, `loading` |
| `commands/` | `init`, `generate`, `verify` and `package`, each ending with its exit status and the lines it prints, and their steps: the stubs, the Handler files, the regenerated files | `config`, `loading`, `project`, `service-code`, `contract-package`, `writing` |

Every Endpoint, Guard, Rejection, def and Event a Contract Package's code declares has a name in code that says its kind, so names of different kinds never meet: `<name>Endpoint`, `<name>Guard`, `<code in camelCase>Rejection`, `<id in camelCase>Def` and `<id in camelCase>ReaderDef` with their types in PascalCase, and `<name with its first letter lower-cased>EventV<n>` for an Event's Message Version (`paymentSettledEventV1`); `@casitafeliz/loom-contract` is imported whole as `loom` and `zod` as `z`. A recursive def is a `z.lazy` annotated with its written type, `z.ZodType<TreeDef, TreeDef>` as declared, input and output exact, and `z.ZodType<TreeReaderDef>` as a reader; an object def is also `z.core.$ZodTypeDiscriminable`, so zod's discriminated union and `loom.openUnion` take it as a variant with no cast, and a written type that disagrees with the schema fails `tsc`.

A command takes where and when it runs (the working directory and the clock) from `bin.ts`. Every command but `init` first builds the project through `project/`: its valid root and the declared Snapshot, with `@casitafeliz/loom-contract/internal`; then `generate` and `verify` write or compare the generated files, and `package`, once the committed Snapshot is that Snapshot, writes the Contract Package from it.

## Reading the graph

The graph is read from each package's `cfLoom` metadata in the registry (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md); only the Baseline's `snapshot.json` is downloaded.

## Publishing to the directory

`publish` records the package in the directory before publishing to the registry (the git-repository directory writes and pushes), then re-reads the directory and fails if the package is missing from it; the no-op path of `publish` verifies membership too.
