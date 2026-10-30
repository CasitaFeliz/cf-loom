---
'@cf-loom/server': minor
---

`fastifyServe` serves HTTP/2 Fastify apps, h2c, TLS and `allowHTTP1` alike. Both adapters read a request's body only once `serve` reads it: over HTTP/1.1, a response to a request whose body `serve` never read, such as `NO_SUCH_ENDPOINT` or a Guard's Rejection, no longer carries `connection: close`, and Node discards the body and keeps the connection; only `BODY_TOO_LARGE`, a body read in part, still closes it.
