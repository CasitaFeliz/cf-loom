---
"@cf-loom/contract": patch
---

The Compatibility Check, which `cf-loom check` and `cf-loom publish` run, compares a chain of ids through a plain union, a tuple item or an `allOf` in time that grows with its length instead of its square.
