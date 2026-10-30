---
"@cf-loom/server": minor
---

`@cf-loom/server/fastify`: `fastifyServe` serves a Contract inside a Fastify v5 app, beside the app's own routes. `nodeHttp` and `nodeListener` write a Response without a stream pipeline, framed by the `content-length` it states or else chunked, destroy the socket when anything fails once the request is taken, and cancel a body whose Caller already left. An answer `nodeHttp` gives itself to a request with no body (`400`, or `NO_SUCH_ENDPOINT` for `TRACE`) keeps the connection alive, where it used to close it.
