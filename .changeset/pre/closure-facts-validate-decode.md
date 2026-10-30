---
"@cf-loom/contract": patch
---

`generate`, `check` and `publish` judge whether a plain union or an intersection reaches an Open Enum, and `check` and `publish` refuse a Baseline holding a def that leads back to itself through `ref`s, `union` options and `allOf` items alone; both now take time that grows with the defs, instead of its square.
