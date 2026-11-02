# @cf-loom/messaging

## 1.0.0-rc.3

### Minor Changes

- 352c3d7: `@cf-loom/messaging/in-process` adds `inProcess(limits)`, a Broker inside the Service's process for local runs with no Docker, AWS account or NATS: what the Service publishes and sends reaches the Message Handlers of its own Subscriptions and Commands on a later turn of the event loop, again after its wait when it fails, until it is acknowledged, ended or delivered `maxDeliver` times. Its limits have the shape of an `applyBrokerPlan`'s, `durableConsumerDefaults` and `durableConsumers` keyed by the Broker plan's names, with the settings `ackWait` and `maxDeliver`, which `inProcess()` reads and `consume` resolves for each Durable consumer. It deduplicates and persists nothing, holds each Durable consumer from its first `consume` for the life of the `inProcess()` value, and is not for production.

### Patch Changes

- 5f109cb: Without an `onServiceFault`, the console lists a Fault's Issues as the invalid-input body does, the first 100 within 64 KiB of the lines written, and counts the others on a last line, `<source>: <count> more Issues`, instead of writing one line per Issue, which made a Message or a Success of a million invalid items write about a hundred megabytes. `onServiceFault` still receives every Issue.
- Updated dependencies [5f109cb]
- Updated dependencies [c7fe597]
- Updated dependencies [78db080]
- Updated dependencies [9b10210]
- Updated dependencies [81c45a1]
  - @cf-loom/contract@1.0.0-rc.3
  - @cf-loom/handlers@1.0.0-rc.3

## 1.0.0-rc.2

### Minor Changes

- ecd2a47: `sqs()` from `@cf-loom/messaging/sqs` runs a Service's messaging on SNS/SQS, through the organization's SNS and SQS clients: `publish` sends each Message to the Service's SNS topic, and `consume` receives from each Durable consumer's SQS queue, after checking the queue and its subscription against what `applyBrokerPlan` writes. A Message cf-loom cannot read is never deleted, but left for the queue's dead-letter queue. `@cf-loom/contract` gives the wire its ASCII JSON for a Message's ids and Transport headers in SNS message attributes.

### Patch Changes

- Updated dependencies [dbab5a7]
- Updated dependencies [39ac3c9]
- Updated dependencies [82776d6]
- Updated dependencies [ecd2a47]
- Updated dependencies [7a3d3f9]
  - @cf-loom/contract@1.0.0-rc.2
  - @cf-loom/handlers@1.0.0-rc.2

## 1.0.0-rc.1

### Major Changes

- 276b379: Every object parameter whose shape cf-loom gives refuses in its type a field it does not declare, given through a variable whose type is one object type as well as a literal: what `fault()` is given, a Direct call's second argument, its `request` and its last argument, a Message Handler's Direct call `meta`, `r.fault`, `r.unknownRejection`'s options, `fakeProvider`'s options, a client call's Input and options, `close`'s options, `deliver`'s meta, `applyBrokerPlan`'s limits and their `streamDefaults` and `durableConsumerDefaults`, `readersOf`'s table, and `defineConfig`'s configuration and its `layout`, as the options of `serve`, `consume`, `client()`, `messaging()`, `memory()`, `publish`, `send`, `jetstream()` and `applyBrokerPlan` already did. A union variable given where the parameter is required is refused when any of its members holds such a field at the top; an upcast, an untyped value or the settings one stream or Durable consumer holds in `applyBrokerPlan`'s limits is not refused in its type, and `applyBrokerPlan`'s limits and a configuration are refused at run time, naming the field. A variable that carried a misspelled field, such as `{ committed: 'no', retryable: true, retryAftr: 30 }` given to `fault()`, or a Handler's built Fault given to `r.fault`, no longer type-checks; a wrapper whose type parameter is constrained to one of these types, `<O extends CallOptions>(o: O) => client.getPayment(input, o)`, types its parameter as the concrete type instead. A value whose shape the Contract gives, an Input part, a body, a Context or Resources, stays open.
- 8d566ea: `applyBrokerPlan` for Amazon SNS and SQS, from `@cf-loom/messaging/sqs`: a Stream is a standard SNS topic named as the Broker plan prints it, and a Durable consumer a standard SQS queue with its dead-letter queue, subscribed to its Stream's topic with raw delivery and a filter on `cf-loom-subject`. It takes `SqsConnecting`, `{ sns, sqs, account }`, and `SqsBrokerLimits`, `ackWait`, `maxDeliver`, `retention` and `deadLetterRetention` for each Durable consumer, and never removes anything.
  
  **Breaking:** `@cf-loom/messaging/jetstream` renames its limits types, with no alias: `BrokerLimits` is `JetStreamBrokerLimits`, `StreamLimits` is `JetStreamStreamLimits` and `DurableConsumerLimits` is `JetStreamDurableConsumerLimits`, and a refusal of its `applyBrokerPlan` names `JetStreamBrokerLimits` as the definer of a key it does not know. Code importing the old names must rename them.

