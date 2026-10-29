---
"@cf-loom/contract": major
"@cf-loom/cli": major
---

`generate` refuses every string format check zod runs through a function, whatever pattern sits beside it: any `z.stringFormat()` (a regex given to it included) and the formats zod builds from a regex, `z.hex()`, `z.hostname()`, `z.currencyCode()` and `z.hash()`, each with `(use .regex(z.regexes.<name>))`. Write `z.string().regex(z.regexes.hex)` (or `z.regexes.sha256_hex` for `z.hash('sha256')`): the Snapshot then holds the regex, and OpenAPI and AsyncAPI documents a `pattern` instead of a `format`. The Snapshot format 1 no longer knows the formats `hex`, `hostname`, `currency_code` and the hash formats, so a Snapshot holding one is malformed.
