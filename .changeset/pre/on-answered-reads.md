---
"@cf-loom/server": patch
---

`onAnswered`'s README and TSDoc say when `aborted` and `durationMs` are read: when the record is built, after `onServiceFault` and before the response is returned, so a Caller that goes away while `onServiceFault` runs is recorded as aborted and `durationMs` includes the time it took.