### Patch Changes

- a2decab: Reading the limits `applyBrokerPlan` takes now lives in one place for every Broker adapter, with no change to what it reads or refuses.
- ae3e590: The READMEs write the glossary's terms as CONTEXT.md spells them, such as Direct call, Former Input, Readers file, Fake Provider and Broker plan, and the messaging README's section "Applying the plan" is "Applying the Broker plan". The messages that name the Broker plan spell it so: `apply the Service's Broker plan` when a Stream or Durable consumer is missing, `<root> has no Broker plan: …` from `cf-loom broker-plan`, and `The value is not the Broker plan of the document cf-loom broker-plan --json prints: …` from `applyBrokerPlan`, which no longer calls the value "the plan" alone.
- a3b1910: A list of three or more names in a failure line is written `a, b and c` by one helper, where two lines wrote `a and b and c`: a Root file that exports three Roots, and a code three or more sources declare.
- d9601a0: Rules that several packages wrote out separately, such as the broker needs of a Contract and the reserved header names, now live in one place, with no change to what cf-loom reads or writes.
- 49121db: The TypeScript blocks of the client and testing READMEs compile with those of the contract, handlers, messaging and server READMEs against one Service, and their tests run them: the client README's first example is a whole file exporting `payments` and `amountOf`, its Provider-side files name `payments-service/` and import what they use, and its browser example is a file of `web-admin` calling through `adminPaymentsDependency`; the testing README's examples import the Handler they call from `src/endpoints/orders/`; the contract README's Definitions Package exports `idempotencyKey`, its Dependency lists `createPaymentEndpoint` and its orders Group lists `settlePayment`; and the server README's `main.ts` gives its Resources the `payments` client.
- 80bd46e: The READMEs gain Set up steps, a CI recipe that keeps `cf-loom check`'s exit status, and a Retrying section that says which Faults a Caller retries and what a browser Caller needs exposed.
- 30a4343: The TypeScript blocks of the contract, handlers, messaging and server READMEs compile together against one Service; the GuardHandler example rejects with the `www-authenticate` header its Rejection declares, and the server and messaging examples hand `serve` and `consume` the Resources their Handlers take; and the contract README's first declarations are those of `notes-service`, a small Service of its own. `onServiceFault`, `onAnswered` and `onBrokerTrouble` may return a value, which is awaited and ignored.
- 067d8dc: A refusal of `applyBrokerPlan` shows the value it refused on one line whatever its length: an `ackWait` list of seven or more entries no longer spans several lines, in the JetStream and the SNS/SQS adapter, and neither does the `connecting.account` line of SNS/SQS.
- 2a50fef: Every line a library writes stays one line: a key, a name, a path, an id or a message holding a line break, such as a record key a Caller sends that `serve` logs in an Issue, no longer splits an Error's message or a console line in two. Each of CR, LF, VT, FF, FS, GS, RS, U+0085, U+2028 and U+2029 is written as the visible text of its escape, as the CLI wrote the first five, and now writes all ten; a message of several lines still has one line per problem, and a `%o`, `%c` or other console format directive inside a Fault message or a Fact id no longer splices the cause into the console line.
- Updated dependencies [61db56f]
- Updated dependencies [4551c99]
- Updated dependencies [e592e51]
- Updated dependencies [276b379]
- Updated dependencies [6edd65b]
- Updated dependencies [230b4a3]
- Updated dependencies [0fd9500]
- Updated dependencies [d71925d]
- Updated dependencies [ae3e590]
- Updated dependencies [bbc91bc]
- Updated dependencies [00ab03c]
- Updated dependencies [5e5b215]
- Updated dependencies [2ea2153]
- Updated dependencies [d2383fe]
- Updated dependencies [a3b1910]
- Updated dependencies [d9601a0]
- Updated dependencies [93dd25e]
- Updated dependencies [49121db]
- Updated dependencies [6d3a5df]
- Updated dependencies [80bd46e]
- Updated dependencies [30a4343]
- Updated dependencies [e464942]
- Updated dependencies [ea89c85]
- Updated dependencies [c2bd88c]
- Updated dependencies [8d566ea]
- Updated dependencies [71750b6]
- Updated dependencies [12a443e]
- Updated dependencies [9b9cfde]
- Updated dependencies [31b52ef]
- Updated dependencies [2a50fef]
  - @cf-loom/contract@1.0.0-rc.1
  - @cf-loom/handlers@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- 99e06d3: The first release candidate of cf-loom 1.0.0, published to npmjs.com with access restricted to the @cf-loom npm organization: install it logged in with an npm account in that organization, with `@rc`. Until 1.0.0 the Snapshot format is not frozen, so a Contract Package or Definitions Package publishes only prereleases, with `cf-loom check --prerelease` and `cf-loom publish --prerelease`.

### Patch Changes

- Updated dependencies [99e06d3]
  - @cf-loom/contract@1.0.0-rc.0
  - @cf-loom/handlers@1.0.0-rc.0
