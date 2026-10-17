# Authoring

How a developer writes a Contract and the code that implements and consumes it. Terms are defined in [CONTEXT.md](CONTEXT.md); the rules for changing a Contract are in [COMPATIBILITY.md](COMPATIBILITY.md).

## Packages

| Package | Used by | Provides |
| --- | --- | --- |
| `@cf-loom/contract` | Services, Applications, Definitions Packages | Declarations: `contract`, `application`, `definitions`, `group`, `endpoint`, `guard`, `rejection`, `event`, `command`, `subscription`, `dependencies`, `openEnum`, `openUnion`; the Standard Rejections `invalidInput`, `notFound`, `notImplemented` |
| `@cf-loom/handlers` | Services | `handle`, `handle.stub`, `success`, `reject`, `admit`, `fault`; the `Outcome`, `Admission` and Handler types (`EndpointHandler`, `GuardHandler`, `CommandHandler`, `EventHandler`) |
| `@cf-loom/server` | Services with Endpoints | `serve` |
| `@cf-loom/server/node-http` | Services on `node:http` | Adapter |
| `@cf-loom/client` | Callers | `client`; the `Client<D, Configured>` type |
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
├── readers.generated.ts                   reader schemas and types of the Service's own Events; regenerated, never edited
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
  rejections: [notFound, orderLocked],
});
```

- `name` is required and unique among the Contract's Endpoints that are not Retired. It is the client's method and the key in the published package; the Endpoint itself is identified by its method and path, and the Snapshot and every Dependency record both.
- `visibility` is required: `public`, `internal` or `private`.
- `success` declares a 2xx `status`, a `body` and optionally `headers`, an object of the HTTP headers the Endpoint promises with its Success; nothing is implied. Only 204 has no body (`success: { status: 204 }`), and its Handler returns `success()`. Headers follow the text rules of Input headers, and the object is always open (see [Headers, path and query](COMPATIBILITY.md#headers-path-and-query) in COMPATIBILITY.md).
- `input` may hold `params`, `query`, `headers` and `body`. `params` must declare exactly the `:names` in the path, and is absent when the path has none. A strict `query` also admits the params its Guards demand; the EndpointHandler receives only the Endpoint's own.
- `rejections` lists the Endpoint's own Rejections, `notFound` among them when it answers it. Those of its Guards, and the two Rejections cf-loom's runtime produces, invalid input and not implemented, are added without listing them (see [Rejections](COMPATIBILITY.md#rejections) in COMPATIBILITY.md).
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

The three Standard Rejections, invalid input, not found and not implemented, are referenced as `invalidInput`, `notFound` and `notImplemented`, exported by `@cf-loom/contract`. Their code, status and message come from the Definitions Package listed on the root that declares them (see [Definitions Packages](#definitions-packages)), or from cf-loom's defaults: `INVALID_INPUT` 400 "Invalid input", `NOT_FOUND` 404 "Not found", `NOT_IMPLEMENTED` 501 "Not implemented".

The body of the invalid-input Rejection is cf-loom's, whatever the Definitions Package declares, and its runtime produces it:

```ts
{ issues: [{ in: 'params' | 'query' | 'headers' | 'body', path: (string | number)[], code: string, message: string }] }
```

`code` is one of a closed set cf-loom owns, not zod's issue codes: `required`, `invalid_type`, `invalid_value`, `invalid_format`, `too_small`, `too_big`, `not_multiple`, `unrecognized_key` and `malformed` (an unparseable body or a wrong content type). An issue never carries the received value.

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

An Event takes `visibility`, a Command none; which Visibilities each kind of Element may have is in [Visibility and Guards](ARCHITECTURE.md#visibility-and-guards) in ARCHITECTURE.md.

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

- A Deprecated Endpoint still works, and every HTTP response carries `Deprecation: @<unix seconds>` (RFC 9745), the instant `generate` stamped as `deprecatedAt` when it first saw the Endpoint Deprecated (see [Endpoints](SNAPSHOT.md#endpoints) in SNAPSHOT.md); the client warns once per method. A Deprecated Message Version carries no header: none exists for it.
- A Deprecated Event is still published until it is Retired, so Subscribers that have not moved on keep receiving it. A Deprecated Command is not sent, but its CommandHandler keeps running to drain what is already queued.
- A Retired Endpoint that is still declared answers the `RETIRED` Fault; once deleted, its URLs route like any other request, and `NO_SUCH_ENDPOINT` answers when nothing matches, never the not-found Rejection (see [Wire protocol](#wire-protocol)).
- A Retired Message cannot be published or sent (a type error), and its Handler is not consumed.

### Open Enums and Open Unions

```ts
status: openEnum(['pending', 'paid'])
payment: openUnion('type', [card, transfer])
```

Readers get a type with an Unknown case and must handle it: an unknown enum value arrives as `{ unknown: 'refunded' }`, and an unknown union variant as `{ type: { unknown: 'crypto' }, raw }`, so TypeScript can tell them from the declared ones. Writers may only use the declared values. `openEnum()` and `openUnion()` infer the writer type only; reader types and schemas are generated from the Snapshot (see [The Contract Package](#the-contract-package)).

### Dependencies

Install the Provider's Contract Package, then declare what is used:

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

The client has methods only for the Endpoints listed, and a Subscription may only reference an Event listed here; which Elements a Service or an Application may depend on is in [Dependencies](ARCHITECTURE.md#dependencies) in ARCHITECTURE.md. An Event listed here that no Subscription uses fails the check, since it would block that Event's retirement for nothing.

### Subscriptions

```ts
// src/contract/subscriptions/notify-on-settled.subscription.ts
export const notifyOnSettled = subscription({
  name: 'notify-on-settled',
  event: paymentsDeps.events.paymentSettledV1,
});
```

`name` is unique in the Service and names the Subscription's durable consumer (`orders-service_notify-on-settled`). The Event is the Service's own or one listed in a Dependency. Neither ever changes: to follow a new Message Version, add a new Subscription and remove the old one in a later Release (see [Subscriptions](COMPATIBILITY.md#subscriptions)).

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

Private Elements, Commands, Subscriptions and Dependencies are never exported. Schemas from Definitions Packages are written into the generated code and Dependencies are data in the Snapshot, so the package.json declares only `@cf-loom/contract` and `zod`, as peers with a caret range on the versions it was built with, and carries the `cfLoom` metadata (see [Where it lives](SNAPSHOT.md#where-it-lives) in SNAPSHOT.md). Contract Packages built on different majors of a peer conflict in one Consumer, so a new major of either peer republishes the Contract Package as a major of its own (see [Versioning](COMPATIBILITY.md#versioning)). The Service itself installs the Contract Packages it depends on as ordinary dependencies, since its client and Subscriptions use them.

Reader schemas and types always come from a Snapshot, the same way for every Visibility, never from a type-level walk of the zod schema: a Contract Package's from its published Snapshot, for Dependencies; a Service's own Events' from its declared Snapshot, written by `generate` to `readers.generated.ts`. Every object in them is open and every Open Enum and Open Union has its Unknown case. The client's validation of what it receives, the Message Handlers and the fakes of `@cf-loom/testing` all use these generated readers.

## Implementing a Contract

`cf-loom generate` writes a stub for every Handler that does not exist yet, never overwriting one, and regenerates `handlers.generated.ts` and `readers.generated.ts` (see [The Contract Package](#the-contract-package)). A stub is `export default handle.stub(getOrder)`, which marks the Handler as not implemented; implementing it means replacing that line with `handle(getOrder, async (…) => …)`. `serve` answers the not-implemented Rejection for an EndpointHandler stub, and for every Endpoint attaching a GuardHandler stub, which never admits. `consume` does not consume a Message Handler stub and logs a warning; its Messages wait in the broker, within the organization's retention, until a Release with the real Handler drains them, as long as the stream retains them: an interest-retention stream with no consumer drops them. Either way a Contract can be merged and deployed with stubs before it is implemented, and is published with that Release (see [The Compatibility Check](COMPATIBILITY.md#the-compatibility-check) in COMPATIBILITY.md). A missing Handler is a type error.

`handlers.generated.ts` exports the handler map, plain data with four keys: `endpoints` by Endpoint name, `guards` by Guard name, `commands` by code name (`chargeCardV1`) and `subscriptions` by Subscription name, a quoted key (`'notify-on-settled'`). Handler types are nominal over their Element (`EndpointHandler<typeof getOrder>`), so the map type-checks by Element, not by inferred payload.

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
- Only the Endpoint's Rejections type-check in `reject`, each with its declared body. A Rejection Outcome carries the declaration and the body, not a resolved code, status or message: `serve` resolves them against the root (see [Rejections](#rejections)). The `Outcome` type of `@cf-loom/handlers` is therefore not the client's (see [Consuming a Contract](#consuming-a-contract)).
- When the Endpoint declares `success.headers`, the Handler returns them with the Success, `success({ headers, body })` (`success({ headers })` for 204); otherwise `success(body)`.
- Anything thrown becomes a Fault with `committed: 'unknown'` and `retryable: false`, since nothing says the same request could succeed later, and the fixed message `Internal error`; the error itself reaches only `onFault`, as `cause` (see [Serving](#serving)). A Handler that knows better returns `fault({ committed: 'no', retryable: true })`, just as it returns `success` and `reject`. Message Handlers differ: there a throw has the Message delivered again (see [Message Handlers](#message-handlers)).

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

`messaging` takes no broker: `connect(broker)` binds one, so `src/main.ts` connects the JetStream adapter and a test connects the in-memory one (see [Testing](#testing)). Creating `messaging` opens no connection. Publishing, sending or consuming before `connect` throws, and so does connecting while connected; `close()` returns to not connected, so a test connects in its setup and closes in its teardown. The Service connects at startup so a broker problem, a missing stream or consumer included (see [The broker](#the-broker)), fails there rather than inside a request, and calls `close()` at shutdown, which stops consuming, waits for the Handlers running and closes the connection. Broker options come from the Service; cf-loom has no defaults for them.

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

All the Messages of one call share a Fact id, which every Message Handler receives to recognize a fact it already handled. The Fact id is random unless the calling code passes one:

```ts
await publisher.publish('OrderCreated', { v1, v2 }, { factId: `${order.id}:created`, headers: { traceparent } });
```

`headers` are transport headers, `traceparent` for one: opaque strings cf-loom passes to the broker unread and hands to every Message Handler in its meta (see [Message Handlers](#message-handlers)). They are not part of the Contract and never validated; the two names cf-loom sets itself (see [The broker](#the-broker)) are refused.

Each Message is sent with `<Name>.v<version>:<factId>` as its broker message id (`OrderCreated.v2:o-1:created`), unique within the Service's stream since a name belongs to one kind, so the broker drops a duplicate within its deduplication window. The Fact id also travels in its own header, `Cf-Loom-Fact-Id`, and is never parsed out of the id. If any version fails, `publish` throws an error that names the Fact id and the versions already sent, and the Handler that called `publish` retries the whole call with the same Fact id: versions already sent are dropped as duplicates. A Fact id derived from the committed entity, as above, is what makes that retry safe; a random one sends the fact again. How long the window lasts is the organization's broker configuration; beyond it, Handlers still recognize the fact by its id. Publishing within the transaction that commits the change (an outbox) is the organization's.

### Message Handlers

```ts
// src/subscriptions/notify-on-settled.handler.ts
export default handle(notifyOnSettled, async (body, { messageId, factId, deliveryCount, headers }) => {
  await notifications.send(body.paymentId);
});
```

A CommandHandler has the same shape. Delivery is at least once (see [Messages](ARCHITECTURE.md#messages) in ARCHITECTURE.md). Returning acknowledges the Message. Throwing, or a Fault with `retryable: true`, leaves it unacknowledged, so the consumer's configuration (ack wait, backoff, max deliveries), the organization's, decides when it comes again and what happens after the last attempt; `deliveryCount` tells the Handler which attempt this is. A Fault with `retryable: false` ends it (JetStream `term`): no redelivery, and it is logged. `headers` are the transport headers the Message was published with (see [Publishing and sending](#publishing-and-sending)). While a Handler runs, the adapter sends in-progress acknowledgements at a fraction of the consumer's ack wait, read from the consumer at `consume`, so a slow Handler's Message is not delivered to a sibling instance meanwhile.

Messages are validated with the generated reader schemas (see [The Contract Package](#the-contract-package)): a Dependency's Event with its Contract Package's, the Service's own with `readers.generated.ts`. A Message that fails its schema never reaches the Handler: it is ended without redelivery and logged with its subject, its ids and the issues (see [Serving](#serving) for what a log carries); where it goes next is the organization's broker configuration.

### The broker

Where a Message travels follows from the Contract, so a Subscriber finds another Service's Events from its Contract Package alone: each Service owns one stream named after it, and each Message Version has the subject `<service>.<event|command>.<Name>.v<version>` (`orders-service.event.OrderCreated.v2`). An optional prefix, passed to the adapter at runtime and to `cf-loom broker-plan --prefix`, goes in front of every subject, stream and consumer name (`staging.orders-service.event.OrderCreated.v2`, `staging_orders-service`), so several environments can share one broker.

On the wire a Message's body is the UTF-8 JSON of the Message body alone; the Message Version is in the subject, two headers carry the ids, `Nats-Msg-Id`, the broker message id, and `Cf-Loom-Fact-Id`, and the transport headers travel as the broker headers they were given (see [Publishing and sending](#publishing-and-sending)).

`cf-loom broker-plan` prints the desired state from the Snapshots: each stream and its subjects, each Subscription's durable consumer and the stream it reads, each Command Version's consumer (`orders-service_command_ChargeCard_v1`, which no kebab-case Subscription name can collide with), the consumers left over from removed Subscriptions and Retired Command Versions, and which subjects each Service may publish and subscribe to. `--json` prints it in a fixed shape, so the organization's own tooling can read it; names carry the prefix when one is given:

```json
{
  "prefix": null,
  "streams": {
    "orders-service": { "service": "orders-service", "subjects": ["orders-service.command.ChargeCard.v1", "orders-service.event.OrderCreated.v1", "orders-service.event.OrderCreated.v2"] }
  },
  "consumers": {
    "orders-service_command_ChargeCard_v1": { "service": "orders-service", "stream": "orders-service", "subject": "orders-service.command.ChargeCard.v1" },
    "orders-service_notify-on-settled": { "service": "orders-service", "stream": "payments-service", "subject": "payments-service.event.PaymentSettled.v1" }
  },
  "orphans": {
    "orders-service_legacy-sync": { "service": "orders-service", "stream": "orders-service", "subject": "orders-service.event.OrderCreated.v1" }
  },
  "permissions": {
    "orders-service": { "publish": ["orders-service.command.ChargeCard.v1", "orders-service.event.OrderCreated.v1", "orders-service.event.OrderCreated.v2"], "subscribe": ["payments-service.event.PaymentSettled.v1"] }
  }
}
```

Nothing applies it by default (see [Messages](ARCHITECTURE.md#messages) in ARCHITECTURE.md); the organization applies it with the adapter's `apply`, in a deploy step, or from its own infrastructure tooling:

```ts
await broker.apply(plan, limits);                    // creates and updates, never removes
await broker.apply(plan, limits, { prune: true });   // also deletes orphaned consumers
```

`plan` is the JSON above; computing it needs the Baseline and the registry, which a running Service does not have. `limits` holds every setting cf-loom has no opinion on: for each stream `retention`, `maxAge`, `duplicateWindow`, `replicas` and `storage`, for each consumer `deliverPolicy`, `ackWait`, `maxDeliver`, `backoff` and `maxAckPending`, keyed by the names the plan prints; `streamDefaults` and `consumerDefaults` fill in whatever a stream or consumer does not set. `apply` refuses to create a stream or consumer with any setting left unset, naming it and the setting. `cf-loom broker-plan --limits-skeleton` prints the `limits` for the plan with every key empty:

```ts
await broker.apply(plan, {
  streamDefaults:   { retention: 'limits', maxAge: '7d', duplicateWindow: '2m', replicas: 3, storage: 'file' },
  consumerDefaults: { deliverPolicy: 'all', ackWait: '30s', maxDeliver: 5, backoff: ['1s', '10s', '1m'], maxAckPending: 100 },
  streams:   { 'orders-service': { replicas: 1 } },
  consumers: { 'orders-service_notify-on-settled': { ackWait: '2m' } },
});
```

Without `prune`, `apply` only creates streams and consumers, adds subjects and updates limits, so a Release running side by side with an older plan never removes what a newer Release needs: applying without `prune` is safe before the new Release deploys and while the old one runs. A Release fails fast when the plan was not applied: `connect` checks that the Service's stream covers every subject it publishes or sends, `consume` that every durable consumer it needs exists, and each fails with an error naming what is missing.

Pruning deletes the consumers of removed Subscriptions and Retired Command Versions, so it runs only once the Release that dropped them is no longer running (see the deploy rule in [ARCHITECTURE.md](ARCHITECTURE.md#messages)). `apply` refuses to delete a consumer that still has pending or ack-pending Messages, with an error naming the consumer and both counts, unless `{ prune: true, force: true }` is given: the deploy rule has a Command Version's queue drained first. `cf-loom broker-plan --orphans` reads the broker, the one thing `broker-plan` does that needs broker access, read-only, and lists the orphaned consumers with those counts. After a prune, rolling back to a Release before it needs that Release's plan applied again, since its consumers are gone.

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
const server = nodeHttp(http).listen(3000);
await consume(handlers);

process.on('SIGTERM', () => {
  server.close();
  void close();
});
```

