---
"@cf-loom/messaging": minor
---

`@cf-loom/messaging/in-process` adds `inProcess(limits)`, a Broker inside the Service's process for local runs with no Docker, AWS account or NATS: what the Service publishes and sends reaches its own Subscriptions and Command Handlers on a later turn of the event loop, again after its wait when it fails, until it is acknowledged, ended or delivered `maxDeliver` times. Its limits have the shape of an `applyBrokerPlan`'s, `durableConsumerDefaults` and `durableConsumers` keyed by the Broker plan's names, with the settings `ackWait` and `maxDeliver`, which `inProcess()` reads and `consume` resolves for each Durable consumer. It deduplicates and persists nothing and holds a Durable consumer only while a connection consumes it or one of its Deliveries is in flight; it is not for production.
