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

npm-compatible registries have no standard way to list the packages in a scope, so the names come from a pluggable Contract directory that returns the complete list or fails, never a partial one. A Contract directory implements `ContractDirectory = { list(scope: string): Promise<{ kind: 'listed', packages: string[] } | { kind: 'failed', message: string }> }`, a type of `@casitafeliz/loom-cli/directories`. `@casitafeliz/loom-cli/directories` ships directories for the registries that can list a scope authoritatively (npm organizations, GitHub, GitLab, CodeArtifact, Azure Artifacts, Artifactory, Nexus 3.88+), a git-repository directory that `publish` writes to for any other registry (see [Publishing to the directory](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/ARCHITECTURE.md#publishing-to-the-directory)), and a fixed list for tests. Versions and metadata always come from the standard package metadata. The directory fails closed: any error, paging limit or listed package whose metadata cannot be read fails the check. The directory is read with the same credentials the check uses, which must be able to read the whole scope.

A Contract Package is named `<scope>/contract-<name>`, and a Definitions Package `<scope>/<name>`.

## Commands

| Command | Does |
| --- | --- |
| `cf-loom init [service \| application \| definitions]` | Creates the root under `src/contract/` (or `src/definitions/`), exporting `contract`, `application` or `definitions`, and `cf-loom.config.ts` with the scope of package.json's name when there is none; it never overwrites a file |
| `cf-loom add-endpoint <group> <name> <METHOD> <path> --visibility <v>` | Creates the Endpoint, its Group if new, and registers both |
| `cf-loom add-guard <name>` | Creates a Guard |
| `cf-loom add-rejection <CODE> --status <n>` | Creates a Rejection |
| `cf-loom add-event <Name> --visibility <v> [--version n]` | Creates an Event, or its next Message Version |
| `cf-loom add-command <Name> [--version n]` | Creates a Command, or its next Message Version |
| `cf-loom add-subscription <name> [<service>] <Name>@<n>` | Creates a Subscription to an Event, the Service's own unless `<service>` is given, in which case the Event is also added to the Dependencies |
| `cf-loom add-dependency <service> <element>` | Adds an Element of an installed Contract Package to the Dependencies: an Endpoint by name, an Event as `<Name>@<n>` |
| `cf-loom generate` | Writes the stub of every missing Handler, regenerates `handlers.generated.ts` and `readers.generated.ts` (see [Stubs and the handler map](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#stubs-and-the-handler-map) in the handlers README), and writes `contract.snapshot.json`, stamping `deprecatedAt` on an Endpoint it first sees Deprecated (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md) |
| `cf-loom broker-plan [--prefix <p>] [--json] [--limits-skeleton] [--orphans]` | Prints the streams, durable consumers, orphaned durable consumers and permissions the broker must hold; `--limits-skeleton` prints the `limits` for `apply` with every key empty, `--orphans` reads the broker and lists the orphaned durable consumers with their pending counts (see [The broker plan](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#the-broker-plan) in the messaging README) |
| `cf-loom route-plan [--json]` | Prints every route with its Visibility, and the Retired ones, for the organization's gateway or ingress |
| `cf-loom openapi` | Writes an OpenAPI 3.1 document of the Endpoints from the Snapshot (see [JSON Schema](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#json-schema) in SNAPSHOT.md) |
| `cf-loom asyncapi` | Writes an AsyncAPI document of the Events from the Snapshot (see [JSON Schema](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#json-schema) in SNAPSHOT.md) |
| `cf-loom verify` | Fails if a generated file was edited or is out of date |
| `cf-loom check [--json]` | Runs the Compatibility Check against the Baseline (see [Breaking Change Approval](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#breaking-change-approval) in COMPATIBILITY.md) |
| `cf-loom publish [--force]` | Builds the Contract, writes the Snapshot, derives the version and publishes the Contract Package (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md); `--force` publishes even when nothing changed (see [Versioning](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#versioning) in COMPATIBILITY.md) |

Exit status: 0, done; 1, the check failed (something not allowed, or a Breaking Change without a verified Approval); 2, the change needs a Breaking Change Approval and no Approval source is configured; 3, a tooling error (configuration, Contract directory, registry).
