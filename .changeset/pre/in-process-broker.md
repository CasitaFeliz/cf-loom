---
"@cf-loom/messaging": minor
---

`@cf-loom/messaging/in-process` adds `inProcess(limits)`, a Broker inside the Service's process for local runs with no Docker, AWS account or NATS: what the Service publishes and sends reaches the Message Handlers of its own Subscriptions and Commands on a later turn of the event loop, again after its wait when it fails, until it is acknowledged, ended or delivered `maxDeliver` times. Its limits have the shape of an `applyBrokerPlan`'s, `durableConsumerDefaults` and `durableConsumers` keyed by the Broker plan's names, with the settings `ackWait` and `maxDeliver`, which `inProcess()` reads and `consume` resolves for each Durable consumer. It deduplicates and persists nothing, holds each Durable consumer from its first `consume` for the life of the `inProcess()` value, and is not for production.
