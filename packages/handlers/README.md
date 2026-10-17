# @casitafeliz/loom-handlers

`handle`, `handle.stub`, `success`, `reject`, `admit`, `fault`; the `Outcome`, `Admission` and Handler types (`EndpointHandler`, `GuardHandler`, `CommandHandler`, `EventHandler`). A Message Handler is written with the same `handle`; how it runs is in [Message Handlers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#message-handlers) in the messaging README. Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

The examples follow the layout in [A first Service](https://github.com/CasitaFeliz/cf-loom/blob/main/README.md#a-first-service) and leave out imports of the Contract's declarations and sibling files.

## Stubs and the handler map

`cf-loom generate` writes a stub for every Handler that does not exist yet, never overwriting one, and regenerates `handlers.generated.ts` and `readers.generated.ts` (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md). A stub is `export default handle.stub(getOrder)`, which marks the Handler as not implemented; implementing it means replacing that line with `handle(getOrder, async (…) => …)`. `serve` answers the not-implemented Rejection for an EndpointHandler stub, and for every Endpoint attaching a GuardHandler stub, which never admits. `consume` does not pull from a Message Handler stub and logs a warning, though it still requires its durable consumer (see [Applying the plan](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#applying-the-plan) in the messaging README); its Messages wait in that durable consumer until a Release with the real Handler drains them, unless the stream's retention limits, which are the organization's, drop them first. Either way a Contract can be merged and deployed with stubs before it is implemented, and is published with that Release (see [The Compatibility Check](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-compatibility-check) in COMPATIBILITY.md). A missing Handler is a type error.

`handlers.generated.ts` exports the handler map, plain data with four keys: `endpoints` by Endpoint name, `guards` by Guard name, `commands` by the Message Version's name in code (`chargeCardV1`) and `subscriptions` by Subscription name, a quoted key (`'notify-on-settled'`). Handler types are nominal over their Element (`EndpointHandler<typeof getOrder>`), so the map type-checks by Element, not by inferred payload.

## EndpointHandler

```ts
// src/endpoints/orders/get-order.handler.ts
import { handle, reject, success } from '@casitafeliz/loom-handlers';

export default handle(getOrder, async ({ params }, context) => {
  const order = await orders.find(params.orderId, context.apiKey.clientId);
  if (!order) return reject(notFound);
  if (order.locked) return reject(orderLocked, { lockedAt: order.lockedAt });
  return success({ id: order.id, status: order.status, total: order.total });
});
```

- The first argument is the validated Input; the second is the Context, one key per attached Guard.
- Only the Endpoint's Rejections type-check in `reject`, each with its declared body. What a Handler builds carries a Rejection as its declaration, `rejection`, and its `body`, not as a resolved code, status or message: `serve` resolves them against the root (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#rejections) in the contract README). The `Outcome` type of `@casitafeliz/loom-handlers` is not the client's (see [Consuming a Contract](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#consuming-a-contract) in the client README); a direct call returns them resolved too (see [Testing a Service's own code](#testing-a-services-own-code)).
- When the Endpoint declares `success.headers`, the Handler returns them with the Success, `success({ headers, body })` (`success({ headers })` for 204); otherwise `success(body)`.
- Anything thrown becomes a Fault with `committed: 'unknown'` and `retryable: false`, since nothing says the same request could succeed later, and the fixed message `Internal error`; the error itself reaches only `onFault`, as `cause` (see [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README). A Handler that knows better returns `fault({ committed: 'no', retryable: true })`, just as it returns `success` and `reject`. Message Handlers differ: there a throw has the Message delivered again (see [Message Handlers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#message-handlers) in the messaging README).

## GuardHandler

```ts
// src/guards/api-key.handler.ts
export default handle(apiKey, async ({ headers }) => {
  const client = await clients.byKey(headers['x-api-key']);
  if (!client) return reject(unauthenticated);
  return admit({ clientId: client.id });
});
```

A GuardHandler receives only what its Guard demands. Every attached Guard, declared locally or imported from a Definitions Package, gets its Handler at `src/guards/<guard-name>.handler.ts`, its name in kebab-case. Guards run in the order the Endpoint lists them, before the Endpoint's own Input is validated: each Guard first validates only what it demands, answering the invalid-input Rejection if that fails, then its GuardHandler runs. The first Rejection stops the request, so an unauthenticated Caller learns nothing about the Endpoint's Input, and the EndpointHandler only runs with valid Input.

## Testing a Service's own code

A Handler returned by `handle()` is a function. Calling it runs the same checks `serve` and `consume` run: Input that breaks the Contract throws with the validation issues, as does an Outcome that breaks a constraint, so a unit test catches what production would answer as the invalid-input Rejection or as `INVALID_OUTCOME`. Otherwise:

- An EndpointHandler or GuardHandler returns what `serve` would answer: anything it throws becomes that Fault, carrying the original error as `cause`.
- A direct call returns the `Outcome` the Handler built (see [EndpointHandler](#endpointhandler)) plus the Rejection's `code`, `status` and `message`, resolved against cf-loom's defaults unless the call is given the root, `getOrderHandler(input, context, { contract })`, which resolves them as `serve` does (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#rejections) in the contract README). A Rejection is told by its declaration: `outcome.rejection === notFound`.
- A Message Handler rethrows what it throws and returns a Fault it returns unchanged, since `consume` answers no Caller.
- An Endpoint or Guard stub returns the not-implemented Rejection, so a direct call's Outcome type includes it; a Message Handler stub throws, since `consume` never runs it.
- A GuardHandler validates only what its Guard demands, and checks an `admit()` against the Guard's `context` schema; `serve` answers an invalid `admit()` with `INVALID_OUTCOME`.
- The Context passed to an EndpointHandler is checked against each attached Guard's `context` schema.
- A Message Handler takes its body as a Subscriber reads it, with Unknown cases written `{ unknown: … }`. In a direct call its meta (see [Message Handlers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#message-handlers) in the messaging README) defaults `headers` to `{}`.

```ts
import getOrderHandler from '../src/endpoints/orders/get-order.handler';

const outcome = await getOrderHandler(
  { params: { orderId: ORDER_ID } },
  { apiKey: { clientId: 'c-1' } },          // the Context, one key per Guard
);
```

The handler map `handlers.generated.ts` exports is plain data (see [Stubs and the handler map](#stubs-and-the-handler-map)), so a test replaces one Handler, a Guard's for example, by spreading the map:

```ts
const http = serve(contract, {
  ...handlers,
  guards: { ...handlers.guards, apiKey: handle(apiKey, async () => admit({ clientId: 'c-1' })) },
});
const res = await http(new Request(`http://test/orders/${ORDER_ID}`, {
  headers: { 'x-api-key': 'any' },          // still demanded by the Contract
}));
```

Which test runner, mocking library, fixtures or end-to-end tools a Service uses is the organization's choice; an HTTP test through a host adapter uses that host's own tools, such as supertest.
