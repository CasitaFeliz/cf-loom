# @cf-loom/client

## 1.0.0-rc.2

### Patch Changes

- Updated dependencies [dbab5a7]
- Updated dependencies [82776d6]
- Updated dependencies [ecd2a47]
- Updated dependencies [7a3d3f9]
  - @cf-loom/contract@1.0.0-rc.2

## 1.0.0-rc.1

### Major Changes

- 276b379: Every object parameter whose shape cf-loom gives refuses in its type a field it does not declare, given through a variable whose type is one object type as well as a literal: what `fault()` is given, a Direct call's second argument, its `request` and its last argument, a Message Handler's Direct call `meta`, `r.fault`, `r.unknownRejection`'s options, `fakeProvider`'s options, a client call's Input and options, `close`'s options, `deliver`'s meta, `applyBrokerPlan`'s limits and their `streamDefaults` and `durableConsumerDefaults`, `readersOf`'s table, and `defineConfig`'s configuration and its `layout`, as the options of `serve`, `consume`, `client()`, `messaging()`, `memory()`, `publish`, `send`, `jetstream()` and `applyBrokerPlan` already did. A union variable given where the parameter is required is refused when any of its members holds such a field at the top; an upcast, an untyped value or the settings one stream or Durable consumer holds in `applyBrokerPlan`'s limits is not refused in its type, and `applyBrokerPlan`'s limits and a configuration are refused at run time, naming the field. A variable that carried a misspelled field, such as `{ committed: 'no', retryable: true, retryAftr: 30 }` given to `fault()`, or a Handler's built Fault given to `r.fault`, no longer type-checks; a wrapper whose type parameter is constrained to one of these types, `<O extends CallOptions>(o: O) => client.getPayment(input, o)`, types its parameter as the concrete type instead. A value whose shape the Contract gives, an Input part, a body, a Context or Resources, stays open.

### Patch Changes

- 3dfac84: The server README gains Compiling schemas, which says that importing `zod/compile` is the organization's option and what it reaches, changes and costs, and the client README says what it costs an Application.
- ae3e590: The READMEs write the glossary's terms as CONTEXT.md spells them, such as Direct call, Former Input, Readers file, Fake Provider and Broker plan, and the messaging README's section "Applying the plan" is "Applying the Broker plan". The messages that name the Broker plan spell it so: `apply the Service's Broker plan` when a Stream or Durable consumer is missing, `<root> has no Broker plan: …` from `cf-loom broker-plan`, and `The value is not the Broker plan of the document cf-loom broker-plan --json prints: …` from `applyBrokerPlan`, which no longer calls the value "the plan" alone.
- 00ab03c: A Handler's `request.signal` aborts when the Caller leaves even after a garbage collection: `nodeHttp`, `nodeListener` and `fastifyServe` hold each request's `Request` from the Caller's departure until its response ends, where undici's `Request` stopped following that signal once nothing else held it. A client call holds its Request from its `signal` the same way until the call settles, so an abort reaches any `fetch`, `serve` in the same process included.
- d9601a0: Rules that several packages wrote out separately, such as the broker needs of a Contract and the reserved header names, now live in one place, with no change to what cf-loom reads or writes.
- 49121db: The TypeScript blocks of the client and testing READMEs compile with those of the contract, handlers, messaging and server READMEs against one Service, and their tests run them: the client README's first example is a whole file exporting `payments` and `amountOf`, its Provider-side files name `payments-service/` and import what they use, and its browser example is a file of `web-admin` calling through `adminPaymentsDependency`; the testing README's examples import the Handler they call from `src/endpoints/orders/`; the contract README's Definitions Package exports `idempotencyKey`, its Dependency lists `createPaymentEndpoint` and its orders Group lists `settlePayment`; and the server README's `main.ts` gives its Resources the `payments` client.
- 80bd46e: The READMEs gain Set up steps, a CI recipe that keeps `cf-loom check`'s exit status, and a Retrying section that says which Faults a Caller retries and what a browser Caller needs exposed.
- 2a50fef: Every line a library writes stays one line: a key, a name, a path, an id or a message holding a line break, such as a record key a Caller sends that `serve` logs in an Issue, no longer splits an Error's message or a console line in two. Each of CR, LF, VT, FF, FS, GS, RS, U+0085, U+2028 and U+2029 is written as the visible text of its escape, as the CLI wrote the first five, and now writes all ten; a message of several lines still has one line per problem, and a `%o`, `%c` or other console format directive inside a Fault message or a Fact id no longer splices the cause into the console line.
- Updated dependencies [61db56f]
- Updated dependencies [e592e51]
- Updated dependencies [6edd65b]
- Updated dependencies [230b4a3]
- Updated dependencies [0fd9500]
- Updated dependencies [d71925d]
- Updated dependencies [ae3e590]
- Updated dependencies [bbc91bc]
- Updated dependencies [00ab03c]
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

## 1.0.0-rc.0

### Major Changes

- 99e06d3: The first release candidate of cf-loom 1.0.0, published to npmjs.com with access restricted to the @cf-loom npm organization: install it logged in with an npm account in that organization, with `@rc`. Until 1.0.0 the Snapshot format is not frozen, so a Contract Package or Definitions Package publishes only prereleases, with `cf-loom check --prerelease` and `cf-loom publish --prerelease`.

### Patch Changes

- Updated dependencies [99e06d3]
  - @cf-loom/contract@1.0.0-rc.0
