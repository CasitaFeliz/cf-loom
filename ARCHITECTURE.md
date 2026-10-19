# Architecture

How cf-loom's pieces fit. Terms are defined in [CONTEXT.md](CONTEXT.md); the rules for changing a Contract are in [COMPATIBILITY.md](COMPATIBILITY.md); how each package is used is in its README, listed in [README.md](README.md#packages), and a package's internal details are in the `ARCHITECTURE.md` next to that README.

## Tooling, not Contracts

- This repository holds the tools, and in `examples/` fictional Services used as end-to-end tests. It contains no real Service's Contract.
- The tools know no organization: package scope, registry and Approvers are configuration of whoever uses them.
- The tools and every Contract Package are published to an internal registry.

## Packages

All packages are released together with one version. `zod` and `@casitafeliz/loom-contract` are peer dependencies of every cf-loom package and every Contract Package, and every cf-loom package a cf-loom package uses is a peer dependency of it, so each process has one copy of each. What each package provides is listed in [Packages](README.md#packages) in README.md.

## Package layout

Every package lays out its `src/` the same way:

- `src/` holds only entry files: the files the package's `exports` and `bin` point at in `dist/` (`index.ts` for `.`, `internal/index.ts` for `./internal`, one folder per subpath entry such as `node-http/index.ts`, and `bin.ts`), each named, never by a wildcard subpath, with its source file in `src/`, and beside each entry the tests that exercise it as a whole (`src/readme.test.ts`). An entry folder holds its `index.ts` and those tests only. **(check)**
- An entry file holds named re-exports only, `export { … } from` and `export type { … } from`, or the empty `export {}` of a package not yet written (Biome's `noReExportAll` refuses `export *`), so an entry cannot grow logic; `bin.ts`, a CLI entry that calls the package's API, is the exception. **(check)**
- Every other file sits in a module folder named for its one responsibility, with an `index.ts` as the module's only seam; modules import each other only through it. **(check)**
- Modules form one direction of dependencies, listed in the package's own ARCHITECTURE.md; no cycles.
- No grab-bag folders (`utils`, `common`, `shared`, `helpers`; see C14 in [CODING_STANDARDS.md](CODING_STANDARDS.md)); a piece several modules need lives in the lowest module that owns its concept. **(check)**
- Modules are one level deep: a module that grows splits into sibling modules, not sub-folders. **(check)**
- Tests sit next to the file they test and import as [C23](CODING_STANDARDS.md#tests) says.

`scripts/check-layout.ts`, run by `pnpm check` and CI, enforces the rules marked (check); the direction of dependencies stays a review rule.

## Where Contracts live

- One Contract per package. Each Service and each Application keeps its Contract as plain source under `src/contract/` of its own package, whose root holds `cf-loom.config.ts`, and publishes it from there; that package may be a repository of its own (recommended) or one package of a monorepo. The Contract's files import only each other, `zod`, `@casitafeliz/loom-contract`, Definitions Packages and the Contract Packages it depends on, so it builds and publishes on its own. The CLI loads them and `cf-loom.config.ts` with Node's own type stripping and no loader, so they are erasable TypeScript whose relative imports name the `.ts` file (`./get-order.endpoint.ts`), in a package whose package.json has `"type": "module"`.
- A Contract is published as exactly one Contract Package carrying its Public and Internal Elements and its Snapshot. Its Dependencies are data in the Snapshot, never imports: a Contract Package depends on no other Contract Package. Its code is generated from its Snapshot, with Definitions Packages' schemas written in, so it depends only on `zod` and `@casitafeliz/loom-contract`, as peers.
- The Snapshot also describes Private Elements, so they have a Baseline. Their shapes are readable by anyone with access to the registry; only their code stays out of the package.
- Applications publish a Contract that holds only Dependencies, so every use of a Service's Elements is known (see [Applications](packages/contract/README.md#applications) in the contract README).

## The Contract Package

`cf-loom package` generates the Contract Package's code from the committed declared Snapshot, and `cf-loom publish` generates it the same way, from the Snapshot with its `version` and history filled in (see [Where it lives](SNAPSHOT.md#where-it-lives) in SNAPSHOT.md), and publishes it; no source file is bundled. It writes the zod schemas, the entry point and the package.json for the Public and Internal Elements that are not Retired, with the Guards, Rejections and recursive schemas they reach, plus the Snapshot itself. What is published is exactly what the Snapshot describes, and no Private code can leak into it:

```ts
// generated entry point of @org/contract-payments-service
import * as loom from '@casitafeliz/loom-contract';

export const contract = {
  name: 'payments-service',
  version: '5.1.0',                                  // stamped by publish
  endpoints: {                                       // keyed by Endpoint name
    createPayment: createPaymentEndpoint,
    getPayment: getPaymentEndpoint,
  },
  events: {                                          // name with its first letter lower-cased + 'V' + version
    paymentSettledV1: paymentSettledEventV1,
    paymentSettledV2: paymentSettledEventV2,
  },
  standardRejections,                                // resolved codes, statuses and messages
} satisfies loom.ContractPackage;
export { snapshot };
```

A Consumer imports `contract` under the Provider's name (`import { contract as payments } from '@org/contract-payments-service'`), and a Dependency declared on it records its `version` (see [Dependencies](packages/contract/README.md#dependencies) in the contract README). Private Elements, Commands, Subscriptions and Dependencies are never exported. Schemas from Definitions Packages are written into the generated code and Dependencies are data in the Snapshot, so the package.json declares only `@casitafeliz/loom-contract` and `zod`, as peers with a caret range on the versions it was built with, and carries the `cfLoom` metadata (see [Where it lives](SNAPSHOT.md#where-it-lives) in SNAPSHOT.md). How a peer's range moves the Contract Package's version is in [Versioning](COMPATIBILITY.md#versioning). The Service itself installs the Contract Packages it depends on as ordinary dependencies, since its client and Subscriptions use them.

The package is TypeScript built with `tsc` alone, since Node strips no types under `node_modules`: `package.json`, `snapshot.json`, a `tsconfig.json` with no Node or DOM types, since Applications import it in browsers, and under `src/` the entry `index.ts`, `snapshot.ts`, `standard-rejections.ts`, one file per exported Endpoint under `endpoints/`, per Guard they attach under `guards/` and per code they answer under `rejections/`, the Standard ones excepted, and `defs.ts` when a schema reaches a recursive def. An Application's package exports its Snapshot only, as `snapshot`. Its files are a function of the canonical Snapshot alone: every map is written in code point order. Each generated declaration is named for its kind, as [Modules](packages/cli/ARCHITECTURE.md#modules) in the CLI's ARCHITECTURE.md says, so no two generated names and no imported name meet; the entry re-exports the types of the recursive defs it reaches.

Each exported Endpoint is rebuilt from its Snapshot entry with `defineEndpoint`, so `InputOf`, `SuccessOf` and `RejectionsOf` give a Consumer the Provider's types: its `input` as declared, the Guards' demands merged as the Snapshot records them, which is what the Service reads; its `success` headers and body and its Rejections' bodies as Reader schemas, since the Consumer reads them; its Guards attached with their Qualifiers; and its own Rejections, the resolved codes but its Guards' and the two cf-loom's runtime adds, `notFound` as the Standard Rejection. Its Guards are rebuilt as declared, with their demands, Context, Qualifier schema and Rejections.

Reader schemas and types always come from a Snapshot, the same way for every Visibility, never from a type-level walk of the zod schema: a Contract Package's from its published Snapshot, for Dependencies; a Service's own Events' from its declared Snapshot, written by `generate` to `readers.generated.ts`. Every object in them is open and every Open Enum and Open Union has its Unknown case, an unknown variant carrying `raw`, the object as received; their constraints and formats stay, so a value that breaks one is refused. Their types are zod's output types of the generated schemas, written out only for a recursive def, so a type and its schema never disagree. The client's validation of what it receives (see [Consuming a Contract](packages/client/README.md#consuming-a-contract) in the client README), the Message Handlers (see [Message Handlers](packages/messaging/README.md#message-handlers)) and the fakes of `@casitafeliz/loom-testing` (see [Faking Providers](packages/testing/README.md#faking-providers)) all use these generated readers.

## Shapes, not behavior

- A Contract describes shapes and declarative constraints only: no defaults, transforms, refinements, coercion or custom validation (see [Not allowed in a Contract](COMPATIBILITY.md#not-allowed-in-a-contract)). What happens when an optional input is missing, and any check beyond a declarative constraint, belongs to the Handler and is expressed as a Rejection.
- The tooling validates what is written before sending it (Success, Rejection bodies, Messages) and sends the parsed value, unknown keys stripped, so nothing carries an undeclared field; whoever reads a Success, a Rejection body or a Message validates it with a Reader schema generated from the Snapshot, which ignores fields it does not know (see [The Contract Package](#the-contract-package)). Objects are open: a Contract declares no strict object, and a record keyed by an enum or literal, which refuses other keys, stays out of every Read shape and of query and headers (see [Not allowed](SNAPSHOT.md#not-allowed) in SNAPSHOT.md). Open means an undeclared field is not refused, never that it is passed on: the Service reads its Input parsed, unknown keys stripped, as every reader does.
- Bodies are JSON. Binary bodies and streaming are not part of a Contract: an upload or a download goes through a pattern of the organization, such as signed URLs, or through a route outside the Contract (see [Endpoints](#endpoints)).

## Runtime

- The HTTP core speaks the web-standard Request and Response, so it also runs on Bun, Deno or inside another framework; an adapter connects it to a host, and cf-loom ships one for `node:http` (see [node-http](packages/server/README.md#node-http)).
- Messaging runs behind a broker interface; an adapter connects it to a broker, and cf-loom ships one for NATS JetStream and an in-memory one for tests and local development (see [Adapters](packages/messaging/README.md#adapters)). A broker client is an optional peer dependency, installed only where its adapter is used.
- Testing support stays within what follows from Contracts: a Service's own code is tested through the exported functions of `@casitafeliz/loom-handlers`, and `@casitafeliz/loom-testing` fakes only other Services, checked against their Snapshots. Test runners, end-to-end tools and real-broker tests belong to the organization (see [Testing a Service's own code](packages/handlers/README.md#testing-a-services-own-code) and the [`@casitafeliz/loom-testing` README](packages/testing/README.md)).
- A Contract can be merged and deployed before its Handlers are implemented, with stubs, and is published with that Release (see [The Compatibility Check](COMPATIBILITY.md#the-compatibility-check) in COMPATIBILITY.md); how a stub behaves is in [Stubs and the Handler map](packages/handlers/README.md#stubs-and-the-handler-map) in the handlers' README.
- Without an `onServiceFault` (see [Serving](packages/server/README.md#serving) in the server README and [Connecting](packages/messaging/README.md#connecting) in the messaging README), `serve` and `messaging` write everything `onServiceFault` would receive to the console: an Issue as its part, path and code, never the received value, and a Fault as its message and `cause` (the line `serve` writes is in [Serving](packages/server/README.md#serving) in the server README).

## Visibility and Guards

- Visibility is network reach only. A Command is always Private; an Event is Internal or Private; an Endpoint may be Public, Internal or Private.
- A Private Endpoint is called only by the owning Service's own processes or its infrastructure (for example a health check).
- Private Elements have no Consumers: the owning Service is never a Consumer of its own Contract. The compatibility rules protect Private Elements for the Releases running side by side.
- Authentication and authorization belong to Guards: a Public Endpoint may still require authentication.
- cf-loom derives which routes each Visibility allows (`cf-loom route-plan`) but does not enforce Visibility on the network: the organization applies the plan to its gateway, ingress or network rules, or Visibility on HTTP stays a declaration.

## Endpoints

- An Endpoint declares its literal path and everything it requires. Groups only organize; they add no prefix and no Guards.
- When two Endpoints with the same method match one URL, routing precedence decides (see [Over HTTP](#over-http)).
- A Guard is attached explicitly, declared in the Contract or imported from a Definitions Package. A Guard may build on the Guards it lists and take a Qualifier from each Endpoint (see [Guards](packages/contract/README.md#guards) in the contract README). Each Service writes its own GuardHandler, even for an imported Guard.
- An EndpointHandler receives the Caller's Input and the Context its Guards provided, and answers an Outcome.
- A Service may serve routes outside its Contract. cf-loom does not see them: the Compatibility Check, shadowing included, covers only declared Endpoints, so a new Endpoint that takes a URL an outside route served is the organization's to catch. Whatever splits requests between them, the host framework or a gateway, must send every declared Endpoint, Retired ones included, to cf-loom; how `serve` hands back a request that is not its own belongs to each framework adapter.

## Messages

- Delivery is at least once and in no guaranteed order: once concurrency or redelivery is involved, nothing orders Messages across subjects or within one (the in-memory adapter is sequential: see [In memory](packages/messaging/README.md#in-memory) in the messaging README). A Command is handled by one CommandHandler, and every Handler must be safe to run again.
- Commands are internal to their Service: they are in the Contract only so the compatibility rules protect Releases running side by side.
- A Service handles its own Events through Subscriptions, like any Subscriber.
- Where a Message travels is derived from the Contract (see [Over the broker](#over-the-broker)).
- cf-loom derives the broker's desired state (streams, durable consumers, orphans, permissions) but never applies it on its own: when and how it is applied, retention, replicas and broker permissions belong to the organization (see [The broker plan](packages/messaging/README.md#the-broker-plan) in the messaging README). Visibility is enforced at the broker only if the organization applies the derived permissions.
- **Deploy rule:** a Release that retires an Element is never deployed before the Release that deprecated it, nor before every Consumer has deployed the Release that dropped its Dependency on it; and a Release that retires a Command Version is deployed only once that version's queue has been drained by the Release that deprecated it (see [Pruning](packages/messaging/README.md#pruning) in the messaging README). The tools do not know when a Release is deployed; this is an operating rule.

## Dependencies

- A Service or Application reaches a Provider only through a Dependency, declared with the tools, which then enable the typed client or the EventHandler stub. Code cannot call what was not declared.
- A Service's Dependency targets only Public or Internal Elements; an Application's targets only Public Elements, since an Application runs outside the internal network.
- Published Dependencies form the dependency graph the Compatibility Check reads before an Element is retired or its Visibility narrowed: for every Contract Package, Applications' included, the highest published version of each major (see [The Baseline](COMPATIBILITY.md#the-baseline) in COMPATIBILITY.md), unless that version is deprecated in the registry. An organization ends an old major by deprecating it (`npm deprecate @org/contract-web-admin@2 "…"`); until then its Dependencies count, and the check's error names the package and the major that block the retirement. A Consumer whose deployed Release is older than its highest publish is covered by the deploy rule. How the graph is read is in [Reading the graph](packages/cli/ARCHITECTURE.md#reading-the-graph) in the CLI's ARCHITECTURE.md.

## Wire protocol

How an Endpoint's Input and Outcome travel over HTTP, between `serve` and the client, and how a Message travels through the broker.

### Over HTTP

- Bodies are JSON, sent as `content-type: application/json; charset=utf-8`, and what is sent is the parsed value, unknown keys stripped (see [Shapes, not behavior](#shapes-not-behavior)). A malformed body or a wrong content type is the invalid-input Rejection, with the `malformed` issue code: a content type is right when its media type is `application/json`, whatever its parameters, and a body that is empty, no UTF-8 or no JSON, or whose stream fails while it is read, is malformed. A malformed body is answered alone, since the Input cannot be read.
- Path params, query params and headers, a Success's included, travel as text and are converted to their declared types: a number matches `^-?(0|[1-9]\d*)(\.\d+)?$`, a boolean is exactly `true` or `false`. A list query param is a repeated key (`?id=a&id=b`), and one occurrence is a one-item list; a repeated single-value key is handed to its schema as the list of its values, which refuses it as invalid input. A header given several times arrives as one comma-joined value (RFC 9110, section 5.3) and is converted as one text. A `+` in a query string is a space. A path param that fails its schema is invalid input, never the not-found Rejection. Headers of an HTTP response that the Endpoint does not declare pass through unread on both sides. A header value travels only as RFC 9110 field text, with no whitespace leading or trailing; a Success header that cannot is `INVALID_OUTCOME` (see [Validation](packages/server/ARCHITECTURE.md#validation) in the server's ARCHITECTURE.md).
- The request path is the URL's path as the [WHATWG URL Standard](https://url.spec.whatwg.org/) resolves it, the same on every host: dot segments, `%2e` included, are removed and `\` reads as `/`, so a path param's text is never `.` or `..`.
- Each path segment is percent-decoded on its own, so a decoded value never spans segments: `/orders/a%2Fb` is one param, `a/b`; a segment that is not valid percent-encoding is kept as sent. There is no trailing-slash or case folding, and an empty segment matches neither a literal nor a param, so `/orders/` and `//orders` match nothing; a request path matches a declared path exactly (see [Identities](SNAPSHOT.md#identities) in SNAPSHOT.md).
- Routing compares segment by segment, left to right: a literal beats a param at the first segment where they differ.
- An undeclared method or path is `NO_SUCH_ENDPOINT`. `HEAD`, `OPTIONS` and CORS preflight are not answered by cf-loom unless declared; the host, its adapter or the organization's gateway handles them.

A Rejection travels with its declared status and its Envelope, `{ rejection: { code, message, body } }`; a Rejection that declares no body has no `body` key. Rejection codes are open for Callers.

A Fault travels with its Envelope, `{ fault: { committed, retryable, message } }`, where `committed` is `'no'`, `'yes'` (done, but the Success was lost) or `'unknown'` (see [Fault](CONTEXT.md#language) in CONTEXT.md). `serve` answers it with 503 when it is retryable and 500 otherwise. The reserved codes (see [Rejections](COMPATIBILITY.md#rejections) in COMPATIBILITY.md) use the same body with a `code`, `{ fault: { code, committed, retryable: false, message } }`, which the client's Fault Outcome exposes:

| Code | Status | `committed` | Answered when |
| --- | --- | --- | --- |
| `RETIRED` | 410 | `'no'` | The Endpoint is Retired and still declared (see [Lifecycle](packages/contract/README.md#lifecycle) in the contract README) |
| `NO_SUCH_ENDPOINT` | 404 | `'no'` | No declared Endpoint has that method and path |
| `BODY_TOO_LARGE` | 413 | `'no'` | The body exceeds `maxBodyBytes` (see [Serving](packages/server/README.md#serving) in the server README) |
| `INVALID_OUTCOME` | 500 | `'unknown'` | The Handler's Outcome broke a constraint (see [Validation](packages/server/ARCHITECTURE.md#validation) in the server's ARCHITECTURE.md). The client produces the same code, and no HTTP status of its own, when a Success or Rejection body fails its Reader schema; its `committed` depends on which (see [Consuming a Contract](packages/client/README.md#consuming-a-contract) in the client README) |

A response with the declared Success status is decoded as the Success; a response whose body is a `{ rejection }` or `{ fault }` Envelope is decoded as such; anything else, or no response at all, becomes a Fault the client infers from what happened. `client(deps, { inferFault })` replaces this inference (see [Consuming a Contract](packages/client/README.md#consuming-a-contract) in the client README):

| What happened | Fault |
| --- | --- |
| No connection: a DNS failure or a refused connection (Node's `cause.code` `ENOTFOUND`, `ECONNREFUSED`), an abort before the request was sent, or 429 | `committed: 'no'`, `retryable: true` |
| A timeout, a reset or abort after the request was sent, or 503 | `committed: 'unknown'`, `retryable: true` |
| Any other network failure of `fetch`, or any other status (500, 502, 504…) | `committed: 'unknown'`, `retryable: false` |

### Over the broker

Where a Message travels follows from the Contract, so a Subscriber finds another Service's Events from its Contract Package alone: each Service owns one stream named after it, and each Message Version has the subject `<service>.<event|command>.<Name>.v<version>` (`orders-service.event.OrderCreated.v2`). An optional prefix, passed to the adapter at runtime and to `cf-loom broker-plan --prefix`, goes in front of every subject, stream and durable consumer name (`staging.orders-service.event.OrderCreated.v2`, `staging_orders-service`), so several environments can share one broker.

On the wire a Message's body is the UTF-8 JSON of the Message body alone; the Message Version is in the subject, two headers carry the ids, `Nats-Msg-Id`, the broker message id, and `Cf-Loom-Fact-Id`, and the transport headers travel as the broker headers they were given (see [Publishing and sending](packages/messaging/README.md#publishing-and-sending) in the messaging README).
