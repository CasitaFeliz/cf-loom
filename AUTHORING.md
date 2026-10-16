# Authoring

How a developer writes a Contract and the code that implements and consumes it. Terms are defined in [CONTEXT.md](CONTEXT.md); the rules for changing a Contract are in [COMPATIBILITY.md](COMPATIBILITY.md). This document will later move into the READMEs of the packages.

## Packages

| Package | Used by | Provides |
| --- | --- | --- |
| `@cf-loom/contract` | Services, Applications, Definitions Packages | Declarations: `contract`, `application`, `definitions`, `group`, `endpoint`, `guard`, `rejection`, `event`, `command`, `subscription`, `dependencies`, `openEnum`, `openUnion`; the Standard Rejections `invalidInput`, `notFound`, `notImplemented` |
| `@cf-loom/handlers` | Services | `handle`, `handle.stub`, `success`, `reject`, `admit`, `fault` |
| `@cf-loom/server` | Services with Endpoints | `serve` |
| `@cf-loom/server/node-http` | Services on `node:http` | Adapter |
| `@cf-loom/client` | Callers | `client` |
| `@cf-loom/messaging` | Services with Messages | `messaging`: EventPublisher, CommandSender, `consume` for Subscriptions and Commands, `connect`, `close` |
| `@cf-loom/messaging/jetstream` | Services on NATS JetStream | Adapter; `@nats-io/*` is an optional peer dependency |
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

File names are kebab-case: the Guard `apiKey` lives in `api-key.guard.ts` and its Handler in `api-key.handler.ts`. The examples below leave out imports of `zod`, `@cf-loom/contract` and sibling files.

Files under `src/contract/` import only each other, `zod`, `@cf-loom/contract`, Definitions Packages and the Contract Packages listed as Dependencies, so the Contract can be built and published on its own.

`src/contract/index.ts` is not what gets published, and no source file is bundled. `cf-loom publish` generates the package's code from the Snapshot: zod schemas, the writer and reader types, its entry point and package.json, for the Public and Internal Elements that are not Retired, with the Guards, Rejections and schemas they use, plus the Snapshot itself. What is published is therefore exactly what the Snapshot describes, and no Private code can leak into it:

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

