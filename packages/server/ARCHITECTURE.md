# Internals of @cf-loom/server

How `serve` (see [README.md](README.md)) answers a request and validates what it sends, and how the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires. How an Outcome travels over HTTP, routing and text conversion included, is in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md.

## Modules

The entry `src/index.ts` (`.`) re-exports from `answering/`, and `src/node-http/index.ts` (`./node-http`) from `node-host/`. The modules of `.` import no `node:` module, so `serve` runs wherever its host runs.

| Module | Holds | Depends on |
| --- | --- | --- |
| `served/` | what `serve()` prepares once: each declared Endpoint with its segments, lifecycle, Handler, Attachments with their Handlers and Qualifiers, and stamp, the walked text nodes by declaration, the resolved Standard Rejections and the body limit; the startup failures it throws, naming the Element, its Handler lookups through `@cf-loom/handlers`'s `mappedHandlerOf` | none (a type-only import of `serve`'s signature for the Handler map it takes) |
| `answering/` | `serve` and its types; one request top to bottom; the Guards' runs plugged into the contract's reading, each with its Context and Qualifier; a run's kinds as a `Response` and a `ServedFault`, the invalid-input Rejection answered in one place, and the runtime's own bug; the hooks and their console fallback | `served` |
| `node-host/` | `nodeHttp` and `nodeListener`: a `Request` from an `IncomingMessage`, or the answer when it cannot be one; a `Response` written to a `ServerResponse` | `answering` |

The request and response sides are free of Handlers and hosts and live in `@cf-loom/contract`'s `wire/`, with the other wire rules the client and `@cf-loom/testing` share: matching a request to an Endpoint and reading its text parts and body, text conversion, building a `Response` from a Success, Rejection or Fault, the invalid-input Rejection's included, the reserved codes with their texts, the `Deprecation` header and the invalid-input body. The order a request is read in lives in the contract's `reading/`. The runs of the Handlers live in `@cf-loom/handlers`'s `./internal`. `serve` keeps answering, the hooks, the startup check and the adapter.

## A request

1. The method and the decoded segments are matched against every declared Endpoint, Retired ones included: none is `NO_SUCH_ENDPOINT`, a Retired one `RETIRED`.
2. The contract's reading reads the request in the order of [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md. Each GuardHandler runs with the admitted Context of the Guards it lists and the Endpoint's Qualifier for it; a body too large is answered alone, unread; a throw while the request is parsed, such as a stack overflow on deeply nested Input, is answered as a Handler's throw, not committed.
3. The EndpointHandler runs with the Input and the admitted Context of the Guards the Endpoint attaches, and what it answered is sent; a Deprecated Endpoint's response, whatever it is, carries the `Deprecation` header.
4. A `ServedFault` goes to `onServiceFault`, then the request's record to `onOutcome`.

An Issue at `context` or `qualifier` means `serve` built something the Contract refuses: it is the runtime's own bug, answered as a Fault not committed and reported as `runtime-bug`, never as the Caller's invalid input.

## Validation

The Handler's run in `@cf-loom/handlers` checks every Success, its declared headers included, and every Rejection body before `serve` sends it, the checks a direct call runs ([Testing a Service's own code](../handlers/README.md#testing-a-services-own-code) in the handlers README). A header value that cannot travel as text (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md) is an Issue at `success.headers`, with its name as path and the code `invalid_format`. A Handler's Outcome that type-checks but breaks a constraint is never sent: the Caller receives a Fault with `INVALID_OUTCOME`, `committed: 'unknown'` and `retryable: false`, and the validation issues go to the Service, never to the Caller (see `onServiceFault` in [Serving](README.md#serving)).
