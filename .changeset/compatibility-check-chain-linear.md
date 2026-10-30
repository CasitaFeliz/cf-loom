---
"@cf-loom/contract": patch
---

The Compatibility Check, which `cf-loom check` and `cf-loom publish` run, compares a chain of ids, each holding the next, in time and memory that grow with its length instead of its square, so a long chain that is unchanged, or changed at one place, no longer runs out of memory. A chain of ids through a plain union, a tuple item or an `allOf` still grows with the square of its length.
