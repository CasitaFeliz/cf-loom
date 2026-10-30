---
"@cf-loom/messaging": patch
---

A refusal of `applyBrokerPlan` shows the value it refused on one line whatever its length: an `ackWait` list of seven or more entries no longer spans several lines, in the JetStream and the SNS/SQS adapter, and neither does the `connecting.account` line of SNS/SQS.
