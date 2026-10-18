# cf-loom

Organization-agnostic tooling for service Contracts: HTTP Endpoints and messaging, written in TypeScript with zod. This repository holds the tools, and in `examples/` fictional Services used as end-to-end tests; never a real Service's Contract.

Terms are defined in [CONTEXT.md](CONTEXT.md), the glossary. The rules for changing a Contract are in [COMPATIBILITY.md](COMPATIBILITY.md), how the pieces fit in [ARCHITECTURE.md](ARCHITECTURE.md), and the Snapshot format in [SNAPSHOT.md](SNAPSHOT.md). How each package is used is in its README, below.

## Packages

| Package | Used by | Provides |
| --- | --- | --- |
| [`@casitafeliz/loom-contract`](packages/contract/README.md) | Services, Applications, Definitions Packages | Declarations: `defineContract`, `defineApplication`, `defineDefinitions`, `defineGroup`, `defineEndpoint`, `defineGuard`, `defineRejection`, `defineEvent`, `defineCommand`, `defineSubscription`, `defineDependencies`, `openEnum`, `openUnion`; the Standard Rejections `invalidInput`, `notFound`, `notImplemented` |
| [`@casitafeliz/loom-handlers`](packages/handlers/README.md) | Services | `handle`, `handle.stub`, `success`, `reject`, `admit`, `fault`, `isRejectionOf`; the `Outcome`, `Admission` and Handler types (`EndpointHandler`, `GuardHandler`, `CommandHandler`, `EventHandler`); `InvalidInputError` and `InvalidOutcomeError`, which a direct call throws |
| [`@casitafeliz/loom-server`](packages/server/README.md) | Services with Endpoints | `serve` |
| [`@casitafeliz/loom-server/node-http`](packages/server/README.md#node-http) | Services on `node:http` | Adapter |
| [`@casitafeliz/loom-client`](packages/client/README.md) | Callers | `client`; the `Client<D, Configured>` type |
| [`@casitafeliz/loom-messaging`](packages/messaging/README.md) | Services with Messages | `messaging`: EventPublisher, CommandSender, `consume` for Subscriptions and Commands, `connect`, `close` |
| [`@casitafeliz/loom-messaging/jetstream`](packages/messaging/README.md#jetstream) | Services on NATS JetStream | Adapter; `@nats-io/*` is an optional peer dependency |
| [`@casitafeliz/loom-messaging/memory`](packages/messaging/README.md#in-memory) | Tests and local development | In-memory adapter |
| [`@casitafeliz/loom-testing`](packages/testing/README.md) | Tests of Consumers | `fakeProvider`, `fakeEvent` |
| [`@casitafeliz/loom-cli`](packages/cli/README.md) | Everyone | The `cf-loom` command; `defineConfig`; Contract directories under `@casitafeliz/loom-cli/directories` |

How the packages relate to each other is in [Packages](ARCHITECTURE.md#packages) in ARCHITECTURE.md.

## A first Service

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
│   ├── events/
│   │   ├── order-created.v1.event.ts
│   │   └── order-created.v2.event.ts
│   ├── commands/
│   │   └── charge-card.v1.command.ts
│   ├── subscriptions/
│   │   └── notify-on-settled.subscription.ts
│   └── dependencies/
│       └── payments-service.dependencies.ts
├── endpoints/orders/get-order.handler.ts  Handlers mirror contract/
├── guards/api-key.handler.ts
├── commands/charge-card.v1.handler.ts
├── subscriptions/notify-on-settled.handler.ts
├── handlers.generated.ts                  regenerated, never edited
├── readers.generated.ts                   Reader schemas and types of the Service's own Events; regenerated, never edited
├── messaging.ts                           EventPublisher, CommandSender
└── main.ts                                starts HTTP and messaging
contract-package/                          the Contract Package cf-loom package writes; built, not edited
```

File names are kebab-case: the Guard `apiKey` lives in `api-key.guard.ts` and its Handler in `api-key.handler.ts`. Files under `src/contract/` import only each other, `zod`, `@casitafeliz/loom-contract`, Definitions Packages and the Contract Packages listed as Dependencies (see [Where Contracts live](ARCHITECTURE.md#where-contracts-live)).

The examples in the package READMEs follow this layout and leave out imports of `zod`, `@casitafeliz/loom-contract` and sibling files.

### Declare

`cf-loom init service` creates the root under `src/contract/`, and `cf-loom add-endpoint`, `add-guard`, `add-rejection`, `add-event`, `add-command`, `add-subscription` and `add-dependency` create each declaration (see [Commands](packages/cli/README.md#commands)). What each declaration holds is in the [`@casitafeliz/loom-contract` README](packages/contract/README.md); the tools are configured in `cf-loom.config.ts` (see [Configuration](packages/cli/README.md#configuration)).

### Generate

`cf-loom generate` writes the stub of every missing Handler, regenerates `handlers.generated.ts` and `readers.generated.ts`, and writes `contract.snapshot.json` (see [Stubs and the Handler map](packages/handlers/README.md#stubs-and-the-handler-map) and [Where it lives](SNAPSHOT.md#where-it-lives) in SNAPSHOT.md).

### Implement

Replace each stub with `handle(element, async (…) => …)`: an [EndpointHandler](packages/handlers/README.md#endpointhandler) or a [GuardHandler](packages/handlers/README.md#guardhandler) with `@casitafeliz/loom-handlers`, a [Message Handler](packages/messaging/README.md#message-handlers) the same way. The EventPublisher and CommandSender come from `messaging(contract)` (see [Connecting](packages/messaging/README.md#connecting)), and another Service is called through its Contract Package with `client` (see [Consuming a Contract](packages/client/README.md#consuming-a-contract)).

### Serve

`src/main.ts` connects the broker adapter, serves the Contract with `serve` through the `node:http` adapter and consumes its Messages (see [Serving](packages/server/README.md#serving)).

### Test

A Handler is called directly (see [Testing a Service's own code](packages/handlers/README.md#testing-a-services-own-code)), Messages run through the [in-memory adapter](packages/messaging/README.md#in-memory), and the Providers a Service depends on are faked with `@casitafeliz/loom-testing` (see [Faking Providers](packages/testing/README.md#faking-providers)).

### Publish

`cf-loom package` writes the Contract Package to `contract-package/`, to build and try it before publishing (see [Commands](packages/cli/README.md#commands)). `cf-loom check` runs the Compatibility Check against the Baseline, and `cf-loom publish` publishes the Contract Package when the Release implementing it is deployed, a Release whose Handlers are stubs included (see [The Compatibility Check](COMPATIBILITY.md#the-compatibility-check) in COMPATIBILITY.md).
