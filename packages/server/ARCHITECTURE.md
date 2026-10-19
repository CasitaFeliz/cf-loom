# Internals of @casitafeliz/loom-server

How `serve` (see [README.md](README.md)) answers a request and validates what it sends, and how the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires. How an Outcome travels over HTTP, routing and text conversion included, is in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md.

## Modules

The entry `src/index.ts` (`.`) re-exports from `answering/`, and `src/node-http/index.ts` (`./node-http`) from `node-host/`. The modules of `.` import no `node:` module, so `serve` runs wherever its host runs.

| Module | Holds | Depends on |
| --- | --- | --- |
| `response/` | a `Response` from a Success, Rejection or Fault as it is sent; the reserved Faults and the runtime's own bug | none |
| `served/` | what `serve()` prepares once: each declared Endpoint with its segments, lifecycle, Handler, Attachments with their Handlers and Qualifiers, walked text nodes and stamp, the resolved Standard Rejections and the body limit; the startup failures it throws, naming the Element | none |
| `answering/` | `serve` and its types; one request top to bottom; the Attachments in order with their Context and Qualifier; the Endpoint's Input; a run's kinds as a `Response` and a `ServiceFault`, the invalid-input Rejection built in one place and a Success's headers checked as text; the `Deprecation` header; the hooks and their console fallback | `response`, `served` |
| `node-host/` | `nodeHttp` and `nodeListener`: a `Request` from an `IncomingMessage`, or the answer when it cannot be one; a `Response` written to a `ServerResponse` | `answering`, `response` |

The request side, matching a request to an Endpoint and reading its text parts and body, is pure and lives in `@casitafeliz/loom-contract`'s `wire/`, with the other wire rules the client and `@casitafeliz/loom-testing` share: text conversion, the Envelopes, the reserved codes with their texts and the invalid-input body. The runs of the Handlers live in `@casitafeliz/loom-handlers`'s `./internal`. `serve` keeps answering, the hooks, the startup check and the adapter.

## A request

1. The method and the decoded segments are matched against every declared Endpoint, Retired ones included: none is `NO_SUCH_ENDPOINT`, a Retired one `RETIRED`.
2. Each Attachment runs in order: its Guard's demands are read from the query and headers, then its GuardHandler runs with the admitted Context of the Guards it lists and the Endpoint's Qualifier for it. The first Admission that is not the request admitted answers it.
3. The Endpoint's Input is read: its text parts, then its body when it declares one, which is answered alone when it is too large or cannot be read as JSON.
4. The EndpointHandler runs with the Input and the admitted Context of the Guards the Endpoint attaches, and what it answered is sent; a Deprecated Endpoint's response, whatever it is, carries the `Deprecation` header.
5. A `ServiceFault` goes to `onServiceFault`, then the request's record to `onOutcome`.

An Issue at `context` or `qualifier` means `serve` built something the Contract refuses: it is the runtime's own bug, answered as a Fault not committed and reported as `runtime-bug`, never as the Caller's invalid input.

## Validation

`serve` validates every Success, its declared headers included, and every Rejection body before sending it, and serializes the headers as it does the body. A header value is sent only when it can travel as text, by the rule `Headers` applies: no CR, LF or NUL, and nothing above U+00FF; one that cannot is an Issue at `success.headers`, its name as path, with the code `invalid_format`. A Handler's Outcome that type-checks but breaks a constraint is never sent: the Caller receives a Fault with `INVALID_OUTCOME`, `committed: 'unknown'` and `retryable: false`, and the validation issues go to the Service, never to the Caller (see `onServiceFault` in [Serving](README.md#serving)).
