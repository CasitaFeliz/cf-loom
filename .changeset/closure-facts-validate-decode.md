---
"@cf-loom/contract": patch
---

`generate` refuses a plain union or an intersection that reaches an Open Enum, and `check` and `publish` refuse a Baseline holding a def that leads back to itself through `ref`s, `union` options and `allOf` items alone, each in time that grows with a chain of ids, instead of its square.
