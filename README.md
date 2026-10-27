# cf-loom

Organization-agnostic tooling for service Contracts: HTTP Endpoints and messaging, written in TypeScript with zod. This repository holds the tools, and in `examples/` fictional Services and the Definitions Package they share, used as end-to-end tests; never a real Service's Contract.

Terms are defined in [CONTEXT.md](CONTEXT.md), the glossary. The rules for changing a Contract are in [COMPATIBILITY.md](COMPATIBILITY.md), how the pieces fit in [ARCHITECTURE.md](ARCHITECTURE.md), and the Snapshot format in [SNAPSHOT.md](SNAPSHOT.md). How each package is used is in its README, below.

## Packages

| Package | Used by | For |
| --- | --- | --- |
| [`@cf-loom/contract`](packages/contract/README.md) | Services, Applications, Definitions Packages | Declaring a Service's or an Application's Contract, or a Definitions Package |
| [`@cf-loom/handlers`](packages/handlers/README.md) | Services | Implementing a Contract's Endpoints, Guards, Commands and Subscriptions, and calling the Handlers directly in tests |
| [`@cf-loom/server`](packages/server/README.md) | Services with Endpoints | Answering a Contract's Endpoints over HTTP with their Handlers |
| [`@cf-loom/server/node-http`](packages/server/README.md#node-http) | Services on `node:http` | The server's adapter for `node:http` |
| [`@cf-loom/client`](packages/client/README.md) | Services and Applications (Callers) | Calling another Service's Endpoints through its Contract Package, in Node or in a browser |
| [`@cf-loom/messaging`](packages/messaging/README.md) | Services with Messages | Connecting a Contract's messaging through a Broker: publishing Events, sending Commands and consuming both |
| [`@cf-loom/messaging/jetstream`](packages/messaging/README.md#jetstream) | Services on NATS JetStream | The Broker adapter for NATS JetStream, which also applies a broker plan |
| [`@cf-loom/messaging/memory`](packages/messaging/README.md#in-memory) | Tests | Messaging in memory, for tests |
| [`@cf-loom/testing`](packages/testing/README.md) | Tests of Consumers | Faking the Providers a Consumer depends on |
| [`@cf-loom/cli`](packages/cli/README.md) | Everyone | The `cf-loom` command and its configuration |

Each package's README lists what it exports. How the packages relate to each other is in [Packages](ARCHITECTURE.md#packages) in ARCHITECTURE.md.

## A first Service

Two fictional Services in `examples/` follow these steps, from their declarations to `cf-loom package`, and their tests run with cf-loom's own: [`orders-service`](examples/orders-service), a Provider with a Guard, Rejections, an Open Enum and a Private Endpoint, which publishes the Internal Event `OrderCreated`, handles it through a Subscription of its own and sends the Command `ChargeCard`; and [`billing-service`](examples/billing-service), a Service with one Endpoint and one Subscription, whose Handlers sit with its own code in its Group's folder, `src/billing/`, and its generated files in `src/generated/` through `layout`, that depends on orders-service through its generated Contract Package, calls it with `client`, receives its `OrderCreated`, and fakes it in its tests with `fakeProvider`. Both run their Messages over NATS JetStream in `main.ts`, which reads `NATS_URL` and `BROKER_PREFIX`, and through `memory()` in their tests; billing's `over-nats.test.ts` applies the plans `cf-loom broker-plan --json` prints, orders' first, to a nats-server of its own, starts both `main.ts` and places an order over HTTP, which billing's Subscription and orders' Message Handler for `ChargeCard` handle.

### Layout

```
src/
├── contract/                              declarations only
│   ├── index.ts                           export const contract = defineService({...})
│   ├── groups/
│   │   └── orders.group.ts                what the Group orders lists
│   ├── endpoints/                         each Element's file under its kind, then its Group
│   │   └── orders/
│   │       ├── get-order.endpoint.ts
│   │       └── create-order.endpoint.ts
│   ├── guards/
│   │   └── api-key.guard.ts
│   ├── rejections/
│   │   └── order-locked.rejection.ts
│   ├── schemas/                           zod schemas the declarations share
│   │   └── order.schema.ts
│   ├── events/
│   │   └── orders/
│   │       ├── order-created.v1.event.ts
│   │       └── order-created.v2.event.ts
│   ├── commands/
│   │   └── orders/
│   │       └── charge-card.v1.command.ts
│   ├── subscriptions/
│   │   └── orders/
│   │       └── notify-on-settled.subscription.ts
│   └── dependencies/
│       └── payments-service.dependency.ts
├── endpoints/orders/get-order.handler.ts  Handlers by Group and name, by default (see Stubs and the Handler map)
├── guards/api-key.handler.ts
├── commands/orders/charge-card.v1.handler.ts
├── subscriptions/orders/notify-on-settled.handler.ts
├── handlers.generated.ts                  the Handler map, carrying the `readers`; regenerated, never edited
├── readers.generated.ts                   the readers: Reader schemas of the Service's own Events and Commands, with the type of each recursive def, and in `readers` each Command's Message Version and Subscription paired with its Reader; regenerated, never edited
├── resources.ts                           the Service's Resources type and `Needs`
└── main.ts                                starts messaging, builds the Resources, serves HTTP and consumes
.cf-loom/
└── contract-package/                      the Contract Package cf-loom package writes; built, never edited
cf-loom.config.ts                          optional: where the Handlers and the generated files sit
contract.snapshot.json                     the declared Snapshot generate writes; committed, never edited
```

The Handlers and the two generated files sit where the tree shows by default; a Service places them elsewhere with `layout` in an optional `cf-loom.config.ts` (see [The layout field](packages/cli/README.md#the-layout-field)), as billing-service does. `contract.snapshot.json` is committed, so every change to the Contract shows in review, and `.cf-loom/` holds only output. File names are kebab-case: the Guard `apiKey` lives in `api-key.guard.ts` and its Handler in `api-key.handler.ts`. Files under `src/contract/` should import only each other, `zod`, `@cf-loom/contract`, Definitions Packages and the Contract Packages whose Elements it uses, so the Contract builds and publishes on its own; a Contract file that imports the Service's code runs that code on every cf-loom command (see [Where Contracts live](ARCHITECTURE.md#where-contracts-live)).

A Definitions Package is laid out the same way under `src/definitions/`: its Root `index.ts` exports its Definitions object (`init` names it `definitions`) and every Guard, Rejection and schema Services import, and nothing else, from `guards/`, `rejections/` and `schemas/` beside it (see [Definitions Packages](packages/contract/README.md#definitions-packages) in the contract README). [`org-definitions`](examples/org-definitions) is the one both example Services import.

The examples in the package READMEs follow this layout and leave out imports of `zod`, `@cf-loom/contract` and sibling files.

### Set up

A Service, an Application and a Definitions Package are each a package of their own, whose `package.json` has:

- `"type": "module"`: every `cf-loom` command but `--help`, `help` and `--version` exits 3 without it, since the CLI loads the Contract's files and `cf-loom.config.ts` as ES modules (see [Where Contracts live](ARCHITECTURE.md#where-contracts-live));
- a `name`, usually scoped, such as `@org/orders-service`: the Contract of a Service or an Application is named after it without the scope, and that name must be kebab-case of at most 64 characters, and its Contract Package is `@org/contract-orders-service`;
- `"engines": { "node": ">=24" }`, the Node every cf-loom package requires.

`zod` and `@cf-loom/contract` are peers of every cf-loom package, and so is each cf-loom package another one uses, so install every one of these that applies:

| For | Install |
| --- | --- |
| Every package | `@cf-loom/contract` and `zod`; `@cf-loom/cli` as a devDependency |
| A Service or a Definitions Package | `typescript` as a devDependency |
| A Service | `@types/node` as a devDependency |
| Endpoints | `@cf-loom/handlers` and `@cf-loom/server` |
| Messages | `@cf-loom/handlers` and `@cf-loom/messaging`; on JetStream also `@nats-io/jetstream`, `@nats-io/nats-core` and a transport such as `@nats-io/transport-node`, all on one version (see [JetStream](packages/messaging/README.md#jetstream)) |
| Subscribing to another Service's Event | `@cf-loom/handlers` and `@cf-loom/messaging`, and the Provider's Contract Package as an ordinary dependency |
| Calling a Provider | `@cf-loom/client`, and the Provider's Contract Package as an ordinary dependency |
| Tests of a Consumer | `@cf-loom/testing` as a devDependency |
| A Definitions Package | `@cf-loom/contract` and `zod` as `peerDependencies` too (see [Definitions Packages](packages/contract/README.md#definitions-packages)) |

Use TypeScript 7, the version cf-loom is built and tested with; 5.x does not type-check a Message Handler. `publish` builds a Service's Contract Package with the `tsc` of the `typescript` installed in the project. Relative imports name the `.ts` file, which `tsc` accepts only with `allowImportingTsExtensions` (it reports TS5097 on each import otherwise), and a Service needs `@types/node` named in `types`, which defaults to none. `init` writes no `tsconfig.json`; this one type-checks a Service that Node runs from source:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test", "cf-loom.config.ts"]
}
```

A Definitions Package is built, since `publish` needs it built first (see [Commands](packages/cli/README.md#commands) in the CLI README). It keeps this `tsconfig.json` to type-check, without `"types": ["node"]` unless its tests use Node's API, when it installs `@types/node` too, and adds a `tsconfig.build.json` that emits only `src/`, with the declarations its Consumers' types come from, and no Node types, since Applications import it too. Build it with `tsc -p tsconfig.build.json`; [`org-definitions`](examples/org-definitions) has both files:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "rewriteRelativeImportExtensions": true,
    "rootDir": "src",
    "outDir": "dist",
    "types": []
  },
  "include": ["src"]
}
```

Put `.cf-loom/` in `.gitignore`.

`check` and `publish` read the registry through the `npm` on your `PATH`, so they need an npm login that can read the scope's registry, even before the first publish; `generate`, `verify` and `package` run offline (see [Configuration](packages/cli/README.md#configuration)).

### Declare

`cf-loom init service` creates the Root under `src/contract/`; every other declaration is a file you write there, where [Layout](#layout) puts it, and a Group or the Root lists it. What each declaration holds, with an example of each, is in the [`@cf-loom/contract` README](packages/contract/README.md), and the declarations in [`examples/`](examples) (`orders-service`, `billing-service`, `org-definitions`) are complete ones; a Service that sets `layout` configures the tools in `cf-loom.config.ts` (see [Configuration](packages/cli/README.md#configuration)).

### Generate

`cf-loom generate` writes the Stub of every missing Handler, regenerates the Handler map and the readers, and writes `contract.snapshot.json` (see [Stubs and the Handler map](packages/handlers/README.md#stubs-and-the-handler-map) and [Where it lives](SNAPSHOT.md#where-it-lives) in SNAPSHOT.md). Which files a formatter must leave byte for byte, and the LF line endings that the `.gitattributes` `init` writes keeps, are described under [What the commands print and write](packages/cli/README.md#what-the-commands-print-and-write) in the CLI README.

### Implement

Replace each Stub with `handle(…, async (…) => …)`: an [EndpointHandler](packages/handlers/README.md#endpointhandler) or a [GuardHandler](packages/handlers/README.md#guardhandler) with `@cf-loom/handlers`, taking its Endpoint or Guard; a [Message Handler](packages/messaging/README.md#message-handlers) the same way, taking the pairing its Stub takes from `readers` (`handle(readers.commands.chargeCardV1, …)`). What a Handler reaches outside the Contract, its EventPublisher and CommandSender (see [Connecting](packages/messaging/README.md#connecting)), a client of another Service built with `client` from its Contract Package (see [Consuming a Contract](packages/client/README.md#consuming-a-contract)) or its database, it takes as Resources, which `src/main.ts` builds and hands `serve` and `consume` (see [Resources](packages/handlers/README.md#resources)).

### Apply the broker plan

A Service with Messages runs only on a Broker that holds its Stream and Durable consumers. cf-loom derives them from the Contract and never applies them, so without this step the first run of a Service that publishes or sends fails with `The stream orders-service does not exist: apply the Service's broker plan`. Apply the plan in a deploy step, with a script such as this one, run with `node scripts/apply-broker-plan.ts`, or the organization's own tooling, a Provider's plan before its Subscribers' (the limits are the organization's: see [Applying the plan](packages/messaging/README.md#applying-the-plan) in the messaging README for them, for the prefix and for what applying never removes):

```ts
// scripts/apply-broker-plan.ts
import { execFileSync } from 'node:child_process';
import { applyBrokerPlan, type BrokerLimits } from '@cf-loom/messaging/jetstream';
import { connect } from '@nats-io/transport-node';

const limits: BrokerLimits = {
  streamDefaults: { retention: 'limits', maxAge: '7d', duplicateWindow: '2m', replicas: 1, storage: 'file' },
  durableConsumerDefaults: { deliverPolicy: 'all', ackWait: '30s', maxDeliver: 5, maxAckPending: 100 },
};
const { plan } = JSON.parse(execFileSync('npx', ['cf-loom', 'broker-plan', '--json'], { encoding: 'utf8' }));
const servers = process.env['NATS_URL'];
if (servers === undefined) throw new Error('NATS_URL is not set');
await applyBrokerPlan({ connect: () => connect({ servers }) }, plan, limits);
```

### Serve

`src/main.ts` connects messaging with the broker adapter, builds the Resources, serves the Contract with `serve` through the `node:http` adapter and consumes its Messages (see [Serving](packages/server/README.md#serving)).

### Test

A Handler is called directly, with the Resources the test builds (see [Testing a Service's own code](packages/handlers/README.md#testing-a-services-own-code)), Messages run through [`memory()`](packages/messaging/README.md#in-memory), and the Providers a Service depends on are faked with `@cf-loom/testing` (see [Faking Providers](packages/testing/README.md#faking-providers)).

### Publish

`cf-loom package` writes the Contract Package to `.cf-loom/contract-package/`, to build and try it before publishing (see [Commands](packages/cli/README.md#commands)). `cf-loom check` runs the Compatibility Check against the Baseline, and `cf-loom publish` publishes the Contract Package; when to publish is the organization's (see [The Compatibility Check](COMPATIBILITY.md#the-compatibility-check) in COMPATIBILITY.md).

Until cf-loom 1.0.0, publish only prereleases: run `npx cf-loom check --prerelease` and `npx cf-loom publish --prerelease`. A plain `publish` publishes 1.0.0 for a package never published, and promotes a prerelease Baseline to a version that is not one. [Before cf-loom 1.0.0](packages/cli/README.md#before-cf-loom-100) in the CLI README says why, and what to do when an upgraded cf-loom refuses a Baseline an older one published.

#### Check in CI

A CI job runs commands after the install and reads their exit status, which the Exit status paragraph under [Commands](packages/cli/README.md#commands) in the CLI README lists; `check` needs the npm login of [Set up](#set-up). The commands run from the project's install with `npx`, or the `exec` of any other package manager:

```sh
npx cf-loom verify
s=0; npx cf-loom check || s=$?
[ "$s" -eq 0 ] || [ "$s" -eq 2 ] || exit "$s"
```

Run with `-e`, as GitHub Actions runs a `bash` step, the job fails when `verify` fails and when `check` exits 1 or 3, and passes when it exits 2.

Before cf-loom 1.0.0, run `check --prerelease` (see [Publish](#publish)); the samples below show a package as it is after 1.0.0, when it publishes versions that are not prereleases.

Exit 2 means an Approver must give a Breaking Change Approval, and nothing records one, so the job above passes on it and the Approval is the review process's: it must require reviews from the owners of `contract.snapshot.json` (see [Breaking Change Approval](COMPATIBILITY.md#breaking-change-approval) in COMPATIBILITY.md), or a Breaking Change merges on a green job. cf-loom enforces nothing here; a job that must stay red until an Approval is the organization's own, reading `check --json`. Removing a Success field is such a Change:

```
Checked against @org/contract-orders-service@1.0.0
endpoints.GET /orders/{} (getOrder) schema field-removed at success.body.placedAt: Breaking, needs a Breaking Change Approval
Would publish @org/contract-orders-service@2.0.0 (major)
```

and stderr says `1 Breaking Change(s) need a Breaking Change Approval: your review process enforces it`. A Neutral Change needs none, and `check` exits 0:

```
Checked against @org/contract-billing-service@1.0.0
subscriptions.draftInvoiceOnCreated description-changed: Neutral
No Change needs a Breaking Change Approval
Would publish @org/contract-billing-service@1.0.1 (patch)
```

A refused Change fails the check whatever Approval is given: here an Event's body lost a field, which only a new Message Version may change (see [Messages](COMPATIBILITY.md#messages) in COMPATIBILITY.md). `check` exits 1 and stderr says `The check failed: 1 Change(s) refused`:

```
Checked against @org/contract-orders-service@1.0.0
events.OrderCreated@1 schema field-removed at body.placedAt (message): Breaking, refused; make the change in a new Message Version
```

A job that reads one document runs `cf-loom check --json`, whose `errors` hold what stderr says (see [--json](packages/cli/README.md#--json) in the CLI README).

#### Trying a Contract Package before publishing

`cf-loom package` writes the Contract Package ready for `tsc`, and a Consumer installs that folder from disk (`link:` as billing-service's package.json has it, or `file:`) before anything is published:

```sh
npx cf-loom package
npx tsc -p .cf-loom/contract-package
```

The folder's package.json is version `0.0.0`, so a Consumer that installs it records `against: '0.0.0'` for the Provider, and `check` and `publish` say that the registry does not list it (see [Configuration](packages/cli/README.md#configuration) in the CLI README), `publish` with exit 3:

```
dependencies.orders-service is against @org/contract-orders-service@0.0.0, which the registry does not list: install a published version
```

Once the Provider is published, install that version in the Consumer: `check` and `publish` stop on the stale Snapshot, with exit 1, until `cf-loom generate` records it.
