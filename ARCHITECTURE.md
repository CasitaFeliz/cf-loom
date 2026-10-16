# Architecture

How cf-loom's pieces fit. Terms are defined in [CONTEXT.md](CONTEXT.md); the rules for changing a Contract are in [COMPATIBILITY.md](COMPATIBILITY.md); how a Contract is written, the packages and the CLI are in [AUTHORING.md](AUTHORING.md).

## Tooling, not Contracts

- This repository holds tools only. It contains no Contract of any Service.
- The tools know no organization: package scope, registry and Approvers are configuration of whoever uses them.
- The tools and every Contract Package are published to an internal registry.

## Where Contracts live

- One Contract per package. Each Service and each Application keeps its Contract in its own package, next to its `cf-loom.config.ts`, and publishes it from there; that package may be a repository of its own (recommended) or one package of a monorepo.
- A Contract is published as exactly one Contract Package carrying its Public and Internal Elements and its Snapshot. Its Dependencies are data in the Snapshot, never imports: a Contract Package depends on no other Contract Package. Its code is generated from its Snapshot, with Definitions Packages' schemas written in, so it depends only on `zod` and `@cf-loom/contract`, as peers.
- The Snapshot also describes Private Elements, so they have a Baseline. Their shapes are therefore readable by anyone with access to the registry; only their code stays out of the package.
- Applications publish a Contract that holds only Dependencies, so every use of a Service's Elements is known.
- A Contract is plain source under `src/contract/` in its owner's repository. Its files import only each other, `zod`, `@cf-loom/contract`, Definitions Packages and the Contract Packages it depends on, so it builds and publishes on its own.

## Shapes, not behavior

- A Contract describes shapes and declarative constraints only: no defaults, transforms, refinements, coercion or custom validation. What happens when an optional input is missing, and any check beyond a declarative constraint, belongs to the Handler and is expressed as a Rejection.
- The tooling validates what is written before sending it (Success, Rejection bodies, Messages), and whoever reads a Success, a Rejection body or a Message ignores fields it does not know. Only the Service reading its Input enforces a strict object.
- Query and path params travel as text; the tooling converts them to their declared types.

## Runtime

- The HTTP core speaks the web-standard Request and Response; adapters connect it to a host (`node:http` first).
- Messaging runs behind a broker interface; adapters connect it to a broker (NATS JetStream first). A broker client is an optional peer dependency, installed only where its adapter is used.
- An EndpointHandler that is not implemented yet answers the not-implemented Standard Rejection, and a Message Handler that is not implemented yet is not consumed, so its Messages wait in the broker. A Contract can therefore be merged and published before its implementation.

## Visibility and Guards

- Visibility is network reach only. A Command is always Private; an Event is Internal or Private; an Endpoint may be Public, Internal or Private.
- A Private Endpoint is called only by the owning Service's own processes or its infrastructure (for example a health check).
- Private Elements have no Consumers: the owning Service is never a Consumer of its own Contract. The compatibility rules protect Private Elements for the Releases running side by side.
- Authorization belongs to Guards: a Public Endpoint may still require authentication.
- cf-loom derives which routes each Visibility allows (`cf-loom route-plan`) but does not enforce Visibility on the network: the organization applies the plan to its gateway, ingress or network rules, or Visibility on HTTP stays a declaration.

## Endpoints

- An Endpoint declares its literal path and everything it requires. Groups only organize; they add no prefix and no Guards.
- A Guard is attached explicitly, declared in the Contract or imported from a Definitions Package. Each Service writes its own GuardHandler, even for an imported Guard.
- An EndpointHandler receives the Caller's input and the Context its Guards provided, and answers an Outcome.

## Messages

- Delivery is at least once; a Command is handled by one CommandHandler, and every Handler must be safe to run again.
- Commands are internal to their Service: they are in the Contract only so the compatibility rules protect Releases running side by side.
- A Service handles its own Events through Subscriptions, like any Subscriber.
- Where a Message travels is derived from the Contract: one stream per Service, and one subject per Message Version made of the Service, the kind, the name and the version.
- cf-loom derives the broker's desired state (streams, consumers, orphans, permissions) but never applies it on its own: when and how it is applied, retention, replicas and broker permissions belong to the organization. Visibility is enforced at the broker only if the organization applies the derived permissions.
- **Deploy rule:** a Release that retires an Element is never deployed before the Release that deprecated it, nor before every Consumer has deployed the Release that dropped its Dependency on it. A Service retiring an Event it subscribes to itself keeps that Subscription until the retiring Release. The tools do not know when a Release is deployed; this is an operating rule until it is automated.

## Dependencies

- A Service or Application reaches another Service only through a Dependency, declared with the tools, which then enable the typed client or the EventHandler stub. Code cannot call what was not declared.
- A Service's Dependency targets only Public or Internal Elements; an Application's targets only Public Elements, since an Application runs outside the internal network.
- Published Dependencies form the dependency graph the Compatibility Check reads before an Element is retired or its Visibility narrowed: the highest published version of each live line of every Contract Package, Applications' included; a maintenance line ends when its `line-<major>` tag is removed. A Consumer whose deployed Release is older than its line's highest publish is covered by the deploy rule.
- npm-compatible registries have no standard way to list the packages in a scope, so the names come from a pluggable Contract directory that returns the complete list or fails, never a partial one. cf-loom ships directories for the registries that can list a scope authoritatively (npm organizations, GitHub, GitLab, CodeArtifact, Azure Artifacts, Artifactory, Nexus 3.88+), a git-repository index that `publish` writes to for any other registry, and a fixed list for tests. Versions and Snapshots always come from the standard package metadata.
- The directory fails closed: any error, paging limit or package whose Snapshot cannot be read fails the check, and `publish` fails if the package it just published is missing from the directory, read with the same credentials the check uses, which must be able to read the whole scope.
