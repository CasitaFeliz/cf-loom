---
"@cf-loom/contract": patch
---

`generate` tells every rule over a schema beside what else in it is Not allowed: an open union or intersection, a nodeless cycle, an intersection's differing keys, a record key, a discriminator, a nullable or repeated id, and the params, query, header and Message body rules, except where what replaces the refused construct could change what a rule tells. A check on a construct that is refused, a `z.date()` or a refused `.default()`, is told only when no allowed type takes it, since the construct that replaces it decides what it means.
