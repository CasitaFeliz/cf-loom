# @cf-loom/contract

The declarations of a Contract: `defineService`, `defineApplication`, `defineDefinitions`, `defineGroup`, `defineEndpoint`, `defineGuard`, `defineRejection`, `defineEvent`, `defineCommand`, `defineSubscription`, `defineDependency`, `openEnum`; `openEnumReader`, `providedEndpoint`, `providedEvent` and `providedRejection`, which generated code calls; the Standard Rejections `invalidInput`, `notFound`, `notImplemented`; and their types (see [Types](#types)). Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md); the rules for changing a Contract are in [COMPATIBILITY.md](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md).

The examples follow the layout in [A first Service](https://github.com/CasitaFeliz/cf-loom/blob/main/README.md#a-first-service) and leave out imports of `zod`, `@cf-loom/contract` and sibling files; each Endpoint, Guard, Command's Message Version and Subscription is exported under its name in code, as `export const getOrder = defineEndpoint({ name: 'getOrder', … })`, and [The Root](#the-root) says how `generate` finds it.

Each declaration returns what was written with its `kind`: the object and every list and map in it are copies, frozen, while the author's zod schemas are kept themselves. A field a declaration does not declare is a type error, and so is a construct that [Not allowed](#not-allowed) says the types refuse.

## First declarations

An Endpoint, the Group that lists it and the Root that lists the Group are three files, which `generate` reads to write the Snapshot, shown with their imports:

```ts
// src/contract/endpoints/orders/get-order.endpoint.ts
import { defineEndpoint } from '@cf-loom/contract';
import { z } from 'zod';

export const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'internal',
  description: 'One order by id',
  input: { params: z.object({ orderId: z.uuid() }) },
  success: { status: 200, body: z.object({ id: z.uuid(), total: z.number() }) },
});
```

```ts
// src/contract/groups/orders.group.ts
import { defineGroup } from '@cf-loom/contract';
import { getOrder } from '../endpoints/orders/get-order.endpoint.ts';

export const ordersGroup = defineGroup({
  name: 'orders',
  description: 'Order lifecycle',
  endpoints: [getOrder],
});
```

```ts
// src/contract/index.ts
import { defineService } from '@cf-loom/contract';
import { ordersGroup } from './groups/orders.group.ts';

export const contract = defineService({ name: 'orders-service', groups: [ordersGroup] });
```

[Required fields](#required-fields) says what a declaration may leave out, and [The Root](#the-root) and [Groups](#groups) show the rest of what these three take.

## Required fields

Nothing in a declaration is implied: a field is optional only where leaving it out has one stated meaning. A `lifecycle` left out is Active; `success.headers`, a Rejection's `headers` and `body`, each part of an Endpoint's `input`, a Guard's `demands` and each part of it, and a Guard's `context` and `qualifier` left out are none; a Guard's `guards`, an Endpoint's `guards` and `rejections`, and a Root's and a Group's lists left out are empty. Every other field is required, `description` on Endpoints, Groups, Guards, Events, Commands and Subscriptions included, and a `description` or a `message` is never blank.

## The Root

```ts
// src/contract/index.ts
import { definitions as orgDefinitions } from '@org/definitions';

export const contract = defineService({
  name: 'orders-service',
  standardRejections: orgDefinitions,
  groups: [ordersGroup],
  dependencies: [paymentsDependency],
});
```

The Root is the one Root its file exports, under any name: `defineService` declares a Service's Contract, `defineApplication` an Application's and `defineDefinitions` a Definitions Package (see Root in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md)). A Service's Root lists everything in the Contract, its Elements and Subscriptions through its Groups: the Snapshot describes what it lists and the Guards, codes and shared schemas those reach, so an Endpoint, Event, Command's Message Version or Subscription that a file under `src/contract/` exports and no Group lists fails a Service's `generate` and `verify`, and so does a Group such a file exports that the Root does not list, reported once and without what it lists; what a Contract Package exports is its Provider's: never reported, and a Group that lists it fails `generate`, and a Guard or Rejection needs no listing, since an Endpoint or a Guard reaches it.

Every Endpoint, Guard, Command's Message Version and Subscription is exported by a file under `src/contract/` (a Definitions Package's Guard, by a package the Contract's files import), under any name, `default` included: `generate` imports each from the first file that exports it, files and then export names in code point order: a Stub imports an Endpoint or Guard under its name in code (`getOrder`), and the Readers file imports a Command's Message Version or Subscription under a local of its own and pairs it under its name in code (`chargeCardV1`, `notifyOnSettled`; see [Stubs and the Handler map](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#stubs-and-the-handler-map) in the handlers README and the `service-code` module in the CLI's [ARCHITECTURE.md](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/ARCHITECTURE.md#modules)).

A Service's or Application's `name` must equal the unscoped part of the `name` in its package.json, or `generate` fails. A Definitions Package has none: its package.json names it.

The Root names as `standardRejections` the Definitions Package whose Standard Rejections the Contract takes; without one, it takes cf-loom's defaults. The Definitions Packages a Contract uses are the ones whose Guards, Rejections and schemas it reaches, and the Snapshot records them in each `origin`; a declaration several of them export belongs to the one that imports it from none of the others, which must have a name and a version in its package.json, or `generate` fails; the Snapshot never names a package by a path.

A Group reaches the Root as `defineGroup` typed it, never annotated `Group`, so each Message Version keeps its exact type and `publish` and `send` know every version of an Event or a Command, whatever Group lists it (see [Publishing and sending](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#publishing-and-sending) in the messaging README).

Names follow fixed grammars, so they are safe in code, as keys of an object, and in subjects and broker names, and `generate` fails on a name that breaks its grammar: a Service, Application or Group name is kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`); an Endpoint, Guard or Subscription name is camelCase words (`^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)*$`) and none of the names code cannot use safely: no ECMAScript reserved word, strict mode's included, nor `eval`, `arguments` or `handle`, which every Stub imports, nor a name every object already has, `Object.prototype`'s `constructor`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `toString` and `valueOf`, or one JavaScript calls on its own, `then` and `toJSON`, since a client has a method per Endpoint and the Handler map a Handler per name, and a literal reserved name is _a type error_; a Message name is PascalCase words (`^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)*$`); in both, each capital starts a word of at least one lower-case letter or digit after it, so a name derives to readable file and code names: `UrlRefresh` and `getUrl`, not `URLRefresh` or `getURL`; a Rejection code is UPPER_SNAKE_CASE (`^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$`); a recursion id (`.meta({ id })`) is camelCase (`^[a-z][a-zA-Z0-9]*$`), since code names its def `<id>Def`; an object field takes no name every object already has either, `Object.prototype`'s own, and `generate` fails on one at any depth (see [Not allowed](#not-allowed)).

A Service, Application, Group, Endpoint, Guard, Subscription or Message name and a Rejection code have at most 64 characters, as a Broker prefix does, since it follows the Service name's grammar, so every Stream and Durable consumer name derived from them stays within the 255 characters NATS allows, and every file or folder cf-loom names after one of them within a file system's 255 bytes (see [Over the Broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) in the root ARCHITECTURE.md). A recursion id and a path param's name reach neither, and have no bound.

A Message Version is written `OrderCreated@2` in the Snapshot, the CLI and logs, `OrderCreated.v2` inside a subject, and in code as its name with the first letter lower-cased, then the word of its kind where a name must say it, then `V` and its version, which always comes last: `orderCreatedV2` with no word, as the examples export a Message Version and as a key of the Handler map and of `readers`, and `orderCreatedEventV2` as its Contract Package exports an Event's (a Command's Durable consumer is named in [The broker plan](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#the-broker-plan) in the messaging README).

A Contract Package exports each Element under a name that says its kind, so names of different kinds never meet, and a Consumer's own `getPayment` does not meet its Provider's `getPaymentEndpoint`: an Endpoint as `<name>Endpoint` (`getOrderEndpoint`), an Event's Message Version as above, and for each recursive def its Elements reach the types `<Id>Def` as declared and `<Id>DefReader` as read (`TreeDef`, `TreeDefReader`).

## Applications

An Application has the same layout as a Service (see [Layout](https://github.com/CasitaFeliz/cf-loom/blob/main/README.md#layout) in README.md) with only Dependencies:

```ts
// web-admin/src/contract/dependencies/payments-service.dependency.ts
import { getPaymentEndpoint } from '@org/contract-payments-service';

export const adminPaymentsDependency = defineDependency({ endpoints: [getPaymentEndpoint] });
```

```ts
// web-admin/src/contract/index.ts
export const application = defineApplication({
  name: 'web-admin',
  dependencies: [adminOrdersDependency, adminPaymentsDependency],
});
```

A Dependency of an Application on an Endpoint that is not Public is a type error that names the Endpoint, and `generate` fails on one the types did not catch.

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

Services import its Guards, Rejections and schemas by name; a Service names its Definitions object as `standardRejections` to take its Standard Rejections (see [The Root](#the-root)). Its Root file exports its Definitions object, which `init` exports as `definitions`, and exactly what it shares: each Guard, Rejection and zod schema, under the name Services import it by; those exports are what its Snapshot describes. Any other export fails `generate`, and so does a Guard or Rejection an exported Guard reaches without being exported, since Services import it to attach it or reject with it. Only the Root file's exports count: a declaration exported only from another entry of the package is none of its members. It is published built, as JavaScript with its `.d.ts`, from erasable TypeScript source, since Node strips no types under `node_modules`. It may declare any of the three Standard Rejections, each with a code, a status and a message and never a body; one it leaves out takes cf-loom's default (see [Rejections](#rejections)). A status the Rejection rules do not allow (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections) in COMPATIBILITY.md), or a body, is a type error.

Its package.json names the built Root file as the package's entry, and `publish` imports that entry as a Service that installed the package would, refusing to publish unless it has the committed Snapshot:

```json
{
  "name": "@org/definitions",
  "type": "module",
  "exports": { ".": { "types": "./dist/definitions/index.d.ts", "default": "./dist/definitions/index.js" } },
  "files": ["dist"],
  "peerDependencies": { "@cf-loom/contract": "…", "zod": "…" }
}
```

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

A Group lists at least one Endpoint, Event, Command or Subscription; one that lists nothing, or an empty list, is a type error, and `generate` fails on a Group that lists nothing. A Group's name is unique in the Contract; a duplicate fails `generate`. A Group lists its Contract's own declarations: a Provided Element, taken from a Contract Package, is a type error in a Group, and `generate` fails on one with a `provided-element` line at the Group, naming the Element and its Provider (see [Failures](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/README.md#failures) in the CLI README).

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

- `name` is required and unique among the Contract's Endpoints that are not Retired. It is the client's method, and its Contract Package exports the Endpoint as `<name>Endpoint` (see [The Root](#the-root)); the Endpoint itself is identified by its method and path, and the Snapshot and every Dependency record both.
- `method` is `GET`, `POST`, `PUT`, `PATCH`, `DELETE` or `OPTIONS`; never `HEAD` (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in ARCHITECTURE.md).
- `visibility` is required: `public`, `internal` or `private`. A Private Element is still described in the published `snapshot.json`, and a Private Endpoint's method and path may reach a Consumer's bundle in an exported Endpoint's `shadowing` (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md).
- `success` declares a `status`, 200, 201, 202, 203 or 204, a `body` and optionally `headers`, an object of the HTTP headers the Endpoint promises with its Success; nothing is implied. An Endpoint declares one Success, so a Caller never tells two cases apart by their status: what it tells apart is a part of the Success's shape, such as an Open Enum field (`effect: openEnum(['created', 'replaced'])`), to which values are added as Additive Changes, or a discriminated union of bodies, which is closed; the Compatibility Check judges how either changes (see [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions) in COMPATIBILITY.md). The status is how a Success travels, not what it says: a `PUT` that may create or replace is declared as a `POST`, or as two Endpoints, since RFC 9110 (section 9.3.4) requires 201 of a `PUT` that creates and 200 or 204 of one that replaces, which one Success cannot send. A 204 has no body (`success: { status: 204 }`), and its Handler returns `success()`. A body where none belongs, or a missing one elsewhere, is a type error. Headers follow the text rules of Input headers, and the object is always open (see [Headers, path and query](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#headers-path-and-query) in COMPATIBILITY.md).
- `input` may hold `params`, `query`, `headers` and `body`. `params` must declare exactly the `:names` in the path, and is absent when the path has none; a body on `GET` is not allowed. Both are type errors. The EndpointHandler receives only the Endpoint's own query params, not those its Guards demand. `generate` fails on an optional path param, on `nullable` anywhere in params, query or headers, and on an enum there whose values travel as one text (`1` and `'1'`).
- Header names, in `input.headers`, `success.headers`, a Rejection's `headers` and a Guard's `demands.headers`, are lower-case: headers are case-insensitive, so each has one spelling, and an upper-case letter is a type error. A name is also an RFC 9110 token (`^[!#$%&'*+\-.^_`|~0-9a-z]+$`) and none that another party owns in its direction; `generate` fails on either:
  - In a request, `input.headers` and a Guard's `demands.headers`, none of these:
    - the Fetch standard's [forbidden request-header names](https://fetch.spec.whatwg.org/#forbidden-request-header), which it keeps for the user agent: `accept-charset`, `accept-encoding`, `access-control-request-headers`, `access-control-request-method`, `connection`, `content-length`, `cookie`, `cookie2`, `date`, `dnt`, `expect`, `host`, `keep-alive`, `origin`, `referer`, `set-cookie`, `te`, `trailer`, `transfer-encoding`, `upgrade` and `via`, and any name starting with `proxy-` or `sec-`;
    - the body's `content-type`, `content-encoding` and `content-range`, and cf-loom's `deprecation`.
  - In a response, a Success's and a Rejection's `headers`, none of these:
    - the framing and connection headers the host owns: `content-length`, `transfer-encoding`, `connection`, `keep-alive`, `proxy-connection`, `upgrade`, `te`, `trailer` and `host`;
    - the body's `content-type`, `content-encoding` and `content-range`, and cf-loom's `deprecation`;
    - the Fetch standard's [forbidden response-header names](https://fetch.spec.whatwg.org/#forbidden-response-header-name), `set-cookie` and `set-cookie2`, which a browser never exposes to code.
  - The Fetch standard forbids `x-http-method`, `x-http-method-override` and `x-method-override` only when their value is a forbidden method, `CONNECT`, `TRACE` or `TRACK`, which no Endpoint declares, so `generate` leaves them alone, and a browser drops one that carries such a value.
  - A Guard that checks a header the user agent sets, such as `origin`, `sec-fetch-site` or an authentication `cookie`, reads it from `request.headers` (see [GuardHandler](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#guardhandler) in the handlers README). A browser sends its cookies through the client's `fetch` option (see [In a browser](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#in-a-browser-applications) in the client README). A Service sets a cookie by wrapping the handler `serve` returns (see [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README).
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

A Rejection may declare `headers`, as a Success does: an object of the HTTP headers it promises, which nothing implies, so RFC 9110's `WWW-Authenticate` of a 401 or `Retry-After` of a 429 is sent only where a Rejection declares it. They follow the text rules and the name rules of a Success's headers, and the object is always open (see [Headers, path and query](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#headers-path-and-query) in COMPATIBILITY.md). A Handler gives them with the body: `reject(unauthenticated, { headers: { 'www-authenticate': 'Bearer realm="orders"' } })` (see [EndpointHandler](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#endpointhandler) in the handlers README).

```ts
// src/contract/rejections/unauthenticated.rejection.ts
export const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'The API key is missing or unknown',
  headers: z.object({ 'www-authenticate': z.string() }),
});
```

A status the Rejection rules do not allow (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections) in COMPATIBILITY.md) is a type error.

The three Standard Rejections, invalid input, not found and not implemented, are referenced as `invalidInput`, `notFound` and `notImplemented`, exported by `@cf-loom/contract`. Their code, status and message come from the Definitions Package the Root names as `standardRejections` (see [The Root](#the-root)), or from cf-loom's defaults: `INVALID_INPUT` 400 "Invalid input", `NOT_FOUND` 404 "Not found", `NOT_IMPLEMENTED` 501 "Not implemented". None of the three declares headers, and the not-found and not-implemented Rejections have no body.

The body of the invalid-input Rejection is cf-loom's, whatever the Definitions Package declares, and its runtime produces it:

```ts
{ issues: [{ in: 'params' | 'query' | 'headers' | 'body', path: (string | number)[], code: string, message: string }] }
```

`code` is one of a set cf-loom owns, not zod's issue codes: `required`, `invalid_type`, `invalid_value`, `invalid_format`, `too_small`, `too_big`, `not_multiple`, `unrecognized_key` and `malformed` (an unparseable body, a wrong content type or a value nested too deeply to read). An issue is `required` when nothing is at its path: a key the value does not hold itself, a hole of a list, or `undefined`. `in` and `code` are Open Enums, which a Caller reads through its Provider's Contract Package with their Unknown case, so a part or a code a later cf-loom adds is an Additive Change. An issue never carries the received value.

Wherever cf-loom writes an issue on one line, in an error, a log or a Fake Provider's Mistake, it writes `<source>: <part>.<path> <code>: <message>`, the path joined by dots and left out when the issue is at the part itself: `orders: body.orderId invalid_format: Invalid UUID`.

## Guards

```ts
// src/contract/guards/api-key.guard.ts
export const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: {
    headers: z.object({ 'x-api-key': z.string().optional() }),
  },
  context: z.object({ callerId: z.string() }),
  rejections: [unauthenticated],
});
```

A Guard states what it demands from the request (`headers` or `query`; a body or path params are a type error), the Context it provides, and the Rejections it may answer, declared ones only: a Standard Rejection on a Guard is a type error. It holds no logic: its GuardHandler lives in each Service that attaches it. The example leaves the key optional on purpose: a request without a required demand is answered as invalid input, before any GuardHandler runs (see [GuardHandler](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#guardhandler) in the handlers README), while an optional one lets the GuardHandler answer `unauthenticated`. Its `name` keys its Context and must be unique among the Guards the Contract reaches, its own and its Definitions Packages'; a duplicate fails `generate`.

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
- An Endpoint's `guards` are its Attachments: a Guard without a `qualifier` is listed bare, one with a `qualifier` as `{ guard, qualifier }` with a value its schema accepts; the value, and each object in it, holds only the keys zod keeps when its schema parses it (in a union, the first option that parses the value decides). Every Guard a listed Guard names appears earlier, and a Guard appears once. Each of these is a type error where the types can state it, and `generate` fails on the rest, such as a list shorter than its `.min()` or a key the union option that parses the value drops. To require two permissions, the Qualifier is a list. A Qualifier zod cannot parse within the call stack is one its schema does not accept.
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

Any Element takes `lifecycle: 'deprecated'`. An Endpoint states with it the instant it is Deprecated as of, `deprecatedAt`, a UTC instant to the second (`2026-11-01T00:00:00Z`); the types require it exactly then, and it may lie in the future:

```ts
// src/contract/endpoints/orders/list-orders.endpoint.ts
export const listOrders = defineEndpoint({
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  lifecycle: 'deprecated',
  deprecatedAt: '2026-11-01T00:00:00Z',
  success: { status: 200, body: z.array(z.object({ orderId: z.uuid() })) },
});
```

A Message Version states no instant, since no header exists for it:

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

To retire it, mark it `lifecycle: 'retired'`, remove an Endpoint's `deprecatedAt`, delete the Handler of an Endpoint or a Command's Message Version, if it has one, run `generate` and publish; this needs the Element Deprecated in the Baseline and, for an Endpoint or an Event, a Breaking Change Approval (see [Retirement](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#retirement)). The Handler map leaves Retired Elements out: `generate` names the Handler of each Element you retire (`… which is Retired: delete it`) and regenerates the map once the file is gone, so a Handler never outlives the record of it. A live Endpoint that takes the name of a Retired one needs a Handler of its own: delete the old file before `generate`, or `serve` refuses it as written for the Retired Endpoint. Once a published Baseline records the Element as Retired, its declaration may be deleted too: `cf-loom publish` carries every Retired Element forward from the Baseline as a tombstone, so its identity is never reused (see [Lifecycle and tombstones](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#lifecycle-and-tombstones)).

At runtime:

- A Deprecated Endpoint still works, and every HTTP response carries `Deprecation: @<unix seconds>` (RFC 9745), the instant its declaration states as `deprecatedAt`, which `serve` reads from the declaration (see [Endpoints](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#endpoints) in SNAPSHOT.md); the client tells it once per method (see [Deprecation](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#deprecation) in the client README). A Deprecated Message Version carries no header: none exists for it. Its Contract Package marks a Deprecated Endpoint or Message Version `@deprecated` on its export, with its description, so a Consumer's editor flags each use.
- A Deprecated Event is still published until it is Retired, so Subscribers that have not moved on keep receiving it. A Deprecated Command is not sent, but its Message Handler keeps running to drain what is already queued.
- A Retired Endpoint that is still declared answers the `RETIRED` Fault; once deleted, its URLs route like any other request, and `NO_SUCH_ENDPOINT`, or `METHOD_NOT_ALLOWED` on a path another Endpoint declares, answers when nothing matches, never the not-found Rejection (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in ARCHITECTURE.md).
- A Retired Message cannot be published or sent (a type error), and its Handler is not consumed.

## Schemas

A Contract's schemas are zod 4 schemas, `zod/mini` ones too; the range of `zod` that works is the `peerDependencies` of `@cf-loom/contract`. A Contract describes shapes and declarative constraints, never behavior (see [Shapes, not behavior](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#shapes-not-behavior) in ARCHITECTURE.md), so `generate` accepts the constructs of the first table below and writes the node each becomes (the node format is in [Schemas](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#schemas) in SNAPSHOT.md). It fails on any other, the constructs [Not allowed](#not-allowed), with a line for each, naming the Endpoint or the Element it sits in and the field, as `<location>` does in the [Failures](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/README.md#failures) of the CLI README, and what lies inside one is still checked and reported; the types of a declaration refuse some of them earlier, as a type error ([Not allowed](#not-allowed) says which):

```
endpoints.GET /orders/{} (getOrder) success.body.placedAt not allowed: z.date() (use z.iso.datetime())
endpoints.GET /orders/{} (getOrder) success.body.note not allowed: .default()
```

### What a construct becomes

Path params, query params and headers are a Contract's text parts, the schemas that travel as text, a Success's and a Rejection's headers and a Guard's demands included (what they hold is in [Headers, path and query](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#headers-path-and-query) in COMPATIBILITY.md, and what `generate` refuses in them under `input` in [Groups](#groups)). The third column says where a construct may appear.

| Construct | Becomes | Where it may appear | The Check |
| --- | --- | --- | --- |
| `z.string()`, with `.min()`, `.max()`, `.length()`, `.regex()` or a format zod builds (`z.uuid()`, `z.email()`, `z.iso.datetime()`, …) | `string` | anywhere | [Constraints](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#constraints) |
| `z.number()` and `z.int()` (`int` is a safe integer, as [Schemas](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#schemas) in SNAPSHOT.md says), with `.min()`, `.max()`, `.gt()`, `.gte()`, `.lt()`, `.lte()` or `.multipleOf()` | `number` | anywhere | [Constraints](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#constraints) |
| `z.boolean()` | `boolean` | anywhere | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields) |
| `z.enum()`, `z.literal()`, a `z.union()` of literals and closed enums (one enum of all their values) | `enum`, closed | anywhere; in a text part, no two values with one text (`1` and `'1'`) | [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions) |
| `openEnum([…])` (see [Open Enums](#open-enums)) | `enum`, open | anywhere but under a plain union or an intersection that is not of open objects, and as a record's key | [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions) |
| `z.object()`, `.extend()`, an intersection of objects | `object` | anywhere but as a field of a text part | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields) |
| `z.record()` or `z.partialRecord()`, with a string key (a format included, as `z.uuid()`) | `record` | anywhere but a text part | [Records, arrays, tuples, intersections, recursion, opaque data](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#records-arrays-tuples-intersections-recursion-opaque-data) |
| `z.array()`, with `.min()`, `.max()` or `.length()` | `array` | anywhere; in a text part, only as a query param's list | [Records, arrays, tuples, intersections, recursion, opaque data](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#records-arrays-tuples-intersections-recursion-opaque-data) |
| `z.tuple()` | `tuple` | anywhere but a text part | [Records, arrays, tuples, intersections, recursion, opaque data](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#records-arrays-tuples-intersections-recursion-opaque-data) |
| `z.union()` | `union` | anywhere but a text part | A plain union: any change is Breaking, see [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions) |
| `z.discriminatedUnion()` | `tagged` | anywhere but a text part | [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions) |
| any other intersection | `allOf` | anywhere but a text part | [Records, arrays, tuples, intersections, recursion, opaque data](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#records-arrays-tuples-intersections-recursion-opaque-data) |
| `z.json()`: any JSON value | `json` | anywhere but a text part | Any change to or from it is Breaking, see [Records, arrays, tuples, intersections, recursion, opaque data](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#records-arrays-tuples-intersections-recursion-opaque-data) |
| `.nullable()` | `nullable` on the node | anywhere but a text part | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields) |
| `.optional()` or `.exactOptional()` (`.required()` makes the field required again) | `required: false` on the field | directly on an object's field; never a path param | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields) |
| `.describe()`, `.meta({ description, examples, id })` | `description`, `examples`, a recursion id | anywhere | [Neutral](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#neutral) |
| a schema that contains itself (see [Recursion](#recursion)) | `ref` to a `defs` entry | anywhere but a text part | [Records, arrays, tuples, intersections, recursion, opaque data](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#records-arrays-tuples-intersections-recursion-opaque-data) |

A schema a Definitions Package exports (see [Definitions Packages](#definitions-packages)) is written into the Snapshot of each Contract that uses it, with its `origin`, and the Compatibility Check judges it as a Message until an Element uses it (see Position in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md)). It follows the rows of this page, and what is Not allowed.

A string format is recognized as zod builds it from its options: the schema is compared with the one the author's own zod builds for that format and its options, so its pattern is zod's own. A check zod runs through a function is refused, whatever pattern sits beside it, since no reading of a function proves what it tests: `z.stringFormat()`, and the formats zod builds from a regex, `z.hex()`, `z.hostname()`, `z.currencyCode()` and `z.hash()`, whose regex `.regex()` takes instead (`z.string().regex(z.regexes.hex)`, `z.regexes.sha256_hex` for `z.hash('sha256')`), so the Snapshot holds the regex itself. The formats, and how their options are stored, are in [Schemas](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#schemas) in SNAPSHOT.md.

### Not allowed

Each of these fails `generate`. A refused check is named by every spelling that builds it (`.min(), .gte(), .nonnegative() or z.minimum()`), since zod keeps no record of which one was written.

A declaration's types refuse the rows TypeScript can state exactly from a schema's type, as a type error that reads as `generate`'s line, except for a bigint format the type cannot tell apart, which it names `z.bigint()`. Several refusals in one schema are joined by `; `, since a refusal may list spellings (`.refine(), z.custom() or z.instanceof()`). Where each rule is enforced is in [The Compatibility Check](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-compatibility-check) in COMPATIBILITY.md.

- The types refuse a zod type the table names by its own type (`.default()`, `.prefault()`, `.catch()`, `.readonly()`, `z.date()`, `z.bigint()`, `z.any()`, `z.unknown()`, `z.custom()`, `z.instanceof()`, `z.templateLiteral()` and the rest of those rows); `z.null()` outside `z.json()`; a transform, pipe or codec (`.transform()`, `.preprocess()`, `.pipe()`, `z.codec()`, `z.stringbool()`); coercion (`z.coerce.*`); `.optional()` or `.exactOptional()` anywhere but on an object's field, and `.nonoptional()` anywhere but on one; and a catchall of a type zod keeps, such as `.catchall(z.never())`, which the type words as `z.strictObject()`, and `.catchall(z.string())`; and an object field that is no zod 4 schema, such as a zod/v3 schema.
- `generate` alone judges the rest: a check such as `.refine()`, `.startsWith()` or a bound that admits no value, and a regex that is no plain RegExp; what zod's types do not carry, `z.looseObject()`, `.passthrough()` and `.catchall(z.unknown())`, whose type is that of any object typed `core.$ZodObject`, `z.strictObject()` and `.strict()`, whose type is `z.object()`'s, `z.looseRecord()` and `z.xor()`; the rules on values and places, such as `z.literal(null)` or a record's key; and anything nested deeper than ten schemas.

| Construct | Why | Use instead |
| --- | --- | --- |
| `.default()`, `.prefault()`, `.catch()` | A default is behavior | `.optional()` on a field; the Handler decides what a missing value means |
| `.transform()`, `.preprocess()`, `.pipe()`, `z.codec()`, `z.coerce.*`, `z.stringbool()`, `.readonly()`, the mutating checks `.trim()`, `.toLowerCase()`, `.toUpperCase()`, `.normalize()`, `.slugify()` and `.overwrite()`, `z.url({ normalize })` | They change the value instead of describing it | Do it in the Handler |
| `.refine()`, `.superRefine()`, `.check()`, `.with()` and any custom check, `z.custom()`, `z.instanceof()`, a conditional check (`when`), a format with a custom `pattern`, any `z.stringFormat()`, `z.hex()`, `z.hostname()`, `z.currencyCode()`, `z.hash()` (see the note under the first table) | A check beyond a declarative constraint cannot be written in the Snapshot or compared, and zod runs these through a function | A declarative constraint (`.min()`, `.regex()`, a format): `.regex(z.regexes.hex)` for `z.hex()`; a Rejection from the Handler for the rest |
| A regex that is no plain RegExp, given to `.regex()`, as a format's `pattern` or as `z.url()`'s `hostname` or `protocol`, zod's own in `z.regexes` included: a RegExp subclass, a RegExp of another realm, one with a property of its own besides a writable `lastIndex` (its own `test`, `exec`, `source` or `flags`), or a value that is no RegExp, such as another regex engine's object or a string (`not allowed: a regex that is no plain RegExp (use a RegExp literal or new RegExp(), with nothing set on it)`) | zod may test a value with the regex's own `test`, and the Snapshot holds only its source and flags as `RegExp.prototype` reads them, so it cannot write what such a regex tests | A RegExp literal or `new RegExp()`, with nothing set on it |
| `.startsWith()`, `.endsWith()`, `.includes()`, `.lowercase()`, `.uppercase()`, `z.templateLiteral()`, `z.int32()`, `z.uint32()`, `z.float32()`, `z.float64()`, `z.xor()`, and any other check or zod type the first table has no row for (zod may add one later: `generate` names a check it does not know by zod's kind, `a zod check "<kind>"`, a number or bigint format it does not know as `a zod check "<kind>" of format "<format>"`, a string format by `z.stringFormat("<format>")`, and a type by `a zod type "<type>"`) | The Snapshot has no node or constraint for it | `.regex()`, for a rule on text |
| `z.date()`, `z.bigint()`, `z.int64()`, `z.uint64()` and a bigint `z.literal()`, `z.symbol()`, `z.void()`, `z.never()`, `z.nan()`, `z.map()`, `z.set()`, `z.file()`, `z.promise()`, `z.function()`, `z.success()` | Bodies are JSON, and the Snapshot has no node for it | `z.iso.datetime()` for `z.date()` |
| `z.unknown()`, `z.any()` | They describe no shape | `z.record()` or `z.json()` |
| `z.strictObject()`, `.strict()`, `z.looseObject()`, `.passthrough()`, `.catchall()` | Objects are open: a reader ignores a field it does not know | `z.object()`, and `z.record()` for dynamic keys |
| `z.null()`, `z.undefined()`, `z.literal(null)`, `z.literal(undefined)` (`z.null()` inside `z.json()` is allowed) | No node stands for `null` or `undefined` alone | `.nullable()` |
| `.optional()` or `.exactOptional()` anywhere but directly on an object's field, `.nonoptional()` anywhere but on an object's field (as `.required()` puts it) | Only an object's field can be absent | |
| A declarative check on a schema that admits `null` or `undefined`: on `.nullable()`, directly or through `z.lazy()`, or on a field's `.optional()` (`z.number().nullable().check(z.gt(3))`, or `z.nullable(z.number()).check(z.gt(3))` in `zod/mini`) | A check belongs to the schema it constrains; whether zod also runs it on `null` or an absent field depends on each check, which the Snapshot cannot say | The check on the schema inside every `.nullable()` and `.optional()`: `z.number().gt(3).nullable()` |
| A `z.record()` with a key that is not a string, or a nullable one; `z.looseRecord()`; a `z.record()` or `z.partialRecord()` keyed by an enum or a literal, which is a strict object; a `z.record()` keyed by an `openEnum()` | A record's keys are strings | `z.object()` with the keys as fields; `z.record(z.string(), …)` |
| Numeric `z.enum()` values; a `z.enum()` or `z.literal()` without values (every value taken out with `.exclude()`); a `z.union()` or `z.discriminatedUnion()` without options | An enum holds at least one value, and `z.enum()` holds strings (`z.literal()` may hold a number or a boolean); a union holds at least one option | |
| In a `z.discriminatedUnion()`, a variant whose discriminator has several values or is not a literal, a variant that is not an object (an intersection, a union or a nullable object), a discriminated union as a variant of another, two variants with one discriminator value | A variant is found by the value of one literal field of an object | |
| An `openEnum()` that an intersection that is not of open objects reaches, or that a `z.union()` reaches, at any depth, through recursion included | A Reader cannot merge an Unknown case with the value it came from, and a union's Reader takes a value another option declares as its Unknown case | `.extend()`; `z.discriminatedUnion()`, or one `openEnum()` of all the values |
| An intersection of objects whose shared keys differ in shape or requiredness (descriptions, examples and origins aside) | The intersection is one object only when its items agree | `.extend()` |
| A number that is not finite (`NaN` or `Infinity`), a `multipleOf` of 0 or less, a length bound that is not a non-negative integer, bounds that admit no value (`.min(5).max(3)`, `.gt(5).lt(5)`), two checks that set one constraint (`.min(1).min(2)`, `.positive().nonnegative()`) | The Snapshot holds each constraint once, and a constraint that admits no value describes no shape | |
| A `.meta()` key other than `description`, `examples` and `id`; a `description` that is not a string; `examples` that are not a list of JSON values, or that include one its schema refuses or zod cannot parse within the call stack | The Snapshot holds a string `description`, `examples` its schema accepts, and a recursion id | |
| A schema nested deeper than 252 levels, its root the first (`not allowed: a schema nested deeper than the 252 levels a Snapshot holds`), or a Snapshot whose JSON, a Qualifier's value for one, nests deeper than 256 levels, the outermost object being the first (`not allowed: JSON nested deeper than the 256 levels a Snapshot holds`) | The decoder reads back only what a Snapshot holds, so whatever `generate` writes, and `publish` merges from it, must nest no deeper (see [Canonical form](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#canonical-form) in SNAPSHOT.md) | |
| A schema nested deeper than 256 schemas as written, its root the first, counting every schema zod enters on the way: an array's items, an object's field, a record's value, a tuple's item, a union's option, an intersection's item, each `.nullable()` and each `z.lazy()`; a schema with a recursion id starts a count of its own, as its def is a node of its own (`not allowed: a schema nested deeper than 256 schemas as written`) | zod parses an example, a Qualifier and every value a Provider reads with the schema as written, one call per schema, so a schema the Snapshot folds into a shallow node, such as thousands of `.nullable()`, would overflow the call stack; a def starts a count of its own, so a chain of defs, each on its own cycle, is bounded only by `generate`'s parse of its examples (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in ARCHITECTURE.md); without an example, a Provider answers every value of it `malformed`, however shallow | |
| A field named `__proto__`, or named as one of `Object.prototype`'s own names (`constructor`, `toString`, `valueOf` and the rest), at any depth | zod drops `__proto__` when it parses, and reads the others from the prototype when the field is absent | Another field name |
| A value that is no zod 4 schema inside one, such as a zod/v3 schema (`not allowed: a value that is no zod 4 schema (zod/v3 is not read)`) | cf-loom reads zod 4 schemas | The zod 4 schema |
| A recursion mistake | See [Recursion](#recursion) | |

### Recursion

A schema that contains itself, through a getter or `z.lazy()`, is named with `.meta({ id })`; the Snapshot writes it once under `defs` and every use as a `ref` (see [Recursion](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#recursion) in SNAPSHOT.md):

```ts
// src/contract/schemas/category.schema.ts
export const category = z
  .object({
    name: z.string(),
    get children() {
      return z.array(category);
    },
  })
  .meta({ id: 'category' });
```

An id is camelCase (`^[a-z][a-zA-Z0-9]*$`, see [The Root](#the-root)). It is read from the schema's own metadata, never looked up by name, and is unique in the Snapshot, so a Definitions Package's ids count too. `.meta({ id })` is the last call: zod keeps an id only on the schema it was given to, so `.describe()`, another `.meta()` or a check after it builds a schema without it. An id that fails on a schema of its cycle still names that cycle, so its own line is the only one; an id on a field's wrapper is not on the cycle, so that cycle also gets its own line. `generate` fails on:

- a cycle with no id on any schema of it, a cycle whose id a later call dropped included (its line names that id when it is a camelCase name), and a cycle through `z.lazy()`, unions, intersections, `.nullable()` and annotations alone, whatever the order of a union's options, since zod's parse never ends on a value no other option accepts (`const node = z.union([z.lazy(() => node), z.string()]).meta({ id: 'node' })`): a cycle passes through a node of another kind, such as an object;
- an id that is not camelCase, an id on a schema that lies on no cycle (not judged on a schema that holds one nested too deeply as written, whose cycle may close beyond it), and one id on two schemas;
- an id on a field's `.optional()` or `.nonoptional()`, or on a schema that admits `null`, directly, through `z.lazy()` or as an intersection of nullable objects: put it on the schema inside, and `.nullable()` on each use.

What is Not allowed inside a cycle is reported wherever the cycle is used.

## Open Enums

```ts
status: openEnum(['pending', 'paid']).describe('Where the order stands')
payment: z.object({
  type: openEnum(['card', 'transfer']),
  last4: z.string().optional(),
  iban: z.string().optional(),
})
```

Readers get a type with an Unknown case and must handle it: an unknown value arrives as `{ unknown: 'refunded' }`, so TypeScript can tell it from the declared ones. Writers may only use the declared values. `openEnum()` infers the writer type only; Reader types and schemas are generated from the Snapshot (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md). An Open Enum's Reader schema is `openEnumReader(['pending', 'paid'])`, which generated Readers call and a Contract never does: it reads a declared value as itself and any other string as its Unknown case, and writes that case back as its string, refusing one that holds a declared value, so whoever writes a value as a Reader reads it, as a Fake Provider does (see [Faking Providers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/testing/README.md#faking-providers) in the testing README), goes through the same schema.

A set of variants that grows is an object whose `type` is an Open Enum and whose variants' fields are optional, as `payment` above: a reader handles a `type` it does not know, and a new variant adds a value and its optional fields. A `z.discriminatedUnion()` is closed (see [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions) in COMPATIBILITY.md).

`openEnum()` takes string values. Inside an intersection or a plain union, use `.extend()` or a discriminated union (see [Not allowed](#not-allowed)). Openness belongs to the schema `openEnum()` returns, typed `OpenEnum<…>`, and to every schema zod derives from it: `.describe()`, `.meta()`, `zod/mini` metadata, `.exclude()` and `.extract()` keep it; a `z.enum()` stays closed. To take any schema, open or not, as a parameter, type it `z.ZodType`.

## Dependencies

Install the Provider's Contract Package:

```bash
npm install @org/contract-payments-service
```

Then write the Dependency in a file and list it in the Root's `dependencies` (see [The Root](#the-root)):

```ts
// src/contract/dependencies/payments-service.dependency.ts
import { getPaymentEndpoint } from '@org/contract-payments-service';

export const paymentsDependency = defineDependency({ endpoints: [getPaymentEndpoint] });
```

A Dependency lists the Endpoints its owner calls, one or more, all one Provider's, imported from the Provider's Contract Package by their exported names (`getPaymentEndpoint`, see [The Root](#the-root)), as `endpoints`, the list as written; its client has a method named after each Endpoint it lists (`client(paymentsDependency, …).getPayment`, see the [client README](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md)), and no more. A Contract Package's Elements are declarations marked as its Provider's (`Provided`), and each Endpoint carries its Provider's name and Standard Rejections, so the client narrows by those Standard Rejections, their codes kept as the Provider wrote them, and reads nodes in the exported Snapshot cut the Endpoint carries (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md). The Snapshot records the Provider's name, each Endpoint by its identity (see [Identities](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#identities) in SNAPSHOT.md), and as `against` the version in the package.json of the installed package that exports them. Endpoints of two Providers in one Dependency, or none, or a Private or own Endpoint, or one of the Service's own Contract Package (`A Provider is another Service: orders-service is this Service`, a type error on `defineService`), is a type error and fails `generate`; one listed twice fails `generate`; `defineDependency` never throws, so what the types refuse, written through a cast, is reported by `generate` at the Dependency's place, `(root) dependencies[0]`, naming the Provider. Several Dependencies may list one Provider's Endpoints, so an Application split into routes can give each its own and each bundle carries only what its route calls; the Snapshot records them together, each Endpoint once. A Dependency lists no Event: a Subscription to another Service's Event takes it from that Service's Contract Package with no Dependency (see [Subscriptions](#subscriptions)). Which Elements a Service or an Application may depend on is in [Dependencies](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#dependencies) in ARCHITECTURE.md.

## Subscriptions

To subscribe to another Service's Event, install its Contract Package, as for a Dependency (see [Dependencies](#dependencies)), and import the Event from it:

```ts
// src/contract/subscriptions/orders/notify-on-settled.subscription.ts
import { paymentSettledEventV1 } from '@org/contract-payments-service';

export const notifyOnSettled = defineSubscription({
  name: 'notifyOnSettled',
  description: 'Notifies the customer of each payment settled',
  event: paymentSettledEventV1,
});
```

`name` is unique in the Service and names the Subscription's Durable consumer from its name in kebab-case (`orders-service_notify-on-settled`). The Event is the Service's own, listed in one of its Groups, or one another Service's Contract Package exports, taken from it, never its own (`A Provider is another Service: …`, a type error on `defineService` as well as a failure of `generate`), and not Retired; another fails `generate`, and a Retired one is also a type error. The Snapshot records that Service among the Providers the Contract uses, against the version of the installed package that exports the Event, with no Endpoint when no Dependency lists one. A Command in `event` is a type error too, and fails `generate`: a Command's Message Version has its own Message Handler. Neither the Subscription's name nor its Event ever changes: to follow a new Message Version, add a new Subscription and remove the old one in a later Release (see [Subscriptions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#subscriptions)).

## Types

- `Visibility`, `Lifecycle`, `Method`, `SuccessStatus` and `RejectionStatus`: the values a declaration may take.
- `IssueCode`, the set of codes an issue of invalid Input says went wrong (see [Rejections](#rejections)); a Caller reads them through its Provider's Contract Package as an Open Enum, so a code a later cf-loom adds arrives as its Unknown case (see [What a call receives](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#what-a-call-receives) in the client README).
- `OpenEnum<T>`, the type `openEnum()` returns (see [Open Enums](#open-enums)).
- `Provided<Element, Name>`, a Provided Element (see [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md)): an Element as its Provider's Contract Package exports it, marked with its Provider's name; `ProvidedEndpoint<E, Name, Standards>`, an Endpoint so marked that also carries its Provider's Standard Rejections, which type what a Caller receives; `providedEndpoint`, which builds one from the Provider (`{ name, standardRejections }`), its declaration and its exported Snapshot cut, `unknown`, which the client and `@cf-loom/testing` read by the format it names (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md), `providedEvent`, which takes the Provider's name, and `providedRejection`, for generated code only: `cf-loom package` builds each Endpoint, Event and Rejection of a Contract Package with them, from its Snapshot, Reader schemas included, with none of the rules above, which `defineEndpoint`, `defineEvent` and `defineRejection` apply to what an author writes. A Contract never calls them.
- `Committed`, `'no' | 'yes' | 'unknown'`, whether a Fault's change was committed; `Issue`, one way a value broke its part of the Contract (see [Rejections](#rejections)); `ReservedCode`, a code cf-loom answers outside the Contract, as a Fault.
- `Http`, `(request: Request) => Promise<Response>`: an HTTP exchange, a Request answered with a Response, what `serve` returns and what a client's `fetch` is called as; `globalThis.fetch` is one.
- `StandardRejection`, the type of `invalidInput`, `notFound` and `notImplemented`; `StandardRejections`, their codes, statuses and messages resolved; `ProvidedStandardRejections`, those as each Endpoint of a Contract Package carries them for its Callers, the invalid-input one with the Reader schema of its body.
- `ServiceContract`, `ApplicationContract`, `Contract` (either of them), `Definitions`, `Group`, `Endpoint`, `Guard`, `Rejection`, `Event`, `Command`, `Subscription` and `Dependency`: what each declaration returns, typed by what was written; `Attachment`, a Guard as an Endpoint's `guards` lists it: the Guard bare, or a `QualifiedAttachment` `{ guard, qualifier }` for a Guard that declares a `qualifier`.
- `InputOf<typeof getOrder>`, the Input its EndpointHandler receives, one key per declared part; `SuccessOf<typeof getOrder>`, its Success's status, headers and body; `BodyOf<typeof orderCreatedV2>`, a Message Version's body as its `body` schema types it: what `publish` or `send` takes for the Service's own Event or Command, and for a Provided Event, whose body is a Reader schema, what a Subscriber reads; a Message Handler's body is `ReceivedBodyOf` (see [Types](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#types) in the handlers README); `ContextOf<typeof getOrder>`, its Context, one key per Guard that provides a Context, by name; `ProvidedContextOf<typeof apiKey>`, the Context one Guard provides (`undefined` without a `context`); `QualifierOf<typeof permission>`, the Qualifier its GuardHandler receives, typed by its `qualifier` schema (`undefined` without a `qualifier`); `RequiredContextOf<typeof permission>`, the Context a Guard's GuardHandler reads from the Guards it lists, keyed like `ContextOf`; `DemandsOf<typeof apiKey>`, what a Guard's GuardHandler receives first, one key per declared demand part (`{}` when it demands nothing); `RejectionsOf<typeof getOrder>`, every Rejection it may answer: its own, its Guards' and the two cf-loom's runtime adds, and `RejectionsOf<typeof apiKey>`, a Guard's own and the not-implemented Rejection its Stub answers.
