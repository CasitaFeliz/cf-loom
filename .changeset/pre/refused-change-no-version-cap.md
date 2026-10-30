---
"@cf-loom/contract": patch
---

The version bump no longer caps a refused Change at patch: `check` and `publish` report a refused Change and derive no version, so the cap was never reached.
