# @casitafeliz/loom-messaging

`messaging`: EventPublisher, CommandSender, `consume` for Subscriptions and Commands, `connect`, `close`. `@casitafeliz/loom-messaging/jetstream` is its adapter for NATS JetStream and `@casitafeliz/loom-messaging/memory` an in-memory one for tests and local development (see [Adapters](#adapters)). What the broker must hold, and how the adapter applies it, is in [The broker plan](#the-broker-plan), [Applying the plan](#applying-the-plan) and [Pruning](#pruning); how a Message travels is in [Over the broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) in the root ARCHITECTURE.md. Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

The examples follow the layout in [A first Service](https://github.com/CasitaFeliz/cf-loom/blob/main/README.md#a-first-service) and leave out imports of the Contract's declarations.

## Connecting

The EventPublisher and CommandSender are created once, in their own module, and imported where needed:

```ts
// src/messaging.ts
import { messaging } from '@casitafeliz/loom-messaging';
import { contract } from './contract';

export const { publisher, sender, consume, connect, close } = messaging(contract);
```

`messaging` takes no broker: `connect(broker)` binds one, so `src/main.ts` connects the JetStream adapter and a test connects the in-memory one (see [In memory](#in-memory)). Creating `messaging` opens no connection. Publishing, sending or consuming before `connect` throws, and so does connecting while connected; `close()` returns to not connected, so a test connects in its setup and closes in its teardown. The Service connects at startup so a broker problem, a missing stream or durable consumer included (see [Applying the plan](#applying-the-plan)), fails there rather than inside a request, and calls `close()` at shutdown, which stops consuming, waits for the Handlers running and closes the connection. Broker options come from the Service; cf-loom has no defaults for them.

`messaging(contract, { onServiceFault })` receives what Message Handlers end or fail with: a Message ended for failing its schema, a Fault with `retryable: false`, and anything thrown. Without an `onServiceFault`, they go to the console (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md).

## Publishing and sending

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

`headers` are transport headers, `traceparent` for one: opaque strings cf-loom passes to the broker unread and hands to every Message Handler in its meta (see [Message Handlers](#message-handlers)). They are not part of the Contract and never validated; the two names cf-loom sets itself (see [Over the broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) in the root ARCHITECTURE.md) are refused.

Each Message is sent with `<Name>.v<version>:<factId>` as its broker message id (`OrderCreated.v2:o-1:created`), unique within the Service's stream since a name belongs to one kind, so the broker drops a duplicate within its deduplication window. The Fact id also travels in its own header, `Cf-Loom-Fact-Id`, and is never parsed out of the id. If any version fails, `publish` throws an error that names the Fact id and the versions already sent, and the Handler that called `publish` retries the whole call with the same Fact id: versions already sent are dropped as duplicates. A Fact id derived from the committed entity, as above, is what makes that retry safe; a random one sends the fact again. How long the window lasts is the organization's broker configuration; beyond it, Handlers still recognize the fact by its id. Publishing within the transaction that commits the change (an outbox) is the organization's.

## Message Handlers

```ts
// src/subscriptions/notify-on-settled.handler.ts
export default handle(notifyOnSettled, async (body, { messageId, factId, deliveryCount, headers }) => {
  await notifications.send(body.paymentId);
});
```

A CommandHandler has the same shape. Delivery is at least once (see [Messages](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#messages) in the root ARCHITECTURE.md). Returning acknowledges the Message. Throwing, or a Fault with `retryable: true`, leaves it unacknowledged, so the durable consumer's configuration (ack wait, backoff, max deliveries), the organization's, decides when it comes again and what happens after the last attempt; `deliveryCount` tells the Handler which attempt this is. A Fault with `retryable: false` ends it (JetStream `term`): no redelivery, and it is logged. `headers` are the transport headers the Message was published with (see [Publishing and sending](#publishing-and-sending)). How the adapter keeps a slow Handler's Message from a sibling instance meanwhile is in [In-progress acknowledgements](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/ARCHITECTURE.md#in-progress-acknowledgements).

Messages are validated with the generated Reader schemas (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md): a Dependency's Event with its Contract Package's, the Service's own with `readers.generated.ts`. A Message that fails its schema never reaches the Handler: it is ended without redelivery and logged with its subject, its ids and the issues (see [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README for what a log carries); where it goes next is the organization's broker configuration.

## Adapters

### JetStream

`jetstream({ servers, prefix })` from `@casitafeliz/loom-messaging/jetstream` connects to NATS JetStream, as `src/main.ts` does in [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README; its broker client is an optional peer dependency (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md) and `prefix` is in [Over the broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) there. The adapter's `apply` applies the broker plan (see [Applying the plan](#applying-the-plan)).

### In memory

`@casitafeliz/loom-messaging/memory` is a broker adapter that keeps everything in memory, for tests and local development:

```ts
import { memory } from '@casitafeliz/loom-messaging/memory';
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
- **Order.** Delivery is sequential, in publish order, which production never guarantees (see [Messages](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#messages) in the root ARCHITECTURE.md).
- **`settled()`** waits until nothing is in flight, including Messages that Handlers publish or send while it waits. It rejects, with the error as `cause`, if a Handler threw or a Message was ended since the last `settled()`, so a failure cannot pass a test unnoticed; a chain that keeps producing Messages is cut after 1,000 deliveries and rejects too.
- **`deliver(element, body, meta)`** delivers one Message now, whatever was delivered before, so a test can deliver the same fact twice to check that a Handler is safe to run again. Its body is written as a Subscriber reads it, like `fakeEvent`'s (see [Faking Providers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/testing/README.md#faking-providers) in the testing README), its broker message id defaults to `<Name>.v<version>:<factId>`, and `meta.headers` are the transport headers the Handler receives. Delivering to an Element nothing consumes throws.
- **Redelivery.** The adapter never redelivers on its own: a Message whose Handler threw or returned a retryable Fault is listed in `broker.pending`, and a test retries it with `deliver`.
- **Duplicates.** A repeated broker message id from `publish` or `send` is dropped, for the adapter's whole lifetime.
- **Not a broker emulator.** It models nothing of the organization's broker configuration (deduplication window, redelivery limits, backoff, retention) and ignores `apply`; tests against a real broker remain the organization's. One `memory()` serves one `messaging`: connecting it to a second throws.

## The broker plan

`cf-loom broker-plan` (see [Commands](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/README.md#commands) in the CLI README) prints the desired state from the Snapshots: each stream and its subjects, each Subscription's durable consumer and the stream it reads, each Command Version's durable consumer (`orders-service_command_ChargeCard_v1`, which no kebab-case Subscription name can collide with), the durable consumers left over from removed Subscriptions and Retired Command Versions, and which subjects each Service may publish and subscribe to. `--json` prints it in a fixed shape, so the organization's own tooling can read it; names carry the prefix when one is given:

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

## Applying the plan

Nothing applies it by default (see [Messages](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#messages) in the root ARCHITECTURE.md); the organization applies it with the adapter's `apply`, in a deploy step, or from its own infrastructure tooling:

```ts
await broker.apply(plan, limits);                    // creates and updates, never removes
await broker.apply(plan, limits, { prune: true });   // also deletes orphaned durable consumers
```

`plan` is the JSON above; computing it needs the Baseline and the registry, which a running Service does not have. `limits` holds every setting cf-loom has no opinion on: for each stream `retention`, `maxAge`, `duplicateWindow`, `replicas` and `storage`, for each durable consumer `deliverPolicy`, `ackWait`, `maxDeliver`, `backoff` and `maxAckPending`, keyed by the names the plan prints; `streamDefaults` and `consumerDefaults` fill in whatever a stream or durable consumer does not set. `apply` refuses to create a stream or durable consumer with any setting left unset, naming it and the setting. `cf-loom broker-plan --limits-skeleton` prints the `limits` for the plan with every key empty:

```ts
await broker.apply(plan, {
  streamDefaults:   { retention: 'limits', maxAge: '7d', duplicateWindow: '2m', replicas: 3, storage: 'file' },
  consumerDefaults: { deliverPolicy: 'all', ackWait: '30s', maxDeliver: 5, backoff: ['1s', '10s', '1m'], maxAckPending: 100 },
  streams:   { 'orders-service': { replicas: 1 } },
  consumers: { 'orders-service_notify-on-settled': { ackWait: '2m' } },
});
```

Without `prune`, `apply` only creates streams and durable consumers, adds subjects and updates limits, so a Release running side by side with an older plan never removes what a newer Release needs: applying without `prune` is safe before the new Release deploys and while the old one runs. A Release fails fast when the plan was not applied: `connect` checks that the Service's stream covers every subject it publishes or sends, `consume` that the durable consumer of every Subscription and Command Version it serves exists, one with a stubbed Handler included, and each fails with an error naming what is missing.

## Pruning

Pruning deletes the durable consumers of removed Subscriptions and Retired Command Versions, so it runs only once the Release that dropped them is no longer running (see the deploy rule in [Messages](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#messages) in the root ARCHITECTURE.md). `apply` refuses to delete a durable consumer that still has pending or ack-pending Messages, with an error naming the durable consumer and both counts, unless `{ prune: true, force: true }` is given: the deploy rule has a Command Version's queue drained first. `cf-loom broker-plan --orphans` reads the broker, the one thing `broker-plan` does that needs broker access, read-only, and lists the orphaned durable consumers with those counts. After a prune, rolling back to a Release before it needs that Release's plan applied again, since its durable consumers are gone.
