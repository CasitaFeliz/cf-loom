---
"@cf-loom/contract": patch
---

`generate` refuses a value that is no zod 4 schema inside a schema, such as a zod/v3 schema in an object field, with `not allowed: a value that is no zod 4 schema (zod/v3 is not read)` at its place instead of crashing with a `TypeError`, and a field holding one is a type error. A cycle whose `.meta({ id })` is refused (not camelCase, not a string, or beside another refused key) gets that refusal alone, not a second `a cycle without .meta({ id })` line, and a cycle whose id a later `.describe()`, `.meta()` or check dropped names that id and says to put `.meta({ id })` last.
