# @casitafeliz/loom-server

`serve`, which answers a Contract's Endpoints with their Handlers, and its types (see [Types](#types)); `@casitafeliz/loom-server/node-http` is its adapter for `node:http`, `nodeHttp` and `nodeListener`. How `serve` validates what it sends is in [ARCHITECTURE.md](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/ARCHITECTURE.md); how an Outcome travels, routing and text conversion included, is in [Wire protocol](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#wire-protocol) in the root ARCHITECTURE.md. Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

## Serving

```ts
// src/main.ts
import { serve } from '@casitafeliz/loom-server';
import { nodeHttp } from '@casitafeliz/loom-server/node-http';
import { jetstream } from '@casitafeliz/loom-messaging/jetstream';
import { contract } from './contract';
import handlers from './handlers.generated';
import { connect, consume, close } from './messaging';

await connect(jetstream({
  servers: process.env.NATS_URL!,
  prefix: process.env.BROKER_PREFIX,   // optional, e.g. one per environment
}));
const http = serve(contract, handlers);      // (Request) => Promise<Response>
const server = nodeHttp(http).listen(3000);
await consume(handlers);

process.on('SIGTERM', () => {
  server.close();
  void close();
});
```

`serve` returns a web-standard handler that an adapter connects to the host (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md). `serve(contract, handlers, { maxBodyBytes })` refuses a larger body with `BODY_TOO_LARGE` (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md), and counts the bytes read, not `Content-Length`; without it cf-loom sets no limit, leaving it to the host or the organization's gateway. The limit is operational, not part of the Contract.

`serve()` checks the Service before the first request, so a Service assembled otherwise than its Contract says fails at startup, not inside a request. It throws, naming what it found, on a root that is no Contract; on an Endpoint that is not Retired whose Handler the map lacks, or holds a value `handle()` did not return for that very Endpoint; on a Guard such an Endpoint attaches without such a Handler; on a part that travels as text, an Endpoint's path params, query, headers or Success headers or a Guard's demands, that any of `generate`'s text-part rules refuses: what it holds, its header names, params that are exactly the path's names, and one shape per header or query name; and on a Deprecated Endpoint whose `deprecatedAt` the map lacks or holds otherwise than `generate` writes it, an ISO 8601 UTC instant to the second, since the map is then stale. A Retired Endpoint needs no Handler, keys the Contract does not name are ignored, so a test can spread the map, and a `deprecatedAt` for an Endpoint that is not Deprecated, or that the Contract does not name, is ignored (see [Testing a Service's own code](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#testing-a-services-own-code) in the handlers README). Every response of a Deprecated Endpoint carries the `Deprecation` header, from the `deprecatedAt` the Handler map carries (see [Stubs and the Handler map](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#stubs-and-the-handler-map) in the handlers README).

How `serve` validates every Outcome before sending it is in [Validation](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/ARCHITECTURE.md#validation). `serve(contract, handlers, { onServiceFault })` receives every Fault the Service's side produced, a `ServedFault` naming its `endpoint` and, when a GuardHandler produced it, its `guard`:

- `returned`, a Fault the Handler returned, as `fault`; only its `committed`, `retryable` and `message` travel, never its `cause` or any field it adds;
- `thrown`, a throw or a return that is no Outcome, as the Fault answered, with the error (or a `TypeError` naming what came back) as its `cause`;
- `invalid-outcome`, an Outcome that broke a constraint, or a Success header whose value cannot travel as HTTP text, answered `INVALID_OUTCOME`, with the issues;
- `runtime-bug`, a Context or Qualifier `serve` built that breaks the Contract, answered as a Fault with `committed: 'no'`, with the issues.

The Caller's Faults, `RETIRED`, `NO_SUCH_ENDPOINT` and `BODY_TOO_LARGE`, never reach it; `onOutcome` counts them. Without an `onServiceFault`, what it would receive goes to the console, one line per issue, `<endpoint>[ <guard>]: <part>.<path> <code>: <message>`, or the Fault's message and its `cause` (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md). What `messaging`'s `onServiceFault` receives is in [Connecting](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#connecting) in the messaging README.

`serve(contract, handlers, { onOutcome })` receives `{ endpoint, status, kind, durationMs }` for every request it answers: the Endpoint's name, absent when none matched, the HTTP status, `'success'`, `'rejection'` or `'fault'`, and the time taken. It is the hook for metrics and tracing; cf-loom ships no exporter, the backend is the organization's. On the Caller's side the `fetch` option of the client does the same (see [Consuming a Contract](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#consuming-a-contract) in the client README).

Both hooks are called before the response is returned; what one throws is the Service's own bug, and the handler `serve` returns rejects with it.

## node-http

`@casitafeliz/loom-server/node-http` exports `nodeHttp(http)`, a `node:http` `Server` that answers every request it receives with the handler `serve` returns, as `nodeHttp(http).listen(3000)` does above, and `nodeListener(http)`, the request listener it is built on, for a server the Service creates itself, such as `createServer(options, nodeListener(http))`. A target in origin form (`/orders/o-1`) or absolute form with an `http` or `https` scheme and no credentials (`http://host/orders/o-1`, as RFC 9112 requires a server to accept) is routed on its path and query, and a path that starts with `//` is a path, never a host. The adapter answers two kinds of request itself, as Node already answers a malformed request before any listener runs, so `onOutcome` sees neither: a target in any other form (`*`, `host:port`, another scheme, credentials), one a web-standard `Request` cannot be built from, or a `Host` header that is missing or is more than a host and an optional port, gets 400; a method a web-standard `Request` refuses (`CONNECT`, `TRACE`, `TRACK`) gets `NO_SUCH_ENDPOINT` (404), since no Endpoint can have it. A request's body is streamed to `serve` for every method but `GET` and `HEAD`, and a response to `HEAD` carries no body. A response that fails while it is written, such as when the Caller disconnects, destroys the socket. What the handler rejects with, a hook's throw, reaches the process; nothing else does.

## Types

- `Http`, `(request: Request) => Promise<Response>`: the fetch-style handler `serve` returns.
- `ServeOptions`, `{ maxBodyBytes?, onServiceFault?, onOutcome? }`: what is operational about serving and no part of the Contract.
- `ServedFault`: what `onServiceFault` receives, `returned`, `thrown`, `invalid-outcome` or `runtime-bug`.
- `AnsweredRequest`, `{ endpoint?, status, kind, durationMs }`: what `onOutcome` receives.
