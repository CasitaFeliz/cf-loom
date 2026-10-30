---
"@cf-loom/handlers": patch
"@cf-loom/server": patch
---

`serve` parses a request's Input and a Guard's demands once instead of twice, with no change to what it answers or to what a Handler receives.
