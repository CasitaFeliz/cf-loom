# @cf-loom/messaging

`messaging`, which connects a Contract's messaging through a Broker: EventPublisher, CommandSender, `consume` for Subscriptions and Commands, `close`; the errors `InvalidMessageError`, `MessageNotSentError`, `MessagingClosedError`, `CloseAbortedError` and `DeadlineError`; and its types, `ConsumeOptions` and the `Broker` an adapter implements among them (see [Types](#types)). `@cf-loom/messaging/jetstream` is its adapter for NATS JetStream, `jetstream`, `applyBrokerPlan` and their types, `JetStreamBrokerOptions`, `JetStreamConnecting`, `BrokerPlan` and `BrokerLimits` among them, and `@cf-loom/messaging/memory` an in-memory one for tests and local development, `memory` and its types (see [Adapters](#adapters)). What the Broker must hold, and how the adapter applies it, is in [The broker plan](#the-broker-plan), [Applying the plan](#applying-the-plan) and [Leftover Durable consumers](#leftover-durable-consumers); how a Message travels is in [Over the Broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) in the root ARCHITECTURE.md. Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

The examples follow the layout in [A first Service](https://github.com/CasitaFeliz/cf-loom/blob/main/README.md#a-first-service) and leave out imports of the Contract's declarations.

## Connecting

One `Messaging` is one connection, used in four steps. Each step says what it rejects.

1. **Connect.** `messaging(contract, broker)` connects through the Broker and resolves to one connection's `Messaging`, `{ publisher, sender, consume, close }`; a Broker that fails to connect rejects it.
   - `src/main.ts` connects it with the organization's Broker adapter (see [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README, which both example Services follow with the JetStream one), a test with the in-memory one (see [In memory](#in-memory)), and hands its `publisher` and `sender` to the Handlers as Resources, through `serve` and `consume` (see [Resources](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#resources) in the handlers README).
   - Each `messaging()` is its own connection: connecting again is calling it again.
   - The Service connects at startup so a broker problem, a missing Stream or Durable consumer included (see [Applying the plan](#applying-the-plan)), fails there rather than inside a request.
2. **Publish and send.** `publish` and `send` reject with `InvalidMessageError` when the call breaks a rule and with `MessageNotSentError` when the Broker fails (see [Publishing and sending](#publishing-and-sending)), and with `MessagingClosedError` once the connection is closed (see step 4).
3. **Consume.** `consume(handlers, { resources })` hands each Message Handler the Resources, its options always given, `{}` when no Message Handler takes any, and hands the Broker its consumers once per `Messaging`: consuming twice throws, and a `consume` the Broker rejects may be called again. It rejects with `MessagingClosedError` once closing has started (see step 4).
4. **Close.** The Service calls `close()` at shutdown, which:
   - stops consuming;
   - aborts the signal every running Message Handler received;
   - waits for the Handlers running, each no longer than its Delivery's wait (see [Message Handlers](#message-handlers)), and for every `publish`, `send`, `consume` and `onBrokerTrouble` in flight, from whichever caller;
   - closes the connection the moment nothing is in flight.

   While it waits, publishing and sending still work, and are waited for too, so a Handler running can finish, and a Message delivered meanwhile is left pending, its Handler never run.

   - `close({ signal })` stops waiting once its signal aborts, or at once if it has:
     - each Delivery still settling (its Handler running within its wait, or its `onServiceFault` in flight) is handed back for another process;
     - the connection is closed, and `close` rejects with `CloseAbortedError`, whose `handedBack` names each, `{ identity, subject, messageId, factId }`, its `cause` the signal's reason;
     - publishing, sending, `consume` and an `onBrokerTrouble` in flight are no longer waited for, and nothing more reaches `onBrokerTrouble` once closing started.
   - That signal bounds the wait for what is in flight, not the Broker's closing: how long a Broker that does not answer keeps `close` waiting is the adapter's (see [JetStream](#jetstream)).
   - Calling `close()` again returns the same promise, which the signal of any call bounds.
   - Consuming rejects with `MessagingClosedError`, `messaging is closing`, while it waits, and once nothing is in flight, publishing, sending and consuming reject with `MessagingClosedError`, `messaging is closed`.

Broker options come from the Service; cf-loom has no defaults for them.

### onServiceFault

`messaging(contract, broker, { onServiceFault })`, which may be async, receives what Message Handlers end or fail with, a `ConsumedFault` whose `element` is the Subscription or the Command's Message Version and whose `identity` names it (`notifyOnSettled`, `ChargeCard@1`), with the Message's `subject`, `messageId` and `factId`, and the Delivery's `deliveryCount` and `lastAttempt`, whether the Broker will not deliver it again:

- `invalid-body`, a Message ended for failing its schema, with its `issues`;
- `returned`, a Fault the Handler returned, retryable or not, as `fault`;
- `thrown`, anything thrown, as `cause`.

Without an `onServiceFault`, they go to the console, one line per issue after `<identity> <subject> <messageId> <factId> attempt <n>`, as the contract writes an issue (see [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#rejections) in the contract README), or one line, `<identity> <subject> <messageId> <factId> attempt <n>: ` and the Fault's message or `the Handler threw`, with its `cause`; the last attempt reads `attempt <n>, the last` (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md).

### onBrokerTrouble

`messaging(contract, broker, { onBrokerTrouble })`, which may be async, receives a `BrokerTrouble` when a Durable consumer stops being pulled from, once, with its `element`, `identity`, `durable`, `stream` and the `cause` (`pull-failed`), and once when its pulls are answered again (`recovered`); `durable` and `stream` are unprefixed, as `connect` gives them. A connection closed for good is `pull-failed` with no `recovered` after, and reconnecting, through the Service's own `connect` and a new `messaging()`, is the Service's. Without it, each goes to the console as one line, `<identity> <durable> <stream>: pulls are failing` with its cause, or `<identity> <durable> <stream>: pulls are answered again`; an `onBrokerTrouble` that throws or rejects is logged as `<identity> <durable> <stream>: onBrokerTrouble threw`. A readiness probe needs only the hook, `onBrokerTrouble: (t) => t.kind === 'pull-failed' ? failing.add(t.identity) : failing.delete(t.identity)`; what the Service does is the organization's.

## Publishing and sending

```ts
// in a Handler taking { publisher } as Resources, once the order is committed
const { duplicates } = await publisher.publish(
  'OrderCreated',
  { v1: { orderId, total: total.amount }, v2: { orderId, total } },   // v1 Deprecated, still published
  { factId: `${order.id}:created` },
);
// in a Message Handler, chaining from the Message it handles
await sender.send('ChargeCard', { orderId }, { factId: `${meta.factId}:charge`, headers: { traceparent: meta.headers['traceparent'] } });
```

`publish` takes an Event's name and one body for each of its Active and Deprecated versions, whatever Groups its versions sit in: leaving one out, or passing a Retired one, is a type error, so adding a new Message Version flags every place that publishes the Event; publishing an Event whose `version` is typed `number`, which keys no body, is a type error too. `send` takes a Command's name and sends its one Active version. Both validate every body of the call with its version's schema before any leaves, and send the parsed value; a body that breaks it is refused with `InvalidMessageError` (see below), each such version listed by its identity with its `issues` at `body`, and nothing is sent. `publish` sends the versions in version order.

Every call takes a Fact id, which all its Messages share and every Message Handler receives to recognize a fact it already handled: a non-empty string that arrives as given on every Broker (see [Over the Broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) in the root ARCHITECTURE.md). The calling code derives it from the fact: from the committed entity, or in a Message Handler from the Message it handles (`meta.factId`), so a retry or a redelivery sends the same id and the Broker drops the copy; a random id would send the fact again.

`headers` are Transport headers, `traceparent` for one, an `undefined` one left out: opaque strings cf-loom passes to the Broker unread and hands to every Message Handler in its meta (see [Message Handlers](#message-handlers)). They are not part of the Contract and never validated against a schema, but one that would not arrive as given on every Broker is refused, a name in cf-loom's `Cf-Loom-` or NATS's `Nats-` namespace among them, in any case, and so are a Fact id and Transport headers that together take more than the 65,535 bytes JetStream stores in a Message's headers (see [Over the Broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) in the root ARCHITECTURE.md). `publish` and `send` reject with `InvalidMessageError`, whose `invalid` lists each part refused, all at once, the Fact id (`factId`), each Transport header (`headers.<name>`), each version whose headers are too large, then each body, one line each in its message, and send nothing.

Each Message is sent with its Broker message id (`event.OrderCreated.v2:o-1:created`, see [Over the Broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker)), so the Broker drops a duplicate within its deduplication window. The Fact id also travels in its own header, `Cf-Loom-Fact-Id`, and is never parsed out of the id. `publish` resolves to `{ factId, duplicates }`, the identities of the versions the Broker already held and dropped, and `send` to `{ factId, duplicate }`: a duplicate is the expected outcome of a retry, or of a Fact id reused for another fact, which the calling code may log. If the Broker fails, `publish` and `send` reject with a `MessageNotSentError` that names the Fact id (`factId`) and the versions already sent (`sent`, `OrderCreated@1`, always empty for `send`), with the Broker's error as `cause`, and the Handler retries the whole call with the same Fact id: versions already sent are dropped as duplicates. How long the window lasts is the organization's broker configuration; beyond it, Handlers still recognize the fact by its id. Publishing within the transaction that commits the change (an outbox) is the organization's.

## Message Handlers

```ts
// src/subscriptions/orders/notify-on-settled.handler.ts
import { readers } from '../../readers.generated.ts';

export default handle(
  readers.subscriptions.notifyOnSettled,
  async (body, { messageId, factId, deliveryCount, headers, signal }, { resources: { notifications } }: Needs<'notifications'>) => {
    await notifications.send(body.paymentId);
  },
);
```

`readers.subscriptions.notifyOnSettled` is the Subscription as a Message Handler takes it, from the readers file (see [Testing a Service's own code](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#testing-a-services-own-code) in the handlers README). The Handler's `body` is typed `ReceivedBodyOf<typeof readers.subscriptions.notifyOnSettled>` (see [Types](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#types) in the handlers README); on the Service's own Event, `BodyOf` is the writer's type, what `publish` takes, which lacks the Unknown cases. A Command's Message Handler has the same shape, and `Needs` is the Service's own (see [Resources](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#resources) in the handlers README). Delivery is at least once (see [Messages](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#messages) in the root ARCHITECTURE.md). What a Message Handler answers decides what happens to the Message:

- Returning nothing acknowledges the Message.
- Throwing, or a Fault with `retryable: true`, leaves it unacknowledged, so the Durable consumer's configuration (ack wait, backoff, max deliveries), the organization's, decides when it comes again and what happens after the last attempt, and both reach `onServiceFault`; `deliveryCount` tells the Handler which attempt this is, and `lastAttempt` whether the Broker will not deliver it again, so the Handler may record the fact before it is dropped.
- A Message Handler's Fault, `MessageFault`, takes no `retryAfter`: the Durable consumer's configuration decides when the Message comes again.
- A Fault with `retryable: false` ends it (JetStream `term`): no redelivery, and it is logged.
- Returning anything else counts as a throw.

`headers` are the Transport headers the Message was published with (see [Publishing and sending](#publishing-and-sending)).

A Handler is waited for as long as the Broker waits for the Message's acknowledgement, its Delivery's wait (for JetStream, the Durable consumer's ack wait or that Delivery's backoff entry). Past it:

- its `signal` aborts;
- its Message is left for redelivery, and `onServiceFault` receives `thrown` with a `DeadlineError`, whose `waitMs` is the wait, as `cause`;
- the Handler's run goes on, its answer ignored, beside the redelivery.

`signal` also aborts when messaging starts closing, its reason a `MessagingClosedError`; a Handler that honors it, passing it to `fetch` or its database client, stops, and what it throws is reported as any throw, its `cause` the signal's reason. A Handler that runs longer than its Durable consumer's ack wait needs a longer `ackWait` in the organization's `limits`; see [A Handler's wait](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/ARCHITECTURE.md#a-handlers-wait).

Messages are validated with the generated Reader schemas (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md): another Service's Event with its Contract Package's, the Service's own with the readers file. `consume` reads each Message with the Reader of the pairing the Handler map's `readers` hold for its Subscription or Command's Message Version, which its Handler must be written for, and throws before it pulls from any, naming the key, when the map has no Handler there, holds one written for another pairing than its `readers` hold, or its `readers` lack the pairing, saying `run cf-loom generate`, or holds one written for another declaration, another copy of it, or a value `handle()` did not return, worded as `serve` words them (see [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README). `consume` types the map against the Contract, `HandlerMapOf<typeof contract>`, so a missing or misplaced Handler fails the build first, and requires the Resources its Handlers take, refusing those left unspecified or unreadable (see [Resources](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#resources) in the handlers README); its options are always given, `{}` when no Message Handler takes any. A Message that fails its schema, whose body is no UTF-8 JSON or is nested too deeply to read, never reaches the Handler: it is ended without redelivery and logged with its subject, its ids and the issues (see [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README for what a log carries); where it goes next is the organization's broker configuration.

## Adapters

An adapter is a `Broker` (see [Types](#types)), so an organization on another Broker may write its own, and obeys these obligations of its methods:

1. **`connect`** receives the Service's Stream and the subjects of the Messages it publishes and sends, unprefixed, and returns the connection `messaging` publishes, consumes and closes through. The core computes every subject, Stream and Durable consumer name unprefixed, and the adapter adds the Broker prefix.
2. **`publish`**, the connection's: an `OutgoingMessage`'s `messageId` is the id the Broker deduplicates by, and `publish` resolves to `{ duplicate }`, whether the Broker dropped the Message as one it already held.
3. **`consume`**, the connection's, and the consumers it receives:
   - each `BrokerConsumer`, `{ durable, stream, subject, receive }`, names its Durable consumer, and its `receive` runs its Handler and resolves to the `Settlement` the adapter applies, `'acked'`, `'ended'` (JetStream `term`), `'pending'`, left for redelivery, or `'handed-back'`, for redelivery now (JetStream `nak`), which the core answers only once `close`'s signal aborted;
   - each `Delivery` carries `waitMs`, how long the Broker waits for its acknowledgement, which the core waits for its Handler, or `undefined` when there is none to know;
   - `receive` resolves even when `onServiceFault` throws or rejects: the core logs that and answers `'pending'`;
   - `consume` receives the consumers and `{ closing, troubled }`: `closing` is a signal the core aborts the moment `close()` starts;
   - `consume` resolves once consuming has started and rejects having started nothing, and once `closing` aborts, or if it already has, it hands nothing more to `receive`, a Message still handed over being left pending by the core;
   - it calls `troubled` once when a consumer stops being pulled from, with the cause, and once when its pulls are answered again, and `troubled` returns at once, the core dropping what comes once `closing` has aborted.
4. **`close`**, the connection's, is called once nothing is in flight (Deliveries settling, `publish`, `send`, `consume` and trouble reports, which the core keeps, not the adapter), or once `close`'s signal aborted and each Delivery still settling was handed back, whatever else is in flight. It:
   - ends what `consume` started and finishes applying any Settlement;
   - ends the connection whatever happens, and rejects when it could not end it cleanly, which is what `close()` then rejects with.

The interface assumes JetStream semantics: the core refuses what NATS would not carry as given (the `Cf-Loom-` and `Nats-` header namespaces, the 65,535 bytes of broker headers), and relies on the Broker dropping a repeated `messageId` within its deduplication window and reporting it, on a delivery count per Message, on acknowledging, ending, leaving a Message for redelivery and handing it back as JetStream `ack`, `term`, no acknowledgement and `nak` do, and on a wait per Delivery after which the Broker delivers it again; an adapter for another Broker provides the same or documents what differs.

### JetStream

`jetstream({ connect, prefix, jetstream })` from `@cf-loom/messaging/jetstream` connects to NATS JetStream, as `src/main.ts` does in [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README.

#### Options

- The option `connect` is the Service's own function that opens a NATS connection, with the transport and authentication the Service chooses (`connect` from `@nats-io/transport-node`, for one); cf-loom calls it once for each `messaging()` and once for each `applyBrokerPlan`, and drains each connection it opened: a `messaging()`'s at `close`, an `applyBrokerPlan`'s when it ends.
- Its NATS packages, `@nats-io/jetstream` and `@nats-io/nats-core`, are optional peer dependencies (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md); keep every `@nats-io/*` package on one version, since `@nats-io/jetstream` pins `@nats-io/nats-core` exactly.
- `prefix` is in [Over the Broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) in the root ARCHITECTURE.md, and `jetstream` is nats.js's own JetStream options, a JetStream domain, an API prefix or a request timeout, which cf-loom hands to its JetStream client and manager unchanged, with no defaults of its own except `checkAPI: false` on the manager, so no `$JS.API.INFO` is requested.
- `applyBrokerPlan` (see [Applying the plan](#applying-the-plan)) takes `connect` and `jetstream` the same way, as a `JetStreamConnecting`, and no `prefix`: it reads it from the plan; it rejects with an error naming the Stream or Durable consumer it could not apply, with the client's error as `cause`, where `messaging()` rejects with it unchanged.
- `jetstream()` throws on a `prefix` that is not kebab-case of at most 64 characters, `''` included: leave it undefined for none.

#### At connect

- `messaging()` rejects with the error the Service's `connect` rejected with, or, once connected, when the Service's Stream does not exist, naming it, or does not hold every subject it publishes and sends, naming the Stream and each subject it does not hold, after draining that connection; any other error of that check, such as JetStream not enabled, rejects it unchanged, after the same drain. NATS decides whether a Stream holds a subject, so a Stream made with a wildcard holds it.

#### At publish

- Each Message is published with its broker headers and waits for the Broker's acknowledgement; a duplicate acknowledgement counts as sent and is reported as `duplicate`.

#### At close

- `close` drains the connection, and resolves when it is already closed, or waits for a drain the Service started.
- When NATS does not answer the drain, the connection is closed without it and `close` rejects with an `Error`, `NATS did not answer the drain, so the connection was closed without it`, nats.js's error as `cause` when it reported one:
  - a server gone, or one silent until the Service's own `pingInterval`, `maxPingOut` and `timeout` give up on it, nats.js rejecting the drain as it reconnects;
  - its reconnects exhausted;
  - the connection dropped while draining, which a Service that does not reconnect gets with no error.
- This holds after `close({ signal })` handed Deliveries back too; those come again after their ack wait.
- `close` resolves the moment the Service closes its connection itself, while either drain runs; a Service whose own drain rejected closes its connection itself, since nats.js leaves it draining, and `close` waits for that once NATS answers again.
- `applyBrokerPlan` rejects with that error when it applied everything; `applyBrokerPlan` on a failure and `messaging()` on a refusal close their connection the same way and keep their own error.

#### At consume

- `consume` asks NATS for the prefixed Durable consumer of each Subscription and Command Version whose Handler it pulls before it pulls from any, and rejects, pulling from none, with a line for each thing wrong, naming it:
  - a Durable consumer that does not exist, with the Stream it reads;
  - a Stream that does not exist, with the Durable consumer that reads it;
  - a Durable consumer that is not a pull consumer with explicit acknowledgements, filtered on its subject, delivering whole Messages and with no priority groups, with what differs.
- Any other error of that check, such as an unknown JetStream domain, rejects it unchanged. A `consume` that was rejected may be called again once the plan is applied (see [Applying the plan](#applying-the-plan)).
- Each Durable consumer hands its Handler one Message at a time, pulling the next only once the last is settled, so no Message waits in the Service. Each pull is a request for one Message on a subscription of its own that expires after 30 seconds, or after the Durable consumer's `max_expires` when that is shorter, read at `consume` like the waits.
- The Service's Durable consumers run side by side, and several processes of the Service pull from the same Durable consumer, its `maxAckPending` capping them all.
- A Message reaches its Handler as [Over the Broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) in the root ARCHITECTURE.md reads it back, with NATS's delivery count as `deliveryCount`; `lastAttempt` is true when the delivery count reaches the Durable consumer's `max_deliver`, read at `consume` like the waits, and with no limit it is never true.
- `acked` acknowledges a Message (JetStream `ack`), `ended` ends it (`term`), `pending` leaves it to NATS, and `handed-back` hands it back (`nak`).
- A Message without `Nats-Msg-Id` or `Cf-Loom-Fact-Id`, which cf-loom never publishes, is ended by the adapter itself with the reason `no <header> header`, which NATS's termination advisory carries, and nothing reaches `onServiceFault`; watching the advisories is the organization's.
- A Handler is waited for that Delivery's wait, its ack wait or, with a backoff, its entry for that Delivery, the last repeating; the waits are read from the Durable consumer at `consume`, so a changed ack wait or backoff reaches a running Service the next time it consumes.
- When `close()` starts, cf-loom drains the subscription of the pull that is open instead of dropping it, so a Message published meanwhile stays on its Durable consumer for the next consumer, and every Message the Broker had already sent arrives and is handed back (`nak`) for another process of the Service, none left to wait out its ack wait; `close({ signal })` hands back (`nak`) each Delivery still settling (its Handler running within its wait, or its `onServiceFault` in flight) once its signal aborts.
- A pull NATS answers with an error, as when a Durable consumer is deleted, or does not answer within twice its expiry, as when publishing on the pull's subject is not permitted, is tried again a second later; the first such failure and the first answer after it reach `onBrokerTrouble` (see [onBrokerTrouble](#onbrokertrouble)), so consuming resumes once the Durable consumer exists again and the Service hears of both.
- A connection that closes for good while consuming ends pulling, and each Durable consumer reports `pull-failed` once. A Durable consumer recreated in another shape is checked at the next `consume`.

#### NATS permissions

The Service's NATS permissions must allow the subjects of `messaging()` and `consume`, and the permissions of whoever applies the plan those of `applyBrokerPlan` (see [Applying the plan](#applying-the-plan)):

| Operation | NATS subjects | Needed by |
| --- | --- | --- |
| `messaging()` | `$JS.API.STREAM.NAMES`, requested for the check of the Service's Stream; the Service's prefixed subjects, which it publishes on and whose acknowledgements come back through the connection's inbox | The Service |
| `consume` | `$JS.API.CONSUMER.INFO` and `$JS.API.CONSUMER.MSG.NEXT` for each prefixed Stream and Durable consumer; the acknowledgement subjects `$JS.ACK.<stream>.<durable consumer>.>`, or `$JS.ACK.<domain>.<account hash>.<stream>.<durable consumer>.>` where NATS writes the longer form; a subscription on the connection's inbox for each pull | The Service |
| `applyBrokerPlan` | `$JS.API.STREAM.INFO`, `$JS.API.STREAM.CREATE`, `$JS.API.STREAM.UPDATE` and `$JS.API.STREAM.NAMES`, and `$JS.API.CONSUMER.INFO` and `$JS.API.CONSUMER.CREATE`, for the plan's names | Whoever applies the plan |

### In memory

`@cf-loom/messaging/memory` is a broker adapter that keeps everything in memory, for tests and local development:

```ts
import { messaging } from '@cf-loom/messaging';
import { memory } from '@cf-loom/messaging/memory';
import { contract } from '../src/contract/index.ts';
import handlers from '../src/handlers.generated.ts';
import createOrderHandler from '../src/endpoints/orders/create-order.handler.ts';

const broker = memory();
const running = await messaging(contract, broker);
const resources = { publisher: running.publisher, sender: running.sender };
await running.consume(handlers, { resources });

await createOrderHandler({ body: newOrder }, { apiKey: { callerId: 'c-1' } }, { resources });
await broker.settled();   // OrderCreated v1 and v2 published, ChargeCard v1 sent and handled
broker.messages;          // each with its subject, body, Fact id, Broker message id and Transport headers
broker.messagesOf(orderCreatedV1);   // those of one Message Version, each body typed by it

await broker.deliver(paymentSettledEventV1, body, { factId: 'pay-1' });
// → 'acked' | 'pending' | 'ended' | 'handed-back'

await running.close();
```

- **Delivery.** What the Service publishes or sends is delivered to the Message Handlers of its consumed Subscriptions and Commands, acknowledged or ended as `consume` does; an Event that two Subscriptions take reaches each, in the order `consume` was given them. A Message nothing consumes, because no Subscription takes the Event, its Handler is a Stub or it was published before `consume`, is only recorded.
- **Order.** Delivery is sequential, in publish order, which production never guarantees (see [Messages](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#messages) in the root ARCHITECTURE.md). `publish` and `send` resolve once the Message is recorded, before its Handlers run.
- **`messages` and `messagesOf(message)`.** `messages` lists every Message the Service published or sent, in the order the Broker took it, a duplicate the Broker dropped left out. `messagesOf(message)` lists those of one Message Version among them, in the same order, each body typed `BodyOf<typeof message>`, as its Message Version's writer writes it (what `publish` or `send` takes), so a test reads a body without a cast. It matches the Message Version by its declaration, among those the Service publishes and sends: before the Service connects it lists none; once connected it lists none yet for a version not yet published or sent, and throws, naming it, for any other declaration: a Retired version, a Command version that is not Active, a Provided Event, which another Service publishes, or a declaration outside the Contract, whatever its name and version.
- **`settled()`** waits until nothing is in flight, including Messages that Handlers publish or send while it waits. It rejects if a Handler threw or returned a Fault, a Message was ended, an `onServiceFault` threw or rejected or Deliveries were cut (see **The cut**) since the last `settled()`, so a failure cannot pass a test unnoticed. The error's message has one line per failure: the console's lines (see [onServiceFault](#onservicefault)), `<identity> <subject> <messageId> <factId> attempt <n>: onServiceFault threw` for an `onServiceFault` that threw or rejected, after the Fault's lines, and `a chain of Messages was cut after 1,000 deliveries` for a cut. Its `cause` is the first failure's `ConsumedFault`; a cut carries none. A failure is reported once.
- **The cut.** Deliveries are counted since nothing was last in flight, whether or not they form a chain, and the 1,001st is cut: a chain of Handlers that keep producing Messages, 1,001 concurrent `deliver`s and a `redeliver()` of 1,001 pending Messages alike. The Messages still waiting are never delivered: one the Service published or sent stays in `messages` and is not added to `pending`, one a `deliver` injected is in neither, and a pending one stays in `pending` at its `deliveryCount`; a `deliver` or `redeliver()` still waiting rejects with the cut's error.
- **`deliver(message, body, meta?)`** delivers one new Message now, as attempt 1, whatever was delivered before, so a test can deliver the same fact twice to check that a Handler is safe to run again. It takes an Event or a Command Message Version: an Event reaches every consumed Subscription to it, a Command its Message Handler, and it resolves to the most severe Settlement, `'ended'` before `'pending'` before `'handed-back'` before `'acked'`. It joins the line behind the Messages already lined up. Its body is typed `BodyOf<typeof message>`: as its Message Version's writer writes it, what `publish` or `send` takes for it, and a Provided Event's as its Reader reads it, with Unknown cases written `{ unknown: … }`; so an Unknown case of the Service's own Event is not delivered but tested through its Handler's direct call. It is written back through each consumer's Reader as a direct call's is (see [Testing a Service's own code](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#testing-a-services-own-code) in the handlers README): a body that breaks a Reader rejects with `InvalidInputError` at `body`, and nothing is delivered. `meta` is `{ factId?, messageId?, headers? }`: its ids default as a direct call's (see [Testing a Service's own code](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#testing-a-services-own-code) in the handlers README), a random Fact id and the Broker message id `<event|command>.<Name>.v<version>:<factId>`, and `headers` are the Transport headers the Handler receives, `{}` when left out. A Fact id or Transport header `publish` would refuse is refused as it refuses it, with `InvalidMessageError` (see [Publishing and sending](#publishing-and-sending)), and so is a Broker message id the Fact id's rule refuses, at `messageId`, or one that takes the Message's headers past what JetStream stores. Delivering a Message Version nothing consumes, because no Subscription takes the Event, its Handler is a Stub, it is Retired or `consume` was not called, rejects, naming it.
- **Redelivery.** The adapter never redelivers on its own: a Message whose Handler threw or returned a retryable Fault stays in `broker.pending`, listed for the Subscription or Command it is pending for, until `redeliver()` delivers every pending Message again, each to that consumer alone, as attempt `deliveryCount + 1`; acknowledged or ended, it leaves the list. A Message that fails again waits for the next `redeliver()`, and one that left the list meanwhile is skipped. `redeliver()` resolves once the Messages it lined up have settled, and `settled()` covers the Messages their Handlers publish; each call is its own pass, so two calls made together can deliver the same Message. A Message left pending while messaging closes is listed too, and so is a Message `close`'s signal handed back. After the connection is closed, `deliver` and `redeliver` reject. Each Message in `pending` is listed as `{ element, identity, subject, messageId, factId, deliveryCount, headers, body }`, `element` the Subscription or the Command's Message Version and `identity` its name, as in a `ConsumedFault`, its body the wire JSON, as in `messages`.
- **Duplicates.** A repeated Broker message id from `publish` or `send` is dropped and reported as a duplicate, neither recorded in `messages` nor delivered, for the adapter's whole lifetime.
- **Not a broker emulator.** It models nothing of the organization's broker configuration (deduplication window, redelivery limits, backoff, retention), so `lastAttempt` is always false and a Handler is waited for however long it runs; tests against a real Broker remain the organization's. One `memory()` serves one connection: a second `messaging()` through it rejects, even after the first is closed. It is `messaging()` that connects it: a `connect` handed anything but the `BrokerService` `messaging()` built, a copy of it included, rejects.

## The broker plan

`cf-loom broker-plan` (see [Commands](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/README.md#commands) in the CLI README) prints the desired state of one Service from its committed `contract.snapshot.json`, offline: the Service's Stream, which holds the subject of each of its Events' and Commands' Message Versions that are not Retired, and which a Service that publishes and sends nothing does not have; each Subscription's Durable consumer and the Stream it reads; and each Durable consumer of a Command Version that is not Retired (`orders-service_command_ChargeCard_v1`, which no Subscription's Durable consumer can collide with, its name in kebab-case holding no `_`). `--json` prints it as the `plan` of its one-line document (see [--json](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/README.md#--json) in the CLI README), in a fixed shape, shown here across lines, with names and subjects in code point order, so the organization's own tooling can read it; with a Broker prefix, every subject, Stream and Durable consumer name carries it, and `service`, a Service's name, never does:

```json
{
  "prefix": null,
  "streams": {
    "orders-service": { "service": "orders-service", "subjects": ["orders-service.command.ChargeCard.v1", "orders-service.event.OrderCreated.v1", "orders-service.event.OrderCreated.v2"] }
  },
  "consumers": {
    "orders-service_command_ChargeCard_v1": { "service": "orders-service", "stream": "orders-service", "subject": "orders-service.command.ChargeCard.v1" },
    "orders-service_notify-on-settled": { "service": "orders-service", "stream": "payments-service", "subject": "payments-service.event.PaymentSettled.v1" }
  }
}
```

## Applying the plan

Nothing applies it by default (see [Messages](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#messages) in the root ARCHITECTURE.md); the organization applies it with `applyBrokerPlan` from `@cf-loom/messaging/jetstream`, in a deploy step, or from its own infrastructure tooling. `applyBrokerPlan` is no part of `Broker` (see [Types](#types)): `messaging()` never applies anything.

```ts
import { connect } from '@nats-io/transport-node';
import { applyBrokerPlan } from '@cf-loom/messaging/jetstream';

const connecting = { connect: () => connect({ servers: process.env.NATS_URL }) };
await applyBrokerPlan(connecting, plan, limits);   // creates and updates, never removes
```

`plan` is the JSON above, the `plan` of the document `cf-loom broker-plan --json` prints; `applyBrokerPlan` refuses one of another shape, and creates every name as the plan prints it, under the plan's `prefix`, the one `cf-loom broker-plan --prefix` was given and the Service's `jetstream({ prefix })` must be given too. `limits` holds every setting cf-loom has no opinion on, keyed by the names the plan prints: for each Stream `retention` (`limits`, `interest` or `workqueue`), `maxAge`, `duplicateWindow`, `replicas` and `storage` (`file` or `memory`); for each Durable consumer `deliverPolicy` (`all`, `new`, `last` or `last_per_subject`), `ackWait`, `maxDeliver` and `maxAckPending`; `streamDefaults` and `consumerDefaults` fill in whatever a Stream or Durable consumer does not set. A duration is a whole number from 1 and one unit, `ms`, `s`, `m`, `h` or `d` (`500ms`, `30s`, `2m`, `7d`), one NATS can hold exactly: its nanoseconds fit 64 bits and a JavaScript number, so `365d` is fine and `106752d` is not; `maxAge`, `maxDeliver` and `maxAckPending` also take `'unlimited'`; `replicas`, `maxDeliver` and `maxAckPending` are otherwise whole numbers from 1. `ackWait` is one duration, or one for each Delivery, the last repeating, which NATS calls a backoff. An `undefined` value for one of these settings, or an `undefined` entry for a Stream or Durable consumer, means the same as leaving it out. Before it connects, `applyBrokerPlan` refuses a setting left unset, a setting `limits` does not have, a Stream or Durable consumer name the plan does not list, and a value that is none of these, naming each, so it creates and changes nothing. For example:

```ts
await applyBrokerPlan(connecting, plan, {
  streamDefaults:   { retention: 'limits', maxAge: '7d', duplicateWindow: '2m', replicas: 3, storage: 'file' },
  consumerDefaults: { deliverPolicy: 'all', ackWait: ['30s', '1m', '5m'], maxDeliver: 5, maxAckPending: 100 },
  streams:   { 'orders-service': { replicas: 1 } },
  consumers: { 'orders-service_notify-on-settled': { ackWait: '2m' } },
});
```

`applyBrokerPlan` only creates Streams and Durable consumers, adds subjects and updates limits; it never removes anything, so applying a newer plan never takes away what an older Release still running consumes: applying is safe before the new Release deploys and while the old one runs. A Stream gets each subject of the plan it does not hold yet, NATS deciding as for `messaging()`'s check, so a Stream made with a wildcard gets none; a Durable consumer is a pull consumer with explicit acknowledgements, filtered on the plan's subject, that delivers whole Messages and has no priority groups, its filter set through `filter_subject`, so one filtered through `filter_subjects` is changed to it; on a Stream or Durable consumer that exists, a NATS setting `limits` has no name for, such as `max_bytes`, stays as it is. `applyBrokerPlan` creates the plan's Streams before its Durable consumers, each in the plan's order, and stops at the first it cannot apply, keeping what it created or updated: a Durable consumer whose Stream does not exist yet, naming the Stream, or one NATS refuses, such as a Stream whose storage or a Durable consumer whose deliver policy or ack policy would change, or a push consumer that would become a pull consumer, which NATS never does, naming the Stream or Durable consumer, with NATS's error as `cause`; a Provider's plan is applied before its Subscribers', and when two Services subscribe to each other's Events, applying the first again after the second completes it. A Release fails fast when the plan was not applied: `messaging()` checks that the Service's Stream exists and holds every subject it publishes or sends, and a Service that publishes and sends nothing has none to check, `consume` that the Durable consumer of every Subscription and Command Version whose Handler it pulls exists, as a pull consumer with explicit acknowledgements, filtered on its subject, that delivers whole Messages and has no priority groups, and each fails with an error naming what is missing. `applyBrokerPlan` opens its own connection and drains it when it ends; the NATS subjects it uses, which the NATS permissions of whoever applies it must allow, are in [NATS permissions](#nats-permissions).

## Leftover Durable consumers

cf-loom never removes a Durable consumer. A Broker prefix holds no `_` (see [Over the Broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) in the root ARCHITECTURE.md), so `<prefix>_<service>_` names one Service of one environment; on a Broker where one Service runs with a Broker prefix, every Service runs with one, or a Service named as a Broker prefix would read that environment's Durable consumers as its own. A Service's Durable consumers are all named `[<prefix>_]<service>_…`, on its own Stream or on its Providers' (see [The broker plan](#the-broker-plan)), so those a removed Subscription or a Retired Command Version left behind are the ones under that name that the Service's plan does not list. The organization finds and deletes them with its own tooling, once no running Release consumes them and, for a Command Version, once its Durable consumer is drained (see the deploy rule in [Messages](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#messages) in the root ARCHITECTURE.md). Rolling back to a Release that consumed a deleted one needs that Release's plan applied again.

## Types

- `Messaging`, `{ publisher, sender, consume, close }`: one connection's messaging, what `messaging()` resolves to; `close` takes `CloseOptions`, `{ signal? }`.
- `MessagingOptions`, `{ onServiceFault?, onBrokerTrouble? }`: what is operational about messaging and no part of the Contract.
- `ConsumeOptions<Resources>`, `{ resources }`: what `consume` takes, always given, besides the Handler map: the Resources its Message Handlers take, required exactly when some Message Handler takes any.
- `EventPublisher` and `CommandSender`: `publish` and `send`, typed by the Contract's Events and Commands, each body typed by its Message Version, `BodyOf<typeof orderCreatedV2>` for that one (see [Types](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#types) in the contract README).
- `MessageOptions`, `{ factId, headers? }`: what a `publish` or `send` call carries besides its bodies.
- `Published`, `{ factId, duplicates }`, and `Sent`, `{ factId, duplicate }`: what `publish` and `send` resolve to.
- `ConsumedFault`: what `onServiceFault` receives, with `element`, the Subscription or the Command's Message Version, `identity`, its name, and the Delivery's `deliveryCount` and `lastAttempt`: `invalid-body`, `returned` or `thrown`.
- `BrokerTrouble`: what `onBrokerTrouble` receives, with `element`, `identity`, and the unprefixed `durable` and `stream`: `pull-failed` with its `cause`, or `recovered`.
- `InvalidMessageError`, with `invalid`, its `InvalidPart`s, `body` with a version's `identity` and `issues`, `id` with `at`, `header` with its `name` and `fit`, and `too-large` with a version's `identity` and `bytes`: what `publish` and `send` reject with when the call breaks a rule, and `deliver` for a refused id, header or header bytes.
- `MessageNotSentError`, with `factId` and `sent`: what `publish` and `send` reject with when the Broker failed.
- `MessagingClosedError`: what `publish`, `send` and `consume` reject with once messaging is closed, and `consume` while it is closing; the reason of a Handler's `signal` once messaging starts closing.
- `CloseAbortedError`, with `handedBack`, each `{ identity, subject, messageId, factId }`: what `close` rejects with when its signal aborted while Deliveries were still settling, its `cause` the signal's reason.
- `DeadlineError`, with `waitMs`: the `cause` of the `thrown` fault of a Handler that ran past its Delivery's wait, and the reason its `signal` aborted.
- `Broker`, `{ connect }`: what `messaging()` connects through, an adapter's or the organization's own; `BrokerService`, `{ stream, subjects }`, what it tells the Broker: the Service's Stream and the subjects of the Messages it publishes and sends, unprefixed.
- `BrokerConnection`, `{ publish, consume, close }`: one connection to a Broker; `publish` resolves to a `BrokerAck`, `{ duplicate }`; `consume` takes the consumers and a `ConsumeRun`, `{ closing, troubled }`: the signal the core aborts when `close()` starts, and where the adapter reports a `ConsumerTrouble`, `{ consumer, kind }`, `pull-failed` with its `cause` or `recovered` (see [Adapters](#adapters)). `close` ends the connection whatever happens.
- `OutgoingMessage`, `{ subject, messageId, factId, headers, body }`: a Message as it leaves, its body the UTF-8 JSON bytes.
- `BrokerConsumer`, `{ durable, stream, subject, receive }`: the Durable consumer of a Subscription or Command Version whose Handler is pulled, and `receive`, which runs that Handler.
- `Delivery`, `{ messageId, factId, deliveryCount, lastAttempt, waitMs, headers, body }`: one Message as an adapter hands it to `receive`.
- `Settlement`, `'acked'`, `'pending'`, `'ended'` or `'handed-back'`: what the adapter does with a Delivery.
- `MemoryBroker`, `{ connect, settled, messages, messagesOf, deliver, redeliver, pending }`: what `memory()` returns, a `Broker` a test drives and watches.
- `RecordedMessage<M>`, `{ subject, messageId, factId, headers, body }`: a Message as the in-memory Broker took it, its body parsed from its JSON and typed `BodyOf<M>`, as the writer of the Message Version `M` writes it; `messages` lists `RecordedMessage` without `M`, its body `unknown`.
- `DeliveryMeta`, `{ factId?, messageId?, headers? }`: what `deliver` may set.
- `PendingMessage`, `{ element, identity, subject, messageId, factId, deliveryCount, headers, body }`: a Message a consumer left unacknowledged, its body the wire JSON.
- `JetStreamConnecting`, `{ connect, jetstream? }`: how a NATS connection is opened, the Service's own function that opens it and the options of nats.js's JetStream client.
- `JetStreamBrokerOptions`, `{ connect, prefix?, jetstream? }`: what `jetstream()` takes, a `JetStreamConnecting` and the Broker prefix, and what it returns is a `Broker`.
- `BrokerPlan`, `{ prefix, streams, consumers }`, with `BrokerPlanStream`, `{ service, subjects }`, and `BrokerPlanConsumer`, `{ service, stream, subject }`: the `plan` of the document `cf-loom broker-plan --json` prints.
- `BrokerLimits`, `{ streamDefaults?, consumerDefaults?, streams?, consumers? }`, with `StreamLimits`, `{ retention, maxAge, duplicateWindow, replicas, storage }`, `DurableConsumerLimits`, `{ deliverPolicy, ackWait, maxDeliver, maxAckPending }`, and `Duration`: what `applyBrokerPlan` takes besides the plan.
