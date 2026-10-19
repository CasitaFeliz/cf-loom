# @casitafeliz/loom-cli

The `cf-loom` command and `defineConfig`; the Contract directories are under `@casitafeliz/loom-cli/directories`. How the command reads and writes the registry and the Contract directory is in [ARCHITECTURE.md](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/ARCHITECTURE.md). Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md); the Compatibility Check the command runs is in [COMPATIBILITY.md](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md), and the Snapshot it writes in [SNAPSHOT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md).

## Configuration

Each Service, Application or Definitions Package configures the tools in `cf-loom.config.ts`, next to its package.json: at the root of its repository, or in its own directory of a monorepo, where the CLI runs. The CLI reads its `config` export; it is never part of the Snapshot or the published package. Like the Contract's files, it is erasable TypeScript (see [Where Contracts live](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#where-contracts-live) in the root ARCHITECTURE.md).

```ts
// cf-loom.config.ts
import { defineConfig } from '@casitafeliz/loom-cli';
import { github } from '@casitafeliz/loom-cli/directories';

export const config = defineConfig({
  scope: '@org',                     // publishes @org/contract-orders-service
  registry: 'https://npm.internal.example',
  directory: github({ org: 'org' }),   // how to list every Contract Package in the scope
  // optional: only when cf-loom should verify Approvals itself
  approvals: myApprovalSource,
  approvers: ['@org/platform-team'],
  allowSelfApproval: false,
});
```

`scope` is always required; `registry` and `directory` are required by `check`, `publish`, `broker-plan` and `route-plan`; `generate`, `verify` and `package` run offline. An Approval source implements `ApprovalSource = { approvalsOf(commit: string): Promise<{ approver: string }[]> }`: expanding teams is the source's job, and the commit and its author come from git.

