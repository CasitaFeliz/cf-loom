---
"@cf-loom/contract": major
"@cf-loom/messaging": major
---

`applyBrokerPlan`, from `@cf-loom/messaging/jetstream` and `@cf-loom/messaging/sqs`, applies only the Broker plan of one Service as `cf-loom broker-plan` prints it, and refuses any other before it connects, naming the first place that differs. Each Stream name, Durable consumer name, subject and Service name must read back into names the grammars accept (a Service name, event or command, a Message name and its version, a Subscription name) that the printers print again unchanged, under the plan's `prefix`, and the plan must be the one Service's plan those names print, in code point order, so a name with a line break, a wildcard subject such as `staging.>`, a Durable consumer pointed at another Message Version's subject, a plan that merges the Streams of two Services, a list out of order or a key named `__proto__`, which was dropped without a word, is refused. Plans that applied before and now do not: a script that merges two Services' Broker plans must call `applyBrokerPlan` once for each Service, and a Broker plan written by hand with names `cf-loom broker-plan` never prints must print them as it does.
