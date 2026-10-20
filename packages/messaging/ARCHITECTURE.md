# Internals of @cf-loom/messaging

How `messaging` (see [README.md](README.md)) is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires, and keeps a Message in flight while its Handler runs. The broker interface and its adapters are in [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md; what the broker must hold is in [Applying the plan](README.md#applying-the-plan).

## Modules

The entry `src/index.ts` (`.`) re-exports from `broker/`, `sending/` and `messaging/`; `memory/index.ts` and `jetstream/index.ts` are the adapters' entries. The wire rules of [Over the broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker), a subject, a durable consumer's name, the broker message id, the headers cf-loom sets and a body's JSON from bytes, live in `@cf-loom/contract`'s `wire/`, which the CLI's broker plan shares; the runs of the Message Handlers and the Handler map's lookup live in `@cf-loom/handlers`'s `./internal`.

| Module | Holds | Depends on |
| --- | --- | --- |
| `broker/` | the broker interface an adapter implements, `Broker` and its parts, and `ConsumedFault`, which a `Settlement` carries | none |
| `subjects/` | where each Message of a Contract travels, computed once at `messaging()`: the Service's name; its Events' live versions in version order and its Commands' Active versions, with their subjects; each consumed Subscription and Command Version not Retired with its key in the Handler map, subject, stream and durable consumer; a root that is no Contract, or a Subscription whose Event no list holds, throws | none |
| `sending/` | `publish` and `send` and their types: every body checked with its version's schema, by the Message body check `@cf-loom/handlers` shares, before any is built, the Fact id, the transport headers checked against the names cf-loom sets, each `OutgoingMessage`, sending one at a time; `PublishError` and `InvalidMessageError` | `broker`, `subjects` |
| `consuming/` | the consumers of one `consume`: each Handler looked up as `serve` looks one up, a stub left out with a warning; one delivery read as JSON, run with its Handler's Reader and settled; a `ConsumedFault` handed to `onServiceFault` or the console | `broker`, `subjects` |
| `messaging/` | `messaging()` and its types, connecting through the broker and wiring the subjects, the publisher, the sender and `consume` to that one connection; the life of a `Messaging`, open, closing, closed, `consume` once, and the Handlers running, which the core keeps, not the adapter, so `close()` waits for them and a delivery while closing is left pending | `broker`, `subjects`, `sending`, `consuming` |

## In-progress acknowledgements

While a Handler runs (see [Message Handlers](README.md#message-handlers)), the adapter sends in-progress acknowledgements at a fraction of the durable consumer's ack wait, read from it at `consume`, so a slow Handler's Message is not delivered to a sibling instance meanwhile.
