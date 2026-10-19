# Internals of @casitafeliz/loom-client

How a call (see [README.md](README.md)) is sent and its response decoded, and how the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires. How an Outcome travels over HTTP, the decoding order and the inference table included, is in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md.

The package builds with `lib: ["ES2024", "DOM"]` and `types: []`, so nothing in it can lean on Node: Applications run it in browsers. Its tests also run it against `serve` and `node:http`, so `@casitafeliz/loom-server` and `@casitafeliz/loom-handlers` are devDependencies, referenced by `tsconfig.test.json` only.

## Modules

The entry `src/index.ts` (`.`) re-exports from `calling/` and `inference/`.

| Module | Holds | Depends on |
| --- | --- | --- |
| `endpoints/` | each listed Endpoint as the client calls it, prepared once: its entry in the Provider's exported Snapshot, found by identity, for the header names its Input declares and its Success headers' nodes, and its Rejections by resolved code | none |
| `request/` | the `baseUrl` checked once; a call's Input parsed part by part as the Provider will parse it, and checked that its text can travel; the URL and the `RequestInit` it is sent with | none |
| `inference/` | `Happened`, the Fault inferred from what `fetch` threw or a response that carried no Outcome, the organization's `inferFault`, the fixed messages, and `Retry-After` | none |
| `decoding/` | a response decoded in order: the Success with its headers and body read by their Reader schemas, else an Envelope, else the inferred Fault; a Rejection known by code, its body read or dropped; the client's own `INVALID_OUTCOME` | `endpoints`, `inference` |
| `calling/` | `client()` and its types; one call top to bottom; the headers given to `client()`; the Deprecation told once per method | `endpoints`, `request`, `inference`, `decoding` |

The wire rules the client shares with `serve` and `@casitafeliz/loom-testing` live in `@casitafeliz/loom-contract`'s `wire/`: a value as text and text as a value, which text can travel as a header, reading a body and recognizing an Envelope, the reserved codes with their texts, the invalid-input body and its reader, and the `Deprecation` header both ways. Which Rejections an Endpoint answers and how each resolves its code are in the contract's `./internal` too.

## A call

1. The headers given to `client()` that the Endpoint declares and the call did not pass are added, a function among them called now.
2. Each declared part of the Input is parsed with its schema, and its text checked that it can travel; one that cannot returns the Provider's invalid-input Rejection, and nothing is sent.
3. A signal already aborted returns its Fault, `committed: 'no'`, and nothing is sent.
4. `fetch` is called with the URL and init. What it throws is inferred as a Fault, or reaches the Caller unchanged when it is no network failure, abort or timeout.
5. The response's `Deprecation` is told the first time a method sees it, then the response is decoded.

Each method returns its decoded Outcome typed by its Endpoint: the decoding is one function for every Endpoint, so its result is cast to the method's `ReceivedOutcome` once, in `client()`.
