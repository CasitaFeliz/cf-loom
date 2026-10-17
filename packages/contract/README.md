# @casitafeliz/loom-contract

The declarations of a Contract: `contract`, `application`, `definitions`, `group`, `endpoint`, `guard`, `rejection`, `event`, `command`, `subscription`, `dependencies`, `openEnum`, `openUnion`; and the Standard Rejections `invalidInput`, `notFound`, `notImplemented`. Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md); the rules for changing a Contract are in [COMPATIBILITY.md](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md).

The examples follow the layout in [A first Service](https://github.com/CasitaFeliz/cf-loom/blob/main/README.md#a-first-service) and leave out imports of `zod`, `@casitafeliz/loom-contract` and sibling files.

## The root

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

## Applications

An Application has the same layout as a Service (see [Layout](https://github.com/CasitaFeliz/cf-loom/blob/main/README.md#layout) in README.md) with only Dependencies:

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

Services import its Guards and schemas directly and list it on their `contract` root (see [The root](#the-root)).

## Groups and Endpoints

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
- `success` declares a 2xx `status`, a `body` and optionally `headers`, an object of the HTTP headers the Endpoint promises with its Success; nothing is implied. Only 204 has no body (`success: { status: 204 }`), and its Handler returns `success()`. Headers follow the text rules of Input headers, and the object is always open (see [Headers, path and query](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#headers-path-and-query) in COMPATIBILITY.md).
- `input` may hold `params`, `query`, `headers` and `body`. `params` must declare exactly the `:names` in the path, and is absent when the path has none. A strict `query` also admits the params its Guards demand; the EndpointHandler receives only the Endpoint's own. `generate` fails on an optional path param, on `nullable` anywhere in params, query or headers, and on a body on `GET` or `HEAD`.
- `rejections` lists the Endpoint's own Rejections, `notFound` among them when it answers it. Those of its Guards, and the two Rejections cf-loom's runtime produces, invalid input and not implemented, are added without listing them (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections) in COMPATIBILITY.md).
- Only shapes and declarative constraints are allowed: see [Not allowed in a Contract](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#not-allowed-in-a-contract).

## Rejections

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

The three Standard Rejections, invalid input, not found and not implemented, are referenced as `invalidInput`, `notFound` and `notImplemented`, exported by `@casitafeliz/loom-contract`. Their code, status and message come from the Definitions Package listed on the root that declares them (see [Definitions Packages](#definitions-packages)), or from cf-loom's defaults: `INVALID_INPUT` 400 "Invalid input", `NOT_FOUND` 404 "Not found", `NOT_IMPLEMENTED` 501 "Not implemented".

The body of the invalid-input Rejection is cf-loom's, whatever the Definitions Package declares, and its runtime produces it:

```ts
{ issues: [{ in: 'params' | 'query' | 'headers' | 'body', path: (string | number)[], code: string, message: string }] }
```

`code` is one of a closed set cf-loom owns, not zod's issue codes: `required`, `invalid_type`, `invalid_value`, `invalid_format`, `too_small`, `too_big`, `not_multiple`, `unrecognized_key` and `malformed` (an unparseable body or a wrong content type). An issue never carries the received value.

## Guards

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

## Events and Commands

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

An Event takes `visibility`, a Command none; which Visibilities each kind of Element may have is in [Visibility and Guards](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#visibility-and-guards) in ARCHITECTURE.md.

## Lifecycle

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

To retire it, mark it `lifecycle: 'retired'` and publish; this needs the Element Deprecated in the Baseline, no Dependency using it, and, for an Endpoint, a Breaking Change Approval (see [Retirement](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#retirement)). `handlers.generated.ts` leaves Retired Elements out, so their Handlers may then be deleted. Once a published Baseline records the Element as Retired, its declaration may be deleted too: `cf-loom publish` carries every Retired Element forward from the Baseline as a tombstone, so its identity is never reused (see [Lifecycle and tombstones](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#lifecycle-and-tombstones)).

At runtime:

- A Deprecated Endpoint still works, and every HTTP response carries `Deprecation: @<unix seconds>` (RFC 9745), the instant `generate` stamped as `deprecatedAt` when it first saw the Endpoint Deprecated (see [Endpoints](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#endpoints) in SNAPSHOT.md); the client warns once per method. A Deprecated Message Version carries no header: none exists for it.
- A Deprecated Event is still published until it is Retired, so Subscribers that have not moved on keep receiving it. A Deprecated Command is not sent, but its CommandHandler keeps running to drain what is already queued.
- A Retired Endpoint that is still declared answers the `RETIRED` Fault; once deleted, its URLs route like any other request, and `NO_SUCH_ENDPOINT` answers when nothing matches, never the not-found Rejection (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in ARCHITECTURE.md).
- A Retired Message cannot be published or sent (a type error), and its Handler is not consumed.

## Open Enums and Open Unions

```ts
status: openEnum(['pending', 'paid'])
payment: openUnion('type', [card, transfer])
```

Readers get a type with an Unknown case and must handle it: an unknown enum value arrives as `{ unknown: 'refunded' }`, and an unknown union variant as `{ type: { unknown: 'crypto' }, raw }`, so TypeScript can tell them from the declared ones. Writers may only use the declared values. `openEnum()` and `openUnion()` infer the writer type only; reader types and schemas are generated from the Snapshot (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md).

## Dependencies

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

The client has methods only for the Endpoints listed, and a Subscription may only reference an Event listed here; which Elements a Service or an Application may depend on is in [Dependencies](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#dependencies) in ARCHITECTURE.md. An Event listed here that no Subscription uses fails the check, since it would block that Event's retirement for nothing.

## Subscriptions

```ts
// src/contract/subscriptions/notify-on-settled.subscription.ts
export const notifyOnSettled = subscription({
  name: 'notify-on-settled',
  event: paymentsDeps.events.paymentSettledV1,
});
```

`name` is unique in the Service and names the Subscription's durable consumer (`orders-service_notify-on-settled`). The Event is the Service's own or one listed in a Dependency. Neither ever changes: to follow a new Message Version, add a new Subscription and remove the old one in a later Release (see [Subscriptions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#subscriptions)).
