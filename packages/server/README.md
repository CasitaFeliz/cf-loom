# @casitafeliz/loom-server

`serve`, which answers a Contract's Endpoints with their Handlers; `@casitafeliz/loom-server/node-http` is its adapter for `node:http`. How `serve` validates what it sends is in [ARCHITECTURE.md](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/ARCHITECTURE.md); how an Outcome travels, routing and text conversion included, is in [Wire protocol](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#wire-protocol) in the root ARCHITECTURE.md. Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

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

How `serve` validates every Outcome before sending it is in [Validation](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/ARCHITECTURE.md#validation). `serve(contract, handlers, { onFault })` receives every Fault cf-loom answers that the Handler did not return itself: a throw or a return that is no Outcome, with the error (or a `TypeError` naming what came back) as `cause`; `INVALID_OUTCOME`, with the issues; and a Context or Qualifier `serve` built that breaks the Contract, the runtime's own bug, with the issues. A Fault the Handler returns never reaches it. Without an `onFault`, they go to the console (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md). What `messaging`'s `onFault` receives is in [Connecting](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#connecting) in the messaging README.

`serve(contract, handlers, { onOutcome })` receives `{ endpoint, status, kind, durationMs }` for every request it answers: the Endpoint's name, absent when none matched, the HTTP status, `'success'`, `'rejection'` or `'fault'`, and the time taken. It is the hook for metrics and tracing; cf-loom ships no exporter, the backend is the organization's. On the Caller's side the `fetch` option of the client does the same (see [Consuming a Contract](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#consuming-a-contract) in the client README).

## node-http

`@casitafeliz/loom-server/node-http` exports `nodeHttp`, the adapter that connects the handler `serve` returns to `node:http`, as `nodeHttp(http).listen(3000)` does above.
