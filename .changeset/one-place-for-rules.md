---
"@cf-loom/cli": patch
"@cf-loom/client": patch
"@cf-loom/contract": patch
"@cf-loom/messaging": patch
---

Rules that several packages wrote out separately, such as the broker needs of a Contract and the reserved header names, now live in one place, with no change to what cf-loom reads or writes.
