---
"@cf-loom/cli": major
---

`cf-loom publish` packs the package it built once, reads that tarball as `cf-loom check` reads a Baseline's, and publishes that same tarball. A package whose tarball `check` could not read as a Baseline, such as a Definitions Package holding a file named with a non-ASCII letter or a colon, or a `Snapshot.json` beside its `snapshot.json`, exits 3 before anything is put, instead of becoming a version that every later `check` and `publish` of the package fails on. `--dry-run` packs and reads the tarball too.
