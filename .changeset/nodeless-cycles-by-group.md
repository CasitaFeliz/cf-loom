---
"@cf-loom/contract": patch
---

`generate` refuses a cycle through `z.lazy()`, unions and intersections alone in time that grows with the recursive schemas, instead of its square: a Contract with 8,000 recursive unions, intersections or aliases of each other took 6.5 s in the walk alone, and doubling it took about five times longer. It tells each set of recursive schemas that lead back to each other this way once, at the schema of it the walk reaches first, also one that another such cycle among the same recursive schemas used to hide, so the line of a cycle may sit at another schema than before. A recursive schema that admits null and whose own write closes such a cycle now gets its own `.meta({ id }) on a schema that admits null` line instead of the cycle line. A Contract that `generate` accepts is accepted with the same Snapshot.
