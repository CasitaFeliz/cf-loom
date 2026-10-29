---
"@cf-loom/contract": patch
---

The Snapshot decoder no longer throws `RangeError` on a Snapshot holding an array or map of more than about 120,000 items, and the client and `@cf-loom/testing` refuse an Endpoint's exported Snapshot cut nested past 256 levels as `<provider>'s exported Snapshot is malformed: <path> nests deeper than 256 levels` instead of throwing `RangeError`.
