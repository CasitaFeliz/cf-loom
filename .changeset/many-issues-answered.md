---
"@cf-loom/contract": patch
---

A request, a Success or a Rejection body whose items each break its schema, 200,000 of them or more, no longer throws `RangeError` from the Issues' collection: `serve` answers `INVALID_INPUT` with every Issue, `client` returns the `INVALID_OUTCOME` Fault or its own `INVALID_INPUT` Rejection, and a Handler's Success of that kind is reported as `invalid-outcome`, not as the Handler's throw.
