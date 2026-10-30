---
"@cf-loom/cli": patch
"@cf-loom/client": patch
"@cf-loom/contract": patch
"@cf-loom/handlers": patch
"@cf-loom/messaging": patch
"@cf-loom/server": patch
"@cf-loom/testing": patch
---

The READMEs write the glossary's terms as CONTEXT.md spells them, such as Direct call, Former Input, Readers file, Fake Provider and Broker plan, and the messaging README's section "Applying the plan" is "Applying the Broker plan". The messages that name the Broker plan spell it so: `apply the Service's Broker plan` when a Stream or Durable consumer is missing, `<root> has no Broker plan: …` from `cf-loom broker-plan`, and `The value is not the Broker plan of the document cf-loom broker-plan --json prints: …` from `applyBrokerPlan`, which no longer calls the value "the plan" alone.
