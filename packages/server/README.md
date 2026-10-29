# @cf-loom/server

`serve`, which answers a Contract's Endpoints with their Handlers, and its types (see [Types](#types)); `@cf-loom/server/node-http` is its adapter for `node:http`, `nodeHttp` and `nodeListener`. How `serve` validates what it sends is in [ARCHITECTURE.md](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/ARCHITECTURE.md); how an Outcome travels, routing and text conversion included, is in [Wire protocol](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#wire-protocol) in the root ARCHITECTURE.md. Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

## Serving

A Service without messaging, `notes-service` here, serves HTTP alone:

```ts
// notes-service/src/main.ts
import { serve } from '@cf-loom/server';
import { nodeHttp } from '@cf-loom/server/node-http';
import { contract } from './contract/index.ts';
import handlers from './handlers.generated.ts';

const resources = { notes: await notesRepository() };   // the Service's own
const http = serve(contract, handlers, { resources, maxBodyBytes: 1_048_576 });   // (Request) => Promise<Response>
const server = nodeHttp(http).listen(3000);

process.on('SIGTERM', () => server.close());   // stops accepting connections; requests in flight finish
```

A Service with messaging connects it first, hands its EventPublisher and CommandSender to the Handlers as Resources, closes it on SIGTERM too, and consumes its Messages once it serves (see [Connecting](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#connecting) in the messaging README):

```ts
// src/main.ts
import { serve } from '@cf-loom/server';
import { nodeHttp } from '@cf-loom/server/node-http';
import { connect } from '@nats-io/transport-node';
import { messaging } from '@cf-loom/messaging';
import { jetstream } from '@cf-loom/messaging/jetstream';
import { contract } from './contract/index.ts';
import handlers from './handlers.generated.ts';

const running = await messaging(contract, jetstream({
  connect: () => connect({ servers: process.env.NATS_URL }),   // the Service's own transport and auth
  prefix: process.env.BROKER_PREFIX,   // optional, e.g. one per environment
}));
const resources = {      // the Service's own
  orders: await ordersRepository(),
  callers: await mongoCallers(),
  notifications: await mongoNotifications(),
  publisher: running.publisher,
  sender: running.sender,
};
const http = serve(contract, handlers, { resources, maxBodyBytes: 1_048_576 });
const server = nodeHttp(http).listen(3000);

process.on('SIGTERM', () => {
  server.close();
  void running.close();
});
await running.consume(handlers, { resources });
```

`serve` returns a web-standard handler that an adapter connects to the host (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md). `serve(contract, handlers, { resources })` hands the Service's Resources to every EndpointHandler and GuardHandler it runs (see [Resources](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#resources) in the handlers README). `serve(contract, handlers, { maxBodyBytes })` refuses a larger body with `BODY_TOO_LARGE` (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md), and counts the bytes read, not `Content-Length`; it is a whole number of bytes from 0, or `'unlimited'`, and `serve` throws at startup on any other value. Without it, or with `'unlimited'`, cf-loom sets no limit, leaving it to the host or the organization's gateway. The limit is operational, not part of the Contract.

`serve()` checks the Service before the first request, so a Service assembled otherwise than its Contract says fails at startup, not inside a request. It throws, naming what it found, on a Root that is no Service's Contract; on a `maxBodyBytes` that is no limit; on an Endpoint that is not Retired whose Handler the map lacks (`endpoints.getOrder has no Handler in the Handler map: run cf-loom generate`), holds the Handler written for another declaration (`endpoints.getOrder holds the Handler written for createOrder`), one written for another copy of it (`endpoints.getOrder holds a Handler written for another copy of getOrder: is @cf-loom/contract or the Contract loaded twice?`), or a value `handle()` did not return (`endpoints.getOrder holds a value handle() did not return: wrap inside the implementation instead`); on a Guard such an Endpoint attaches without its Handler, worded the same; on a part that travels as text, an Endpoint's path params, query, headers or Success headers, a Rejection's headers or a Guard's demands, that any of `generate`'s text-part rules refuses: what it holds, its header names, params that are exactly the path's names, an enum whose values travel as one text, and one shape per header or query name. `serve` types the map against the Contract, `HandlerMapOf<typeof contract>` (see [Types](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#types) in the handlers README), so most of these fail the build first, and requires the Resources its Handlers take, refusing those left unspecified or unreadable (see [Resources](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#resources) in the handlers README); the startup check of the Contract is of what the types cannot state, the Service's assembly (a Handler written for another copy of the Contract type-checks, and so does a stale map) and every text part of the Contract's Endpoints, Guards and Rejections, judged by `generate`'s text-part rules, a Retired Endpoint's included. The rest of the Contract is read as its types declare it, so a Contract the types refuse is the Service's bug. A key the Contract does not name is refused only by the generated map's `satisfies`, never by `serve`'s type. A Retired Endpoint needs no Handler, and keys the Contract does not name are ignored, so a test can spread the map (see [Testing a Service's own code](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#testing-a-services-own-code) in the handlers README). Every response of a Deprecated Endpoint carries the `Deprecation` header, from the `deprecatedAt` its declaration states (see [Lifecycle](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#lifecycle) in the contract README).

How `serve` validates every Outcome before sending it is in [Validation](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/ARCHITECTURE.md#validation). `serve(contract, handlers, { onServiceFault })` calls `onServiceFault(fault, request)` with every Fault the Service's side produced and the web-standard `Request` it came from, `fault` a `ServedFault` naming its `declaration`, the Endpoint the request matched, with its `name`, and, when a GuardHandler produced it, its `guard`, the Guard:

- `returned`, a Fault the Handler returned, as `fault`; only its `committed`, `retryable` and `message` travel, and its `retryAfter` as `Retry-After`, never its `cause` or any field it adds;
- `thrown`, a throw or a return that is no Outcome, with the error, or a `TypeError` naming what came back, as `cause`;
- `invalid-outcome`, an Outcome that broke a constraint, or a Success header whose value cannot travel as HTTP field text, answered `INVALID_OUTCOME`, with the issues;
- `runtime-bug`, a Context or Qualifier `serve` built that breaks the Contract, answered as a Fault with `committed: 'no'`, with the issues.

The Faults `serve` answers with a Reserved code and no Handler (see [Reserved code](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md#language) in CONTEXT.md), `RETIRED`, `NO_SUCH_ENDPOINT`, `METHOD_NOT_ALLOWED` and `BODY_TOO_LARGE`, never reach it; `onAnswered` counts them. Without an `onServiceFault`, what it would receive goes to the console, one line per issue after `<name>[ <guard>]`, as the contract writes an issue (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#rejections) in the contract README), or the Fault's message, or `the Handler threw`, and its `cause` (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md). What `messaging`'s `onServiceFault` receives is in [onServiceFault](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#onservicefault) in the messaging README.

`serve(contract, handlers, { fallback })` hands every request no declared Endpoint matches to `fallback`, an `Http` of the Service's own, and returns its Response as is, or the internal Fault, logged as `serve: the fallback rejected`, when it rejects; a Retired Endpoint still answers `RETIRED`, and `onAnswered` does not record what the fallback answered. A framework adapter that hands a request back to its framework passes a fallback that returns a Response it recognizes by identity. The fallback answers only what `serve` does not: a browser Application also needs CORS headers on every Endpoint's response, `Access-Control-Expose-Headers` among them (see [In a browser](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#in-a-browser-applications) in the client README), and any `Set-Cookie`, which no Contract declares since a browser never exposes it; the Service adds both by wrapping the handler `serve` returns.

```ts
import { serve } from '@cf-loom/server';
import handlers from '../src/handlers.generated.ts';

const notOurs = new Response(null, { status: 404 });
const http = serve(contract, handlers, {
  resources,
  maxBodyBytes: 1_048_576,
  fallback: async (request) => {
    if (new URL(request.url).pathname === '/healthz') return new Response('ok');
    if (request.method === 'OPTIONS') return preflight(request); // the Service's CORS policy
    return notOurs;
  },
});
```

`serve(contract, handlers, { onAnswered })` calls `onAnswered(answered, request)` for every request it answers, with the web-standard `Request`, whose headers carry what tracing reads, such as `traceparent`, and `answered`, an `AnsweredRequest`: `method`, the matched Endpoint's, or, when none matched, the request's when it is a method an Endpoint may declare or `HEAD`, else `_OTHER`, so its cardinality is bounded, as OpenTelemetry's `http.request.method` asks; `endpoint` and `path`, the matched Endpoint's name and its path as declared (`/orders/:orderId`), both present exactly when an Endpoint matched; `status`, the HTTP status; `kind`, `'success'`, `'rejection'` or `'fault'`; `code`, the code sent, a Rejection's as the Root resolves it or a Reserved code's, and none for a Success or a Fault the Service produced; `aborted`, whether the request's signal had aborted when the record was built, after `onServiceFault` and before the response is returned, as when the Caller went away; and `durationMs`, the time from when `serve` received the request until then, `onServiceFault` included. It is the hook for metrics and tracing: `method` and `path` fill OpenTelemetry's `http.request.method` and `http.route`; cf-loom ships no exporter: the backend is the organization's. On the Caller's side the `fetch` option of the client does the same (see [Consuming a Contract](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#consuming-a-contract) in the client README).

Both hooks may be async and are awaited before the response is returned; what one throws or rejects is logged and never escapes (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md).

## node-http

`@cf-loom/server/node-http` exports `nodeHttp(http)`, a `node:http` `Server` that answers every request it receives with the handler `serve` returns, as `nodeHttp(http).listen(3000)` does above, and `nodeListener(http)`, the request listener it is built on, for a server the Service creates itself, such as `createServer(options, nodeListener(http))`. A target in origin form (`/orders/o-1`) or absolute form with an `http` or `https` scheme and no credentials (`http://host/orders/o-1`, as RFC 9112 requires a server to accept) is routed on its path and query, and a path that starts with `//` is a path, never a host. The adapter answers two kinds of request itself, as Node already answers a malformed request before any listener runs, so `onAnswered` sees neither: a target in any other form (`*`, `host:port`, another scheme, credentials), one a web-standard `Request` cannot be built from, or a `Host` header that is missing or is more than a host and an optional port, gets 400; a method a web-standard `Request` refuses (`CONNECT`, `TRACE`, `TRACK`) gets `NO_SUCH_ENDPOINT` (404), since no Endpoint can have it. A request's body is streamed to `serve` for every method but `GET` and `HEAD`, and a response to `HEAD` carries no body. A response sent before `serve` read the request's whole body, such as `NO_SUCH_ENDPOINT`, a Guard's Rejection or `BODY_TOO_LARGE`, carries `connection: close`, and the connection closes after it, so a body `serve` did not read never stalls the next request; the Caller reconnects for its next request. A Caller that disconnects before its response is written aborts the request's signal, which its Handlers received (see [EndpointHandler](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#endpointhandler) in the handlers README); a response that fails while it is written destroys the socket. A handler that rejects is answered 500 with the Fault Envelope, `committed: 'unknown'`, and logged as `nodeListener: the handler rejected`.

## Types

- `Http`, re-exported from `@cf-loom/contract`: the handler `serve` returns.
- `ServeOptions<Resources>`, `{ resources?, maxBodyBytes?: BodyLimit, fallback?, onServiceFault?, onAnswered? }`: what `serve` takes, always given, besides the Contract and the Handler map: the Resources its Handlers take, required exactly when some Handler takes any, and what is operational about serving; none of it is part of the Contract. A field it does not declare is a type error, given as a literal or through a variable, and a function that wraps `serve` types its parameters as the concrete types (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md).
- `BodyLimit`, `number | 'unlimited'`: what `maxBodyBytes` takes, a whole number of bytes from 0 or no limit.
- `ServedFault`: what `onServiceFault` receives first, beside the `Request`, `{ declaration, name, guard? }` and `returned`, `thrown`, `invalid-outcome` or `runtime-bug`.
- `AnsweredRequest`, `{ method, endpoint?, path?, status, kind, code?, aborted, durationMs }`: what `onAnswered` receives first, beside the `Request`.
