---
"@cf-loom/contract": patch
---

`generate` walks and validates a chain of ids, each holding the next, in time and memory that grow with its length instead of its square, so a deep chain that passes, or fails at one place, no longer runs out of memory with no line saying why. A chain whose every link fails still prints one line per link, each naming its full location, so that output grows with the square of the chain.
