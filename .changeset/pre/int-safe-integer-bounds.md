---
"@cf-loom/cli": patch
---

The OpenAPI and AsyncAPI documents now bound an `int` to the safe integers, as zod's `z.int()` checks, instead of leaving it unbounded.
