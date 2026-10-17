# Architecture

How cf-loom's pieces fit. Terms are defined in [CONTEXT.md](CONTEXT.md); the rules for changing a Contract are in [COMPATIBILITY.md](COMPATIBILITY.md); how a Contract is written, the packages and the CLI are in [AUTHORING.md](AUTHORING.md).

## Tooling, not Contracts

- This repository holds tools only. It contains no Contract of any Service.
- The tools know no organization: package scope, registry and Approvers are configuration of whoever uses them.
- The tools and every Contract Package are published to an internal registry.

## Where Contracts live

- One Contract per package. Each Service and each Application keeps its Contract as plain source under `src/contract/` of its own package, whose root holds `cf-loom.config.ts`, and publishes it from there; that package may be a repository of its own (recommended) or one package of a monorepo. The Contract's files import only each other, `zod`, `@cf-loom/contract`, Definitions Packages and the Contract Packages it depends on, so it builds and publishes on its own.
- A Contract is published as exactly one Contract Package carrying its Public and Internal Elements and its Snapshot. Its Dependencies are data in the Snapshot, never imports: a Contract Package depends on no other Contract Package. Its code is generated from its Snapshot, with Definitions Packages' schemas written in, so it depends only on `zod` and `@cf-loom/contract`, as peers.
- The Snapshot also describes Private Elements, so they have a Baseline. Their shapes are readable by anyone with access to the registry; only their code stays out of the package.
- Applications publish a Contract that holds only Dependencies, so every use of a Service's Elements is known.

## Shapes, not behavior