`serve` returns a web-standard handler that an adapter connects to the host (see [Runtime](ARCHITECTURE.md#runtime)). `serve(contract, handlers, { maxBodyBytes })` refuses a larger body with `BODY_TOO_LARGE` (see [Wire protocol](#wire-protocol)); without it cf-loom sets no limit, leaving it to the host or the organization's gateway. The limit is operational, not part of the Contract.

`serve` validates every Success, its declared headers included, and every Rejection body before sending it, and serializes the headers as it does the body. A Handler's Outcome that type-checks but breaks a constraint is never sent: the Caller receives a Fault with `INVALID_OUTCOME`, `committed: 'unknown'` and `retryable: false`, and the validation issues go to the Service, never to the Caller. `serve(contract, handlers, { onFault })` receives every Fault cf-loom answers that the Handler did not return itself: a throw, with the error as `cause`, and `INVALID_OUTCOME`, with the issues. `messaging(contract, { onFault })` receives what Message Handlers end or fail with: a Message ended for failing its schema, a Fault with `retryable: false`, and anything thrown. Without an `onFault`, `serve` and `messaging` write these to the console; a logged schema failure, a Message body's or an `INVALID_OUTCOME`, carries the issues' paths and codes, never the received values.

`serve(contract, handlers, { onOutcome })` receives `{ endpoint, status, kind, durationMs }` for every request it answers: the Endpoint's name, absent when none matched, the HTTP status, `'success'`, `'rejection'` or `'fault'`, and the time taken. It is the hook for metrics and tracing; cf-loom ships no exporter, the backend is the organization's. On the Caller's side the `fetch` option of the client does the same (see [Consuming a Contract](#consuming-a-contract)).

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
    if (outcome.committed === 'no' && outcome.retryable) return retry();
    throw new Error('payments-service failed');
}
```

The client has one method per Endpoint listed in the Dependency, named after it, and returns an Outcome: it never throws for a Rejection or a Fault. It reads the Provider's Standard Rejection codes from the Provider's Contract Package, so a Caller receives the Provider's codes, not its own. Every method takes an optional second argument, `{ signal }`, to abort the call; cf-loom sets no timeout, the organization does. How an Outcome travels is in [Wire protocol](#wire-protocol).

A Success Outcome carries `value`, the body, and `headers`, the declared Success headers, typed. The client validates a Success, its headers included, and a Rejection body against the reader schemas of the Provider's Contract Package (see [The Contract Package](#the-contract-package)): open objects, Unknown cases. One that fails them is a Fault with `INVALID_OUTCOME`, `committed: 'yes'` and `retryable: false`: the Service processed the request, but answered something its Contract does not describe.

A Rejection Outcome carries `known`, `code`, `message` and `body`: when `known` is `true`, `code` is one of the declared codes and `body` its declared type; when `false`, the client did not know the code, and `code` is the raw string and `body` unvalidated. Checking `known` first lets TypeScript narrow by code.

A Fault Outcome carries `committed`, `retryable`, `message`, the reserved `code` when there is one, and `retryAfter`, the `Retry-After` header when the response carried one. A Caller may retry on its own only when `committed === 'no' && retryable`: nothing happened, and the same request could succeed later (see [Fault](CONTEXT.md#language) in CONTEXT.md). cf-loom requires no idempotency; the pattern for it is a Guard in a Definitions Package that demands an `idempotency-key` header, whose Service stores each key with its Success and replays it. A Caller of such an Endpoint may retry whenever `committed !== 'yes' && retryable`, with the same key.

`client(deps, { fetch })` replaces the global `fetch`, for instrumentation (tracing headers, timing), a runtime without one, a test (see [Testing](#testing)) or any other `RequestInit` concern, such as a browser's `credentials`: `client(deps, { fetch: (url, init) => fetch(url, { ...init, credentials: 'include' }) })`. Only a network failure, an abort or a timeout of `fetch` becomes a Fault, inferred as in [Wire protocol](#wire-protocol); any other error `fetch` throws reaches the calling code unchanged. `client(deps, { inferFault })` replaces that inference, so an organization that knows its network (a gateway that only answers 502 before forwarding, for one) can relax it. Code that calls another Service can depend on the `Client<typeof paymentsDeps, 'x-api-key'>` type rather than on `client()` itself; its second parameter names the headers supplied when the client is created, which its methods no longer require.

Headers an Endpoint or its Guards demand are typed, with lower-case names. Those given to `client()`, as values or as a function called per request (which may be async, to refresh a token), need not be passed again; any still missing is a required `headers` field on each call that needs it. Query params, a Guard's included, are always passed per call.

## Wire protocol

How an Endpoint's Input and Outcome travel over HTTP, between `serve` and the client.

- Bodies are JSON, sent as `content-type: application/json; charset=utf-8`, and what is sent is the parsed value, unknown keys stripped (see [Shapes, not behavior](ARCHITECTURE.md#shapes-not-behavior) in ARCHITECTURE.md). A malformed body or a wrong content type is the invalid-input Rejection, with the `malformed` issue code.
- Path params, query params and headers, a Success's included, travel as text and are converted to their declared types: a number matches `^-?(0|[1-9]\d*)(\.\d+)?$`, a boolean is exactly `true` or `false`. A list query param is a repeated key (`?id=a&id=b`), and one occurrence is a one-item list; a repeated single-value key, or a header given several times, is invalid input. A path param that fails its schema is invalid input, never the not-found Rejection. Headers of an HTTP response that the Endpoint does not declare pass through unread on both sides.
- `generate` fails on an optional path param, on `nullable` anywhere in params, query or headers, and on a body on `GET` or `HEAD`.
- Each path segment is percent-decoded on its own, so a decoded value never spans segments: `/orders/a%2Fb` is one param, `a/b`. There is no trailing-slash or case folding; a request path matches a declared path exactly (see [Identities](SNAPSHOT.md#identities) in SNAPSHOT.md).
- Routing compares segment by segment, left to right: a literal beats a param at the first segment where they differ.
- An undeclared method or path is `NO_SUCH_ENDPOINT`. `HEAD`, `OPTIONS` and CORS preflight are not answered by cf-loom unless declared; the host, its adapter or the organization's gateway handles them.
- `maxBodyBytes` counts the bytes read, not `Content-Length`.

A Rejection travels with its declared status and a body cf-loom defines, `{ rejection: { code, message, body } }`; a Rejection that declares no body has no `body` key. Rejection codes are open for Callers.

A Fault travels with a body cf-loom defines, `{ fault: { committed, retryable, message } }`, where `committed` is `'no'`, `'yes'` (done, but the Success was lost) or `'unknown'` (see [Fault](CONTEXT.md#language) in CONTEXT.md). `serve` answers it with 503 when it is retryable and 500 otherwise. The reserved codes (see [Rejections](COMPATIBILITY.md#rejections) in COMPATIBILITY.md) use the same body with a `code`, `{ fault: { code, committed, retryable: false, message } }`, which the client's Fault Outcome exposes:

| Code | Status | `committed` | Answered when |
| --- | --- | --- | --- |
| `RETIRED` | 410 | `'no'` | The Endpoint is Retired and still declared (see [Lifecycle](#lifecycle)) |
| `NO_SUCH_ENDPOINT` | 404 | `'no'` | No declared Endpoint has that method and path |
| `BODY_TOO_LARGE` | 413 | `'no'` | The body exceeds `maxBodyBytes` (see [Serving](#serving)) |
| `INVALID_OUTCOME` | 500 | `'unknown'` | The Handler's Outcome broke a constraint (see [Serving](#serving)). The client produces the same code with `committed: 'yes'`, and no HTTP status of its own, when a Success or Rejection body fails its reader schema (see [Consuming a Contract](#consuming-a-contract)) |

An HTTP response that is neither the Success, a Rejection body nor a Fault body, or no response at all, becomes a Fault the client infers from what happened; `client(deps, { inferFault })` replaces this inference (see [Consuming a Contract](#consuming-a-contract)):

| What happened | Fault |
| --- | --- |
| No connection: a DNS failure or a refused connection (Node's `cause.code` `ENOTFOUND`, `ECONNREFUSED`), an abort before the request was sent, or 429 | `committed: 'no'`, `retryable: true` |
| A timeout, a reset or abort after the request was sent, or 503 without a Fault body | `committed: 'unknown'`, `retryable: true` |
| Any other network failure of `fetch`, or any other status without a Fault body (500, 502, 504…) | `committed: 'unknown'`, `retryable: false` |

## Testing

cf-loom keeps its API test-friendly and ships testing helpers only where hand-written test doubles would drift from a Contract. Which test runner, mocking library, fixtures or end-to-end tools a Service uses is the organization's choice; an HTTP test through a host adapter uses that host's own tools, such as supertest.

### A Service's own code

A Handler returned by `handle()` is a function. Calling it runs the same checks `serve` and `consume` run: Input that breaks the Contract throws with the validation issues, as does an Outcome that breaks a constraint, so a unit test catches what production would answer as the invalid-input Rejection or as `INVALID_OUTCOME`. Otherwise:

- An EndpointHandler or GuardHandler returns what `serve` would answer: anything it throws becomes that Fault, carrying the original error as `cause`.
- A direct call's Outcome is the handler-side `Outcome` of `@cf-loom/handlers`, not the client's: a Rejection carries its declaration as `rejection` (`outcome.rejection === notFound`) and its `body`, with `code`, `status` and `message` resolved against cf-loom's defaults unless the call is given the root, `getOrderHandler(input, context, { contract })`, which resolves them as `serve` does (see [Rejections](#rejections)).
- A Message Handler rethrows what it throws and returns a Fault it returns unchanged, since `consume` answers no Caller.
- An Endpoint or Guard stub returns the not-implemented Rejection, so a direct call's Outcome type includes it; a Message Handler stub throws, since `consume` never runs it.
- A GuardHandler validates only what its Guard demands, and checks an `admit()` against the Guard's `context` schema; `serve` answers an invalid `admit()` with `INVALID_OUTCOME`.
- The Context passed to an EndpointHandler is checked against each attached Guard's `context` schema.
- A Message Handler takes its body as a Subscriber reads it, with Unknown cases written `{ unknown: … }`.

```ts
import getOrderHandler from '../src/endpoints/orders/get-order.handler';

const outcome = await getOrderHandler(
  { params: { orderId: ORDER_ID } },
  { apiKey: { clientId: 'c-1' } },          // the Context, one key per Guard
);
```

The handler map `handlers.generated.ts` exports is plain data (see [Implementing a Contract](#implementing-a-contract)), so a test replaces one Handler, a Guard's for example, by spreading the map:

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
import { connect, consume, close } from '../src/messaging';
import handlers from '../src/handlers.generated';
import createOrderHandler from '../src/endpoints/orders/create-order.handler';

const broker = memory();
await connect(broker);
await consume(handlers);

await createOrderHandler({ body: newOrder }, { apiKey: { clientId: 'c-1' } });
await broker.settled();   // OrderCreated v1 and v2 published, ChargeCard v1 sent and handled
broker.messages;          // each with its subject, body, Fact id, broker message id and transport headers

await broker.deliver(paymentsDeps.events.paymentSettledV1, body, { factId: 'pay-1' });
// → 'acked' | 'pending' | 'ended'

await close();
```

- **Delivery.** What the Service publishes or sends is delivered to its consumed Subscriptions and CommandHandlers, acknowledged or ended as `consume` does. A Message nothing consumes, because no Subscription takes the Event or its Handler is a stub, is only recorded.
- **Order.** Delivery is sequential, in publish order, which production never guarantees (see [Messages](ARCHITECTURE.md#messages) in ARCHITECTURE.md).
- **`settled()`** waits until nothing is in flight, including Messages that Handlers publish or send while it waits. It rejects, with the error as `cause`, if a Handler threw or a Message was ended since the last `settled()`, so a failure cannot pass a test unnoticed; a chain that keeps producing Messages is cut after 1,000 deliveries and rejects too.
- **`deliver(element, body, meta)`** delivers one Message now, whatever was delivered before, so a test can deliver the same fact twice to check that a Handler is safe to run again. Its body is written as a Subscriber reads it, like `fakeEvent`'s, its broker message id defaults to `<Name>.v<version>:<factId>`, and `meta.headers` are the transport headers the Handler receives. Delivering to an Element nothing consumes throws.
- **Redelivery.** The adapter never redelivers on its own: a Message whose Handler threw or returned a retryable Fault is listed in `broker.pending`, and a test retries it with `deliver`.
- **Duplicates.** A repeated broker message id from `publish` or `send` is dropped, for the adapter's whole lifetime.
- **Not a broker emulator.** It models nothing of the organization's broker configuration (deduplication window, redelivery limits, backoff, retention) and ignores `apply`; tests against a real broker remain the organization's. One `memory()` serves one `messaging`: connecting it to a second throws.

### Other Services

`@cf-loom/testing` fakes the Providers a Consumer depends on, checked against the Provider's Snapshot, so a fake can never answer what the Provider could not:

```ts
import { fakeProvider, fakeEvent } from '@cf-loom/testing';
import { paymentsDeps } from '../src/contract/dependencies/payments-service.dependencies';
import notifyOnSettledHandler from '../src/subscriptions/notify-on-settled.handler';

const payments = fakeProvider(paymentsDeps);
payments.on('getPayment')
  .once((r) => r.reject('NOT_FOUND'))                    // a declared code, with its declared body
  .once((r) => r.reject({ unknown: 'CARD_EXPIRED' }, {})) // a code the Provider does not declare
  .once((r) => r.fault({ committed: 'no', retryable: true }))
  .once((r) => r.noConnection())                         // the client infers the Fault: committed 'no'
  .once((r) => r.reset())                                // a reset after sending: committed 'unknown', retryable
  .once((r) => r.status(502))                            // committed 'unknown', not retryable
  .otherwise((r, { params }) => r.success({ id: params.paymentId, amount }));

const settlement = new SettlementService(payments.client({ headers: { 'x-api-key': 'k' } }));
await settlement.settle(PAYMENT_ID);
payments.calls('getPayment');                            // the requests the code made, in order

const settled = fakeEvent(paymentsDeps.events.paymentSettledV1, { paymentId: PAYMENT_ID });
await notifyOnSettledHandler(settled, { messageId: 'PaymentSettled.v1:pay-1', factId: 'pay-1', deliveryCount: 1 });
```

- **Requests.** `fakeProvider` validates each request as the Provider would, its Input and its Guards' demands, and answers the Provider's invalid-input Rejection when it fails; that Rejection uses no step. Every request, valid or not, appears in `calls()`.
- **Steps.** Each step, in `once` or `otherwise`, receives a builder typed by the Endpoint and the request, so codes and bodies autocomplete from the Provider's Contract and nothing collides with `@cf-loom/contract` or `@cf-loom/handlers`.
  - `r.success(body)` answers the Success; `r.success({ headers, body })` when the Endpoint declares `success.headers`.
  - `r.reject(code, body?)` answers a declared code with its status; `r.reject({ unknown: code }, body)` answers a code the Provider does not declare, with status 422.
  - `r.fault(…)` may carry a reserved code (see [Wire protocol](#wire-protocol)).
  - `r.noConnection()`, `r.reset()` and `r.status(n, headers?)` let the client infer the Fault, as from a real response (see the inference table in [Wire protocol](#wire-protocol)); `headers` may carry `Retry-After`.
- **Mistakes in the test.** A call to an Endpoint with no step left and no `otherwise`, or to an Endpoint never scripted, throws the fake's own error out of the client, so the code under test cannot take it for a Fault.
- **Real client.** `payments.client(options)` returns a real client over the fake, and `payments.fetch` serves code that builds its own client with `client(deps, { fetch })`, so the Consumer's code also runs the client's decoding: bodies and Success headers are validated against the generated readers, unknown codes arrive with `known: false`, Faults are inferred, and a Deprecated Endpoint sends the `Deprecation` header.
- **Values as a reader sees them.** `fakeEvent` builds an Event body as a Subscriber reads it, and scripted Outcomes are written as a Caller reads them. Declared parts are checked against the Provider's schemas, shapes and constraints alike; an Unknown case, `{ unknown: 'refunded' }`, is checked only to make sure `'refunded'` is not a declared value, and an Open Union's Unknown variant sends its `raw` value as it is. That is how a test reaches the code that handles values the Provider may add later.
- **Scope.** The package fakes only other Services. A Service's own Handlers, Guards and Messages are tested with the API above; a body for its own Event is written directly, since what its writers produce is also what its readers accept.

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

`scope` is always required; `registry` and `directory` only by `check` and `publish`, since `generate` and `verify` run offline. An Approval source implements `ApprovalSource = { approvalsOf(commit: string): Promise<{ approver: string }[]> }`: expanding teams is the source's job, and the commit and its author come from git.

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
| `cf-loom generate` | Writes the stub of every missing Handler, regenerates `handlers.generated.ts` and `readers.generated.ts`, and writes `contract.snapshot.json`, stamping `deprecatedAt` on an Endpoint it first sees Deprecated |
| `cf-loom broker-plan [--prefix <p>] [--json] [--limits-skeleton] [--orphans]` | Prints the streams, consumers, orphaned consumers and permissions the broker must hold; `--limits-skeleton` prints the `limits` for `apply` with every key empty, `--orphans` reads the broker and lists the orphaned consumers with their pending counts (see [The broker](#the-broker)) |
| `cf-loom route-plan [--json]` | Prints every route with its Visibility, and the Retired ones, for the organization's gateway or ingress |
| `cf-loom openapi` | Writes an OpenAPI 3.1 document of the Endpoints from the Snapshot (see [JSON Schema](SNAPSHOT.md#json-schema) in SNAPSHOT.md) |
| `cf-loom asyncapi` | Writes an AsyncAPI document of the Events from the Snapshot (see [JSON Schema](SNAPSHOT.md#json-schema) in SNAPSHOT.md) |
| `cf-loom verify` | Fails if a generated file was edited or is out of date |
| `cf-loom check [--json]` | Runs the Compatibility Check against the Baseline (see [Breaking Change Approval](COMPATIBILITY.md#breaking-change-approval) in COMPATIBILITY.md) |
| `cf-loom publish [--force]` | Builds the Contract, writes the Snapshot, derives the version and publishes the Contract Package; `--force` publishes even when nothing changed (see [Versioning](COMPATIBILITY.md#versioning) in COMPATIBILITY.md) |

Exit status: 0, done; 1, the check failed (something not allowed, or a Breaking Change without a verified Approval); 2, the change needs a Breaking Change Approval and no Approval source is configured; 3, a tooling error (configuration, Contract directory, registry).
