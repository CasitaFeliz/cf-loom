---
"@cf-loom/contract": patch
---

`generate` walks and validates a chain of ids, however each holds the next, in time and memory that grow with its length instead of its square, so a deep chain of recursive schemas fails only on what the author wrote and no longer runs out of memory with no line saying why.
