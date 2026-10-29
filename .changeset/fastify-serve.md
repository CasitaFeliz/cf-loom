---
"@cf-loom/server": minor
---

`@cf-loom/server/fastify`: `fastifyServe` serves a Contract inside a Fastify v5 app, beside the app's own routes. `nodeHttp` and `nodeListener` write a Response without a stream pipeline, framed by the `content-length` it states or else chunked, and destroy the socket when anything fails once the request is taken.
