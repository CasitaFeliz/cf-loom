# @cf-loom/handlers

`handle`, `handle.stub`, `readersOf`, `success`, `reject`, `admit`, `fault`, `isRejectionOf`; `InvalidInputError` and `InvalidOutcomeError`, which a direct call throws; and their types (see [Types](#types)). A Message Handler is written with the same `handle`; how it runs is in [Message Handlers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#message-handlers) in the messaging README. Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

The examples follow the layout in [A first Service](https://github.com/CasitaFeliz/cf-loom/blob/main/README.md#a-first-service) and leave out imports of the Contract's declarations and sibling files.

## Stubs and the Handler map

`cf-loom generate` writes a Stub for every Handler that does not exist yet, never overwriting one, and regenerates the Handler map, which holds every Guard of the Contract, attached by a Retired Endpoint or not, and the readers, in the files the layout places them in (see [The layout field](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/README.md#the-layout-field) and [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md). A Stub is `export default handle.stub(getOrder)`, which marks the Handler as not implemented; implementing it means replacing that line with `handle(getOrder, async (…) => …)`. A Message Handler's Stub is `handle.stub(readers.commands.chargeCardV1)`, where `readers` is imported from the readers file and `readers.commands.chargeCardV1` is the pairing (see [Testing a Service's own code](#testing-a-services-own-code)). `serve` answers the not-implemented Rejection for an EndpointHandler Stub, and for every Endpoint attaching a GuardHandler Stub once that Guard's demands are valid, since the Stub never admits. `consume` does not pull from a Message Handler Stub and logs a warning; its Messages wait in its Durable consumer, which the broker plan still lists (see [The broker plan](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#the-broker-plan) in the messaging README), until a Release with the real Handler drains them, unless the Stream's retention limits, which are the organization's, drop them first. Either way a Contract can be merged and deployed with Stubs before it is implemented, and its Contract Package published; when it is published is the organization's (see [The Compatibility Check](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-compatibility-check) in COMPATIBILITY.md). The Handler map ends `satisfies HandlerMapOf<typeof contract>`, so a missing Handler, one written for another declaration, or a value `handle()` did not return is a type error: each Handler `handle()` returns carries a brand of its declaration, which no hand-made value has. A Handler written for another copy of the declaration, as when the Contract is loaded twice, type-checks when the copies' types agree; `serve` and `consume` refuse it at startup, naming the copy.

A Stub's path comes from names and the Service's `layout` (see [The layout field](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/README.md#the-layout-field)), which also gives each kind's default path. A Message Handler's Stub imports `readers` from the readers file and passes it the pairing under its name in code (`readers.commands.chargeCardV1`, `readers.subscriptions.notifyOnSettled`). An EndpointHandler's or GuardHandler's Stub imports its Endpoint or Guard under its `name`, whatever its export is called, aliased when the two differ (`import { fetchOrder as getOrder }`; see the [`@cf-loom/contract` README](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md)): a local one from the first file under `src/contract/` exporting it, files and then export names in code point order, with a relative import naming the `.ts` file; a Definitions Package's Guard from the first specifier, in code point order, the project's own files import it by (its own package's first, when the project imports it), under the first of that module's export names, in code point order, that holds it. `generate` and `verify` fail on an Endpoint, attached Guard, Command's Message Version or Subscription that nothing exports; the name grammar already refuses `handle`, which every Stub imports from `@cf-loom/handlers` (see [The Root](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#the-root) in the contract README). Which Handler files cf-loom claims is what its Handler map imports; see [The layout field](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/README.md#the-layout-field). `generate` and `verify` also fail on a Handler path that holds something other than a file, and `verify` on a Handler the map imports that is missing.

The Handler map's file, `handlers.generated.ts` by default, exports the Handler map, plain data with five keys, ending `satisfies HandlerMapOf<typeof contract>`, where the map imports the Root as `contract` from the name its Root file exports it by: `endpoints` by Endpoint name, `guards` by Guard name, `commands` by the Message Version's name in code (`chargeCardV1`), `subscriptions` by Subscription name (`notifyOnSettled`), `readers`, the readers file's table, which pairs each Command's Message Version and Subscription, under those same names, with the Reader its Handler reads. Handler types are nominal over the Endpoint, Guard, Command's Message Version or Subscription they were written for (`EndpointHandler<typeof getOrder>`), so the map type-checks by declaration, not by the shape it receives; `HandlerMap` is the shape every map has at runtime, knowing each Handler by the `declaration` it carries. A map written by hand is typed `HandlerMapOf<typeof contract, Resources>`, with the Service's Resources, `NoResources` when it has none; `HandlerMapOf<typeof contract>` alone is the shape every map of the Contract has, which a map ends `satisfies` and no value is typed with (see [Resources](#resources)).

## EndpointHandler

```ts
// src/endpoints/orders/get-order.handler.ts
import { handle, reject, success } from '@cf-loom/handlers';
import type { Needs } from '../../resources.ts';

export default handle(getOrder, async ({ params }, { context }, { resources: { orders } }: Needs<'orders'>) => {
  const order = await orders.find(params.orderId, context.apiKey.callerId);
  if (!order) return reject(notFound);
  if (order.locked) return reject(orderLocked, { lockedAt: order.lockedAt });
  return success({ id: order.id, status: order.status, total: order.total });
});
```

- The Handler receives the validated Input, parsed with its schemas: unknown keys are stripped, so it sees only the fields the Endpoint declares; then `{ context, request }`, the Context, one key per Guard that provides a Context, and the request's `signal` and `headers` as received, which are no Input: for cancelling work when the Caller goes away and for tracing; then `{ resources }`, the Resources it takes (see [Resources](#resources)).
- Only the Endpoint's Rejections type-check in `reject`, each with its declared body, or `{ headers, body }` when it declares headers, as `success` takes them: `reject(unauthenticated, { headers: { 'www-authenticate': 'Bearer realm="orders"' } })`, `reject(rateLimited, { headers: { 'retry-after': 30 }, body: { limit: 100 } })`. What a Handler builds carries a Rejection as its declaration, `rejection`, and its `headers` and `body`, not as a resolved code, status or message: `serve` resolves them against the Root (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#rejections) in the contract README); a direct call returns them as built (see [Testing a Service's own code](#testing-a-services-own-code)). The `Outcome` type of `@cf-loom/handlers` is not the client's (see [Consuming a Contract](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#consuming-a-contract) in the client README).
- When the Endpoint declares `success.headers`, the Handler returns them with the Success, `success({ headers, body })` (`success({ headers })` for 204); otherwise `success(body)`.
- Anything thrown, or returned that is no Outcome, becomes a Fault with `committed: 'unknown'` and `retryable: false`, since nothing says the same request could succeed later, and the fixed message `Internal error`; the error itself reaches only `onServiceFault`, as `cause` (see [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README). A Handler that knows better returns `fault({ committed: 'no', retryable: true })`, just as it returns `success` and `reject`; its `message` is `Internal error` unless it gives one, and a `cause` it gives is the Handler's own: it never travels, and reaches only `serve`'s `onServiceFault`, which receives every Fault the Handler returned. A retryable Fault may say when to retry, `fault({ committed: 'no', retryable: true, retryAfter: 30 })`, in whole seconds from 0, which `serve` sends as `Retry-After`; `fault()` throws on any other `retryAfter`; a Fault that is not retryable takes none: the type refuses it, and one built past the types with a `retryAfter`, or with any other `retryAfter`, is `INVALID_OUTCOME`. Message Handlers differ: there a throw has the Message delivered again (see [Message Handlers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#message-handlers) in the messaging README).

## GuardHandler

```ts
// src/guards/api-key.handler.ts
export default handle(apiKey, async ({ headers }, _call, { resources: { callers } }: Needs<'callers'>) => {
  const caller = await callers.byKey(headers['x-api-key']);
  if (!caller) return reject(unauthenticated);
  return admit({ callerId: caller.id });
});
```

The Guard declares the key optional (see [Guards](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#guards) in the contract README), so a request without it reaches this Handler, which rejects it as `unauthenticated`.

A Guard that lists other Guards, or declares a `qualifier` (see [Guards](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#guards) in the contract README), receives their Context and its Qualifier too:

```ts
// src/guards/permission.handler.ts
export default handle(permission, async (_demands, { context: { userToken }, qualifier }, { resources: { permissions } }: Needs<'permissions'>) => {
  const held = await permissions.of(userToken.userId);
  const granted = qualifier.every((code) => held.includes(code));
  return granted ? admit() : reject(forbidden);
});
```

A GuardHandler receives what its Guard demands, parsed with its schemas, unknown keys stripped, so it sees only the fields the Guard demands (`{}` when it demands nothing); the Context of the Guards it lists and no other, one key per Guard that provides a Context (`{}` when none does), its Qualifier, when the Guard declares one, typed by that schema, and the request, as `{ context, qualifier, request }`; then `{ resources }`, the Resources it takes. Every attached Guard, declared locally or imported from a Definitions Package, gets its Handler, where [Stubs and the Handler map](#stubs-and-the-handler-map) says. A GuardHandler runs once its Guard's demands are valid, in the order a request is read (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md), with the Context of the Guards it lists and the Endpoint's Qualifier for it. The first Admission that is not the request admitted stops it, so an unauthenticated Caller learns nothing about the Endpoint's Input, and the EndpointHandler only runs with valid Input.

A Guard never demands a header the user agent sets itself (see [Groups](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#groups) in the contract README). A GuardHandler that checks one, such as `origin` against a cross-site request or an authentication `cookie`, reads it from `request.headers` (`request.headers.get('origin')`).

## Resources

A Handler reaches what lies outside the Contract, its database, the clients of the Providers it calls, its EventPublisher and CommandSender, through Resources: one object the Service builds in `src/main.ts` and hands `serve` and `consume`, which give it, unchanged, to every Handler they run, as `resources` in its last argument, every Handler alike. It is required when a Handler takes any; cf-loom never reads, copies or checks it, and what it holds and how it is built are the Service's.

The Service declares one type for all of it, and each Handler picks the keys it takes:

```ts
// src/resources.ts
import type { WithResources } from '@cf-loom/handlers';

export type Resources = {
  readonly orders: Orders;
  readonly callers: Callers;
  readonly permissions: Permissions;
  readonly payments: Client<typeof paymentsDependency>;
  readonly publisher: EventPublisher<typeof contract>;
  readonly sender: CommandSender<typeof contract>;
};
export type Needs<Key extends keyof Resources> = WithResources<Pick<Resources, Key>>;
```

```ts
// src/main.ts
const running = await messaging(contract, broker);
const resources: Resources = {
  orders: await mongoOrders(),
  callers: await mongoCallers(),
  permissions: await mongoPermissions(),
  payments: client(paymentsDependency, { baseUrl }),
  publisher: running.publisher,
  sender: running.sender,
};
const http = serve(contract, handlers, { resources });
await running.consume(handlers, { resources });
```

- A Handler takes the Resources its implementation's last parameter requires, `Needs<'orders'>`, every Handler alike, and receives the whole object; one that leaves that parameter out takes none, and so does a Stub; one that leaves it unannotated takes none too, and reads it as `ResourcesNotAnnotated`, whose name the type error shows when it reads a Resource. `ResourcesOf<typeof handlers>` gives the Resources a map's Handlers take together: `serve` requires those of its EndpointHandlers and GuardHandlers, and `consume` those of its Message Handlers, so a Resource `main.ts` forgets is a type error there, and a test that replaces a Handler by spreading the map needs only what the Handlers left take. `serve` and `consume` always take their options, `{}` when no Handler takes any Resources and nothing operational is set; `resources` in them is required exactly when some Handler takes any. Each Handler carries what it takes in its brand, so `HandlerMapOf<typeof contract, Resources>` types a map, or a helper's parameter, with the Service's Resources, and refuses a Handler that takes one the Service lacks; `NoResources` is the Resources of a Service with none, `HandlerMapOf<typeof contract, NoResources>`, which refuses a Handler that takes some. A Handler whose Resources are unspecified is refused by name by `ResourcesOf`, and so by `serve` and `consume`, and by a map annotated with the Resources: one typed by its brand alone, `HandledBy<typeof getOrder>`, or in a map annotated `HandlerMapOf<typeof contract>` without the Resources. One whose Resources are unreadable, typed `any` or with an implementation that types them `any`, `WithResources<any>`, is refused by name in a map the types infer; a map annotated with the Resources accepts it, as TypeScript accepts any `any`. A last parameter whose Resources hold no key, `WithResources<{}>`, is refused by name too.
- `ResourcesOf` is an intersection of what each Handler takes: two Handlers that type the same key differently make `main.ts` unsatisfiable, and picking from one type for the Service rules that out. That type is the Service's code; cf-loom adds no API for it.
- They are handed once, at startup. What belongs to one request comes from its Input, Context and request, and a Guard hands an EndpointHandler shapes through Context, never objects. A Handler builds anything per request from its Resources, such as a transaction from a pool.
- The startup checks of `serve` and `consume` do not look at them; their type is the check.
- A direct call takes them in its last argument, `{ resources }`, so a test hands each Handler what it takes, a fake or an in-memory repository, with nothing to reset between tests (see [Testing a Service's own code](#testing-a-services-own-code)).

## Testing a Service's own code

A Handler returned by `handle()` is a function, and its `declaration` is the Endpoint, Guard, Command's Message Version or Subscription it was written for. Calling it runs the same checks `serve` and `consume` run: Input that breaks the Contract throws an `InvalidInputError`, and an Outcome that breaks a constraint, a Success or Rejection header that cannot travel as HTTP field text, or a Fault whose `retryAfter` cannot travel as `Retry-After`, an `InvalidOutcomeError`, so a unit test catches what production would answer as the invalid-input Rejection or as `INVALID_OUTCOME`. Both carry `issues`, one `Issue` per failure: its `part`, the slot as the Snapshot names it, such as `input.params`, `demands.headers`, `context`, `qualifier`, `success.body`, `headers` or `body` (a Rejection's), or `rejections` for a Rejection the Endpoint or Guard does not answer, or `fault` for a Fault whose `retryAfter` cannot travel as `Retry-After`, the `path` inside it, cf-loom's `code` (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#rejections) in the contract README) and a `message`, never the received value; a value where the part declares none is `invalid_type` with the message `Expected no value`. The error's message is one line per Issue (a Context or Qualifier that breaks the Contract is, in production, the runtime's own Fault). Otherwise:

- An EndpointHandler or GuardHandler returns what `serve` would answer: anything it throws, or returns that is no Outcome, becomes that Fault, carrying the original error, or a `TypeError` naming what came back, as `cause`. A throw while checking what it is given, such as a getter in its Input that throws, is the same Fault with `committed: 'no'`, since the implementation never ran.
- A direct call returns what `serve` would answer, before `serve` resolves a Rejection: a Success as `{ kind: 'success', status, headers, body }`, with only the parts the Endpoint declares and their values parsed as written, unknown keys stripped, since every object in a Read shape is open; a Rejection as the Handler built it (see [EndpointHandler](#endpointhandler)), its declaration and only the headers and body it declares, parsed as a Success's are, never a code, since the code a Rejection travels with is the Root's (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#rejections) in the contract README); a Fault as built. A test tells a Rejection by its declaration, `isRejectionOf(outcome, notFound)`, which narrows the Outcome to that Rejection with its headers and body typed.
- A direct call takes what the Handler is given beside its Input or demands in its second argument, `{ context, request }`, and a GuardHandler's `{ context, qualifier, request }`, its Qualifier when its Guard declares one: `request` may be left out, or either of its fields, a signal never aborted and empty headers taking their place, and `context` may be left out exactly when no Guard gives the Handler a Context, as `{ resources }`, its last argument, is required exactly when the Handler takes some. A GuardHandler's direct call returns `{ kind: 'admitted', context }` when it admits the request.
- A Message Handler answers nothing when it returns nothing, returns a Fault it returns unchanged and rethrows what it throws, since `consume` answers no Caller; returning anything else throws a `TypeError` naming what came back.
- A fake Provider's mistake thrown into an EndpointHandler, such as a call the test never scripted, is answered as a Fault like any throw; the fake's `verify()` reports it (see [Faking Providers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/testing/README.md#faking-providers) in the testing README).
- An Endpoint or Guard Stub checks what it is given first, like any Handler, then returns the not-implemented Rejection, so a direct call's Outcome type includes it; a Message Handler Stub checks its body too, then throws, since `consume` never runs it.
- A GuardHandler validates what its Guard demands, the Context it is given against the `context` schemas of the Guards it lists and its Qualifier against its `qualifier` schema, or refuses one when the Guard declares none (`permissionHandler({}, { context: { userToken: { userId: 'u-1' } }, qualifier: ['orders:edit'] }, { resources })`), and checks an `admit()` against the Guard's `context` schema; `serve` answers an invalid `admit()` with `INVALID_OUTCOME`.
- The Context passed to an EndpointHandler is checked against each attached Guard's `context` schema, read only from a key the Context holds itself, never one it inherits, and a key no attached Guard provides is an `unrecognized_key`.
- A Message Handler is written for the pairing of its Command's Message Version or Subscription with its Reader schema, as the readers file's `readers` holds it (`readers.commands.chargeCardV1`, `readers.subscriptions.notifyOnSettled`), never for the bare declaration: passing that to `handle` is a type error naming the readers file. `consume` reads with the Reader the Handler map's `readers` pair, and refuses a Handler written for any other pairing (see [Message Handlers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#message-handlers) in the messaging README). It takes its body as a Subscriber reads it, with Unknown cases written `{ unknown: … }`, typed `ReceivedBodyOf<typeof readers.subscriptions.notifyOnSettled>`: a direct call writes it back through that Reader, as a fake writes a scripted value, so a body that breaks it throws `InvalidInputError` at `body`, then reads it as `consume` does; what the in-memory `deliver` takes for a body is in [In memory](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#in-memory) in the messaging README. In a direct call its meta (see [Message Handlers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#message-handlers) in the messaging README) may be left out, whole or in part: the Fact id is random, the Broker message id is derived from it as a published Message's is, `deliveryCount` is 1, `lastAttempt` `false`, `headers` `{}` and `signal` a signal never aborted; its last argument is `{ resources }`.

```ts
import getOrderHandler from '../src/endpoints/orders/get-order.handler.ts';

const outcome = await getOrderHandler(
  { params: { orderId: ORDER_ID } },
  { context: { apiKey: { callerId: 'c-1' } } },   // one key per Guard that provides a Context; request left out
  { resources: { orders } },                     // the Resources it takes, here an in-memory repository
);
```

```ts
import notifyOnSettledHandler from '../src/subscriptions/orders/notify-on-settled.handler.ts';

const answer = await notifyOnSettledHandler(
  { paymentId: 'pay-1', method: { unknown: 'wallet' } },   // written as a Subscriber reads it
  {},                                                       // meta defaulted, as deliver defaults it
  { resources: { notifications } },
);
```

The Handler map is plain data (see [Stubs and the Handler map](#stubs-and-the-handler-map)), so a test replaces one Handler, a Guard's for example, by spreading the map:

```ts
const http = serve(
  contract,
  { ...handlers, guards: { ...handlers.guards, apiKey: handle(apiKey, async () => admit({ callerId: 'c-1' })) } },
  { resources },
);
const res = await http(new Request(`http://test/orders/${ORDER_ID}`, {
  headers: { 'x-api-key': 'any' },          // the replaced GuardHandler admits any key
}));
```

Which test runner, mocking library, fixtures or end-to-end tools a Service uses is the organization's choice; an HTTP test through a host adapter uses that host's own tools, such as supertest.

## Types

- `Outcome<typeof getOrder>`, what an EndpointHandler builds: `success(…)`, one of the Endpoint's Rejections with its headers and body (its own, its Guards', not found when listed and not implemented; never invalid input, which the runtime answers), or a Fault; `CheckedOutcome<typeof getOrder>`, what its direct call returns, the Success with its status, a Rejection as built with its headers and body parsed, or a Fault.
- `Admission<typeof apiKey>`, what a GuardHandler builds: `admit(…)` with the Context its Guard provides, one of the Guard's Rejections, or a Fault; `CheckedAdmission<typeof apiKey>`, what its direct call returns, a Rejection as built.
- `isRejectionOf(outcome, rejection)`, whether a direct call's answer is that Rejection, a Standard one included, narrowing it with its headers and body typed and its `rejection` to that declaration.
- `Fault`, `{ kind: 'fault', committed, retryable, message, cause?, retryAfter? }`, `retryAfter` only when `retryable` is `true`, and `Committed`, `'no'`, `'yes'` or `'unknown'`; `MessageFault`, the Fault a Message Handler returns, a `Fault` with no `retryAfter`.
- `EndpointHandler<typeof getOrder, Resources>` and `GuardHandler<typeof apiKey, Resources>`, what `handle()` and `handle.stub()` return, nominal over the Endpoint or Guard they were written for and typed by the Resources they take; `EndpointImplementation`, `GuardImplementation` and `MessageImplementation`, the function `handle()` wraps, typed by its last parameter, `EndpointImplementation<typeof getOrder, Needs<'orders'>>`, from which `handle()` reads the Resources the Handler takes.
- `MessageHandler<typeof readers.commands.chargeCardV1, Resources>` and `MessageHandler<typeof readers.subscriptions.notifyOnSettled, Resources>`, the Message Handlers, written for a Command's Message Version or a Subscription and typed by the Resources they take, each written for its pairing in the readers file's `readers` (`readers.commands.chargeCardV1` and `readers.subscriptions.notifyOnSettled`) and nominal over the Command's Message Version or Subscription it was written for, so a Command's is no Subscription's and no other Command's; their direct call answers a Fault or nothing (see [Message Handlers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#message-handlers) in the messaging README).
- `WithResources<R>`, `{ resources }`, what every Handler takes last, to its implementation and its direct call; `ResourcesNotAnnotated`, the Resources of an implementation whose last parameter is not annotated, which takes none; `NoResources`, the Resources of a Service none of whose Handlers take any, `HandlerMapOf<typeof contract, NoResources>` (see [Resources](#resources)).
- `EndpointCall<typeof getOrder>`, `{ context, request }`, and `GuardCall<typeof apiKey>`, `{ context, qualifier, request }`, `qualifier` only when the Guard declares one: what an EndpointHandler and a GuardHandler are given second; `HandledRequest`, `{ signal, headers }`, the request's abort signal and its headers as received.
- `ResourcesOf<typeof handlers>`, the Resources the Handlers of a map take together, which `serve` and `consume` require (see [Resources](#resources)).
- `readersOf`, which the readers file calls to build its `readers` table, and `Readers`, that table's type, keyed as the Handler map keys its Handlers; `Pairing`, one Command's Message Version or Subscription with its Reader, which `handle` takes (see [Testing a Service's own code](#testing-a-services-own-code)); `ReceivedBodyOf<typeof readers.subscriptions.notifyOnSettled>`, the body a Message Handler receives, as its pairing's Reader reads it, Unknown cases included: the type a helper it calls takes, never the declaration's `body`, which on the Service's own Event or Command is the writer's (`BodyOf` in the contract README); `MessageMeta`, `{ messageId, factId, deliveryCount, lastAttempt, headers, signal }`, the meta a Message Handler receives; `DirectMeta`, `Partial<MessageMeta>`, the meta a direct call of a Message Handler takes, each part left out defaulted.
- `HandlerMapOf<typeof contract, Resources>`, the Handler map a Contract needs, with the Service's Resources, which `serve` and `consume` take: a Handler for each Endpoint not Retired, each Guard those attach, optional for a Guard only Retired Endpoints attach, each Command's Message Version not Retired and each Subscription, with `readers`, each Handler taking some of `Resources` (see [Resources](#resources)); `HandlerMapOf<typeof contract>` alone, the shape every such map has, which `generate` writes as `satisfies HandlerMapOf<typeof contract>`, never the type of a value; `HandledBy<typeof getOrder, Resources>`, the brand that only a Handler `handle()` returned for that declaration carries, with the Resources it takes, and `HandledBy<typeof getOrder>` alone, its shape, never the type of a Handler.
- `HandlerMap`, the shape every Handler map has at runtime, which `serve` and `consume` check at startup: `endpoints` and `guards`, each Handler known by the `declaration` it was written for, `commands` and `subscriptions`, and `readers` (see [Stubs and the Handler map](#stubs-and-the-handler-map)).
- `Issue`, `InvalidInputError` and `InvalidOutcomeError`: what a direct call throws (see [Testing a Service's own code](#testing-a-services-own-code)).
