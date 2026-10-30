---
"@cf-loom/contract": major
---

`generate` refuses a regex that is no plain RegExp, given to `.regex()`, as a format's `pattern` or as `z.url()`'s `hostname` or `protocol`: a subclass, a RegExp of another realm, one with a property of its own besides `lastIndex` such as its own `test`, or no RegExp at all, which zod tests through its own `test` while the Snapshot held only its source and flags. A Proxy around a RegExp is refused instead of crashing `generate`, and a string given to `.regex()` no longer writes an empty `regex`.
