---
"@cf-loom/contract": patch
"@cf-loom/cli": patch
---

`check` and `publish` tell a Change inside a recursive schema from that schema, `defs.<id>` with the id the proposed Contract gives it, where they told it from the Endpoint through every recursive schema above it, so a report grows with its Changes and a Change no longer moves when another field reaches the schema first. Two schema Differences at one place, with one Position and one shape, are one Change, the first found. The `--json` document's `format` is 2 in every command: a Change inside a recursive schema has `at` as `["defs", "<id>", …]` and `path` as `defs.<id>…`. A reader that requires `format` 1 must accept 2.
