# @cf-loom/messaging

`messaging`, which connects a Contract's messaging through a Broker: EventPublisher, CommandSender, `consume` for Subscriptions and Commands, `close`; the errors `PublishError` and `InvalidMessageError`; and its types, the `Broker` an adapter implements among them (see [Types](#types)). `@cf-loom/messaging/jetstream` is its adapter for NATS JetStream and `@cf-loom/messaging/memory` an in-memory one for tests and local development (see [Adapters](#adapters)). What the Broker must hold, and how the adapter applies it, is in [The broker plan](#the-broker-plan), [Applying the plan](#applying-the-plan) and [Pruning](#pruning); how a Message travels is in [Over the Broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) in the root ARCHITECTURE.md. Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

The examples follow the layout in [A first Service](https://github.com/CasitaFeliz/cf-loom/blob/main/README.md#a-first-service) and leave out imports of the Contract's declarations.

## Connecting

`messaging(contract, broker)` connects through the Broker and resolves to one connection's `Messaging`, `{ publisher, sender, consume, close }`; a Broker that fails to connect rejects it. The Service keeps it in its own module, written by hand, never generated, as a Consumer keeps its client:

```ts
// src/messaging.ts
import { type Broker, type Messaging, messaging } from '@cf-loom/messaging';
import { contract } from './contract/index.ts';

let started: Messaging<typeof contract> | undefined;

export async function startMessaging(broker: Broker): Promise<Messaging<typeof contract>> {
  started = await messaging(contract, broker);
  return started;
}

export function ordersMessaging(): Messaging<typeof contract> {
  if (started === undefined) {
    throw new Error('startMessaging() was not called');
  }
  return started;
}
```

`src/main.ts` starts it with the JetStream adapter (see [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README), a test with the in-memory one (see [In memory](#in-memory)), and Handlers reach it through `ordersMessaging()`. Each `messaging()` is its own connection: connecting again is calling it again. The Service connects at startup so a broker problem, a missing stream or durable consumer included (see [Applying the plan](#applying-the-plan)), fails there rather than inside a request. `consume(handlers)` hands the Broker its consumers once per `Messaging`: consuming twice throws, and a `consume` the Broker rejects may be called again. The Service calls `close()` at shutdown, which stops consuming, waits for the Handlers running and for every `publish`, `send` and `consume` in flight, from whichever caller, and closes the connection: while it waits, publishing and sending still work, and are waited for too, so a Handler running can finish, a Message delivered meanwhile is left pending, its Handler never run, and consuming throws. Calling `close()` again returns the same promise; once nothing is in flight, publishing, sending and consuming throw `messaging is closed`. Broker options come from the Service; cf-loom has no defaults for them.

`messaging(contract, broker, { onServiceFault })` receives what Message Handlers end or fail with, a `ConsumedFault` whose `element` names the Subscription, or the Command's Message Version by its identity (`notify-on-settled`, `ChargeCard@1`), with the Message's `subject`, `messageId` and `factId`: `invalid-body`, a Message ended for failing its schema, with its `issues`; `returned`, a Fault with `retryable: false`, as `fault`; and `thrown`, anything thrown, as `cause`. Without an `onServiceFault`, they go to the console, one line per issue, `<element> <subject> <messageId> <factId>: body.<path> <code>: <message>`, or one line, `<element> <subject> <messageId> <factId>: ` and the Fault's message or `the Handler threw`, with its `cause` (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md).

## Publishing and sending

```ts
// in any Handler
import { ordersMessaging } from '../../messaging.ts';

const { publisher, sender } = ordersMessaging();
await publisher.publish('OrderCreated', {
  v1: { orderId, total: total.amount },   // Deprecated, still published
  v2: { orderId, total },
});
await sender.send('ChargeCard', { orderId });
```

`publish` takes an Event's name and one body for each of its Active and Deprecated versions: leaving one out, or passing a Retired one, is a type error, so adding a new Message Version flags every place that publishes the Event. `send` takes a Command's name and sends its one Active version. Both validate every body of the call with its version's schema before any leaves, and send the parsed value; a body that breaks it throws `InvalidMessageError`, whose `invalid` lists each such version by its identity with its `issues` at `body`, and nothing is sent. `publish` sends the versions in version order.

All the Messages of one call share a Fact id, which every Message Handler receives to recognize a fact it already handled. The Fact id is random unless the calling code passes one, a non-empty string:

```ts
await publisher.publish('OrderCreated', { v1, v2 }, { factId: `${order.id}:created`, headers: { traceparent } });
```

`headers` are transport headers, `traceparent` for one: opaque strings cf-loom passes to the Broker unread and hands to every Message Handler in its meta (see [Message Handlers](#message-handlers)). They are not part of the Contract and never validated; the two names cf-loom sets itself (see [Over the Broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) in the root ARCHITECTURE.md) are refused, in any case.

Each Message is sent with `<Name>.v<version>:<factId>` as its broker message id (`OrderCreated.v2:o-1:created`), unique within the Service's stream since a name belongs to one kind, so the Broker drops a duplicate within its deduplication window. The Fact id also travels in its own header, `Cf-Loom-Fact-Id`, and is never parsed out of the id. If any version fails, `publish` throws a `PublishError` that names the Fact id (`factId`) and the versions already sent (`sent`, `OrderCreated@1`), with the Broker's error as `cause`, and the Handler that called `publish` retries the whole call with the same Fact id: versions already sent are dropped as duplicates. `send` sends one Message, so it rejects with the Broker's error itself. A Fact id derived from the committed entity, as above, is what makes that retry safe; a random one sends the fact again. How long the window lasts is the organization's broker configuration; beyond it, Handlers still recognize the fact by its id. Publishing within the transaction that commits the change (an outbox) is the organization's.

## Message Handlers

```ts
// src/subscriptions/notify-on-settled.handler.ts
export default handle(notifyOnSettled, async (body, { messageId, factId, deliveryCount, headers }) => {
  await notifications.send(body.paymentId);
});
```

`notifyOnSettled` is the Subscription as a Message Handler takes it (see [Testing a Service's own code](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#testing-a-services-own-code) in the handlers README). A CommandHandler has the same shape. Delivery is at least once (see [Messages](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#messages) in the root ARCHITECTURE.md). Returning nothing acknowledges the Message. Throwing, or a Fault with `retryable: true`, leaves it unacknowledged, so the durable consumer's configuration (ack wait, backoff, max deliveries), the organization's, decides when it comes again and what happens after the last attempt; `deliveryCount` tells the Handler which attempt this is. A Fault with `retryable: false` ends it (JetStream `term`): no redelivery, and it is logged. Returning anything else counts as a throw. `headers` are the transport headers the Message was published with (see [Publishing and sending](#publishing-and-sending)). How the adapter keeps a slow Handler's Message from a sibling instance meanwhile is in [In-progress acknowledgements](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/ARCHITECTURE.md#in-progress-acknowledgements).

Messages are validated with the generated Reader schemas (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md): a Dependency's Event with its Contract Package's, the Service's own with `readers.generated.ts`. A Message that fails its schema, or whose body is no UTF-8 JSON, never reaches the Handler: it is ended without redelivery and logged with its subject, its ids and the issues (see [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README for what a log carries); where it goes next is the organization's broker configuration.

## Adapters

An adapter is a `Broker` (see [Types](#types)): `connect` receives the Service's name and returns the connection `messaging` publishes, consumes and closes through, so an organization on another Broker may write its own. The core computes every subject, stream and durable consumer name unprefixed, and the adapter adds the prefix; an `OutgoingMessage`'s `messageId` is the id the Broker deduplicates by; each `BrokerConsumer`'s `receive` runs its Handler and resolves to the `Settlement` the adapter applies, acknowledging, ending (JetStream `term`) or leaving the Message for redelivery, and a `receive` that rejects, which only an `onServiceFault` that throws causes, leaves it for redelivery; `close` is called once nothing is in flight: Handlers running, `publish`, `send` and `consume`, which the core keeps, not the adapter.

### JetStream

`jetstream({ servers, prefix })` from `@cf-loom/messaging/jetstream` connects to NATS JetStream, as `src/main.ts` does in [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README; its broker client is an optional peer dependency (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md) and `prefix` is in [Over the Broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) there. The adapter's `apply` applies the broker plan (see [Applying the plan](#applying-the-plan)).

### In memory

`@cf-loom/messaging/memory` is a broker adapter that keeps everything in memory, for tests and local development:

```ts
import { memory } from '@cf-loom/messaging/memory';
import { startMessaging } from '../src/messaging.ts';
import handlers from '../src/handlers.generated.ts';
import createOrderHandler from '../src/endpoints/orders/create-order.handler.ts';

const broker = memory();
const running = await startMessaging(broker);
await running.consume(handlers);

await createOrderHandler({ body: newOrder }, { apiKey: { callerId: 'c-1' } });
await broker.settled();   // OrderCreated v1 and v2 published, ChargeCard v1 sent and handled
broker.messages;          // each with its subject, body, Fact id, broker message id and transport headers

await broker.deliver(paymentsDeps.events.paymentSettledV1, body, { factId: 'pay-1' });
// → 'acked' | 'pending' | 'ended'

await running.close();
```

- **Delivery.** What the Service publishes or sends is delivered to its consumed Subscriptions and CommandHandlers, acknowledged or ended as `consume` does. A Message nothing consumes, because no Subscription takes the Event or its Handler is a stub, is only recorded.
- **Order.** Delivery is sequential, in publish order, which production never guarantees (see [Messages](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#messages) in the root ARCHITECTURE.md).
- **`settled()`** waits until nothing is in flight, including Messages that Handlers publish or send while it waits. It rejects, with the error as `cause`, if a Handler threw or a Message was ended since the last `settled()`, so a failure cannot pass a test unnoticed; a chain that keeps producing Messages is cut after 1,000 deliveries and rejects too.
- **`deliver(element, body, meta)`** delivers one Message now, whatever was delivered before, so a test can deliver the same fact twice to check that a Handler is safe to run again. Its body is written as a Subscriber reads it, like `fakeEvent`'s (see [Faking Providers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/testing/README.md#faking-providers) in the testing README), its broker message id defaults to `<Name>.v<version>:<factId>`, and `meta.headers` are the transport headers the Handler receives. Delivering to an Element nothing consumes throws.
- **Redelivery.** The adapter never redelivers on its own: a Message whose Handler threw or returned a retryable Fault is listed in `broker.pending`, and a test retries it with `deliver`.
- **Duplicates.** A repeated broker message id from `publish` or `send` is dropped, for the adapter's whole lifetime.
- **Not a broker emulator.** It models nothing of the organization's broker configuration (deduplication window, redelivery limits, backoff, retention) and ignores `apply`; tests against a real Broker remain the organization's. One `memory()` serves one connection: a second `messaging()` through it rejects.

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

Without `prune`, `apply` only creates streams and durable consumers, adds subjects and updates limits, so a Release running side by side with an older plan never removes what a newer Release needs: applying without `prune` is safe before the new Release deploys and while the old one runs. A Release fails fast when the plan was not applied: `messaging()` checks that the Service's stream covers every subject it publishes or sends, `consume` that the durable consumer of every Subscription and Command Version it serves exists, one with a stubbed Handler included, and each fails with an error naming what is missing.

## Pruning

Pruning deletes the durable consumers of removed Subscriptions and Retired Command Versions, so it runs only once the Release that dropped them is no longer running (see the deploy rule in [Messages](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#messages) in the root ARCHITECTURE.md). `apply` refuses to delete a durable consumer that still has pending or ack-pending Messages, with an error naming the durable consumer and both counts, unless `{ prune: true, force: true }` is given: the deploy rule has a Command Version's durable consumer drained first. `cf-loom broker-plan --orphans` reads the Broker, the one thing `broker-plan` does that needs broker access, read-only, and lists the orphaned durable consumers with those counts. After a prune, rolling back to a Release before it needs that Release's plan applied again, since its durable consumers are gone.

## Types

- `Messaging`, `{ publisher, sender, consume, close }`: one connection's messaging, what `messaging()` resolves to.
- `MessagingOptions`, `{ onServiceFault? }`: what is operational about messaging and no part of the Contract.
- `EventPublisher` and `CommandSender`: `publish` and `send`, typed by the Contract's Events and Commands.
- `MessageOptions`, `{ factId?, headers? }`: what a `publish` or `send` call may add.
- `ConsumedFault`: what `onServiceFault` receives, `invalid-body`, `returned` or `thrown`.
- `PublishError`, with `factId` and `sent`: what `publish` throws when a version could not be sent.
- `InvalidMessageError`, with `invalid`, each version's `identity` and `issues`: what `publish` and `send` throw given a body that breaks its schema.
- `Broker`, `{ connect }`: what `messaging()` connects through, an adapter's or the organization's own; `BrokerService`, `{ name }`, what it tells the Broker.
- `BrokerConnection`, `{ publish, consume, close }`: one connection to a Broker.
- `OutgoingMessage`, `{ subject, messageId, factId, headers, body }`: a Message as it leaves, its body the UTF-8 JSON bytes.
- `BrokerConsumer`, `{ durable, stream, subject, element, reader, receive }`: the durable consumer of a Subscription or Command Version whose Handler is pulled, with the Element it consumes and the Reader its Handler reads with.
- `Delivery`, `{ messageId, factId, deliveryCount, headers, body }`: one Message as an adapter hands it to `receive`.
- `Settlement`, `acked`, `pending` or `ended`: what became of a delivery, with the `ConsumedFault` `onServiceFault` received, if any.