npm-compatible registries have no standard way to list the packages in a scope, so the names come from a pluggable Contract directory that returns the complete list or fails, never a partial one. `@casitafeliz/loom-cli/directories` ships directories for the registries that can list a scope authoritatively (npm organizations, GitHub, GitLab, CodeArtifact, Azure Artifacts, Artifactory, Nexus 3.88+), a git-repository directory that `publish` writes to for any other registry (see [Publishing to the directory](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/ARCHITECTURE.md#publishing-to-the-directory)), and a fixed list for tests. Versions and metadata always come from the standard package metadata. The directory fails closed: any error, paging limit or listed package whose metadata cannot be read fails the check. The directory is read with the same credentials the check uses, which must be able to read the whole scope.

A Contract Package is named `<scope>/contract-<name>`, and a Definitions Package `<scope>/<name>`. A Contract Package `cf-loom package` writes is `0.0.0`, in its package.json and in `contract.version`, so a Dependency declared on it records `against: '0.0.0'`; only `publish` derives a version.

## Commands

| Command | Does |
| --- | --- |
| `cf-loom init [service \| application \| definitions]` | Creates the root, `src/contract/index.ts` (or `src/definitions/index.ts`) exporting `contract`, `application` or `definitions`, and `cf-loom.config.ts` with the scope of package.json's name when there is none; it writes all of them or nothing, and never overwrites a file. When package.json's name has no scope and `cf-loom.config.ts` does not exist, it fails (exit 3): write the config by hand. A project has one root, exported under one name |
| `cf-loom add-endpoint <group> <name> <METHOD> <path> --visibility <v>` | Creates the Endpoint, its Group if new, and registers both |
| `cf-loom add-guard <name>` | Creates a Guard |
| `cf-loom add-rejection <CODE> --status <n>` | Creates a Rejection |
| `cf-loom add-event <Name> --visibility <v> [--version n]` | Creates an Event, or its next Message Version |
| `cf-loom add-command <Name> [--version n]` | Creates a Command, or its next Message Version |
| `cf-loom add-subscription <name> [<service>] <Name>@<n>` | Creates a Subscription to an Event, the Service's own unless `<service>` is given, in which case the Event is also added to the Dependencies |
| `cf-loom add-dependency <service> <element>` | Adds an Element of an installed Contract Package to the Dependencies: an Endpoint by name, an Event as `<Name>@<n>` |
| `cf-loom generate` | Writes `contract.snapshot.json`, stamping `deprecatedAt` on an Endpoint it first sees Deprecated (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md); for a Service it also regenerates `src/handlers.generated.ts` and `src/readers.generated.ts` and writes the stub of every missing Handler (see [Stubs and the Handler map](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#stubs-and-the-handler-map) in the handlers README), while an Application or a Definitions Package gets `contract.snapshot.json` only. It fails on an Endpoint or attached Guard that nothing exports under its name (no file under `src/contract/`, or its Definitions Package), on a Handler file that no declared Endpoint, Guard, Command's Message Version or Subscription names and on a Handler path that is no file, and then writes nothing |
| `cf-loom broker-plan [--prefix <p>] [--json] [--limits-skeleton] [--orphans]` | Prints the streams, durable consumers, orphaned durable consumers and permissions the broker must hold; `--limits-skeleton` prints the `limits` for `apply` with every key empty, `--orphans` reads the broker and lists the orphaned durable consumers with their pending counts (see [The broker plan](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#the-broker-plan) in the messaging README) |
| `cf-loom route-plan [--json]` | Prints every route with its Visibility, and the Retired ones, for the organization's gateway or ingress |
| `cf-loom openapi` | Writes an OpenAPI 3.1 document of the Endpoints from the Snapshot (see [JSON Schema](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#json-schema) in SNAPSHOT.md) |
| `cf-loom asyncapi` | Writes an AsyncAPI document of the Events from the Snapshot (see [JSON Schema](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#json-schema) in SNAPSHOT.md) |
| `cf-loom verify` | Fails if `contract.snapshot.json`, `src/handlers.generated.ts` or `src/readers.generated.ts` was edited or is out of date, if a Handler file the Handler map imports is missing or is no file, or if a Handler file names no declared Endpoint, Guard, Command's Message Version or Subscription. It compares files only and imports no file under `src/contract/` beyond what the root imports, so it does not repeat `generate`'s export checks; it writes nothing |
| `cf-loom package [--out <dir>]` | Writes the Contract Package of a Service or an Application to `<dir>`, `contract-package/` next to `cf-loom.config.ts` by default, ready for `tsc -p <dir>` (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md, which also says how `publish` generates it). It is generated from the committed `contract.snapshot.json`, which must be what `generate` would write, apart from `generator`, as `verify` compares it (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md). The folder must be missing, empty, or a previous output, which holds only what `package` writes (`package.json` with `cfLoom`, `snapshot.json`, `tsconfig.json`, `src/`), beside a build's `dist/` or an install's `node_modules/`, which are kept while the rest is replaced; anything else, a symbolic link included, is refused and left as it was. A Definitions Package has no Contract Package: it is published from its own source |
| `cf-loom check [--json]` | Runs the Compatibility Check against the Baseline (see [Breaking Change Approval](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#breaking-change-approval) in COMPATIBILITY.md) |
| `cf-loom publish [--force]` | Builds the Contract, writes the Snapshot, derives the version and publishes the Contract Package (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md); `--force` publishes even when nothing changed (see [Versioning](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#versioning) in COMPATIBILITY.md) |

Exit status: 0, done; 1, the check failed (something not allowed, or a Breaking Change without a verified Approval); 2, the change needs a Breaking Change Approval and no Approval source is configured; 3, a tooling error (configuration, Contract directory, registry).

## What the commands print and write

Each command prints one line per thing it did or found, never a stack trace:

| Command | Prints |
| --- | --- |
| `init` | `Created <root file>` |
| `generate` | `Wrote <path>` for each file it wrote, `contract.snapshot.json` first, then the Handler map, the readers and each new stub |
| `verify` | `<path> is up to date` for each file it compared |
| `package` | `Wrote <dir>` |

A failure is one line on stderr. These are every line `init`, `generate`, `verify` and `package` print, by exit status.

Exit 1, the check failed:

| Line | Command |
| --- | --- |
| `<location> <rule>: <message>`, `<location> not allowed: <construct> (use <instead>)`, one per rule the root breaks | `generate`, `verify`, `package` |
| `endpoints.<name> is exported by no file under src/contract/` (`guards.<name>` for a Guard) | `generate` |
| `endpoints.<name> is not exported as <name>` (`guards.<name>` for a Guard) | `generate` |
| `guards.<name> is not exported as <name> by <package>`, for a Guard of a Definitions Package | `generate` |
| `<path> names no declared Endpoint, Guard, Command's Message Version or Subscription: delete it` | `generate`, `verify` |
| `<path> is no file: a Handler is a file` | `generate`, `verify` |
| `contract.snapshot.json is missing or out of date: run cf-loom generate` | `package` |
| `<path> was edited or is out of date: run cf-loom generate` | `verify` |
| `<path> is missing: run cf-loom generate` | `verify` |
| `contract.snapshot.json was edited: it is no JSON (<reason>)` | `verify` |

Exit 3, a tooling error:

| Line | Command |
| --- | --- |
| `package.json not found: cf-loom runs next to the package.json of the project`, `package.json is no JSON: …`, `package.json cannot be read: …`, `package.json names no package`, `package.json names no package npm accepts: <name>`, `package.json has no "type": "module": the config and the Contract's files are ES modules` | every command |
| `cf-loom.config.ts not found: run cf-loom init`, `cf-loom.config.ts cannot be loaded: …`, `cf-loom.config.ts exports no config: export const config = defineConfig({ … })`, `cf-loom.config.ts threw while it was read: …`, `cf-loom.config.ts: scope is required, an npm scope such as '@org'` | `generate`, `verify`, `package` |
| `No root in src/contract/index.ts or src/definitions/index.ts: run cf-loom init`, `A project has one root: both <file> and <file> exist`, `<file> cannot be loaded: …`, `<file> exports none of contract, application, definitions`, `<file> exports one root, not <name> and <name>`, `<file> threw while it was read: …` | `generate`, `verify`, `package` |
| `<file> already exists`, `<folder> is no folder: init cannot write <file>`, `cf-loom.config.ts is no file`, `package.json names no scope to write cf-loom.config.ts with`, `init cannot write: …` | `init` |
| `<package> is not installed: install it to list it`, `<package> has no version in its package.json`, `<package> cannot be loaded: …`, for a listed Definitions Package | `generate`, `verify`, `package` |
| `contract.snapshot.json cannot be read: …` | `generate`, `verify`, `package` |
| `contract.snapshot.json is no JSON (<reason>): restore it or delete it, then run cf-loom generate` | `generate`, `package` |
| `<file> cannot be loaded: …`, for a file under `src/contract/` the root does not import | `generate` |
| `<folder> cannot be read: …`, for a folder under `src/contract/` or the Handlers' folders | `generate`, `verify` |
| `<path> cannot be written: …` | `generate`, `package` |
| `<dir> cannot be read: …` | `package` |
| `<dir> holds files package did not write: package writes to a missing or empty folder, or over its own output` | `package` |
| `<dir> is no folder: package writes a folder` | `package` |
| `<dir> is a symbolic link: package writes a folder of its own` | `package` |
| `<peer> is not installed: a Contract Package is built with it`, for `zod` or `@casitafeliz/loom-contract` | `package` |
| `<peer> has no version in its package.json: a Contract Package is built with it` | `package` |
| `A Definitions Package has no Contract Package: it is published from its own source` | `package` |
| `The codes <code> and <code> are one name in code: rename one of them` | `package` |
| `The recursion id <id> is no name in code: rename it` | `package` |
| `The recursion ids <id> and <id> are one name in code: rename one of them` | `package` |

Exit 3, a usage error, each followed on the same line by the usage:

| Line | Command |
| --- | --- |
| `Unknown command: <command>`, `Unknown command: (none)` with no command | any |
| `Unknown option: <option>` | any |
| `Only package takes --out` | any command but `package`, an unknown one included |
| `--out takes a folder` | `package` |
| `Unknown kind: <kind>`, `init takes one kind` | `init` |
| `generate takes no argument`, `verify takes no argument`, `package takes no argument` | `generate`, `verify`, `package` |

Every file `generate` regenerates starts with `// Generated by cf-loom generate. Do not edit.`, and every TypeScript file of a Contract Package with `// Generated by cf-loom package. Do not edit.`; stubs carry no such line, since they are the Service's to replace. What the Contract Package's package.json carries in `cfLoom`, and how `snapshotHash` is taken, is in [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) and [Canonical form](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#canonical-form) in SNAPSHOT.md.
