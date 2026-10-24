# @cf-loom/handlers

`handle`, `handle.stub`, `withReader`, `success`, `reject`, `admit`, `fault`, `isRejectionOf`; the `Outcome`, `Admission` and Handler types (`EndpointHandler`, `GuardHandler`, `CommandHandler`, `EventHandler`), `WithReader`, `CommandImplementation`, `EventImplementation` and `MessageMeta`; `WithResources` and `ResourcesOf`; `DirectCall`, `GuardCall` and `MessageCall`, the last argument of a direct call; `InvalidInputError` and `InvalidOutcomeError`, which a direct call throws; the `HandlerMap` type. A Message Handler is written with the same `handle`; how it runs is in [Message Handlers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#message-handlers) in the messaging README. Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

The examples follow the layout in [A first Service](https://github.com/CasitaFeliz/cf-loom/blob/main/README.md#a-first-service) and leave out imports of the Contract's declarations and sibling files.

## Stubs and the Handler map

`cf-loom generate` writes a stub for every Handler that does not exist yet, never overwriting one, and regenerates the Handler map and the readers, by default `src/handlers.generated.ts` and `src/readers.generated.ts` (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md). A stub is `export default handle.stub(getOrder)`, which marks the Handler as not implemented; implementing it means replacing that line with `handle(getOrder, async (…) => …)`. A Message Handler's stub is `handle.stub(chargeCardV1)`, where `chargeCardV1` is the pairing (see [Testing a Service's own code](#testing-a-services-own-code)). `serve` answers the not-implemented Rejection for an EndpointHandler stub, and for every Endpoint attaching a GuardHandler stub once that Guard's demands are valid, since the stub never admits. `consume` does not pull from a Message Handler stub and logs a warning; its Messages wait in its durable consumer, which the broker plan still lists (see [The broker plan](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#the-broker-plan) in the messaging README), until a Release with the real Handler drains them, unless the stream's retention limits, which are the organization's, drop them first. Either way a Contract can be merged and deployed with stubs before it is implemented, and its Contract Package published; when it is published is the organization's (see [The Compatibility Check](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-compatibility-check) in COMPATIBILITY.md). A missing Handler is a type error.

A stub's path comes from names alone, and from the Service's layout (see [The layout field](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/README.md#the-layout-field)); by default an EndpointHandler's is `src/endpoints/<group>/<endpoint-name>.handler.ts`, a GuardHandler's `src/guards/<guard-name>.handler.ts`, a CommandHandler's `src/commands/<command-name>.v<n>.handler.ts`, an EventHandler's `src/subscriptions/<subscription-name>.handler.ts`, each name in kebab-case. A Message Handler's stub imports its pairing from the readers file under its name in code (`chargeCardV1`, `notifyOnSettled`), so its Command or Subscription needs no export of its own. An EndpointHandler's or GuardHandler's stub imports its Endpoint or Guard under its `name`, the name the declaration is exported under (see the [`@cf-loom/contract` README](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md)): a local one from the first file under `src/contract/` exporting it under that name, files in code point order, with a relative import naming the `.ts` file; a Definitions Package's Guard from the package's name, never from a file that re-exports it. `generate` fails on an Endpoint or attached Guard exported under no such name; the name grammar already refuses `handle`, which every stub imports from `@cf-loom/handlers` (see [The root](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#the-root) in the contract README). A `*.handler.ts` under `src/`, outside `src/contract/`, that no declared Endpoint, Guard, Command's Message Version or Subscription names, a Retired Endpoint or Command's Message Version still declared counting as naming its Handler, fails `generate` and `verify`: after a Group is renamed or a Handler moved, the map would import a fresh stub and the Endpoint would answer the not-implemented Rejection. Both also fail on a Handler path that holds something other than a file, and `verify` on a Handler the map imports that is missing.

The Handler map's file, `handlers.generated.ts` by default, exports the Handler map, plain data with five keys: `endpoints` by Endpoint name, `guards` by Guard name, `commands` by the Message Version's name in code (`chargeCardV1`), `subscriptions` by Subscription name, a quoted key (`'notify-on-settled'`), and `deprecatedAt`, the `deprecatedAt` of each Deprecated Endpoint, by Endpoint name, from the Snapshot (see [Endpoints](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#endpoints) in SNAPSHOT.md), which `serve` sends in the `Deprecation` header and `verify` checks with the rest of the map. Handler types are nominal over the Endpoint, Guard, Command's Message Version or Subscription they were written for (`EndpointHandler<typeof getOrder>`), so the map type-checks by declaration, not by the shape it receives; `HandlerMap` is the shape every map has, knowing each Handler by the `element` it carries.

## EndpointHandler

```ts
// src/endpoints/orders/get-order.handler.ts
import { handle, reject, success } from '@cf-loom/handlers';
import type { Needs } from '../../resources.ts';

export default handle(getOrder, async ({ params }, context, { resources: { orders } }: Needs<'orders'>) => {
  const order = await orders.find(params.orderId, context.apiKey.callerId);
  if (!order) return reject(notFound);
  if (order.locked) return reject(orderLocked, { lockedAt: order.lockedAt });
  return success({ id: order.id, status: order.status, total: order.total });
});
```

- The Handler receives the validated Input, parsed with its schemas: unknown keys are stripped, so it sees only the fields the Endpoint declares; then the Context, one key per Guard that provides a Context; then `{ resources }`, the Resources it takes (see [Resources](#resources)).
- Only the Endpoint's Rejections type-check in `reject`, each with its declared body. What a Handler builds carries a Rejection as its declaration, `rejection`, and its `body`, not as a resolved code, status or message: `serve` resolves them against the root (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#rejections) in the contract README). The `Outcome` type of `@cf-loom/handlers` is not the client's (see [Consuming a Contract](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#consuming-a-contract) in the client README); a direct call returns them resolved too (see [Testing a Service's own code](#testing-a-services-own-code)).
- When the Endpoint declares `success.headers`, the Handler returns them with the Success, `success({ headers, body })` (`success({ headers })` for 204 or a `HEAD` Endpoint); otherwise `success(body)`.
- Anything thrown, or returned that is no Outcome, becomes a Fault with `committed: 'unknown'` and `retryable: false`, since nothing says the same request could succeed later, and the fixed message `Internal error`; the error itself reaches only `onServiceFault`, as `cause` (see [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README). A Handler that knows better returns `fault({ committed: 'no', retryable: true })`, just as it returns `success` and `reject`; its `message` is `Internal error` unless it gives one, and a `cause` it gives is the Handler's own: it never travels, and reaches only `serve`'s `onServiceFault`, which receives every Fault the Handler returned. Message Handlers differ: there a throw has the Message delivered again (see [Message Handlers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#message-handlers) in the messaging README).

## GuardHandler

```ts
// src/guards/api-key.handler.ts
export default handle(apiKey, async ({ headers }, _context, { resources: { callers } }: GuardCall<typeof apiKey, Pick<Resources, 'callers'>>) => {
  const caller = await callers.byKey(headers['x-api-key']);
  if (!caller) return reject(unauthenticated);
  return admit({ callerId: caller.id });
});
```

A Guard that lists other Guards, or declares a `qualifier` (see [Guards](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#guards) in the contract README), receives their Context and its Qualifier too:

```ts
// src/guards/permission.handler.ts
export default handle(permission, async (_demands, { userToken }, { qualifier, resources: { permissions } }: GuardCall<typeof permission, Pick<Resources, 'permissions'>>) => {
  const held = await permissions.of(userToken.userId);
  const granted = qualifier.every((code) => held.includes(code));
  return granted ? admit() : reject(forbidden);
});
```

A GuardHandler receives what its Guard demands, parsed with its schemas, unknown keys stripped, so it sees only the fields the Guard demands (`{}` when it demands nothing); the Context of the Guards it lists and no other, one key per Guard that provides a Context (`{}` when none does); and `{ qualifier, resources }`: its Qualifier, when the Guard declares one, typed by that schema, and the Resources it takes. Every attached Guard, declared locally or imported from a Definitions Package, gets its Handler, where [Stubs and the Handler map](#stubs-and-the-handler-map) says. A GuardHandler runs once its Guard's demands are valid, in the order a request is read (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md), with the Context of the Guards it lists and the Endpoint's Qualifier for it. The first Admission that is not the request admitted stops it, so an unauthenticated Caller learns nothing about the Endpoint's Input, and the EndpointHandler only runs with valid Input.

## Resources

A Handler reaches what lies outside the Contract, its database, the clients of the Providers it calls, its EventPublisher and CommandSender, through Resources: one object the Service builds in `src/main.ts` and hands `serve` and `consume`, which give it, unchanged, to every Handler they run, as `resources` in its last argument. It is required when a Handler takes any; cf-loom never reads, copies or checks it, and what it holds and how it is built are the Service's.

The Service declares one type for all of it, and each Handler picks the keys it takes:

```ts
// src/resources.ts
import type { WithResources } from '@cf-loom/handlers';

export type Resources = {
  readonly orders: Orders;
  readonly callers: Callers;
  readonly permissions: Permissions;
  readonly payments: Client<typeof paymentsDeps>;
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
  payments: client(paymentsDeps, { baseUrl }),
  publisher: running.publisher,
  sender: running.sender,
};
const http = serve(contract, handlers, { resources });
await running.consume(handlers, { resources });
```

- A Handler types the Resources it takes in its last parameter, `Needs<'orders'>` or, for a Guard, `GuardCall<typeof apiKey, Pick<Resources, 'callers'>>`, and receives the whole object; a Handler that takes none leaves that parameter out, and so does a stub. `ResourcesOf<typeof handlers>` gives the Resources a map's Handlers take together: `serve` requires those of its EndpointHandlers and GuardHandlers, and `consume` those of its Message Handlers, so a Resource `main.ts` forgets is a type error there, and a test that replaces a Handler by spreading the map needs only what the Handlers left take. When no Handler takes any, `serve` and `consume` need no `resources`.
- `ResourcesOf` is an intersection of what each Handler takes: two Handlers that type the same key differently make `main.ts` unsatisfiable, and picking from one type for the Service rules that out. That type is the Service's code; cf-loom adds no API for it.
- They are handed once, at startup. What belongs to one request comes from its Input and Context, and a Guard hands an EndpointHandler shapes through Context, never objects. A Handler builds anything per request from its Resources, such as a transaction from a pool.
- The startup checks of `serve` and `consume` do not look at them; their type is the check.
- A direct call takes them in its last argument, `{ resources }`, so a test hands each Handler what it takes, a fake or an in-memory repository, with nothing to reset between tests (see [Testing a Service's own code](#testing-a-services-own-code)).

## Testing a Service's own code

A Handler returned by `handle()` is a function, and its `element` is the Endpoint, Guard, Command's Message Version or Subscription it was written for. Calling it runs the same checks `serve` and `consume` run: Input that breaks the Contract throws an `InvalidInputError`, and an Outcome that breaks a constraint, or a Success header that cannot travel as HTTP field text, an `InvalidOutcomeError`, so a unit test catches what production would answer as the invalid-input Rejection or as `INVALID_OUTCOME`. Both carry `issues`, one `Issue` per failure: its `part`, the slot as the Snapshot names it, such as `input.params`, `demands.headers`, `context`, `qualifier`, `success.body` or `body`, or `rejections` for a Rejection the Endpoint or Guard does not answer, the `path` inside it, cf-loom's `code` (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#rejections) in the contract README) and a `message`, never the received value; a value where the part declares none is `invalid_type` with the message `Expected no value`. The error's message is one line per Issue (a Context or Qualifier that breaks the Contract is, in production, the runtime's own Fault). Otherwise:

- An EndpointHandler or GuardHandler returns what `serve` would answer: anything it throws, or returns that is no Outcome, becomes that Fault, carrying the original error, or a `TypeError` naming what came back, as `cause`. A throw while checking what it is given, such as a stack overflow on deeply nested Input, is the same Fault with `committed: 'no'`, since the implementation never ran.
- A direct call returns what `serve` sends: a Success as `{ kind: 'success', status, headers, body }`, with only the parts the Endpoint declares and their values parsed as written, unknown keys stripped, since every object in a Read shape is open; a Rejection as the Handler built it (see [EndpointHandler](#endpointhandler)), its body parsed, plus its `code`, `status` and `message`, resolved against cf-loom's defaults unless its last argument gives the root, `getOrderHandler(input, context, { contract, resources })`, which resolves them as `serve` does (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#rejections) in the contract README); a Fault as built. A Rejection is told by its declaration, `isRejectionOf(outcome, orderLocked)`, which narrows the Outcome to that Rejection with its body typed; a declared Rejection's `code`, `status` and `message` are typed as written, so `outcome.code === 'ORDER_LOCKED'` leaves out the other declared Rejections.
- A GuardHandler's direct call takes no root: its last argument, `{ qualifier, resources }`, holds its Qualifier when its Guard declares one and the Resources it takes, and is left out when it needs neither. A Guard's declared Rejections carry their own code, status and message, and a stub's not-implemented Rejection resolves against cf-loom's defaults. It returns `{ kind: 'admitted', context }` when it admits the request.
- A Message Handler answers nothing when it returns nothing, returns a Fault it returns unchanged and rethrows what it throws, since `consume` answers no Caller; returning anything else throws a `TypeError` naming what came back.
- An Endpoint or Guard stub checks what it is given first, like any Handler, then returns the not-implemented Rejection, so a direct call's Outcome type includes it; a Message Handler stub checks its body too, then throws, since `consume` never runs it.
- A GuardHandler validates what its Guard demands, the Context it is given against the `context` schemas of the Guards it lists and its Qualifier against its `qualifier` schema, or refuses one when the Guard declares none (`permissionHandler({}, { userToken: { userId: 'u-1' } }, { qualifier: ['orders:edit'], resources })`), and checks an `admit()` against the Guard's `context` schema; `serve` answers an invalid `admit()` with `INVALID_OUTCOME`.
- The Context passed to an EndpointHandler is checked against each attached Guard's `context` schema, and a key no attached Guard provides is an `unrecognized_key`.
- A Message Handler is written for its Command's Message Version or Subscription paired with its Reader schema by `withReader`, as the readers file exports it, and takes its body as a Subscriber reads it, with Unknown cases written `{ unknown: … }`: a direct call writes it back through that Reader, as a fake writes a scripted value, so a body that breaks it throws `InvalidInputError` at `body`, then reads it as `consume` does. In a direct call its meta (see [Message Handlers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#message-handlers) in the messaging README) defaults `headers` to `{}`, and its last argument is `{ resources }`.

```ts
import getOrderHandler from '../src/endpoints/orders/get-order.handler.ts';

const outcome = await getOrderHandler(
  { params: { orderId: ORDER_ID } },
  { apiKey: { callerId: 'c-1' } },          // the Context, one key per Guard that provides one
  { resources: { orders } },                // the Resources it takes, here an in-memory repository
);
```

```ts
import notifyOnSettledHandler from '../src/subscriptions/notify-on-settled.handler.ts';

const answer = await notifyOnSettledHandler(
  settled,
  { messageId, factId: 'pay-1', deliveryCount: 1 },   // headers: {}
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
  headers: { 'x-api-key': 'any' },          // still demanded by the Contract
}));
```

Which test runner, mocking library, fixtures or end-to-end tools a Service uses is the organization's choice; an HTTP test through a host adapter uses that host's own tools, such as supertest.

## Types

- `Outcome<typeof getOrder>`, what an EndpointHandler builds: `success(…)`, one of the Endpoint's Rejections with its body (its own, its Guards', not found when listed and not implemented; never invalid input, which the runtime answers), or a Fault; `ResolvedOutcome<typeof getOrder>`, what its direct call returns, the Success with its status and a Rejection with its code, status and message resolved.
- `Admission<typeof apiKey>`, what a GuardHandler builds: `admit(…)` with the Context its Guard provides, one of the Guard's Rejections, or a Fault; `ResolvedAdmission<typeof apiKey>`, what its direct call returns.
- `isRejectionOf(outcome, rejection)`, whether a direct call's answer is that Rejection, a Standard one included, narrowing it with its body typed; a resolved declared Rejection's `code`, `status` and `message` are typed as its declaration writes them, a Standard Rejection's as `string` and `number`.
- `Fault`, `{ kind: 'fault', committed, retryable, message, cause? }`, and `Committed`, `'no'`, `'yes'` or `'unknown'`.
- `EndpointHandler<typeof getOrder, Resources>` and `GuardHandler<typeof apiKey, Resources>`, what `handle()` and `handle.stub()` return, nominal over the Endpoint or Guard they were written for and typed by the Resources they take; `EndpointImplementation`, `GuardImplementation`, `CommandImplementation` and `EventImplementation`, the function `handle()` wraps; `DirectCall`, `{ contract?, resources }`, the last argument of an EndpointHandler's direct call: the root it resolves Standard Rejections against and its Resources.
- `CommandHandler<typeof chargeCardV1, Resources>` and `EventHandler<typeof notifyOnSettled, Resources>`, written for a Command's Message Version or a Subscription and typed by the Resources they take, each paired with its Reader by `withReader` (`chargeCardV1` and `notifyOnSettled` as the readers file exports them), the Message Handlers, whose direct call answers a Fault or nothing (see [Message Handlers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#message-handlers) in the messaging README).
- `WithResources<R>`, `{ resources }`, what an EndpointHandler's or Message Handler's implementation takes last; `GuardCall<typeof apiKey, R>`, `{ qualifier, resources }`, a GuardHandler's last argument, to its implementation and its direct call; `MessageCall<R>`, a Message Handler's direct call's.
- `ResourcesOf<typeof handlers>`, the Resources the Handlers of a map take together, which `serve` and `consume` require (see [Resources](#resources)).
- `WithReader`, what `withReader` returns and `handle` takes (see [Testing a Service's own code](#testing-a-services-own-code)); `MessageMeta`, `{ messageId, factId, deliveryCount, headers }`, the meta a Message Handler receives.
- `HandlerMap`, the shape `serve` and `consume` accept a Handler map in: `endpoints` and `guards`, each Handler known by the `element` it was written for, `commands` and `subscriptions`, and `deprecatedAt` (see [Stubs and the Handler map](#stubs-and-the-handler-map)).
- `Issue`, `InvalidInputError` and `InvalidOutcomeError`: what a direct call throws (see [Testing a Service's own code](#testing-a-services-own-code)).
