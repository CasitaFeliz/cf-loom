# Internals of @cf-loom/messaging

How `messaging` (see [README.md](README.md)) keeps a Message in flight while its Handler runs. The broker interface and its adapters are in [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md; what the broker must hold is in [Applying the plan](README.md#applying-the-plan).

## In-progress acknowledgements

While a Handler runs (see [Message Handlers](README.md#message-handlers)), the adapter sends in-progress acknowledgements at a fraction of the durable consumer's ack wait, read from it at `consume`, so a slow Handler's Message is not delivered to a sibling instance meanwhile.