Private Elements, Commands, Subscriptions and Dependencies are never exported. Dependencies are recorded in the Snapshot as data, so a Contract Package never imports another one and installing it never pulls in the Services it uses. Schemas from Definitions Packages are written into the generated code, so a Contract Package does not depend on them at runtime. Its package.json declares only `@cf-loom/contract` and `zod`, as peers with a caret range on the versions it was built with. Contract Packages built on different cf-loom majors therefore conflict in one Consumer, so upgrading to a cf-loom major republishes the Contract Package as a major of its own (see [Versioning](COMPATIBILITY.md#versioning)). The Service itself installs the Contract Packages it depends on as ordinary dependencies, since its client and Subscriptions use them.

## Declaring a Contract

### The root

```ts
// src/contract/index.ts
import { contract } from '@cf-loom/contract';
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

The root lists everything in the Contract: what it lists is exactly what the Snapshot describes. The Contract Package carries the code of its Public and Internal Elements only. `name` must equal the unscoped part of the `name` in the Service's package.json.

A Message Version is written `OrderCreated@2` in the Snapshot, the CLI and logs, `orderCreatedV2` in code, and `OrderCreated.v2` inside a subject.

Names follow fixed grammars, so they are safe in code, subjects and broker names: a Service, Application, Definitions Package or Subscription name is kebab-case (`[a-z0-9-]+`); a Group name is kebab-case; an Endpoint or Guard name is camelCase; a Message name is PascalCase; a Rejection code is UPPER_SNAKE_CASE. At most one listed Definitions Package may declare Standard Rejections; without one, cf-loom's defaults apply.

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
import { apiKey } from '../../guards/api-key.guard';

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

The three Standard Rejections, invalid input (400), not found (404) and not implemented (501), take their code, status and message from a Definitions Package or from cf-loom's defaults (`INVALID_INPUT`, `NOT_FOUND`, `NOT_IMPLEMENTED`). They are referenced as `invalidInput`, `notFound` and `notImplemented`, exported by `@cf-loom/contract`. A Caller receives the codes of the *provider's* Definitions Package, not its own.

Should a future cf-loom version add a Standard Rejection, it would apply to every Endpoint, so adopting that version would be an Additive Change for every Service.

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

Any Element takes `lifecycle: 'deprecated'`. To retire it, mark it `lifecycle: 'retired'` and publish; this needs the Element Deprecated in the Baseline, no Dependency using it, and, for an Endpoint, a Breaking Change Approval (see [Retirement](COMPATIBILITY.md#retirement)). `handlers.generated.ts` leaves Retired Elements out, so their Handlers may then be deleted.

At runtime:

- A Deprecated Endpoint still works, and every response carries a `Deprecation` header; the client warns once per method.
- A Retired Endpoint answers 410 with `RETIRED` while it is still declared. Like a Fault, this is outside the Contract: Callers receive it as a Fault with `committed: 'no'` and `retryable: false`.
- A Retired Message cannot be published or sent (a type error), and its Handler is no longer consumed.
- Once a published Baseline records an Element as Retired, its declaration may be deleted: `cf-loom publish` carries every Retired Element forward from the Baseline into the new Snapshot, so its identity is never reused. A deleted Endpoint answers like any undeclared method and path: 404 with `NO_SUCH_ENDPOINT`, a Fault for the client, never the not-found Rejection.

```ts
export const orderCreatedV1 = event({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  lifecycle: 'deprecated',
  body: z.object({ orderId: z.uuid(), total: z.number() }),
});
```

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

## Implementing a Contract

`cf-loom generate` writes a stub for every Handler that does not exist yet, never overwriting one, and regenerates `handlers.generated.ts`. A stub is `export default handle.stub(getOrder)`, which marks the Handler as not implemented; implementing it means replacing that line with `handle(getOrder, async (…) => …)`. `serve` answers the not-implemented Rejection for an EndpointHandler stub, and for every Endpoint attaching a GuardHandler stub, which never admits. `consume` does not consume a Message Handler stub and logs a warning; its Messages wait in the broker, within the organization's retention, until a Release with the real Handler drains them. Either way a Contract can be merged and published before it is implemented. A missing Handler is a type error.

### EndpointHandler

```ts
// src/endpoints/orders/get-order.handler.ts
import { handle, reject, success } from '@cf-loom/handlers';
import { notFound } from '@cf-loom/contract';
import { getOrder } from '../../contract/endpoints/orders/get-order.endpoint';
import { orderLocked } from '../../contract/rejections/order-locked.rejection';

export default handle(getOrder, async ({ params }, context) => {
  const order = await orders.find(params.orderId, context.apiKey.clientId);
  if (!order) return reject(notFound);
  if (order.locked) return reject(orderLocked, { lockedAt: order.lockedAt });
  return success({ id: order.id, status: order.status, total: order.total });
});
```

- The first argument is the validated input; the second is the Context, one key per attached Guard.
- Only the Endpoint's Rejections type-check in `reject`, each with its declared body.
- Anything thrown becomes a Fault with `committed: 'unknown'` and `retryable: false`, because a Caller cannot know whether it may retry. Message Handlers differ: there a throw has the Message delivered again. A Handler that knows better returns `fault({ committed: 'no', retryable: true })`, just as it returns `success` and `reject`.

### GuardHandler

```ts
// src/guards/api-key.handler.ts
export default handle(apiKey, async ({ headers }) => {
  const client = await clients.byKey(headers['x-api-key']);
  if (!client) return reject(unauthenticated);
  return admit({ clientId: client.id });
});
```

A GuardHandler receives only what its Guard demands. Every attached Guard, declared locally or imported from a Definitions Package, gets its Handler at `src/guards/<guard-name>.handler.ts`, its name in kebab-case. Guards run in the order the Endpoint lists them; the first Rejection stops the request.

### Messages

```ts
// src/subscriptions/notify-on-settled.handler.ts
export default handle(notifyOnSettled, async (body, { messageId, factId }) => {
  await notifications.send(body.paymentId);
});
```

Returning acknowledges the Message; throwing, or a Fault with `retryable: true`, has it delivered again; a Fault with `retryable: false` ends it without redelivery and logs it. How often and how fast a Message is delivered again, and what happens after the last attempt, belong to the organization's broker configuration. A Message that fails its schema never reaches the Handler: it is ended without redelivery and logged with its subject, ids and the validation errors; where it goes next is the organization's broker configuration. Messages are validated with reader schemas built from the Snapshot, in which every object is open, whatever the author wrote. Delivery is at least once, so every Message Handler must be safe to run again. A CommandHandler has the same shape.

The EventPublisher and CommandSender are created once, in their own module, and imported where needed:

```ts
// src/messaging.ts
import { messaging } from '@cf-loom/messaging';
import { jetstream } from '@cf-loom/messaging/jetstream';
import contract from './contract';

const broker = jetstream({
  servers: process.env.NATS_URL!,
  prefix: process.env.BROKER_PREFIX,   // optional, e.g. one per environment
});
export const { publisher, sender, consume, connect, close } = messaging(contract, broker);
```

```ts
// in any Handler
import { publisher, sender } from '../../messaging';

await publisher.publish('OrderCreated', {
  v1: { orderId, total: total.amount },   // Deprecated, still published
  v2: { orderId, total },
});
await sender.send('ChargeCard', { orderId });
```

Where a Message travels follows from the Contract, so a Subscriber finds another Service's Events from its Contract Package alone: each Service owns one stream named after it, and each Message Version has the subject `<service>.<event|command>.<Name>.v<version>` (`orders-service.event.OrderCreated.v2`). An optional prefix, passed to the adapter at runtime and to `cf-loom broker-plan --prefix`, goes in front of every subject, stream and consumer name (`staging.orders-service.event.OrderCreated.v2`, `staging_orders-service`), so several environments can share one broker.

cf-loom derives what the broker must hold but does not decide how it gets there. `cf-loom broker-plan` prints the desired state from the Snapshots: each stream and its subjects, each Subscription's durable consumer and the stream it reads, each Command Version's consumer (`orders-service_command_ChargeCard_v1`, which no kebab-case Subscription name can collide with), the consumers left over from removed Subscriptions and Retired Command Versions, and which subjects each Service may publish and subscribe to. The organization chooses when and how to apply it, and with which retention, replicas and permissions: with the adapter's `apply`, in a deploy step, or from its own infrastructure tooling. Nothing applies it by default.

```ts
await broker.apply(plan, limits);                    // creates and updates, never removes
await broker.apply(plan, limits, { prune: true });   // also deletes orphaned consumers
```

`plan` is the JSON `cf-loom broker-plan --json` printed; computing it needs the Baseline and the registry, which a running Service does not have. Without `prune`, `apply` only creates streams and consumers, adds subjects and updates limits, so a Release running side by side with an older plan never removes what a newer Release needs. Pruning deletes the consumers of removed Subscriptions and Retired Command Versions, so it runs only once the Release that dropped them is no longer running (see the deploy rule in [ARCHITECTURE.md](ARCHITECTURE.md)).

Creating `messaging` opens no connection, so importing a Handler, in a test for example, has no side effect. The Service calls `connect()` at startup so a broker problem fails there rather than inside a request, and `close()` at shutdown, which stops consuming, waits for the Handlers running and closes the connection. Broker options come from the Service; cf-loom has no defaults for them.

`publish` takes an Event's name and one body for each of its Active and Deprecated versions: leaving one out, or passing a Retired one, is a type error, so adding a new Message Version flags every place that publishes the Event. All the Messages of one call share a fact id, which every Message Handler receives (`{ messageId, factId }`) to recognize a fact it already handled. `send` takes a Command's name and sends its one Active version, since a Deprecated Command cannot be sent; it gives its Message a fact id the same way. Both validate the body before it leaves.

```ts
await publisher.publish('OrderCreated', { v1, v2 }, { factId: `${order.id}:created` });
```

The fact id is random unless the caller passes one. Each Message is sent with `<factId>.v<version>` as its broker message id (JetStream's `Nats-Msg-Id`), so the broker drops a duplicate within its deduplication window. If any version fails, `publish` throws, and the caller retries the whole call with the same fact id: versions already sent are dropped as duplicates. How long that window lasts is the organization's broker configuration; beyond it, Handlers still recognize the fact by its id.

### Serving

```ts
// src/main.ts
import { serve } from '@cf-loom/server';
import { nodeHttp } from '@cf-loom/server/node-http';
import contract from './contract';
import handlers from './handlers.generated';
import { connect, consume, close } from './messaging';

await connect();
const app = serve(contract, handlers);       // (Request) => Promise<Response>
nodeHttp(app).listen(3000);
await consume(handlers);

process.on('SIGTERM', () => close());
```

`serve` refuses a body over 1 MB with `BODY_TOO_LARGE`, a safety default that `serve(contract, handlers, { maxBodyBytes })` overrides. The limit is operational, not part of the Contract.

The HTTP core speaks the web-standard Request and Response, so it also runs on Bun, Deno or inside another framework; adapters only connect it to a host.

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

The client has one method per declared Endpoint, named after it, and returns an Outcome: it never throws for a Rejection or a Fault. It reads the provider's Standard Rejection codes from the provider's Contract Package.

A Rejection travels with its declared status and a body cf-loom defines, `{ rejection: { code, message, body } }`. Rejection codes are open for Callers. A Rejection Outcome carries `known`: when `true`, `code` is one of the declared codes and `body` its declared type; when `false`, the client did not know the code, and `code` is the raw string and `body` unvalidated. Checking `known` first lets TypeScript narrow by code.

A Fault travels with a body cf-loom defines, `{ fault: { committed, retryable, message } }`, where `committed` is `'no'`, `'yes'` (done, but the answer was lost) or `'unknown'`. The server answers it with 503 when it is retryable and 500 otherwise; `RETIRED` (410), `NO_SUCH_ENDPOINT` (404) and `BODY_TOO_LARGE` (413) use the same body with a `code` (`{ fault: { code, committed: 'no', retryable: false, message } }`), and the client's Fault Outcome exposes that `code`. A malformed body or a wrong content type is the invalid-input Rejection; a request to a declared path with an undeclared method is `NO_SUCH_ENDPOINT`. A response that is neither the Success, a Rejection body nor a Fault body becomes a Fault inferred from what happened:

| Response | Fault |
| --- | --- |
| No connection, or 429 / 503 without a Fault body | `committed: 'no'`, `retryable: true` |
| Anything else (502, 504, a timeout or reset after sending…) | `committed: 'unknown'`, `retryable: false` |

Headers an Endpoint or its Guards demand are typed, with lower-case names. Those given to `client()`, as values or as a function called per request (which may be async, to refresh a token), need not be passed again; any still missing is a required `headers` field on each call that needs it. Query params, a Guard's included, are always passed per call.

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
| `cf-loom generate` | Writes the stub of every missing Handler and regenerates `handlers.generated.ts` |
| `cf-loom broker-plan [--prefix <p>] [--json]` | Prints the streams, consumers, orphaned consumers and permissions the broker must hold |
| `cf-loom route-plan [--json]` | Prints every route with its Visibility, and the Retired ones, for the organization's gateway or ingress |
| `cf-loom verify` | Fails if a generated file was edited or is out of date |
| `cf-loom check [--line <major>] [--json]` | Runs the Compatibility Check against the Baseline; a distinct exit status means the change needs a Breaking Change Approval |
| `cf-loom publish [--line <major>] [--force]` | Builds the Contract, writes the Snapshot, derives the version and publishes the Contract Package |
