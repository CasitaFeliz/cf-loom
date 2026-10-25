# @cf-loom/contract

The declarations of a Contract: `defineContract`, `defineApplication`, `defineDefinitions`, `defineGroup`, `defineEndpoint`, `defineGuard`, `defineRejection`, `defineEvent`, `defineCommand`, `defineSubscription`, `defineDependency`, `openEnum`, `openEnumReader`; the Standard Rejections `invalidInput`, `notFound`, `notImplemented`; and their types (see [Types](#types)). Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md); the rules for changing a Contract are in [COMPATIBILITY.md](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md).

The examples follow the layout in [A first Service](https://github.com/CasitaFeliz/cf-loom/blob/main/README.md#a-first-service) and leave out imports of `zod`, `@cf-loom/contract` and sibling files. Every Endpoint, Guard, Command's Message Version and Subscription is exported by a file under `src/contract/` (a Definitions Package's Guard, by a package the Contract's files import), under any name, `default` included: `generate` imports each from the first file that exports it, files and then export names in code point order: a stub imports an Endpoint or Guard under its name in code (`getOrder`), and the readers file imports a Command's Message Version or Subscription under a local of its own and pairs it under its name in code (`chargeCardV1`, `notifyOnSettled`; see [Stubs and the Handler map](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#stubs-and-the-handler-map) in the handlers README and the `service-code` module in the CLI's [ARCHITECTURE.md](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/ARCHITECTURE.md#modules)). The examples export each under that name: `export const getOrder = defineEndpoint({ name: 'getOrder', … })`.

Each declaration returns what was written with its `kind`: the object and every list and map in it are copies, frozen, while the author's zod schemas are kept themselves. A field a declaration does not declare is a type error. The types refuse what TypeScript can state exactly, marked _a type error_ below; where each rule is enforced is in [The Compatibility Check](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-compatibility-check) in COMPATIBILITY.md.

## Required fields

Nothing in a declaration is implied: a field is optional only where leaving it out has one stated meaning. A `lifecycle` left out is Active; `success.headers`, a Rejection's `body`, each part of an Endpoint's `input`, a Guard's `demands` and each part of it, and a Guard's `context` and `qualifier` left out are none; a Guard's `guards`, an Endpoint's `guards` and `rejections`, and a root's and a Group's lists left out are empty. Every other field is required, `description` on Endpoints, Groups, Guards, Events, Commands and Subscriptions included, and a `description` or a `message` is never blank.

## The root

```ts
// src/contract/index.ts
import { definitions as orgDefinitions } from '@org/definitions';

export const contract = defineContract({
  name: 'orders-service',
  standardRejections: orgDefinitions,
  groups: [ordersGroup],
  dependencies: [paymentsDependency],
});
```

The root lists everything in the Contract, its Elements and Subscriptions through its Groups: the Snapshot describes what it lists and the Guards, codes and shared schemas those reach, so an Endpoint, Event, Command's Message Version or Subscription that a file under `src/contract/` exports and no Group lists fails a Service's `generate` and `verify`, and so does a Group such a file exports that the root does not list, reported once and without what it lists; what a listed Dependency's Provider exports is the Provider's, never reported, and a Guard or Rejection needs no listing, since an Endpoint or a Guard reaches it. A Service's or Application's `name` must equal the unscoped part of the `name` in its package.json, or `generate` fails. A Definitions Package has none: its package.json names it. The root names as `standardRejections` the Definitions Package whose Standard Rejections the Contract takes; without one, it takes cf-loom's defaults. The Definitions Packages a Contract uses are the ones whose Guards, Rejections and schemas it reaches, and the Snapshot records them in each `origin`; a declaration several of them export belongs to the one that imports it from none of the others, which must have a name and a version in its package.json, or `generate` fails; the Snapshot never names a package by a path. A Group reaches the root as `defineGroup` typed it, never annotated `Group`, so each Message Version keeps its exact type and `publish` and `send` know every version of an Event or a Command, whatever Group lists it (see [Publishing and sending](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#publishing-and-sending) in the messaging README).

Names follow fixed grammars, so they are safe in code, as keys of an object, and in subjects and broker names, and `generate` fails on a name that breaks its grammar: a Service, Application or Group name is kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`); an Endpoint, Guard or Subscription name is camelCase words (`^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)*$`) and none of the names code cannot use safely: no ECMAScript reserved word, strict mode's included, nor `eval`, `arguments` or `handle`, which every stub imports, nor a name every object already has, `Object.prototype`'s `constructor`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `toString` and `valueOf`, or one JavaScript calls on its own, `then` and `toJSON`, since a client has a method per Endpoint and the Handler map a Handler per name, and a literal reserved name is _a type error_; a Message name is PascalCase words (`^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)*$`); in both, each capital starts a word of at least one lower-case letter or digit after it, so a name derives to readable file and code names: `UrlRefresh` and `getUrl`, not `URLRefresh` or `getURL`; a Rejection code is UPPER_SNAKE_CASE (`^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$`); a recursion id (`.meta({ id })`) is camelCase (`^[a-z][a-zA-Z0-9]*$`; see [Recursion](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#recursion) in SNAPSHOT.md); an object field takes no name every object already has either, `Object.prototype`'s own, and `generate` fails on one at any depth (see [Not allowed](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#not-allowed) in SNAPSHOT.md). A Message Version is written `OrderCreated@2` in the Snapshot, the CLI and logs, `orderCreatedV2` in code, and `OrderCreated.v2` inside a subject.

## Applications

An Application has the same layout as a Service (see [Layout](https://github.com/CasitaFeliz/cf-loom/blob/main/README.md#layout) in README.md) with only Dependencies:

```ts
// web-admin/src/contract/dependencies/payments-service.dependency.ts
import { contract as payments } from '@org/contract-payments-service';

export const adminPaymentsDependency = defineDependency({
  provider: payments,
  endpoints: [payments.endpoints.getPayment],
});
```

```ts
// web-admin/src/contract/index.ts
export const application = defineApplication({
  name: 'web-admin',
  dependencies: [adminOrdersDependency, adminPaymentsDependency],
});
```

A Dependency of an Application on an Endpoint that is not Public is a type error that names the Endpoint, and `generate` fails on one the types did not catch; an Application has no Subscriptions, so each of its Dependencies selects Endpoints.

## Definitions Packages

A Definitions Package is a package of its own, which may be a repository of its own (recommended) or one package of a monorepo:

```ts
// definitions/src/definitions/index.ts, published as @org/definitions
export const definitions = defineDefinitions({
  standardRejections: {
    invalidInput:   { code: 'BAD_REQUEST',     status: 400, message: 'The request is invalid' },
    notFound:       { code: 'NOT_FOUND',       status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented yet' },
  },
});

export { userToken, permission, money, pagination, unauthenticated, forbidden };
```

Services import its Guards, Rejections and schemas by name; a Service names its `definitions` as `standardRejections` to take its Standard Rejections (see [The root](#the-root)). Its root file exports `definitions` and exactly what it shares: each Guard, Rejection and zod schema, under the name Services import it by; those exports are what its Snapshot describes. Any other export fails `generate`, and so does a Guard or Rejection an exported Guard reaches without being exported, since Services import it to attach it or reject with it. Only the root file's exports count: a declaration exported only from another entry of the package is none of its members. It is published built, as JavaScript with its `.d.ts`, from erasable TypeScript source, since Node strips no types under `node_modules`. It may declare any of the three Standard Rejections, each with a code, a status and a message and never a body; one it leaves out takes cf-loom's default (see [Rejections](#rejections)). A status the Rejection rules do not allow (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections) in COMPATIBILITY.md), or a body, is a type error.

## Groups

Every Endpoint, Event's or Command's Message Version, and Subscription belongs to exactly one Group; two Message Versions of one Event or Command may sit in different Groups. Guards belong to none.

```ts
// src/contract/groups/orders.group.ts
export const ordersGroup = defineGroup({
  name: 'orders',
  description: 'Order lifecycle',
  endpoints: [getOrder, createOrder],
  events: [orderCreatedV1, orderCreatedV2],
  commands: [chargeCardV1],
  subscriptions: [notifyOnSettled],
});
```

A Group lists at least one Endpoint, Event, Command or Subscription; one that lists nothing, or an empty list, is a type error, and `generate` fails on a Group that lists nothing. A Group's name is unique in the Contract; a duplicate fails `generate`.

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
- `method` is `GET`, `POST`, `PUT`, `PATCH`, `DELETE` or `OPTIONS`; never `HEAD` (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in ARCHITECTURE.md).
- `visibility` is required: `public`, `internal` or `private`.
- `success` declares a `status`, 200, 201, 202, 203 or 204, a `body` and optionally `headers`, an object of the HTTP headers the Endpoint promises with its Success; nothing is implied. A 204 has no body (`success: { status: 204 }`), and its Handler returns `success()`. A body where none belongs, or a missing one elsewhere, is a type error. Headers follow the text rules of Input headers, and the object is always open (see [Headers, path and query](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#headers-path-and-query) in COMPATIBILITY.md).
- `input` may hold `params`, `query`, `headers` and `body`. `params` must declare exactly the `:names` in the path, and is absent when the path has none; a body on `GET` is not allowed. Both are type errors. The EndpointHandler receives only the Endpoint's own query params, not those its Guards demand. `generate` fails on an optional path param and on `nullable` anywhere in params, query or headers.
- Header names, in `input.headers`, `success.headers` and a Guard's `demands.headers`, are lower-case: headers are case-insensitive, so each has one spelling, and an upper-case letter is a type error. A name is also an RFC 9110 token (`^[!#$%&'*+\-.^_`|~0-9a-z]+$`) and none of the names the host or cf-loom owns: `content-length`, `transfer-encoding`, `connection`, `keep-alive`, `proxy-connection`, `upgrade`, `te`, `trailer`, `host`, `content-type`, `content-encoding`, `content-range` and `deprecation`; `generate` fails on either (`cookie` and `content-location` are allowed).
- `rejections` lists the Endpoint's own Rejections, `notFound` among them when it answers it. Those of its Guards, and the two Rejections cf-loom's runtime produces, invalid input and not implemented, are added without listing them, so listing `invalidInput` or `notImplemented` is a type error (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections) in COMPATIBILITY.md).
- Only shapes and declarative constraints are allowed: see [Not allowed in a Contract](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#not-allowed-in-a-contract).

## Rejections

A code is declared once: by one `defineRejection`, in the Contract or a Definitions Package it uses, and never with the code a Standard Rejection resolves to; a second declaration fails `generate`, naming each, while the same Rejection referenced twice, or re-exported by another Definitions Package, is one. An Endpoint or a Guard lists each code once, and an Endpoint each Standard Rejection once; listing one twice is a type error.

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

The three Standard Rejections, invalid input, not found and not implemented, are referenced as `invalidInput`, `notFound` and `notImplemented`, exported by `@cf-loom/contract`. Their code, status and message come from the Definitions Package the root names as `standardRejections` (see [The root](#the-root)), or from cf-loom's defaults: `INVALID_INPUT` 400 "Invalid input", `NOT_FOUND` 404 "Not found", `NOT_IMPLEMENTED` 501 "Not implemented". The not-found and not-implemented Rejections have no body.

The body of the invalid-input Rejection is cf-loom's, whatever the Definitions Package declares, and its runtime produces it:

```ts
{ issues: [{ in: 'params' | 'query' | 'headers' | 'body', path: (string | number)[], code: string, message: string }] }
```

`code` is one of a set cf-loom owns, not zod's issue codes: `required`, `invalid_type`, `invalid_value`, `invalid_format`, `too_small`, `too_big`, `not_multiple`, `unrecognized_key` and `malformed` (an unparseable body or a wrong content type). `in` and `code` are Open Enums, which a Caller reads through its Provider's Contract Package with their Unknown case, so a part or a code a later cf-loom adds is an Additive Change. An issue never carries the received value.

## Guards

```ts
// src/contract/guards/api-key.guard.ts
export const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: {
    headers: z.object({ 'x-api-key': z.string() }),
  },
  context: z.object({ callerId: z.string() }),
  rejections: [unauthenticated],
});
```

A Guard states what it demands from the request (`headers` or `query`; a body or path params are a type error), the Context it provides, and the Rejections it may answer, declared ones only: a Standard Rejection on a Guard is a type error. It holds no logic: its GuardHandler lives in each Service that attaches it. Its `name` keys its Context and must be unique among the Guards the Contract reaches, its own and its Definitions Packages'; a duplicate fails `generate`.

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
- An Endpoint's `guards` are its Attachments: a Guard without a `qualifier` is listed bare, one with a `qualifier` as `{ guard, qualifier }` with a value its schema accepts; the value, and each object in it, holds only the keys zod keeps when its schema parses it (in a union, the first option that parses the value decides). Every Guard a listed Guard names appears earlier, and a Guard appears once. Each of these is a type error where the types can state it, and `generate` fails on the rest, such as a list shorter than its `.min()` or a key the union option that parses the value drops. To require two permissions, the Qualifier is a list.
- A check that needs the path params or the body, such as whether the Caller owns the order, belongs to the EndpointHandler, which may answer any of its Guards' Rejections.

## Events and Commands

Each Message Version is its own declaration and file.

```ts
// src/contract/events/orders/order-created.v2.event.ts
export const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  description: 'An order was placed, with its total',
  body: z.object({ orderId: z.uuid(), total: money }),
});
```

```ts
// src/contract/commands/orders/charge-card.v1.command.ts
export const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the card an order is paid with',
  body: z.object({ orderId: z.uuid() }),
});
```

An Event takes `visibility`, a Command none, and a Public Event is a type error; which Visibilities each kind of Element may have is in [Visibility and Guards](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#visibility-and-guards) in ARCHITECTURE.md.

A Message body is an object of its fields, so a Message can grow without a new Message Version; a scalar, a list, a record, a union or a nullable object as a body is a type error, and `generate` fails on one the types cannot tell. A `version` is a whole number from 1 to `Number.MAX_SAFE_INTEGER`: a literal that is not one, one written with an exponent (`1e21`) and a union of versions are type errors, and `generate` fails on any other number; which Message Versions `generate` refuses, how versions are numbered, and that a Command has at most one Active version are in [Messages](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#messages).

## Lifecycle

Any Element takes `lifecycle: 'deprecated'`:

```ts
// src/contract/events/orders/order-created.v1.event.ts
export const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was placed',
  lifecycle: 'deprecated',
  body: z.object({ orderId: z.uuid(), total: z.number() }),
});
```

To retire it, mark it `lifecycle: 'retired'` and publish; this needs the Element Deprecated in the Baseline and, for an Endpoint or an Event, a Breaking Change Approval (see [Retirement](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#retirement)). The Handler map leaves Retired Elements out: `generate` names the Handler of each Element you retire (`… which is Retired: delete it`) and regenerates the map once the file is gone, so a Handler never outlives the record of it. A live Endpoint that takes the name of a Retired one needs a Handler of its own: delete the old file before `generate`, or `serve` refuses it as written for the Retired Endpoint. Once a published Baseline records the Element as Retired, its declaration may be deleted too: `cf-loom publish` carries every Retired Element forward from the Baseline as a tombstone, so its identity is never reused (see [Lifecycle and tombstones](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#lifecycle-and-tombstones)).

At runtime:

- A Deprecated Endpoint still works, and every HTTP response carries `Deprecation: @<unix seconds>` (RFC 9745), the instant `generate` stamped as `deprecatedAt` when it first saw the Endpoint Deprecated (see [Endpoints](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#endpoints) in SNAPSHOT.md), which `serve` reads from the Handler map `generate` writes; the client tells it once per method (see [Deprecation](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#deprecation) in the client README). A Deprecated Message Version carries no header: none exists for it.
- A Deprecated Event is still published until it is Retired, so Subscribers that have not moved on keep receiving it. A Deprecated Command is not sent, but its CommandHandler keeps running to drain what is already queued.
- A Retired Endpoint that is still declared answers the `RETIRED` Fault; once deleted, its URLs route like any other request, and `NO_SUCH_ENDPOINT`, or `METHOD_NOT_ALLOWED` on a path another Endpoint declares, answers when nothing matches, never the not-found Rejection (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in ARCHITECTURE.md).
- A Retired Message cannot be published or sent (a type error), and its Handler is not consumed.

## Open Enums

```ts
status: openEnum(['pending', 'paid']).describe('Where the order stands')
payment: z.object({
  type: openEnum(['card', 'transfer']),
  last4: z.string().optional(),
  iban: z.string().optional(),
})
```

Readers get a type with an Unknown case and must handle it: an unknown value arrives as `{ unknown: 'refunded' }`, so TypeScript can tell it from the declared ones. Writers may only use the declared values. `openEnum()` infers the writer type only; reader types and schemas are generated from the Snapshot (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md). An Open Enum's Reader schema is `openEnumReader(['pending', 'paid'])`, which generated readers call and a Contract never does: it reads a declared value as itself and any other string as its Unknown case, and writes that case back as its string, refusing one that holds a declared value, so whoever writes a value as a reader reads it, as a fake does (see [Faking Providers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/testing/README.md#faking-providers) in the testing README), goes through the same schema.

A set of variants that grows is an object whose `type` is an Open Enum and whose variants' fields are optional, as `payment` above: a reader handles a `type` it does not know, and a new variant adds a value and its optional fields. A `z.discriminatedUnion()` is closed (see [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions) in COMPATIBILITY.md).

`openEnum()` takes string values. Inside an intersection or a plain union, use `.extend()` or a discriminated union (see [Not allowed](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#not-allowed) in SNAPSHOT.md). Openness belongs to the schema `openEnum()` returns, typed `OpenEnum<…>`, and to every schema zod derives from it: `.describe()`, `.meta()`, `zod/mini` metadata, `.exclude()` and `.extract()` keep it; a `z.enum()` stays closed. To take any schema, open or not, as a parameter, type it `z.ZodType`.

## Dependencies

Install the Provider's Contract Package, then declare what is used:

```bash
npm install @org/contract-payments-service
npx cf-loom add-dependency payments-service getPayment
```

```ts
// src/contract/dependencies/payments-service.dependency.ts
import { contract as payments } from '@org/contract-payments-service';

export const paymentsDependency = defineDependency({
  provider: payments,
  endpoints: [payments.endpoints.getPayment],
});
```

A Dependency holds the Provider's Contract Package as `provider`, the `contract` it exports, and the Endpoints it calls as `endpoints`, the list as written; its client has a method named after each Endpoint it lists (`client(paymentsDependency, …).getPayment`, see the [client README](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md)). From `provider` the Snapshot records the Provider's name and the `version` the Dependency was declared against, the client narrows by the Provider's Standard Rejections, their codes kept as the Provider wrote them, and reads nodes from its exported Snapshot (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md). A Contract Package's Elements are its declarations: the Dependency keeps the Endpoints it selects by identity, and the Snapshot records each by its identity (see [Identities](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#identities) in SNAPSHOT.md). Selecting an Endpoint the Provider's Contract Package does not export is a type error, and `generate` checks each listed Endpoint against the ones `provider` exports and fails on one listed twice; `defineDependency` never throws, so what the types refuse, written through a cast, is reported by `generate`. A Dependency selects no Event: a Subscription to another Service's Event takes it from that Service's Contract Package (see [Subscriptions](#subscriptions)), and needs that Service listed as a Dependency. A Contract lists at most one Dependency per Provider; a second fails `generate`. A Dependency is used: one that lists no Endpoint and whose Provider exports no Event a Subscription receives fails `generate`, since a Dependency names only what its owner uses. The client has methods only for the Endpoints listed; which Elements a Service or an Application may depend on is in [Dependencies](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#dependencies) in ARCHITECTURE.md.

## Subscriptions

```ts
// src/contract/subscriptions/orders/notify-on-settled.subscription.ts
import { contract as payments } from '@org/contract-payments-service';

export const notifyOnSettled = defineSubscription({
  name: 'notifyOnSettled',
  description: 'Notifies the customer of each payment settled',
  event: payments.events.paymentSettledV1,
});
```

`name` is unique in the Service and names the Subscription's durable consumer from its name in kebab-case (`orders-service_notify-on-settled`). The Event is the Service's own, listed in one of its Groups, or one a listed Dependency's Provider exports, taken from its Contract Package, and not Retired; another fails `generate`, and a Retired one is also a type error. A Command in `event` is a type error too, and fails `generate`: a Command is handled by its CommandHandler. Neither ever changes: to follow a new Message Version, add a new Subscription and remove the old one in a later Release (see [Subscriptions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#subscriptions)).

## Types

- `Visibility`, `Lifecycle`, `Method`, `SuccessStatus` and `RejectionStatus`: the values a declaration may take.
- `IssueCode`, the set of codes an issue of invalid Input says went wrong (see [Rejections](#rejections)); a Caller reads them through its Provider's Contract Package as an Open Enum, so a code a later cf-loom adds arrives as its Unknown case (see [What a call receives](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#what-a-call-receives) in the client README).
- `OpenEnum<T>`, the type `openEnum()` returns (see [Open Enums](#open-enums)).
- `Committed`, `'no' | 'yes' | 'unknown'`, whether a Fault's change was committed; `Issue`, one way a value broke its part of the Contract (see [Rejections](#rejections)); `ReservedCode`, a code cf-loom answers outside the Contract, as a Fault.
- `Http`, `(request: Request) => Promise<Response>`: an HTTP exchange, a Request answered with a Response, what `serve` returns and what a client's `fetch` is called as; `globalThis.fetch` is one.
- `StandardRejection`, the type of `invalidInput`, `notFound` and `notImplemented`; `StandardRejections`, their codes, statuses and messages resolved; `ProvidedStandardRejections`, those as a Contract Package carries them for its Callers, the invalid-input one with the Reader schema of its body.
- `Contract`, `Application`, `Definitions`, `Group`, `Endpoint`, `Guard`, `Rejection`, `Event`, `Command`, `Subscription` and `Dependency`: what each declaration returns, typed by what was written; `Attachment`, a Guard as an Endpoint's `guards` lists it: the Guard bare, or a `QualifiedAttachment` `{ guard, qualifier }` for a Guard that declares a `qualifier`; `ContractPackage`, the `contract` a Contract Package exports, whose `standardRejections` are `ProvidedStandardRejections`, which a Dependency holds as `provider`, and `ExportedSnapshot`, its Snapshot cut to what it exports (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md).
- `InputOf<typeof getOrder>`, the Input its EndpointHandler receives, one key per declared part; `SuccessOf<typeof getOrder>`, its Success's status, headers and body; `ContextOf<typeof getOrder>`, its Context, one key per Guard that provides a Context, by name; `ProvidedContextOf<typeof apiKey>`, the Context one Guard provides (`undefined` without a `context`); `QualifierOf<typeof permission>`, the Qualifier its GuardHandler receives, typed by its `qualifier` schema (`undefined` without a `qualifier`); `RequiredContextOf<typeof permission>`, the Context a Guard's GuardHandler reads from the Guards it lists, keyed like `ContextOf`; `DemandsOf<typeof apiKey>`, what a Guard's GuardHandler receives first, one key per declared demand part (`{}` when it demands nothing); `RejectionsOf<typeof getOrder>`, every Rejection it may answer: its own, its Guards' and the two cf-loom's runtime adds, and `RejectionsOf<typeof apiKey>`, a Guard's own and the not-implemented Rejection its stub answers.