- A Contract describes shapes and declarative constraints only: no defaults, transforms, refinements, coercion or custom validation (see [Not allowed in a Contract](COMPATIBILITY.md#not-allowed-in-a-contract)). What happens when an optional input is missing, and any check beyond a declarative constraint, belongs to the Handler and is expressed as a Rejection.
- The tooling validates what is written before sending it (Success, Rejection bodies, Messages) and sends the parsed value, unknown keys stripped, so nothing carries an undeclared field; whoever reads a Success, a Rejection body or a Message validates it with a reader schema generated from the Snapshot, which ignores fields it does not know (see [The Contract Package](AUTHORING.md#the-contract-package) in AUTHORING.md). Only the Service reading its Input enforces a strict object.
- Bodies are JSON. Binary bodies and streaming are not part of a Contract: an upload or a download goes through a pattern of the organization, such as signed URLs, or through a route outside the Contract (see [Endpoints](#endpoints)).
- Path params, query params and headers travel as text; how they are converted to their declared types is in [Wire protocol](AUTHORING.md#wire-protocol) in AUTHORING.md.

## Runtime

- The HTTP core speaks the web-standard Request and Response, so it also runs on Bun, Deno or inside another framework; an adapter connects it to a host, and cf-loom ships one for `node:http`.
- Messaging runs behind a broker interface; an adapter connects it to a broker, and cf-loom ships one for NATS JetStream and an in-memory one for tests and local development. A broker client is an optional peer dependency, installed only where its adapter is used.
- Testing support stays within what follows from Contracts: a Service's own code is tested through the exported functions of `@cf-loom/handlers`, and `@cf-loom/testing` fakes only other Services, checked against their Snapshots. Test runners, end-to-end tools and real-broker tests belong to the organization (see [Testing](AUTHORING.md#testing)).
- A Contract can be merged and deployed before its Handlers are implemented, with stubs, and is published with that Release (see [The Compatibility Check](COMPATIBILITY.md#the-compatibility-check) in COMPATIBILITY.md); how a stub behaves is in [Implementing a Contract](AUTHORING.md#implementing-a-contract) in AUTHORING.md.

## Visibility and Guards

- Visibility is network reach only. A Command is always Private; an Event is Internal or Private; an Endpoint may be Public, Internal or Private.
- A Private Endpoint is called only by the owning Service's own processes or its infrastructure (for example a health check).
- Private Elements have no Consumers: the owning Service is never a Consumer of its own Contract. The compatibility rules protect Private Elements for the Releases running side by side.
- Authentication and authorization belong to Guards: a Public Endpoint may still require authentication.
- cf-loom derives which routes each Visibility allows (`cf-loom route-plan`) but does not enforce Visibility on the network: the organization applies the plan to its gateway, ingress or network rules, or Visibility on HTTP stays a declaration.

## Endpoints

- An Endpoint declares its literal path and everything it requires. Groups only organize; they add no prefix and no Guards.
- When two Endpoints with the same method match one URL, routing precedence decides (see [Wire protocol](AUTHORING.md#wire-protocol) in AUTHORING.md).
- A Guard is attached explicitly, declared in the Contract or imported from a Definitions Package. Each Service writes its own GuardHandler, even for an imported Guard.
- An EndpointHandler receives the Caller's Input and the Context its Guards provided, and answers an Outcome.
- A Service may serve routes outside its Contract. cf-loom does not see them: the Compatibility Check, shadowing included, covers only declared Endpoints, so a new Endpoint that takes a URL an outside route served is the organization's to catch. Whatever splits requests between them, the host framework or a gateway, must send every declared Endpoint, Retired ones included, to cf-loom; how `serve` hands back a request that is not its own belongs to each framework adapter.

## Messages

- Delivery is at least once and in no guaranteed order: once concurrency or redelivery is involved, nothing orders Messages across subjects or within one (the in-memory adapter is sequential: see [Messages](AUTHORING.md#messages) in AUTHORING.md). A Command is handled by one CommandHandler, and every Handler must be safe to run again.
- Commands are internal to their Service: they are in the Contract only so the compatibility rules protect Releases running side by side.
- A Service handles its own Events through Subscriptions, like any Subscriber.
- Where a Message travels is derived from the Contract: one stream per Service, and one subject per Message Version made of the Service, the kind, the name and the version (see [The broker](AUTHORING.md#the-broker) in AUTHORING.md).
- cf-loom derives the broker's desired state (streams, consumers, orphans, permissions) but never applies it on its own: when and how it is applied, retention, replicas and broker permissions belong to the organization. Visibility is enforced at the broker only if the organization applies the derived permissions.
- **Deploy rule:** a Release that retires an Element is never deployed before the Release that deprecated it, nor before every Consumer has deployed the Release that dropped its Dependency on it; and a Command Version's queue is drained before the Release that retired it is pruned from the broker (see [The broker](AUTHORING.md#the-broker) in AUTHORING.md). The tools do not know when a Release is deployed; this is an operating rule.

## Dependencies

- A Service or Application reaches a Provider only through a Dependency, declared with the tools, which then enable the typed client or the EventHandler stub. Code cannot call what was not declared.
- A Service's Dependency targets only Public or Internal Elements; an Application's targets only Public Elements, since an Application runs outside the internal network.
- Published Dependencies form the dependency graph the Compatibility Check reads before an Element is retired or its Visibility narrowed: for every Contract Package, Applications' included, the highest version of each major, unless that version is deprecated in the registry. An organization ends an old major by deprecating it (`npm deprecate @org/contract-web-admin@2 "…"`); until then its Dependencies count, and the check's error names the package and the major that block the retirement. A Consumer whose deployed Release is older than its highest publish is covered by the deploy rule. The graph is read from each package's `cfLoom` metadata in the registry (see [Where it lives](SNAPSHOT.md#where-it-lives) in SNAPSHOT.md); only the Baseline's `snapshot.json` is downloaded.
- npm-compatible registries have no standard way to list the packages in a scope, so the names come from a pluggable Contract directory that returns the complete list or fails, never a partial one. cf-loom ships directories for the registries that can list a scope authoritatively (npm organizations, GitHub, GitLab, CodeArtifact, Azure Artifacts, Artifactory, Nexus 3.88+), a git-repository directory that `publish` writes to for any other registry, and a fixed list for tests. Versions and metadata always come from the standard package metadata.
- The directory fails closed: any error, paging limit or listed package whose metadata cannot be read fails the check. `publish` records the package in the directory before publishing to the registry (the git-repository directory writes and pushes), then re-reads the directory and fails if the package is missing from it; the no-op path of `publish` verifies membership too. The directory is read with the same credentials the check uses, which must be able to read the whole scope.
