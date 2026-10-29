---
"@cf-loom/client": major
"@cf-loom/handlers": major
"@cf-loom/messaging": major
"@cf-loom/server": major
"@cf-loom/testing": major
---

Every object parameter whose shape cf-loom gives refuses in its type a field it does not declare, given through a variable as well as a literal: what `fault()` is given, a Direct call's second argument, its `request` and its last argument, a Message Handler's Direct call `meta`, `r.fault`, `r.unknownRejection`'s options, `fakeProvider`'s options, a client call's Input and options, `close`'s options and `deliver`'s meta, as the options of `serve`, `consume`, `client()`, `messaging()`, `memory()`, `publish`, `send`, `jetstream()` and `applyBrokerPlan` already did. A variable that carried a misspelled field, such as `{ committed: 'no', retryable: true, retryAftr: 30 }` given to `fault()`, or a Handler's built Fault given to `r.fault`, no longer type-checks; a wrapper whose type parameter is constrained to one of these types, `<O extends CallOptions>(o: O) => client.getPayment(input, o)`, types its parameter as the concrete type instead. A value whose shape the Contract gives, an Input part, a body, a Context or Resources, stays open.
