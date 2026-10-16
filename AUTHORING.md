# Authoring

How a developer writes a Contract and the code that implements and consumes it. Terms are defined in [CONTEXT.md](CONTEXT.md); the rules for changing a Contract are in [COMPATIBILITY.md](COMPATIBILITY.md).

## Packages

| Package | Used by | Provides |
| --- | --- | --- |
| `@cf-loom/contract` | Services, Applications, Definitions Packages | Declarations: `contract`, `application`, `definitions`, `group`, `endpoint`, `guard`, `rejection`, `event`, `command`, `subscription`, `dependencies`, `openEnum`, `openUnion`; the Standard Rejections `invalidInput`, `notFound`, `notImplemented` |
| `@cf-loom/handlers` | Services | `handle`, `handle.stub`, `success`, `reject`, `admit`, `fault`; the `Outcome` and `Admission` types |
| `@cf-loom/server` | Services with Endpoints | `serve` |
| `@cf-loom/server/node-http` | Services on `node:http` | Adapter |
| `@cf-loom/client` | Callers | `client`; the `Client<D>` type |
| `@cf-loom/messaging` | Services with Messages | `messaging`: EventPublisher, CommandSender, `consume` for Subscriptions and Commands, `connect`, `close` |
| `@cf-loom/messaging/jetstream` | Services on NATS JetStream | Adapter; `@nats-io/*` is an optional peer dependency |
| `@cf-loom/messaging/memory` | Tests and local development | In-memory adapter |
| `@cf-loom/testing` | Tests of Consumers | `fakeProvider`, `fakeEvent` |
| `@cf-loom/cli` | Everyone | The `cf-loom` command; `config`; Contract directories under `@cf-loom/cli/directories` |

All packages are released together with one version. `zod` and `@cf-loom/contract` are peer dependencies of every cf-loom package and every Contract Package, so each process has one copy of each.

## Layout of a Service

```
src/
├── contract/                              declarations only
│   ├── index.ts                           contract({...})
│   ├── endpoints/
│   │   └── orders/
│   │       ├── orders.group.ts
│   │       ├── get-order.endpoint.ts
│   │       └── create-order.endpoint.ts
│   ├── guards/
│   │   └── api-key.guard.ts
│   ├── rejections/
│   │   └── order-locked.rejection.ts
│   ├── events/
│   │   ├── order-created.v1.event.ts
│   │   └── order-created.v2.event.ts
│   ├── commands/
│   │   └── charge-card.v1.command.ts
│   ├── subscriptions/
│   │   └── notify-on-settled.subscription.ts
│   └── dependencies/
│       └── payments-service.dependencies.ts
├── endpoints/orders/get-order.handler.ts  Handlers mirror contract/
├── guards/api-key.handler.ts
├── commands/charge-card.v1.handler.ts
├── subscriptions/notify-on-settled.handler.ts
├── handlers.generated.ts                  regenerated, never edited
├── messaging.ts                           EventPublisher, CommandSender
└── main.ts                                starts HTTP and messaging
```

