---
"@cf-loom/messaging": major
---

`applyBrokerPlan` for Amazon SNS and SQS, from `@cf-loom/messaging/sqs`: a Stream is a standard SNS topic named as the Broker plan prints it, and a Durable consumer a standard SQS queue with its dead-letter queue, subscribed to its Stream's topic with raw delivery and a filter on `cf-loom-subject`. It takes `SqsConnecting`, `{ sns, sqs, account }`, and `SqsBrokerLimits`, `ackWait`, `maxDeliver`, `retention` and `deadLetterRetention` for each Durable consumer, and never removes anything.

**Breaking:** `@cf-loom/messaging/jetstream` renames its limits types, with no alias: `BrokerLimits` is `JetStreamBrokerLimits`, `StreamLimits` is `JetStreamStreamLimits` and `DurableConsumerLimits` is `JetStreamDurableConsumerLimits`, and a refusal of its `applyBrokerPlan` names `JetStreamBrokerLimits` as the definer of a key it does not know. Code importing the old names must rename them.
