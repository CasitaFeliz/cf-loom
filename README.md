# cf-loom

Organization-agnostic tooling for service Contracts: HTTP Endpoints and messaging, written in TypeScript with zod. This repository holds the tools, and in `examples/` fictional Services and the Definitions Package they share, used as end-to-end tests; never a real Service's Contract.

Terms are defined in [CONTEXT.md](CONTEXT.md), the glossary. The rules for changing a Contract are in [COMPATIBILITY.md](COMPATIBILITY.md), how the pieces fit in [ARCHITECTURE.md](ARCHITECTURE.md), and the Snapshot format in [SNAPSHOT.md](SNAPSHOT.md). How each package is used is in its README, below.

## Packages

| Package | Used by | Provides |
| --- | --- | --- |
| [`@cf-loom/contract`](packages/contract/README.md) | Services, Applications, Definitions Packages | Declarations: `defineContract`, `defineApplication`, `defineDefinitions`, `defineGroup`, `defineEndpoint`, `defineGuard`, `defineRejection`, `defineEvent`, `defineCommand`, `defineSubscription`, `defineDependencies`, `openEnum`; `openEnumReader`, which generated readers call; the Standard Rejections `invalidInput`, `notFound`, `notImplemented` |
| [`@cf-loom/handlers`](packages/handlers/README.md) | Services | `handle`, `handle.stub`, `withReader`, `success`, `reject`, `admit`, `fault`, `isRejectionOf`; the `Outcome`, `Admission` and Handler types (`EndpointHandler`, `GuardHandler`, `CommandHandler`, `EventHandler`), `WithReader`, `CommandImplementation`, `EventImplementation` and `MessageMeta`; `WithResources`, `ResourcesOf`, and `DirectCall`, `GuardCall` and `MessageCall`, the last argument of a direct call; `InvalidInputError` and `InvalidOutcomeError`, which a direct call throws; the `HandlerMap` type |
| [`@cf-loom/server`](packages/server/README.md) | Services with Endpoints | `serve`; the `Http`, `ServeOptions`, `ServedFault` and `AnsweredRequest` types |
| [`@cf-loom/server/node-http`](packages/server/README.md#node-http) | Services on `node:http` | Adapter: `nodeHttp`, `nodeListener` |
| [`@cf-loom/client`](packages/client/README.md) | Callers | `client`; the `Client<D, Configured>` type, `ClientOptions`, `CallInput`, the `ReceivedOutcome` it returns and the types of `inferFault` and `onDeprecation` |
| [`@cf-loom/messaging`](packages/messaging/README.md) | Services with Messages | `messaging`, connecting a Contract's messaging through a Broker: EventPublisher, CommandSender, `consume` for Subscriptions and Commands, `close`; `PublishError`, `InvalidMessageError`; and its types, `ConsumeOptions` and the `Broker` an adapter implements among them |
| [`@cf-loom/messaging/jetstream`](packages/messaging/README.md#jetstream) | Services on NATS JetStream | Adapter: `jetstream`, whose `apply` applies a broker plan; the `JetStreamBrokerOptions`, `JetStreamBroker`, `BrokerPlan`, `BrokerPlanStream`, `BrokerPlanConsumer`, `BrokerLimits`, `StreamLimits`, `DurableConsumerLimits` and `Duration` types; `@nats-io/jetstream` and `@nats-io/nats-core` are optional peer dependencies |
| [`@cf-loom/messaging/memory`](packages/messaging/README.md#in-memory) | Tests and local development | In-memory adapter: `memory`; the `MemoryBroker`, `RecordedMessage`, `DeliveryMeta` and `PendingMessage` types |
| [`@cf-loom/testing`](packages/testing/README.md) | Tests of Consumers | `fakeProvider` and `FakeProviderError`; the `FakeProvider`, `Script`, `StepBuilder` and `FakeCall` types; `fakeEvent` |
| [`@cf-loom/cli`](packages/cli/README.md) | Everyone | The `cf-loom` command; `defineConfig` |

How the packages relate to each other is in [Packages](ARCHITECTURE.md#packages) in ARCHITECTURE.md.

## A first Service

Two fictional Services in `examples/` follow these steps, from their declarations to `cf-loom package`, and their tests run with cf-loom's own: [`orders-service`](examples/orders-service), a Provider with a Guard, Rejections, an Open Enum and a Private Endpoint, which publishes the Internal Event `OrderCreated`, handles it through a Subscription of its own and sends the Command `ChargeCard`; and [`billing-service`](examples/billing-service), a Service with one Endpoint and one Subscription that depends on orders-service through its generated Contract Package, calls it with `client`, receives its `OrderCreated`, and fakes it in its tests with `fakeProvider` and `fakeEvent`. Both run their Messages over NATS JetStream in `main.ts`, which reads `NATS_URL` and `BROKER_PREFIX`, and through the in-memory adapter in their tests; billing's `over-nats.test.ts` applies the plans `cf-loom broker-plan --json` prints, orders' first, to a nats-server of its own, starts both `main.ts` and places an order over HTTP, which billing's Subscription and orders' CommandHandler for `ChargeCard` handle.

### Layout

```
src/
├── contract/                              declarations only
│   ├── index.ts                           export const contract = defineContract({...})
│   ├── endpoints/
│   │   └── orders/
│   │       ├── orders.group.ts
│   │       ├── get-order.endpoint.ts
│   │       └── create-order.endpoint.ts
│   ├── guards/
│   │   └── api-key.guard.ts
│   ├── rejections/
│   │   └── order-locked.rejection.ts
│   ├── schemas/                           zod schemas the declarations share
│   │   └── order.schema.ts
│   ├── events/
│   │   ├── order-created.v1.event.ts
│   │   └── order-created.v2.event.ts
│   ├── commands/
│   │   └── charge-card.v1.command.ts
│   ├── subscriptions/
│   │   └── notify-on-settled.subscription.ts
│   └── dependencies/
│       └── payments-service.dependencies.ts
├── endpoints/orders/get-order.handler.ts  Handlers by Group and name (see Stubs and the Handler map)
├── guards/api-key.handler.ts
├── commands/charge-card.v1.handler.ts
├── subscriptions/notify-on-settled.handler.ts
├── handlers.generated.ts                  regenerated, never edited
├── readers.generated.ts                   Reader schemas and types of the Service's own Events and Commands, and each Command's Message Version and Subscription paired with its Reader; regenerated, never edited
├── resources.ts                           the Service's Resources type and `Needs`
└── main.ts                                starts messaging, builds the Resources, serves HTTP and consumes
.cf-loom/
└── contract-package/                      the Contract Package cf-loom package writes; built, never edited
```

File names are kebab-case: the Guard `apiKey` lives in `api-key.guard.ts` and its Handler in `api-key.handler.ts`. Files under `src/contract/` import only each other, `zod`, `@cf-loom/contract`, Definitions Packages and the Contract Packages listed as Dependencies (see [Where Contracts live](ARCHITECTURE.md#where-contracts-live)).

A Definitions Package is laid out the same way under `src/definitions/`: its root `index.ts` exports `definitions` and every declaration Services import, from `guards/`, `rejections/` and `schemas/` beside it (see [Definitions Packages](packages/contract/README.md#definitions-packages) in the contract README). [`org-definitions`](examples/org-definitions) is the one both example Services list.

The examples in the package READMEs follow this layout and leave out imports of `zod`, `@cf-loom/contract` and sibling files.

### Declare

`cf-loom init service` creates the root under `src/contract/`, and `cf-loom add-endpoint`, `add-guard`, `add-rejection`, `add-event`, `add-command`, `add-subscription` and `add-dependency` create each declaration (see [Commands](packages/cli/README.md#commands)). What each declaration holds is in the [`@cf-loom/contract` README](packages/contract/README.md); the tools are configured in `cf-loom.config.ts` (see [Configuration](packages/cli/README.md#configuration)).

### Generate

`cf-loom generate` writes the stub of every missing Handler, regenerates `handlers.generated.ts` and `readers.generated.ts`, and writes `contract.snapshot.json` (see [Stubs and the Handler map](packages/handlers/README.md#stubs-and-the-handler-map) and [Where it lives](SNAPSHOT.md#where-it-lives) in SNAPSHOT.md).

### Implement

Replace each stub with `handle(…, async (…) => …)`: an [EndpointHandler](packages/handlers/README.md#endpointhandler) or a [GuardHandler](packages/handlers/README.md#guardhandler) with `@cf-loom/handlers`, taking its Endpoint or Guard; a [Message Handler](packages/messaging/README.md#message-handlers) the same way, taking the pairing its stub imports from `readers.generated.ts` (`handle(chargeCardV1, …)`). What a Handler reaches outside the Contract, its EventPublisher and CommandSender (see [Connecting](packages/messaging/README.md#connecting)), a client of another Service built with `client` from its Contract Package (see [Consuming a Contract](packages/client/README.md#consuming-a-contract)) or its database, it takes as Resources, which `src/main.ts` builds and hands `serve` and `consume` (see [Resources](packages/handlers/README.md#resources)).

### Serve

`src/main.ts` connects messaging with the broker adapter, builds the Resources, serves the Contract with `serve` through the `node:http` adapter and consumes its Messages (see [Serving](packages/server/README.md#serving)).

### Test

A Handler is called directly, with the Resources the test builds (see [Testing a Service's own code](packages/handlers/README.md#testing-a-services-own-code)), Messages run through the [in-memory adapter](packages/messaging/README.md#in-memory), and the Providers a Service depends on are faked with `@cf-loom/testing` (see [Faking Providers](packages/testing/README.md#faking-providers)).

### Publish

`cf-loom package` writes the Contract Package to `.cf-loom/contract-package/`, to build and try it before publishing (see [Commands](packages/cli/README.md#commands)). `cf-loom check` runs the Compatibility Check against the Baseline, and `cf-loom publish` publishes the Contract Package when the Release implementing it is deployed, a Release whose Handlers are stubs included (see [The Compatibility Check](COMPATIBILITY.md#the-compatibility-check) in COMPATIBILITY.md).
