# @casitafeliz/loom-contract

The declarations of a Contract: `defineContract`, `defineApplication`, `defineDefinitions`, `defineGroup`, `defineEndpoint`, `defineGuard`, `defineRejection`, `defineEvent`, `defineCommand`, `defineSubscription`, `defineDependencies`, `openEnum`, `openUnion`; the Standard Rejections `invalidInput`, `notFound`, `notImplemented`; and their types (see [Types](#types)). Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md); the rules for changing a Contract are in [COMPATIBILITY.md](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md).

The examples follow the layout in [A first Service](https://github.com/CasitaFeliz/cf-loom/blob/main/README.md#a-first-service) and leave out imports of `zod`, `@casitafeliz/loom-contract` and sibling files. Every declaration is a named export, and an Endpoint or a Guard is exported under its `name` (`export const getOrder = defineEndpoint({ name: 'getOrder', … })`), which its stub imports (see [Stubs and the Handler map](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#stubs-and-the-handler-map) in the handlers README).

Each declaration returns what was written with its `kind`: the object and every list and map in it are copies, frozen, while the author's zod schemas are kept themselves. A field a declaration does not declare is a type error. The types refuse what TypeScript can state exactly, marked _a type error_ below; where each rule is enforced is in [The Compatibility Check](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-compatibility-check) in COMPATIBILITY.md.

## Required fields

Nothing in a declaration is implied: a field is optional only where leaving it out has one stated meaning. A `lifecycle` left out is Active; `success.headers`, a Rejection's `body`, each part of an Endpoint's `input`, a Guard's `demands` and each part of it, and a Guard's `context` and `qualifier` left out are none; a Guard's `guards`, an Endpoint's `guards` and `rejections` and a root's lists left out are empty, except an Application's `dependencies`, which it always lists. Every other field is required, `description` on Endpoints, Groups and Guards included.

## The root

```ts
// src/contract/index.ts
import { definitions as orgDefinitions } from '@org/definitions';

export const contract = defineContract({
  name: 'orders-service',
  definitions: [orgDefinitions],
  groups: [ordersGroup],
  events: [orderCreatedV1, orderCreatedV2],
  commands: [chargeCardV1],
  subscriptions: [notifyOnSettled],
  dependencies: [paymentsDeps],
});
```

The root lists everything in the Contract: what it lists is exactly what the Snapshot describes. A root's `name`, a Service's, an Application's or a Definitions Package's, must equal the unscoped part of the `name` in its package.json, or `generate` fails. A Contract lists each Definitions Package once, under a name of its own, and at most one listed Definitions Package may declare Standard Rejections.

Names follow fixed grammars, so they are safe in code, subjects and broker names, and `generate` fails on a name that breaks its grammar: a Service, Application, Definitions Package, Group or Subscription name is kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`); an Endpoint or Guard name is camelCase (`^[a-z][a-zA-Z0-9]*$`) and none of the words code cannot use as a name: no ECMAScript reserved word, strict mode's included, nor `eval`, `arguments` or `handle`, which every stub imports; a Message name is PascalCase (`^[A-Z][a-zA-Z0-9]*$`); a Rejection code is UPPER_SNAKE_CASE (`^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$`). A Message Version is written `OrderCreated@2` in the Snapshot, the CLI and logs, `orderCreatedV2` in code, and `OrderCreated.v2` inside a subject.

## Applications

An Application has the same layout as a Service (see [Layout](https://github.com/CasitaFeliz/cf-loom/blob/main/README.md#layout) in README.md) with only Dependencies:

```ts
// web-admin/src/contract/dependencies/payments-service.dependencies.ts
import { contract as payments } from '@org/contract-payments-service';

export const adminPaymentsDeps = defineDependencies(payments, {
  endpoints: [payments.endpoints.getPayment],
});
```

```ts
// web-admin/src/contract/index.ts
export const application = defineApplication({
  name: 'web-admin',
  dependencies: [adminOrdersDeps, adminPaymentsDeps],
});
```

A Dependency of an Application on an Endpoint that is not Public, or on any Event, is a type error.

## Definitions Packages

A Definitions Package lives in its own repository:

```ts
// definitions/src/definitions/index.ts, published as @org/definitions
export const definitions = defineDefinitions({
  name: 'definitions',
  guards: [userToken, permission],
  schemas: { money, pagination },
  rejections: [unauthenticated, forbidden],
  standardRejections: {
    invalidInput:   { code: 'BAD_REQUEST',     status: 400, message: 'The request is invalid' },
    notFound:       { code: 'NOT_FOUND',       status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented yet' },
  },
});
```

Services import its Guards and schemas directly and list its `definitions` on their root (see [The root](#the-root)). It lists every Guard and Rejection it exports or its Guards reach, through their `guards` and `rejections`; one it leaves out fails `generate`. It is published built, as JavaScript with its `.d.ts`, from erasable TypeScript source, since Node strips no types under `node_modules`. It may declare any of the three Standard Rejections, each with a code, a status and a message and never a body; one it leaves out takes cf-loom's default (see [Rejections](#rejections)). A status the Rejection rules do not allow (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections) in COMPATIBILITY.md), or a body, is a type error.

## Groups and Endpoints

Every Endpoint belongs to exactly one Group.

```ts
// src/contract/endpoints/orders/orders.group.ts
export const ordersGroup = defineGroup({
  name: 'orders',
  description: 'Order lifecycle',
  endpoints: [getOrder, createOrder],
});
```

A Group lists at least one Endpoint; an empty list is a type error. A Group's name is unique in the Contract; a duplicate fails `generate`.

```ts
// src/contract/endpoints/orders/get-order.endpoint.ts
import { money } from '@org/definitions';

export const getOrder = defineEndpoint({
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
- `method` is `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE` or `OPTIONS`.
- `visibility` is required: `public`, `internal` or `private`.
- `success` declares a `status`, 200, 201, 202, 203 or 204, a `body` and optionally `headers`, an object of the HTTP headers the Endpoint promises with its Success; nothing is implied. A 204 has no body (`success: { status: 204 }`), and its Handler returns `success()`; nor does any Success of a `HEAD` Endpoint, which takes a status and optionally headers. A body where none belongs, or a missing one elsewhere, is a type error. Headers follow the text rules of Input headers, and the object is always open (see [Headers, path and query](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#headers-path-and-query) in COMPATIBILITY.md).
- `input` may hold `params`, `query`, `headers` and `body`. `params` must declare exactly the `:names` in the path, and is absent when the path has none; a body on `GET` or `HEAD` is not allowed. Both are type errors. A strict `query` also admits the params its Guards demand; the EndpointHandler receives only the Endpoint's own. `generate` fails on an optional path param and on `nullable` anywhere in params, query or headers.
- Header names, in `input.headers`, `success.headers` and a Guard's `demands.headers`, are lower-case: headers are case-insensitive, so each has one spelling, and an upper-case letter is a type error.
- `rejections` lists the Endpoint's own Rejections, `notFound` among them when it answers it. Those of its Guards, and the two Rejections cf-loom's runtime produces, invalid input and not implemented, are added without listing them, so listing `invalidInput` or `notImplemented` is a type error (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections) in COMPATIBILITY.md).
- Only shapes and declarative constraints are allowed: see [Not allowed in a Contract](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#not-allowed-in-a-contract).

## Rejections

A Rejection is declared once and referenced wherever it can be answered.

```ts
// src/contract/rejections/order-locked.rejection.ts
export const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ lockedAt: z.iso.datetime() }),
});
```

A status the Rejection rules do not allow (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections) in COMPATIBILITY.md) is a type error.

The three Standard Rejections, invalid input, not found and not implemented, are referenced as `invalidInput`, `notFound` and `notImplemented`, exported by `@casitafeliz/loom-contract`. Their code, status and message come from the Definitions Package listed on the root that declares them (see [Definitions Packages](#definitions-packages)), or from cf-loom's defaults: `INVALID_INPUT` 400 "Invalid input", `NOT_FOUND` 404 "Not found", `NOT_IMPLEMENTED` 501 "Not implemented". The not-found and not-implemented Rejections have no body.

The body of the invalid-input Rejection is cf-loom's, whatever the Definitions Package declares, and its runtime produces it:

```ts
{ issues: [{ in: 'params' | 'query' | 'headers' | 'body', path: (string | number)[], code: string, message: string }] }
```

`code` is one of a closed set cf-loom owns, not zod's issue codes: `required`, `invalid_type`, `invalid_value`, `invalid_format`, `too_small`, `too_big`, `not_multiple`, `unrecognized_key` and `malformed` (an unparseable body or a wrong content type). An issue never carries the received value.

## Guards

```ts
// src/contract/guards/api-key.guard.ts
export const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per client',
  demands: {
    headers: z.object({ 'x-api-key': z.string() }),
  },
  context: z.object({ clientId: z.string() }),
  rejections: [unauthenticated],
});
```

A Guard states what it demands from the request (`headers` or `query`; a body or path params are a type error), the Context it provides, and the Rejections it may answer, declared ones only: a Standard Rejection on a Guard is a type error. It holds no logic: its GuardHandler lives in each Service that attaches it. Its `name` keys its Context and must be unique across the Contract and every Definitions Package it lists; a duplicate fails `generate`.

A Guard may build on others and take a Qualifier:

```ts
// definitions/src/definitions/guards/permission.guard.ts
export const permissionCode = z.enum(['orders:read', 'orders:edit', 'customers:read']);

export const permission = defineGuard({
  name: 'permission',
  description: 'The user holds every listed permission',
  guards: [userToken],
  qualifier: z.array(permissionCode).min(1),
  rejections: [forbidden],
});
```

```ts
// an Endpoint lists every Guard itself, in order
guards: [userToken, { guard: permission, qualifier: ['orders:edit'] }],
```

- `guards` lists the Guards whose Context its GuardHandler reads, one key per Guard that provides a Context, by name.
- `qualifier` is the schema of the value each Endpoint attaches the Guard with, its Qualifier, using the schemas allowed in a Contract (see [Not allowed in a Contract](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#not-allowed-in-a-contract)). The GuardHandler receives it; a Qualifier enforces nothing by itself and never travels on the wire.
- An Endpoint's `guards` are its Attachments: a Guard without a `qualifier` is listed bare, one with a `qualifier` as `{ guard, qualifier }` with a value its schema accepts; the value, and each object in it, holds only the keys its schema declares. Every Guard a listed Guard names appears earlier, and a Guard appears once. Each of these is a type error. To require two permissions, the Qualifier is a list.
- A check that needs the path params or the body, such as whether the Caller owns the order, belongs to the EndpointHandler, which may answer any of its Guards' Rejections.

## Events and Commands

Each Message Version is its own declaration and file.

```ts
// src/contract/events/order-created.v2.event.ts
export const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  body: z.object({ orderId: z.uuid(), total: money }),
});
```

```ts
// src/contract/commands/charge-card.v1.command.ts
export const chargeCardV1 = defineCommand({
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
export const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  lifecycle: 'deprecated',
  body: z.object({ orderId: z.uuid(), total: z.number() }),
});
```

To retire it, mark it `lifecycle: 'retired'` and publish; this needs the Element Deprecated in the Baseline, no Dependency using it, and, for an Endpoint, a Breaking Change Approval (see [Retirement](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#retirement)). `handlers.generated.ts` leaves Retired Elements out, so their Handlers may then be deleted. Once a published Baseline records the Element as Retired, its declaration may be deleted too: `cf-loom publish` carries every Retired Element forward from the Baseline as a tombstone, so its identity is never reused (see [Lifecycle and tombstones](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#lifecycle-and-tombstones)). Its Handler goes with its declaration, since `generate` fails on a Handler file no declared Endpoint, Guard, Command's Message Version or Subscription names (see [Stubs and the Handler map](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#stubs-and-the-handler-map) in the handlers README).

At runtime:

- A Deprecated Endpoint still works, and every HTTP response carries `Deprecation: @<unix seconds>` (RFC 9745), the instant `generate` stamped as `deprecatedAt` when it first saw the Endpoint Deprecated (see [Endpoints](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#endpoints) in SNAPSHOT.md); the client warns once per method. A Deprecated Message Version carries no header: none exists for it.
- A Deprecated Event is still published until it is Retired, so Subscribers that have not moved on keep receiving it. A Deprecated Command is not sent, but its CommandHandler keeps running to drain what is already queued.
- A Retired Endpoint that is still declared answers the `RETIRED` Fault; once deleted, its URLs route like any other request, and `NO_SUCH_ENDPOINT` answers when nothing matches, never the not-found Rejection (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in ARCHITECTURE.md).
- A Retired Message cannot be published or sent (a type error), and its Handler is not consumed.

## Open Enums and Open Unions

```ts
status: openEnum(['pending', 'paid']).describe('Where the order stands')
payment: openUnion('type', [card, transfer])
```

Readers get a type with an Unknown case and must handle it: an unknown enum value arrives as `{ unknown: 'refunded' }`, and an unknown union variant as `{ type: { unknown: 'crypto' }, raw }`, so TypeScript can tell them from the declared ones. Writers may only use the declared values. `openEnum()` and `openUnion()` infer the writer type only; reader types and schemas are generated from the Snapshot (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md).

`openEnum()` takes string values. `openUnion(discriminator, variants)` takes schemas whose discriminator is a string literal (a `z.lazy` of an object included) and returns zod's discriminated union; a literal of several values, a value that is no string, or two variants with the same value, fail `generate`. Its types refuse a variant whose discriminator is no string literal, but take what zod's own discriminated union takes, such as an enum discriminator, a nested union or intersection variant, or a `.default()`, which only `generate` refuses. Inside an intersection, use `.extend()` (see [Not allowed](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#not-allowed) in SNAPSHOT.md). Openness belongs to the schema either one returns and survives zod's own `.describe()`, `.meta()` and `zod/mini` metadata, which keep its shape; a `z.enum()` or `z.discriminatedUnion()` described the same way stays closed.

## Dependencies

Install the Provider's Contract Package, then declare what is used:

```bash
npm install @org/contract-payments-service
npx cf-loom add-dependency payments-service getPayment
```

```ts
// src/contract/dependencies/payments-service.dependencies.ts
import { contract as payments } from '@org/contract-payments-service';

export const paymentsDeps = defineDependencies(payments, {
  endpoints: [payments.endpoints.getPayment],
  events: [payments.events.paymentSettledV1],
});
```

A Contract Package's Elements are its declarations: a Dependency keeps the Endpoints it selects by identity, and its Events by name and version, their identity in the Snapshot (see [Identities](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#identities) in SNAPSHOT.md). A Dependency records the Provider's name as `provider`, the `version` of the Contract Package it was declared against as `against`, the Provider's resolved Standard Rejections as `standardRejections` and the Elements the Provider exports as `exported`, and exposes the Elements it selects by their names in code (`paymentsDeps.endpoints.getPayment`, `paymentsDeps.events.paymentSettledV1`); selecting an Element the Provider's Contract Package does not export is a type error, and `generate` checks each selected Element against `exported`. A Contract lists at most one Dependency per Provider; a second fails `generate`. The client has methods only for the Endpoints listed, and a Subscription may only reference an Event listed here; which Elements a Service or an Application may depend on is in [Dependencies](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#dependencies) in ARCHITECTURE.md. An Event listed here that no Subscription uses fails `generate`, since it would block that Event's retirement for nothing.

## Subscriptions

```ts
// src/contract/subscriptions/notify-on-settled.subscription.ts
export const notifyOnSettled = defineSubscription({
  name: 'notify-on-settled',
  event: paymentsDeps.events.paymentSettledV1,
});
```

`name` is unique in the Service and names the Subscription's durable consumer (`orders-service_notify-on-settled`). The Event is the Service's own or one listed in a Dependency. Neither ever changes: to follow a new Message Version, add a new Subscription and remove the old one in a later Release (see [Subscriptions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#subscriptions)).

## Types

- `Visibility`, `Lifecycle`, `Method`, `SuccessStatus` and `RejectionStatus`: the values a declaration may take.
- `IssueCode`, the closed set of codes an issue of invalid Input says went wrong (see [Rejections](#rejections)).
- `StandardRejection`, the type of `invalidInput`, `notFound` and `notImplemented`; `StandardRejections`, their codes, statuses and messages resolved, as a Contract Package carries them.
- `Contract`, `Application`, `Definitions`, `Group`, `Endpoint`, `Guard`, `Rejection` and `Dependencies`: what each declaration returns, typed by what was written; `Attachment`, a Guard as an Endpoint's `guards` lists it: the Guard bare, or a `QualifiedAttachment` `{ guard, qualifier }` for a Guard that declares a `qualifier`; `ContractPackage`, the `contract` a Contract Package exports, and `ExportedElements`, the Endpoints and Events of it a Dependency keeps (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md).
- `InputOf<typeof getOrder>`, the Input its EndpointHandler receives, one key per declared part; `SuccessOf<typeof getOrder>`, its Success's status, headers and body; `ContextOf<typeof getOrder>`, its Context, one key per Guard that provides a Context, by name; `ProvidedContextOf<typeof apiKey>`, the Context one Guard provides (`undefined` without a `context`); `QualifierOf<typeof permission>`, the Qualifier its GuardHandler receives, typed by its `qualifier` schema (`undefined` without a `qualifier`); `RequiredContextOf<typeof permission>`, the Context a Guard's GuardHandler reads from the Guards it lists, keyed like `ContextOf`; `DemandsOf<typeof apiKey>`, what a Guard's GuardHandler receives first, one key per declared demand part (`{}` when it demands nothing); `RejectionsOf<typeof getOrder>`, every Rejection it may answer: its own, its Guards' and the two cf-loom's runtime adds, and `RejectionsOf<typeof apiKey>`, a Guard's own and the not-implemented Rejection its stub answers.
