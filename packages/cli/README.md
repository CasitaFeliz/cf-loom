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

`scope` is always required; `registry` and `directory` are required by `check`, `publish`, `broker-plan` and `route-plan`; `generate` and `verify` run offline. An Approval source implements `ApprovalSource = { approvalsOf(commit: string): Promise<{ approver: string }[]> }`: expanding teams is the source's job, and the commit and its author come from git.

npm-compatible registries have no standard way to list the packages in a scope, so the names come from a pluggable Contract directory that returns the complete list or fails, never a partial one. `@casitafeliz/loom-cli/directories` ships directories for the registries that can list a scope authoritatively (npm organizations, GitHub, GitLab, CodeArtifact, Azure Artifacts, Artifactory, Nexus 3.88+), a git-repository directory that `publish` writes to for any other registry (see [Publishing to the directory](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/ARCHITECTURE.md#publishing-to-the-directory)), and a fixed list for tests. Versions and metadata always come from the standard package metadata. The directory fails closed: any error, paging limit or listed package whose metadata cannot be read fails the check. The directory is read with the same credentials the check uses, which must be able to read the whole scope.

A Contract Package is named `<scope>/contract-<name>`, and a Definitions Package `<scope>/<name>`. Until `publish` derives its version, a Contract Package `cf-loom package` writes is `0.0.0`, in its package.json and in `contract.version`.

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
| `cf-loom generate` | Writes `contract.snapshot.json`, stamping `deprecatedAt` on an Endpoint it first sees Deprecated (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md); for a Service it also regenerates `src/handlers.generated.ts` and `src/readers.generated.ts` and writes the stub of every missing Handler (see [Stubs and the Handler map](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#stubs-and-the-handler-map) in the handlers README), while an Application or a Definitions Package gets `contract.snapshot.json` only. It fails on an Endpoint or attached Guard that no file under `src/contract/` exports and on a Handler file that no declared Endpoint or Guard names, and then writes nothing |
| `cf-loom broker-plan [--prefix <p>] [--json] [--limits-skeleton] [--orphans]` | Prints the streams, durable consumers, orphaned durable consumers and permissions the broker must hold; `--limits-skeleton` prints the `limits` for `apply` with every key empty, `--orphans` reads the broker and lists the orphaned durable consumers with their pending counts (see [The broker plan](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#the-broker-plan) in the messaging README) |
| `cf-loom route-plan [--json]` | Prints every route with its Visibility, and the Retired ones, for the organization's gateway or ingress |
| `cf-loom openapi` | Writes an OpenAPI 3.1 document of the Endpoints from the Snapshot (see [JSON Schema](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#json-schema) in SNAPSHOT.md) |
| `cf-loom asyncapi` | Writes an AsyncAPI document of the Events from the Snapshot (see [JSON Schema](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#json-schema) in SNAPSHOT.md) |
| `cf-loom verify` | Fails if `contract.snapshot.json`, `src/handlers.generated.ts` or `src/readers.generated.ts` was edited or is out of date, if a Handler file the Handler map imports is missing, or if a Handler file names no declared Endpoint or Guard; it writes nothing |
| `cf-loom package [--out <dir>]` | Validates the Contract as `generate` does and writes its Contract Package to `<dir>`, `contract-package/` next to `cf-loom.config.ts` by default, a Service's or an Application's (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md), ready for `tsc -p <dir>`; `publish` publishes the same package. The folder must be missing, empty, or a previous output, a package.json with `cfLoom`, which is replaced whole; anything else is refused and left as it was. A Definitions Package has no Contract Package: it is published from its own source |
| `cf-loom check [--json]` | Runs the Compatibility Check against the Baseline (see [Breaking Change Approval](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#breaking-change-approval) in COMPATIBILITY.md) |
| `cf-loom publish [--force]` | Builds the Contract, writes the Snapshot, derives the version and publishes the Contract Package (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md); `--force` publishes even when nothing changed (see [Versioning](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#versioning) in COMPATIBILITY.md) |

Exit status: 0, done; 1, the check failed (something not allowed, or a Breaking Change without a verified Approval); 2, the change needs a Breaking Change Approval and no Approval source is configured; 3, a tooling error (configuration, Contract directory, registry).

## What the commands print and write

Each command prints one line per thing it did or found, never a stack trace:

| Command | Prints |
| --- | --- |
| `generate` | `Wrote <path>` for each file it wrote, `contract.snapshot.json` first, then the Handler map, the readers and each new stub |
| `verify` | `<path> is up to date` for each file it compared |
| `package` | `Wrote <dir>` |

A failure is one line on stderr:

| Line | Command | Exit |
| --- | --- | --- |
| `endpoints.<name> is exported by no file under src/contract/` (`guards.<name>` for a Guard) | `generate` | 1 |
| `guards.<name> is not exported by <package>`, for a Guard of a Definitions Package | `generate` | 1 |
| `<path> names no declared Endpoint or Guard: delete it` | `generate`, `verify` | 1 |
| `<path> was edited or is out of date: run cf-loom generate` | `verify` | 1 |
| `<path> is missing: run cf-loom generate` | `verify` | 1 |
| `<dir> holds files package did not write: package writes to a missing or empty folder, or over its own output` | `package` | 3 |
| `A Definitions Package has no Contract Package: it is published from its own source` | `package` | 3 |
| `The recursion ids <id> and <id> are one name in code: rename one of them` | `package` | 3 |

Every file `generate` regenerates starts with `// Generated by cf-loom generate. Do not edit.`, and every TypeScript file of a Contract Package with `// Generated by cf-loom package. Do not edit.`; stubs carry no such line, since they are the Service's to replace. The Contract Package's package.json carries `cfLoom: { format, snapshotHash, kind, dependencies }` (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md), `snapshotHash` being the SHA-256 of the Snapshot's canonical text without `version` and `generator`, in lowercase hex (see [Canonical form](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#canonical-form) in SNAPSHOT.md).
