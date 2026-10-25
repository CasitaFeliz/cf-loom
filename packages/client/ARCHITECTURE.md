# Internals of @cf-loom/client

How a call (see [README.md](README.md)) is sent and its response decoded, and how the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires. How an Outcome travels over HTTP, the decoding order and the inference table included, is in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md.

The package builds with `lib: ["ES2024", "DOM"]` and `types: []`, so nothing in it can lean on Node: Applications run it in browsers. Its tests also run it against `serve` and `node:http`, so `@cf-loom/server` and `@cf-loom/handlers` are devDependencies, referenced by `tsconfig.test.json` only.

## Modules

The entry `src/index.ts` (`.`) re-exports from `calling/`, `decoding/` and `inference/`, and `src/internal/index.ts` (`./internal`) what `@cf-loom/testing` builds its fake and its client with: the types `AnyDependency`, from `endpoints/`, `ConfiguredName`, from `calling/`, and `EndpointSuccess` and `EndpointRejection`, the Success and the Rejections of one Endpoint, from `decoding/`, `baseUrlOf` and `basePathOf`, the base URL checked once and the path every Endpoint is called under, from `request/`, and `networkFailureOf`, what `fetch` throws for a refused or a lost connection, from `inference/`.

| Module | Holds | Depends on |
| --- | --- | --- |
| `endpoints/` | each listed Endpoint as the client calls it, prepared once: its entry in the Provider's exported Snapshot, found by identity, for the header names its Input declares and its Success headers' nodes, and its Rejections by resolved code; what any Dependency gives the client, and the Endpoints it lists, `ListedEndpoints`, none for a Dependency written without the list, and their by-name view, `ListedName` and `ListedEndpoint`, which name the client's methods and `fakeProvider`'s scripts | none |
| `request/` | the `baseUrl` checked once, an http or https URL; a call's Input read by the contract's reading as the Provider reads the request it would send, every Guard admitting and its demands kept, and a body left out sent with no content type; then its text, that it can travel, the demands' with the Input's; the Request it is sent as, which never follows a redirect | none |
| `inference/` | `Happened`, what the call met instead of an Outcome, told from what was thrown or the signal, and a refused or lost connection as `fetch` throws it, by the code it is told from; the inference of each, the organization's `inferFault`, the fixed messages, and `Retry-After` | none |
| `decoding/` | the Outcome types, decoded and as each Endpoint types them; a response decoded in order: the Success with its headers and body read by their Reader schemas, unless its body is no JSON and the inferred status Fault answers instead, else an Envelope, else the inferred Fault; a Rejection by code, known or `unknown-rejection`, its body read or none; the client's own `INVALID_OUTCOME` | `endpoints`, `inference` |
| `calling/` | `client()` and its types, the Provider's exported Snapshot refused, before any Endpoint's entry is read, in a format the client does not read; one call top to bottom; the headers given to `client()`; the Deprecation told once per method | `endpoints`, `request`, `inference`, `decoding` |

The wire rules the client shares with `serve` and `@cf-loom/testing` live in `@cf-loom/contract`'s `wire/`: a value as text and text as a value, which text can travel as a header, a path segment or a query value, reading a received body whole and recognizing an Envelope in it, the reserved codes with their texts, the invalid-input Rejection from Issues, the schema a Rejection's body is read with, the Provider's Reader for invalid input, and the `Deprecation` header both ways. Which Rejections an Endpoint answers, by the code each resolves to, its entry in the exported Snapshot, the check that refuses one in a format the client does not read, and the reading of a request are in the contract's `./internal` too.

## A call

1. A signal already aborted returns its Fault, `committed: 'no'`, and nothing is sent.
2. The headers given to `client()` that the Endpoint declares and the call did not pass are added, a function among them called now.
3. The Input is read as the Provider reads the request it would send, every Guard admitting it and a declared body left out sent with no content type, and its text checked that it can travel; what fails returns the Provider's invalid-input Rejection, marked `source: 'client'`, its body read with the Provider's Reader as a received one is, and nothing is sent. A signal aborted meanwhile returns its Fault, `committed: 'no'`.
4. `fetch` is called with the Request. What it throws is inferred as a Fault, or reaches the Caller unchanged when it is no network failure, abort or timeout.
5. The response is decoded, then its `Deprecation` is told the first time a method sees it; what `onDeprecation` throws goes to the console.

Each method returns its decoded Outcome typed by its Endpoint: the decoding is one function for every Endpoint, and each typed Outcome is its decoded form narrowed, so the methods are cast to `Client` once, in `client()`.
