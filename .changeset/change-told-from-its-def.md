---
"@cf-loom/contract": patch
"@cf-loom/cli": patch
---

`check` and `publish` tell a Change inside a recursive schema from that schema, `defs.<id>` with the id the proposed Contract gives it, where they told it from the Endpoint through every recursive schema above it. A report grows with its Changes, where a chain of recursive schemas that each hold the one before twice, or one changed at every level, gave each Change a path as long as the nesting, and a Change no longer moves when another field reaches the schema first. A schema Difference found twice at one place with one shape is one Change. The `--json` document's `format` is 2 in every command: a Change inside a recursive schema has `at` as `["defs", "<id>", …]` and `path` as `defs.<id>…`. A reader that requires `format` 1 must accept 2.
