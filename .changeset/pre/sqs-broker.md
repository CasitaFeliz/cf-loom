---
"@cf-loom/messaging": minor
"@cf-loom/contract": patch
---

`sqs()` from `@cf-loom/messaging/sqs` runs a Service's messaging on SNS/SQS, through the organization's SNS and SQS clients: `publish` sends each Message to the Service's SNS topic, and `consume` receives from each Durable consumer's SQS queue, after checking the queue and its subscription against what `applyBrokerPlan` writes. A Message cf-loom cannot read is never deleted, but left for the queue's dead-letter queue. `@cf-loom/contract` gives the wire its ASCII JSON for a Message's ids and Transport headers in SNS message attributes.
