# @cf-loom/server

`serve`, which answers a Contract's Endpoints with their Handlers, and its types (see [Types](#types)); its adapters connect it to a host (see [Adapters](#adapters)): `@cf-loom/server/node-http` for `node:http`, `nodeHttp` and `nodeListener`, and `@cf-loom/server/fastify` inside a Fastify app, `fastifyServe`. How `serve` validates what it sends is in [ARCHITECTURE.md](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/ARCHITECTURE.md); how an Outcome travels, routing and text conversion included, is in [Wire protocol](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#wire-protocol) in the root ARCHITECTURE.md. Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

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
import { client } from '@cf-loom/client';
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
  payments: client(paymentsDependency, { baseUrl }),
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

`serve()` checks the Service before the first request, so a Service assembled otherwise than its Contract says fails at startup, not inside a request. It throws, naming what it found, on a Root that is no Service's Contract; on a `maxBodyBytes` that is no limit; on an Endpoint that is not Retired whose Handler the map lacks (`endpoints.getOrder has no Handler in the Handler map: run cf-loom generate`), holds the Handler written for another declaration (`endpoints.getOrder holds the Handler written for createOrder`), one written for another copy of it (`endpoints.getOrder holds a Handler written for another copy of getOrder: is @cf-loom/contract or the Contract loaded twice?`), or a value `handle()` did not return (`endpoints.getOrder holds a value handle() did not return: wrap inside the implementation instead`); on a Guard such an Endpoint attaches without its Handler, worded the same; on a part that travels as text, an Endpoint's path params, query, headers or Success headers, a Rejection's headers or a Guard's demands, that any of `generate`'s text-part rules refuses: what it holds, its header names, params that are exactly the path's names, an enum whose values travel as one text, an enum value its part cannot carry, and one shape per header or query name. `serve` types the map against the Contract, `HandlerMapOf<typeof contract>` (see [Types](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#types) in the handlers README), so most of these fail the build first, and requires the Resources its Handlers take, refusing those left unspecified or unreadable (see [Resources](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#resources) in the handlers README); the startup check of the Contract is of what the types cannot state, the Service's assembly (a Handler written for another copy of the Contract type-checks, and so does a stale map) and every text part of the Contract's Endpoints, Guards and Rejections, judged by `generate`'s text-part rules, a Retired Endpoint's included. The rest of the Contract is read as its types declare it, so a Contract the types refuse is the Service's bug. A key the Contract does not name is refused only by the generated map's `satisfies`, never by `serve`'s type. A Retired Endpoint needs no Handler, and keys the Contract does not name are ignored, so a test can spread the map (see [Testing a Service's own code](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#testing-a-services-own-code) in the handlers README). Every response of a Deprecated Endpoint carries the `Deprecation` header, from the `deprecatedAt` its declaration states (see [Lifecycle](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#lifecycle) in the contract README).

How `serve` validates every Outcome before sending it is in [Validation](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/ARCHITECTURE.md#validation). `serve(contract, handlers, { onServiceFault })` calls `onServiceFault(fault, request)` with every Fault the Service's side produced and the web-standard `Request` it came from, `fault` a `ServedFault` naming its `declaration`, the Endpoint the request matched, with its `name`, and, when a GuardHandler produced it, its `guard`, the Guard:

- `returned`, a Fault the Handler returned, as `fault`; only its `committed`, `retryable` and `message` travel, and its `retryAfter` as `Retry-After`, never its `cause` or any field it adds;
- `thrown`, a throw or a return that is no Outcome, with the error, or a `TypeError` naming what came back, as `cause`;
- `invalid-outcome`, an Outcome that broke a constraint, or a Success header whose value cannot travel as HTTP field text, answered `INVALID_OUTCOME`, with the Issues;
- `runtime-bug`, a Context or Qualifier `serve` built that breaks the Contract, answered as a Fault with `committed: 'no'`, with the Issues.

The Faults `serve` answers with a Reserved code and no Handler (see [Reserved code](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md#language) in CONTEXT.md), `RETIRED`, `NO_SUCH_ENDPOINT`, `METHOD_NOT_ALLOWED` and `BODY_TOO_LARGE`, never reach it; `onAnswered` counts them. Without an `onServiceFault`, what it would receive goes to the console, one line per Issue after `<name>[ <guard>]`, as the contract writes an Issue (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#rejections) in the contract README), or the Fault's message, or `the Handler threw`, and its `cause` (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md). What `messaging`'s `onServiceFault` receives is in [onServiceFault](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#onservicefault) in the messaging README.

`serve(contract, handlers, { fallback })` hands every request no declared Endpoint matches to `fallback`, an `Http` of the Service's own, and returns its Response as is, or the internal Fault, logged as `serve: the fallback rejected`, when it rejects; a Retired Endpoint still answers `RETIRED`, and `onAnswered` does not record what the fallback answered. A framework adapter that hands a request back to its framework passes a fallback that returns a Response it recognizes by identity. The fallback answers only what `serve` does not: a browser Application also needs CORS headers on every Endpoint's response, `Access-Control-Expose-Headers` among them (see [In a browser](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#in-a-browser-applications) in the client README), and any `Set-Cookie`, which no Contract declares since a browser never exposes it; the Service adds both by wrapping the handler `serve` returns. Under `fastifyServe`, an app `onRequest` hook registered before it sets them on the reply instead (see [fastify](#fastify)).

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

`serve(contract, handlers, { onAnswered })` calls `onAnswered(answered, request)` for every request it answers, with the web-standard `Request`, whose headers carry what tracing reads, such as `traceparent`, and `answered`, an `AnsweredRequest`: `method`, the matched Endpoint's, or, when none matched, the request's when it is a method an Endpoint may declare or `HEAD`, else `_OTHER`, so its cardinality is bounded, as OpenTelemetry's `http.request.method` asks; `endpoint` and `path`, the matched Endpoint's name and its path as declared (`/orders/:orderId`), both present exactly when an Endpoint matched; `status`, the HTTP status; `kind`, `'success'`, `'rejection'` or `'fault'`; `code`, the code sent, a Rejection's as the Root resolves it or a Reserved code's, and none for a Success or a Fault the Service produced; `aborted`, whether the request's signal had aborted when the record was built, after `onServiceFault` and before the response is returned, as when the Caller went away; and `durationMs`, the time from when `serve` received the request until then, `onServiceFault` included. The record is built before the response is written, so a write that fails afterwards, as when an app header Node refuses fails it, still records the status `serve` answered. It is the hook for metrics and tracing: `method` and `path` fill OpenTelemetry's `http.request.method` and `http.route`; cf-loom ships no exporter: the backend is the organization's. On the Caller's side the `fetch` option of the client does the same (see [Consuming a Contract](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#consuming-a-contract) in the client README).

Both hooks may be async and are awaited before the response is returned; what one throws or rejects is logged and never escapes (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md).

## Adapters

An adapter connects the handler `serve` returns to a host (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md). cf-loom ships two, [node-http](#node-http) and [fastify](#fastify), and both:

- hand `serve` every request whose method and path a declared Endpoint has, Retired ones included;
- route a target in origin form (`/orders/o-1`), or in absolute form with an `http` or `https` scheme and no credentials (`http://host/orders/o-1`, as RFC 9112 requires a server to accept), on its path and query, and read a path that starts with `//` as a path, never a host; the URL is on the origin the `Host` header names, read as sent; an HTTP/2 request is read as the absolute-form target its `:scheme`, its `:authority` (or its `Host` when it has none) and its path make, by the same rule, and its pseudo-headers are not among the `Request`'s headers; several `Cookie` fields reach `serve` as one, joined by `; `;
- stream a request's body to `serve` for every method but `GET` and `HEAD`, and apply no limit of their own: `maxBodyBytes` governs;
- write every response the same way: its status and headers, then its body, read and written chunk by chunk and framed by Node: over HTTP/1.1 with the `content-length` the Response states or else chunked, so `serve`'s responses, which state none, are chunked, a stated length that does not match the body's bytes destroying the socket; over HTTP/2 in DATA frames; a response to `HEAD` carries no body;
- send a response written before `serve` read the request's whole body, such as `NO_SUCH_ENDPOINT`, a Guard's Rejection or `BODY_TOO_LARGE`, with `connection: close`, and the connection closes after it, so a body `serve` did not read never stalls the next request; the Caller reconnects for its next request; over HTTP/2, which has no `connection` header, the request's stream is closed instead once the response is written, so the Caller stops sending a body `serve` did not read, and the connection's other requests go on;
- abort the request's signal, which its Handlers received (see [EndpointHandler](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#endpointhandler) in the handlers README), when a Caller disconnects before its response is written, at once if it left before the adapter took the request, and cancel the body's stream of a Response nobody is left to read;
- destroy the socket, or over HTTP/2 reset the request's stream with an error, when anything fails once the request is taken, before or while its response is written, so the process lives on, the Caller is not left waiting, and never takes a cut-off body for a whole one.

Each adapter says what it does with a request it cannot read or that no Endpoint has.

### node-http

`@cf-loom/server/node-http` exports `nodeHttp(http)`, a `node:http` `Server` that answers every request it receives with the handler `serve` returns, as `nodeHttp(http).listen(3000)` does above, and `nodeListener(http)`, the request listener it is built on, for a server the Service creates itself, such as `createServer(options, nodeListener(http))`. The adapter answers two kinds of request itself, as Node already answers a malformed request before any listener runs, so `onAnswered` sees neither: a target in any other form (`*`, `host:port`, another scheme, credentials), one a web-standard `Request` cannot be built from, or a `Host` header that is missing or is more than a host and an optional port, gets 400; a method a web-standard `Request` refuses (`CONNECT`, `TRACE`, `TRACK`) gets `NO_SUCH_ENDPOINT` (404), since no Endpoint can have it. A handler that rejects is answered 500 with the Fault Envelope, `committed: 'unknown'`, and logged as `nodeListener: the handler rejected`.

### fastify

`@cf-loom/server/fastify` exports `fastifyServe(contract, handlers, options)`, a Fastify plugin that serves a Contract inside an app, beside the app's own routes, which keep working: a health check, static files, anything outside the Contract.

```ts
import Fastify from 'fastify';
import { fastifyServe } from '@cf-loom/server/fastify';
import handlers from '../src/handlers.generated.ts';

export const app = Fastify();
app.get('/healthz', async () => 'ok');   // the app's own route
await app.register(fastifyServe(contract, handlers, { resources, maxBodyBytes: 1_048_576 }));
```

- **Setup.** Fastify v5 is an optional peer dependency of `@cf-loom/server`, installed only by a Service that uses this adapter. `fastifyServe` takes what `serve` takes but `fallback`, which is a type error, since a request no Endpoint has goes on to the app. `serve`'s startup checks throw when `fastifyServe` is called, before `register`; registering it throws with a `prefix`, since an Endpoint's path is its whole path, and inside an encapsulated plugin, where its hook would cover only that plugin. It serves HTTP/1.1 and HTTP/2 alike: `Fastify({ http2: true })`, with or without `https`, and with `allowHTTP1`, where each request is served by its own version.
- **What it takes from Fastify.** Its global `onRequest` hook takes every request whose method and path a declared Endpoint has, Retired ones included, whatever app route matches it, and answers it as `serve` does.
- **What goes on to the app.** An undeclared path; another method on a declared path, which gets Fastify's 404, never `METHOD_NOT_ALLOWED` with `Allow`; `HEAD`, and `OPTIONS` unless an Endpoint declares it; a target or `Host` the adapter cannot read, such as `*` (`OPTIONS *` over either version), a `Host` that is more than a host and an optional port, or a `:scheme` other than `http` or `https`; and `TRACE` and `TRACK`, which a web-standard `Request` refuses (`CONNECT` never reaches Fastify: Node hands it to the server's `connect` event, and over HTTP/2 answers it 405 when nothing listens). `onAnswered` records only what cf-loom answered. A request taken that a web-standard `Request` cannot be built from is answered 400, as `nodeHttp` answers it.
- **Which app hooks see an Endpoint.** Its request is the app's no longer once taken. The app's `onRequest` hooks registered before the plugin run first, those of an encapsulated plugin included; one that answers keeps the request from cf-loom, and the headers they set on the reply are sent with the Endpoint's answer, `serve`'s own header winning where the names meet, and a `content-length` dropped, since Node frames the body. `onRequest` hooks registered after the plugin do not run. No `onSend` hook (compression among them), route handler, not-found handler, error handler or `handlerTimeout` touches the request. `onRequestAbort`, `onTimeout` and `onResponse` hooks and Fastify's request log see it.
- **When something fails once a request is taken**, such as a rejecting `serve` or a header an app hook set that Node refuses, the connection closes, or over HTTP/2 the request's stream is reset, with no response, the app's routes keep answering, and the request reaches `onRequestAbort`, never `onResponse` over HTTP/1.1; over HTTP/2 it reaches `onResponse` after it too, since Node finishes an HTTP/2 response on every close.
- **CORS headers and `Set-Cookie`** come from such an earlier `onRequest` hook, since the response is cf-loom's.
- **Body limits and parsing.** Fastify's `bodyLimit`, content-type parsers and schemas do not apply to Endpoints; `maxBodyBytes` governs.
- **`rewriteUrl`** applies: cf-loom routes on the URL it returns. The `Host` header is read as sent, never through `trustProxy`.
- **What Fastify answers first.** It answers three kinds of request before any hook runs: a segment that is not valid percent-encoding (400); when an app route shares the prefix, a param longer than `maxParamLength` (414); and, under its default `return503OnClosing`, a request that arrives while `app.close()` runs (503).

## Compiling schemas

zod can compile a schema to a faster parser the first time the schema parses. Whether a Service uses it is the organization's choice: cf-loom compiles nothing, turns nothing on and has no setting for it, so `serve`, `consume` and `client` parse with zod's regular parser until the process asks zod to compile.

`import 'zod/compile'` asks, through zod's global configuration, and reaches every schema built after it in the process, cf-loom's own included. A schema built before it is never compiled, so it goes first among the imports of the Service's entry point, or the process starts with a flag that loads it before any module:

```ts
import 'zod/compile';
import { serve } from '@cf-loom/server';
```

```sh
node --import zod/compile src/main.ts
```

- **One import reaches every parse.** The Input `serve` reads, the Success and Rejection bodies it checks before it sends them, the Message bodies `consume` reads with their Reader schemas and the Outcomes `client` reads with theirs. Nothing is set per Endpoint or per Message.
- **The Issues are the same.** zod documents that a compiled schema gives the results of the regular parser, and that invalid input falls back to the regular parser, so an invalid-input Rejection is the one it was. A Service should run its own tests with the import in place before relying on it.
- **Valid input is faster, invalid input is not.** In a benchmark of `serve` from `Request` to `Response`, and of a Delivery from its bytes to the Handler's return, with a Handler that does nothing and a body of about twenty fields and ten items, valid input took about half the time, a saving of microseconds to tens of microseconds, and invalid input about as long. A Handler's own work, such as a database call, does not shorten. Measure with the Service's own bodies.
- **What zod cannot compile stays regular.** A schema that is recursive, or holds a recursive one, keeps zod's regular parser, with the same results (see [Recursion](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#recursion) in the contract README). A host that forbids building code from strings gets the regular parser for every schema, with the same results: Node's `--disallow-code-generation-from-strings` is one such host, and a browser page whose Content-Security-Policy omits `unsafe-eval` is another.

## Types

- An object parameter whose shape cf-loom gives, such as an options object, refuses in its type a field it does not declare as [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md says.
- `Http`, re-exported from `@cf-loom/contract`: the handler `serve` returns.
- `ServeOptions<Resources>`, `{ resources?, maxBodyBytes?: BodyLimit, fallback?, onServiceFault?, onAnswered? }`: what `serve` takes, always given, besides the Contract and the Handler map: the Resources its Handlers take, required exactly when some Handler takes any, and what is operational about serving; none of it is part of the Contract.
- `fastifyServe`'s options: `ServeOptions` without `fallback`.
- `BodyLimit`, `number | 'unlimited'`: what `maxBodyBytes` takes, a whole number of bytes from 0 or no limit.
- `ServedFault`: what `onServiceFault` receives first, beside the `Request`, `{ declaration, name, guard? }` and `returned`, `thrown`, `invalid-outcome` or `runtime-bug`.
- `AnsweredRequest`, `{ method, endpoint?, path?, status, kind, code?, aborted, durationMs }`: what `onAnswered` receives first, beside the `Request`.
