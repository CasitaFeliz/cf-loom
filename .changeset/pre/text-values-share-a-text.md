---
"@cf-loom/contract": major
"@cf-loom/server": major
---

`generate`, and `serve` at startup, refuse a text part's enum whose values travel as one text, such as `1` and `'1'`, `true` and `'true'`, or `1e21` and `'1000000000000000000000'`: a Caller could never send the second. The line reads `A query param's values each have a text of their own: v has "1" and 1`, rule `shared-text`.
