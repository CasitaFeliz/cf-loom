# Internals of @casitafeliz/loom-server

How `serve` (see [README.md](README.md)) answers a request and validates what it sends, and how the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires. How an Outcome travels over HTTP, routing and text conversion included, is in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md.

## Modules

The entry `src/index.ts` (`.`) re-exports from `answering/`, and `src/node-http/index.ts` (`./node-http`) from `node-host/`. The modules of `.` import no `node:` module, so `serve` runs wherever its host runs.

| Module | Holds | Depends on |
| --- | --- | --- |
| `matching/` | one request's method and decoded segments against the declared Endpoints: precedence, and the param texts by position | none |
| `request/` | the text parts of one party, an Endpoint's Input or a Guard's demands, read field by field and converted by their walked nodes; the body read within `maxBodyBytes` and parsed as JSON, or why it cannot be | none |
| `response/` | a `Response` from a resolved Success, Rejection or Fault; the invalid-input Rejection from Issues, the one place it is built; the reserved Faults with their texts and the runtime's own bug; the `Deprecation` header | none |
| `served/` | what `serve()` prepares once: each declared Endpoint with its segments, lifecycle, Handler, Attachments with their Handlers and Qualifiers, walked text nodes and stamp, and the resolved Standard Rejections; the startup failures it throws, naming the Element | `request` |
| `answering/` | `serve` and its types; one request top to bottom; the Attachments in order with their Context and Qualifier; the Endpoint's Input; a run's kinds as a `Response` and a `ServiceFault`; the hooks and their console fallback | `matching`, `request`, `response`, `served` |
| `node-host/` | `nodeHttp` and `nodeListener`: a `Request` from an `IncomingMessage`, a `Response` written to a `ServerResponse` | `answering` |

The wire rules the client and `@casitafeliz/loom-testing` share, text conversion, the Envelopes, the reserved codes and the invalid-input body, live in `@casitafeliz/loom-contract`'s `./internal`; the runs of the Handlers in `@casitafeliz/loom-handlers`'s.

## A request

1. The method and the decoded segments are matched against every declared Endpoint, Retired ones included: none is `NO_SUCH_ENDPOINT`, a Retired one `RETIRED`.
2. Each Attachment runs in order: its Guard's demands are read from the query and headers, then its GuardHandler runs with the admitted Context of the Guards it lists and the Endpoint's Qualifier for it. The first Admission that is not the request admitted answers it.
3. The Endpoint's Input is read: its text parts, then its body when it declares one, which is answered alone when it is too large or cannot be read as JSON.
4. The EndpointHandler runs with the Input and the admitted Context of the Guards the Endpoint attaches, and what it answered is sent; a Deprecated Endpoint's response, whatever it is, carries the `Deprecation` header.
5. A `ServiceFault` goes to `onServiceFault`, then the request's record to `onOutcome`.

An Issue at `context` or `qualifier` means `serve` built something the Contract refuses: it is the runtime's own bug, answered as a Fault not committed and reported as `runtime-bug`, never as the Caller's invalid input.

## Validation

`serve` validates every Success, its declared headers included, and every Rejection body before sending it, and serializes the headers as it does the body. A Handler's Outcome that type-checks but breaks a constraint is never sent: the Caller receives a Fault with `INVALID_OUTCOME`, `committed: 'unknown'` and `retryable: false`, and the validation issues go to the Service, never to the Caller (see `onServiceFault` in [Serving](README.md#serving)).