File names are kebab-case: the Guard `apiKey` lives in `api-key.guard.ts` and its Handler in `api-key.handler.ts`. Files under `src/contract/` import only each other, `zod`, `@cf-loom/contract`, Definitions Packages and the Contract Packages listed as Dependencies (see [Where Contracts live](ARCHITECTURE.md#where-contracts-live)).

The examples below leave out imports of `zod`, `@cf-loom/contract` and sibling files.

## Declaring a Contract

### The root

```ts
// src/contract/index.ts
import orgDefinitions from '@org/definitions';

export default contract({
  name: 'orders-service',
  definitions: [orgDefinitions],
  groups: [ordersGroup],
  events: [orderCreatedV1, orderCreatedV2],
  commands: [chargeCardV1],
  subscriptions: [notifyOnSettled],
  dependencies: [paymentsDeps],
});
```

The root lists everything in the Contract: what it lists is exactly what the Snapshot describes. `name` must equal the unscoped part of the `name` in the Service's package.json. At most one listed Definitions Package may declare Standard Rejections.

Names follow fixed grammars, so they are safe in code, subjects and broker names: a Service, Application, Definitions Package, Group or Subscription name is kebab-case (`[a-z0-9-]+`); an Endpoint or Guard name is camelCase; a Message name is PascalCase; a Rejection code is UPPER_SNAKE_CASE. A Message Version is written `OrderCreated@2` in the Snapshot, the CLI and logs, `orderCreatedV2` in code, and `OrderCreated.v2` inside a subject.

### Groups and Endpoints

Every Endpoint belongs to exactly one Group.

```ts
// src/contract/endpoints/orders/orders.group.ts
export const ordersGroup = group({
  name: 'orders',
  description: 'Order lifecycle',
  endpoints: [getOrder, createOrder],
});
```

```ts
// src/contract/endpoints/orders/get-order.endpoint.ts
import { money } from '@org/definitions';

export const getOrder = endpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order by id',
  guards: [apiKey],
  input: {
    params: z.object({ orderId: z.uuid() }),
  },
  success: {
    status: 200,
    body: z.object({
      id: z.uuid(),
      status: openEnum(['pending', 'paid']),
      total: money,
    }),
  },
  rejections: [orderLocked],
});
```

- `name` is required and unique among the Contract's Endpoints that are not Retired. It is the client's method and the key in the published package; the Endpoint itself is identified by its method and path, and the Snapshot and every Dependency record both.
- `visibility` is required: `public`, `internal` or `private`.
- `success` declares a 2xx `status` and a `body`; nothing is implied. Only 204 has no body (`success: { status: 204 }`), and its Handler returns `success()`.
- `input` may hold `params`, `query`, `headers` and `body`. `params` must declare exactly the `:names` in the path, and is absent when the path has none. A strict `query` also admits the params its Guards demand; the EndpointHandler receives only the Endpoint's own.
- `rejections` lists the Endpoint's own Rejections. Those of its Guards are added without listing them, and so are the invalid-input and not-implemented Standard Rejections. The not-found Standard Rejection is added when the path has params; any other Endpoint that answers it lists `notFound` in `rejections`.
- Only shapes and declarative constraints are allowed: see [Not allowed in a Contract](COMPATIBILITY.md#not-allowed-in-a-contract).

### Rejections

A Rejection is declared once and referenced wherever it can be answered.

```ts
// src/contract/rejections/order-locked.rejection.ts
export const orderLocked = rejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ lockedAt: z.iso.datetime() }),
});
```

The three Standard Rejections, invalid input, not found and not implemented, are referenced as `invalidInput`, `notFound` and `notImplemented`, exported by `@cf-loom/contract`. Their code, status and message come from the Definitions Package listed on the root that declares them (see [Definitions Packages](#definitions-packages)), or from cf-loom's defaults: `INVALID_INPUT` 400, `NOT_FOUND` 404, `NOT_IMPLEMENTED` 501.

### Guards

```ts
// src/contract/guards/api-key.guard.ts
export const apiKey = guard({
  name: 'apiKey',
  demands: {
    headers: z.object({ 'x-api-key': z.string() }),
  },
  context: z.object({ clientId: z.string() }),
  rejections: [unauthenticated],
});
```

A Guard states what it demands from the request (`headers` or `query`, never the body), the Context it provides, and the Rejections it may answer. It holds no logic: its GuardHandler lives in each Service that attaches it. Its `name` keys its Context and must be unique across the Contract and every Definitions Package it lists; a duplicate fails the check.

### Events and Commands

Each Message Version is its own declaration and file.

```ts
// src/contract/events/order-created.v2.event.ts
export const orderCreatedV2 = event({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  body: z.object({ orderId: z.uuid(), total: money }),
});
```

```ts
// src/contract/commands/charge-card.v1.command.ts
export const chargeCardV1 = command({
  name: 'ChargeCard',
  version: 1,
  body: z.object({ orderId: z.uuid() }),
});
```

An Event's `visibility` is `internal` or `private`. A Command takes none: it is always Private.

### Lifecycle

Any Element takes `lifecycle: 'deprecated'`:

```ts
// src/contract/events/order-created.v1.event.ts
export const orderCreatedV1 = event({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  lifecycle: 'deprecated',
  body: z.object({ orderId: z.uuid(), total: z.number() }),
});
```

To retire it, mark it `lifecycle: 'retired'` and publish; this needs the Element Deprecated in the Baseline, no Dependency using it, and, for an Endpoint, a Breaking Change Approval (see [Retirement](COMPATIBILITY.md#retirement)). `handlers.generated.ts` leaves Retired Elements out, so their Handlers may then be deleted. Once a published Baseline records the Element as Retired, its declaration may be deleted too: `cf-loom publish` carries every Retired Element forward from the Baseline as a tombstone, so its identity is never reused (see [Lifecycle and tombstones](SNAPSHOT.md#lifecycle-and-tombstones)).

At runtime:

- A Deprecated Endpoint still works, and every HTTP response carries a `Deprecation` header; the client warns once per method.
- A Deprecated Event is still published until it is Retired, so Subscribers that have not moved on keep receiving it. A Deprecated Command is not sent, but its CommandHandler keeps running to drain what is already queued.
- A Retired Endpoint that is still declared answers 410 with `RETIRED`, which Callers receive as a Fault (see [Consuming a Contract](#consuming-a-contract)). Once deleted, it answers like any undeclared method and path: 404 with `NO_SUCH_ENDPOINT`, also a Fault, never the not-found Rejection.
- A Retired Message cannot be published or sent (a type error), and its Handler is not consumed.

### Open Enums and Open Unions

```ts
status: openEnum(['pending', 'paid'])
payment: openUnion('type', [card, transfer])
```

Readers get a type with an Unknown case and must handle it: an unknown enum value arrives as `{ unknown: 'refunded' }`, and an unknown union variant as `{ type: { unknown: 'crypto' }, raw }`, so TypeScript can tell them from the declared ones. Writers may only use the declared values. `openEnum()` and `openUnion()` infer the writer type; the reader types are derived from the Snapshot.

### Dependencies

Install the other Service's Contract Package, then declare what is used:

```bash
npm install @org/contract-payments-service
npx cf-loom add-dependency payments-service getPayment
```

```ts
// src/contract/dependencies/payments-service.dependencies.ts
import payments from '@org/contract-payments-service';

export const paymentsDeps = dependencies(payments, {
  endpoints: [payments.endpoints.getPayment],
  events: [payments.events.paymentSettledV1],
});
```

A Service may depend on Public or Internal Elements; an Application only on Public ones. The client has methods only for the Endpoints listed, and a Subscription may only reference an Event listed here. An Event listed here that no Subscription uses fails the check, since it would block that Event's retirement for nothing.

### Subscriptions

```ts
// src/contract/subscriptions/notify-on-settled.subscription.ts
export const notifyOnSettled = subscription({
  name: 'notify-on-settled',
  event: paymentsDeps.events.paymentSettledV1,
});
```

`name` is unique in the Service and names the Subscription's durable queue (`orders-service_notify-on-settled`). The Event is the Service's own or one listed in a Dependency. Neither ever changes: to follow a new Message Version, add a new Subscription and remove the old one in a later Release (see [Subscriptions](COMPATIBILITY.md#subscriptions)).

## The Contract Package

`cf-loom publish` generates the Contract Package's code from the Snapshot; no source file is bundled. It writes the zod schemas, the writer and reader types, the entry point and the package.json for the Public and Internal Elements that are not Retired, with the Guards, Rejections and schemas they use, plus the Snapshot itself. What is published is exactly what the Snapshot describes, and no Private code can leak into it:

```ts
// generated entry point of @org/contract-payments-service
export default {
  name: 'payments-service',
  endpoints: { getPayment, createPayment },          // keyed by Endpoint name
  events: { paymentSettledV1, paymentSettledV2 },    // name with its first letter lower-cased + 'V' + version
  standardRejections,                                // resolved codes, statuses and messages
};
export { snapshot };
```

Private Elements, Commands, Subscriptions and Dependencies are never exported. Schemas from Definitions Packages are written into the generated code and Dependencies are data in the Snapshot, so the package.json declares only `@cf-loom/contract` and `zod`, as peers with a caret range on the versions it was built with. Contract Packages built on different cf-loom majors conflict in one Consumer, so a cf-loom major republishes the Contract Package as a major of its own (see [Versioning](COMPATIBILITY.md#versioning)). The Service itself installs the Contract Packages it depends on as ordinary dependencies, since its client and Subscriptions use them.

## Implementing a Contract

`cf-loom generate` writes a stub for every Handler that does not exist yet, never overwriting one, and regenerates `handlers.generated.ts`. A stub is `export default handle.stub(getOrder)`, which marks the Handler as not implemented; implementing it means replacing that line with `handle(getOrder, async (…) => …)`. `serve` answers the not-implemented Rejection for an EndpointHandler stub, and for every Endpoint attaching a GuardHandler stub, which never admits. `consume` does not consume a Message Handler stub and logs a warning; its Messages wait in the broker, within the organization's retention, until a Release with the real Handler drains them. Either way a Contract can be merged and published before it is implemented. A missing Handler is a type error.

### EndpointHandler

```ts
// src/endpoints/orders/get-order.handler.ts
import { handle, reject, success } from '@cf-loom/handlers';

export default handle(getOrder, async ({ params }, context) => {
  const order = await orders.find(params.orderId, context.apiKey.clientId);
  if (!order) return reject(notFound);
  if (order.locked) return reject(orderLocked, { lockedAt: order.lockedAt });
  return success({ id: order.id, status: order.status, total: order.total });
});
```

- The first argument is the validated Input; the second is the Context, one key per attached Guard.
- Only the Endpoint's Rejections type-check in `reject`, each with its declared body.
- Anything thrown becomes a Fault with `committed: 'unknown'` and `retryable: false`, because a Caller cannot know whether it may retry. A Handler that knows better returns `fault({ committed: 'no', retryable: true })`, just as it returns `success` and `reject`. Message Handlers differ: there a throw has the Message delivered again (see [Message Handlers](#message-handlers)).

### GuardHandler

```ts
// src/guards/api-key.handler.ts
export default handle(apiKey, async ({ headers }) => {
  const client = await clients.byKey(headers['x-api-key']);
  if (!client) return reject(unauthenticated);
  return admit({ clientId: client.id });
});
```

A GuardHandler receives only what its Guard demands. Every attached Guard, declared locally or imported from a Definitions Package, gets its Handler at `src/guards/<guard-name>.handler.ts`, its name in kebab-case. Guards run in the order the Endpoint lists them, before the Endpoint's own Input is validated: each Guard first validates only what it demands, answering the invalid-input Rejection if that fails, then its GuardHandler runs. The first Rejection stops the request, so an unauthenticated Caller learns nothing about the Endpoint's Input, and the EndpointHandler only runs with valid Input.

### Messaging

The EventPublisher and CommandSender are created once, in their own module, and imported where needed:

```ts
// src/messaging.ts
import { messaging } from '@cf-loom/messaging';
import contract from './contract';

export const { publisher, sender, consume, connect, close } = messaging(contract);
```

`messaging` takes no broker: `connect(broker)` binds one, so `src/main.ts` connects the JetStream adapter and a test connects the in-memory one (see [Testing](#testing)). Creating `messaging` opens no connection. Publishing, sending or consuming before `connect` throws, and so does connecting while connected; `close()` returns to not connected, so a test connects in its setup and closes in its teardown. The Service connects at startup so a broker problem fails there rather than inside a request, and calls `close()` at shutdown, which stops consuming, waits for the Handlers running and closes the connection. Broker options come from the Service; cf-loom has no defaults for them.

### Publishing and sending

```ts
// in any Handler
import { publisher, sender } from '../../messaging';

await publisher.publish('OrderCreated', {
  v1: { orderId, total: total.amount },   // Deprecated, still published
  v2: { orderId, total },
});
await sender.send('ChargeCard', { orderId });
```

`publish` takes an Event's name and one body for each of its Active and Deprecated versions: leaving one out, or passing a Retired one, is a type error, so adding a new Message Version flags every place that publishes the Event. `send` takes a Command's name and sends its one Active version. Both validate the body before it leaves.

All the Messages of one call share a Fact id, which every Message Handler receives to recognize a fact it already handled. The Fact id is random unless the caller passes one:

```ts
await publisher.publish('OrderCreated', { v1, v2 }, { factId: `${order.id}:created` });
```

Each Message is sent with `<factId>.v<version>` as its broker message id (JetStream's `Nats-Msg-Id`), so the broker drops a duplicate within its deduplication window. If any version fails, `publish` throws, and the caller retries the whole call with the same Fact id: versions already sent are dropped as duplicates. How long that window lasts is the organization's broker configuration; beyond it, Handlers still recognize the fact by its id.

### Message Handlers

```ts
// src/subscriptions/notify-on-settled.handler.ts
export default handle(notifyOnSettled, async (body, { messageId, factId }) => {
  await notifications.send(body.paymentId);
});
```

A CommandHandler has the same shape. Delivery is at least once, so every Message Handler must be safe to run again. Returning acknowledges the Message; throwing, or a Fault with `retryable: true`, has it delivered again; a Fault with `retryable: false` ends it without redelivery and logs it. How often and how fast a Message is delivered again, and what happens after the last attempt, belong to the organization's broker configuration.

Messages are validated with reader schemas built from the Snapshot, in which every object is open. A Message that fails its schema never reaches the Handler: it is ended without redelivery and logged with its subject, ids and the validation errors; where it goes next is the organization's broker configuration.

### The broker

Where a Message travels follows from the Contract, so a Subscriber finds another Service's Events from its Contract Package alone: each Service owns one stream named after it, and each Message Version has the subject `<service>.<event|command>.<Name>.v<version>` (`orders-service.event.OrderCreated.v2`). An optional prefix, passed to the adapter at runtime and to `cf-loom broker-plan --prefix`, goes in front of every subject, stream and consumer name (`staging.orders-service.event.OrderCreated.v2`, `staging_orders-service`), so several environments can share one broker.

`cf-loom broker-plan` prints the desired state from the Snapshots: each stream and its subjects, each Subscription's durable consumer and the stream it reads, each Command Version's consumer (`orders-service_command_ChargeCard_v1`, which no kebab-case Subscription name can collide with), the consumers left over from removed Subscriptions and Retired Command Versions, and which subjects each Service may publish and subscribe to. Nothing applies it by default (see [Messages](ARCHITECTURE.md#messages) in ARCHITECTURE.md); the organization applies it with the adapter's `apply`, in a deploy step, or from its own infrastructure tooling:

```ts
await broker.apply(plan, limits);                    // creates and updates, never removes
await broker.apply(plan, limits, { prune: true });   // also deletes orphaned consumers
```

`plan` is the JSON `cf-loom broker-plan --json` printed; computing it needs the Baseline and the registry, which a running Service does not have. Without `prune`, `apply` only creates streams and consumers, adds subjects and updates limits, so a Release running side by side with an older plan never removes what a newer Release needs. Pruning deletes the consumers of removed Subscriptions and Retired Command Versions, so it runs only once the Release that dropped them is no longer running (see the deploy rule in [ARCHITECTURE.md](ARCHITECTURE.md#messages)).

### Serving

```ts
// src/main.ts
import { serve } from '@cf-loom/server';
import { nodeHttp } from '@cf-loom/server/node-http';
import { jetstream } from '@cf-loom/messaging/jetstream';
import contract from './contract';
import handlers from './handlers.generated';
import { connect, consume, close } from './messaging';

await connect(jetstream({
  servers: process.env.NATS_URL!,
  prefix: process.env.BROKER_PREFIX,   // optional, e.g. one per environment
}));
const http = serve(contract, handlers);      // (Request) => Promise<Response>
nodeHttp(http).listen(3000);
await consume(handlers);

process.on('SIGTERM', () => close());
```

`serve` returns a web-standard handler that an adapter connects to the host (see [Runtime](ARCHITECTURE.md#runtime)). It refuses a body over 1 MB with `BODY_TOO_LARGE`, a safety default that `serve(contract, handlers, { maxBodyBytes })` overrides. The limit is operational, not part of the Contract.

`serve` validates every Success and Rejection body before sending it. A Handler's answer that type-checks but breaks a constraint is never sent: the Caller receives a Fault with `INVALID_OUTCOME`, `committed: 'unknown'` and `retryable: false`, and the validation issues go to the Service through `serve(contract, handlers, { onFault })`, never to the Caller. `messaging(contract, { onFault })` receives what Message Handlers end or fail with: a Message ended for failing its schema, a Fault with `retryable: false`, and anything thrown. Without `onFault`, cf-loom writes them to the console.

## Consuming a Contract

```ts
import { client } from '@cf-loom/client';

const payments = client(paymentsDeps, {
  baseUrl,
  headers: { 'x-api-key': settings.paymentsKey },   // a string
});
const outcome = await payments.getPayment({ params: { paymentId } });

switch (outcome.kind) {
  case 'success':
    return outcome.value.amount;
  case 'rejection':
    if (outcome.known && outcome.code === 'NOT_FOUND') return null;
    throw new Error(outcome.message);
  case 'fault':
    if (outcome.retryable) return retry();
    throw new Error('payments-service failed');
}
```

The client has one method per Endpoint listed in the Dependency, named after it, and returns an Outcome: it never throws for a Rejection or a Fault. It reads the provider's Standard Rejection codes from the provider's Contract Package, so a Caller receives the provider's codes, not its own.

A Rejection travels with its declared status and a body cf-loom defines, `{ rejection: { code, message, body } }`. Rejection codes are open for Callers. A Rejection Outcome carries `known`: when `true`, `code` is one of the declared codes and `body` its declared type; when `false`, the client did not know the code, and `code` is the raw string and `body` unvalidated. Checking `known` first lets TypeScript narrow by code.

A Fault travels with a body cf-loom defines, `{ fault: { committed, retryable, message } }`, where `committed` is `'no'`, `'yes'` (done, but the answer was lost) or `'unknown'`. The server answers it with 503 when it is retryable and 500 otherwise; `RETIRED` (410), `NO_SUCH_ENDPOINT` (404) and `BODY_TOO_LARGE` (413) use the same body with a `code` (`{ fault: { code, committed: 'no', retryable: false, message } }`), and `INVALID_OUTCOME` (500) too, with `committed: 'unknown'`; the client's Fault Outcome exposes that `code`. A malformed body or a wrong content type is the invalid-input Rejection; a request to a declared path with an undeclared method is `NO_SUCH_ENDPOINT`. An HTTP response that is neither the Success, a Rejection body nor a Fault body becomes a Fault inferred from what happened:

| HTTP response | Fault |
| --- | --- |
| No connection, or 429 / 503 without a Fault body | `committed: 'no'`, `retryable: true` |
| Anything else (502, 504, a timeout or reset after sending…) | `committed: 'unknown'`, `retryable: false` |

`client(deps, { fetch })` replaces the global `fetch`, for instrumentation, a runtime without one, or a test (see [Testing](#testing)). Code that calls another Service can depend on the `Client<typeof paymentsDeps, 'x-api-key'>` type rather than on `client()` itself; its second parameter names the headers supplied when the client is created, which its methods no longer require.

Headers an Endpoint or its Guards demand are typed, with lower-case names. Those given to `client()`, as values or as a function called per request (which may be async, to refresh a token), need not be passed again; any still missing is a required `headers` field on each call that needs it. Query params, a Guard's included, are always passed per call.

## Testing

cf-loom keeps its API test-friendly and ships testing helpers only where hand-written test doubles would drift from a Contract. Which test runner, mocking library, fixtures or end-to-end tools a Service uses is the organization's choice; an HTTP test through a host adapter uses that host's own tools, such as supertest.

### A Service's own code

A Handler returned by `handle()` is a function. Calling it runs the same checks `serve` and `consume` run: Input that breaks the Contract, or an Outcome that breaks a constraint, throws with the validation issues, so a unit test catches what production would answer as `INVALID_OUTCOME`. Otherwise a direct call returns what `serve` or `consume` would:

- Anything the Handler throws becomes the Fault `serve` would answer, carrying the original error as `cause` so the test can see it.
- An Endpoint or Guard stub returns the not-implemented Rejection; a Message Handler stub throws, since `consume` never runs it.
- A GuardHandler validates only what its Guard demands, and checks an `admit()` against the Guard's `context` schema; `serve` answers an invalid `admit()` with `INVALID_OUTCOME`.
- The Context passed to an EndpointHandler is checked against each attached Guard's `context` schema.

```ts
import getOrderHandler from '../src/endpoints/orders/get-order.handler';

const outcome = await getOrderHandler(
  { params: { orderId: ORDER_ID } },
  { apiKey: { clientId: 'c-1' } },          // the Context, one key per Guard
);
```

The handler map `handlers.generated.ts` exports is plain data, `{ endpoints, guards, commands, subscriptions }`, so a test replaces one Handler, a Guard's for example, by spreading the map:

```ts
const http = serve(contract, {
  ...handlers,
  guards: { ...handlers.guards, apiKey: handle(apiKey, async () => admit({ clientId: 'c-1' })) },
});
const res = await http(new Request(`http://test/orders/${ORDER_ID}`, {
  headers: { 'x-api-key': 'any' },          // still demanded by the Contract
}));
```

### Messages

`@cf-loom/messaging/memory` is a broker adapter that keeps everything in memory, for tests and local development:

```ts
import { memory } from '@cf-loom/messaging/memory';
import { connect, consume } from '../src/messaging';
import handlers from '../src/handlers.generated';

const broker = memory();
await connect(broker);
await consume(handlers);
await createOrderHandler({ body: newOrder }, { apiKey: { clientId: 'c-1' } });

await broker.settled();   // every Message published or sent so far has been handled
broker.messages;          // OrderCreated v1 and v2 with one Fact id, then ChargeCard v1

await broker.deliver(paymentsDeps.events.paymentSettledV1, body, { factId: 'pay-1' });
// → 'acked' | 'redelivered' | 'ended'
```

- It records every Message with its subject, body, Fact id and broker message id, and delivers what is published or sent to the Service's consumed Subscriptions and CommandHandlers, acknowledging or ending each Message as `consume` does. `settled()` waits until every Message so far has been handled.
- A repeated broker message id from `publish` or `send` is dropped, for the adapter's whole lifetime. `deliver(element, body, meta)` always delivers, with a body typed by the Event or Command, so a test can deliver the same fact twice to check that a Handler is safe to run again.
- It never redelivers on its own: a Message whose Handler asked for redelivery is listed in `broker.pending`. Delivering to a stub, or to an Event no Subscription consumes, throws. It models nothing of the organization's broker configuration (deduplication window, redelivery limits, backoff, retention) and ignores `apply`: it is not a broker emulator, and tests against a real broker remain the organization's.

### Other Services

`@cf-loom/testing` fakes the Services a Consumer depends on, checked against the provider's Snapshot, so a fake can never answer what the provider could not:

```ts
import { fakeProvider, fakeEvent } from '@cf-loom/testing';

const payments = fakeProvider(paymentsDeps);
payments.on('getPayment')
  .once(r => r.reject('NOT_FOUND'))                    // a declared code, with its declared body
  .once(r => r.reject({ unknown: 'CARD_EXPIRED' }, {})) // a code the provider does not declare
  .once(r => r.fault({ committed: 'no', retryable: true }))
  .once(r => r.noConnection())                         // the client infers the Fault
  .once(r => r.status(502))
  .otherwise((r, { params }) => r.success({ id: params.paymentId, amount }));

const settlement = new SettlementService(payments.client({ headers: { 'x-api-key': 'k' } }));
payments.calls('getPayment');                         // what the code under test called

const settled = fakeEvent(paymentsDeps.events.paymentSettledV1, { paymentId: PAYMENT_ID });
await notifyOnSettledHandler(settled, { messageId: 'pay-1.v1', factId: 'pay-1' });
```

- `fakeProvider` validates each request as the provider would, its Input and its Guards' demands, and answers the provider's invalid-input Rejection when it fails, so a Consumer that forgets a header fails its test. `payments.client(options)` returns a real client over the fake, and `payments.fetch` serves code that builds its own client with `client(deps, { fetch })`.
- Each step receives a builder typed by the Endpoint, so codes and bodies autocomplete from the provider's Contract and nothing collides with `@cf-loom/contract` or `@cf-loom/handlers`. A call with no step left and no `otherwise` throws in the test.
- `fakeProvider` scripts the Outcomes of the Endpoints a Dependency lists and serves them to the real client through `fetch`, so the Consumer's code also runs the client's decoding: unknown codes arrive with `known: false`, and Faults are inferred as from a real response. A Success or Rejection body is checked against the provider's schemas, shapes and constraints alike.
- `fakeEvent` builds an Event body as a Subscriber reads it, and the Outcomes scripted in `fakeProvider` are written as a Caller reads them. Declared parts are checked against the provider's schemas, shapes and constraints alike; an Unknown case, `{ unknown: 'refunded' }`, is checked only to make sure `'refunded'` is not a declared value. That is how a test reaches the code that handles values the provider may add later.
- A Message Handler called directly takes its body the same way, as a Subscriber reads it.
- The package fakes only other Services. A Service's own Handlers, Guards and Messages are tested with the API above.

## Applications

An Application has the same layout with only Dependencies:

```ts
// web-admin/src/contract/index.ts
export default application({
  name: 'web-admin',
  dependencies: [ordersDeps, paymentsDeps],
});
```

## Definitions Packages

A Definitions Package lives in its own repository:

```ts
// definitions/src/definitions/index.ts, published as @org/definitions
export default definitions({
  name: 'definitions',
  guards: [userToken],
  schemas: { money, pagination },
  rejections: [unauthenticated, forbidden],
  standardRejections: {
    invalidInput:   { code: 'BAD_REQUEST',     status: 400, message: 'The request is invalid' },
    notFound:       { code: 'NOT_FOUND',       status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented yet' },
  },
});
```

Services import its Guards and schemas directly and list it on their `contract` root.

## Configuration

Each Service, Application or Definitions Package configures the tools in `cf-loom.config.ts`, next to its package.json: at the root of its repository, or in its own directory of a monorepo, where the CLI runs. The CLI reads it; it is never part of the Snapshot or the published package.

```ts
// cf-loom.config.ts
import { config } from '@cf-loom/cli';
import { github } from '@cf-loom/cli/directories';

export default config({
  scope: '@org',                     // publishes @org/contract-orders-service
  registry: 'https://npm.internal.example',
  directory: github({ org: 'org' }),   // how to list every Contract Package in the scope
  // optional: only when cf-loom should verify Approvals itself
  approvals: myApprovalSource,
  approvers: ['@org/platform-team'],
  allowSelfApproval: false,
});
```

A Contract Package is named `<scope>/contract-<name>`, and a Definitions Package `<scope>/<name>`.

## The CLI

| Command | Does |
| --- | --- |
| `cf-loom init [service \| application \| definitions]` | Creates the root under `src/contract/` (or `src/definitions/`) |
| `cf-loom add-endpoint <group> <name> <METHOD> <path> --visibility <v>` | Creates the Endpoint, its Group if new, and registers both |
| `cf-loom add-guard <name>` | Creates a Guard |
| `cf-loom add-rejection <CODE> --status <n>` | Creates a Rejection |
| `cf-loom add-event <Name> --visibility <v> [--version n]` | Creates an Event, or its next Message Version |
| `cf-loom add-command <Name> [--version n]` | Creates a Command, or its next Message Version |
| `cf-loom add-subscription <name> [<service>] <Name>@<n>` | Creates a Subscription to an Event, the Service's own unless `<service>` is given, in which case the Event is also added to the Dependencies |
| `cf-loom add-dependency <service> <element>` | Adds an Element of an installed Contract Package to the Dependencies: an Endpoint by name, an Event as `<Name>@<n>` |
| `cf-loom generate` | Writes the stub of every missing Handler, regenerates `handlers.generated.ts` and writes `contract.snapshot.json` |
| `cf-loom broker-plan [--prefix <p>] [--json]` | Prints the streams, consumers, orphaned consumers and permissions the broker must hold |
| `cf-loom route-plan [--json]` | Prints every route with its Visibility, and the Retired ones, for the organization's gateway or ingress |
| `cf-loom verify` | Fails if a generated file was edited or is out of date |
| `cf-loom check [--line <major>] [--json]` | Runs the Compatibility Check against the Baseline; a distinct exit status means the change needs a Breaking Change Approval |
| `cf-loom publish [--line <major>] [--force]` | Builds the Contract, writes the Snapshot, derives the version and publishes the Contract Package; does nothing when nothing changed unless `--force` |
