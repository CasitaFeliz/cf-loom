# Internals of @casitafeliz/loom-server

How `serve` (see [README.md](README.md)) validates what it sends. How an Outcome travels over HTTP, routing and text conversion included, is in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md.

## Validation

`serve` validates every Success, its declared headers included, and every Rejection body before sending it, and serializes the headers as it does the body. A Handler's Outcome that type-checks but breaks a constraint is never sent: the Caller receives a Fault with `INVALID_OUTCOME`, `committed: 'unknown'` and `retryable: false`, and the validation issues go to the Service, never to the Caller (see `onFault` in [Serving](README.md#serving)).
