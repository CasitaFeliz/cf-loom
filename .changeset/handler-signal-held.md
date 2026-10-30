---
"@cf-loom/client": patch
"@cf-loom/contract": patch
"@cf-loom/server": patch
---

A Handler's or a Guard's `request.signal` aborts when the Caller leaves even after a garbage collection: `nodeHttp`, `nodeListener` and `fastifyServe` hold each request's `Request` from the Caller's departure until its response ends, where undici's `Request` stopped following that signal once nothing else held it. A client call holds its Request from its `signal` the same way until the call settles, so an abort reaches any `fetch`, `serve` in the same process included.
