# @cf-loom/handlers

## 1.0.0-rc.4

### Patch Changes

- fb46173: The packages are published to npmjs.com with public access and licensed `MIT OR Apache-2.0`: each package holds `LICENSE-MIT` and `LICENSE-APACHE`, and its `license` says `(MIT OR Apache-2.0)`. Versions 1.0.0-rc.0 to 1.0.0-rc.3 stay published as they are, public with the license `UNLICENSED`; 1.0.0-rc.4 is the first licensed version.
- c4a2e85: A refusal shows a value that untyped code passed and its type does not allow by its kind, running none of the value's code. A limits setting or an `account` that `inProcess()`, `applyBrokerPlan` and `sqs()` refuse is shown as `util.inspect` prints it only when it is a string, a number, a boolean, `null`, `undefined` or a list held as data (its first 100 entries, three levels deep): an object reads `an object`, a function `a function`, a Symbol `a symbol`, a bigint `a bigint` and any other list `a list`, so a refusal no longer prints every key of a wide object, a Symbol's whole description or a bigint's every digit, or throws what the value's `[inspect.custom]`, getter or Proxy trap threw in place of its own line naming the place; an object that used to print its keys (`{ seconds: 30 }`) now reads `an object`. A validation line names a function, a Symbol or a bigint by its kind too, where it printed a function's source or a Symbol's whole description, and where a throwing `Symbol.toPrimitive` threw out of `generate` and `serve`. A revoked Proxy that `serve` or a Handler names no longer throws `Cannot perform 'IsArray'`: it is named `an object`. A Rejection's `code` and a returned `kind` that are an object, a function, a list, a Symbol or a bigint are named by their kind in the `InvalidOutcomeError` and the Fault's `cause` of a Handler, instead of `[object Object]`, a function's source or what the value's `toString` threw. `fault({ retryAfter: 1n })` and `serve({ maxBodyBytes: 1n })` refuse with `got a bigint`, where they said `got 1`, the text of a valid number, and a Fake Provider's mistake for a Symbol or a bigint `retryAfter` or Reserved code names `a symbol` or `a bigint`.
- Updated dependencies [60c2979]
- Updated dependencies [d4b12a0]
- Updated dependencies [fb46173]
- Updated dependencies [173a819]
- Updated dependencies [51cbdc3]
- Updated dependencies [7f2943f]
- Updated dependencies [9112ec2]
- Updated dependencies [c4a2e85]
- Updated dependencies [116374b]
  - @cf-loom/contract@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- Updated dependencies [5f109cb]
- Updated dependencies [c7fe597]
- Updated dependencies [78db080]
- Updated dependencies [9b10210]
- Updated dependencies [81c45a1]
  - @cf-loom/contract@1.0.0-rc.3

## 1.0.0-rc.2

### Major Changes

- 39ac3c9: `CheckedAdmission` is removed: a GuardHandler's Direct call returns `Admission<typeof apiKey>`, the type its implementation builds, which `CheckedAdmission` always equalled. Code that names `CheckedAdmission` names `Admission` instead; nothing changes at run time.

### Patch Changes

- Updated dependencies [dbab5a7]
- Updated dependencies [82776d6]
- Updated dependencies [ecd2a47]
- Updated dependencies [7a3d3f9]
  - @cf-loom/contract@1.0.0-rc.2

## 1.0.0-rc.1

### Major Changes

- 4551c99: `success()` and `admit()` take their declaration first, as `reject()` takes its Rejection: `success(getOrder, body)`, `success(createOrder, { headers, body })`, `success(deleteOrder)` for a 204 without headers, `admit(apiKey, { callerId })`, and `admit(permission)` for a Guard that provides no Context. A literal with a field the Endpoint or the Guard does not declare, such as a misspelled optional field or header, is now a type error where it is written; a variable may carry more, which the runtime strips, and a Success built in a helper or into a variable before its `return` type-checks. Every `success(…)` and `admit(…)` call gains its declaration as the first argument. A generic wrapper of `success` is refused; one typed with the concrete Endpoint, `(body: SuccessOf<typeof getOrder>['body']) => success(getOrder, body)`, compiles.
- 276b379: Every object parameter whose shape cf-loom gives refuses in its type a field it does not declare, given through a variable whose type is one object type as well as a literal: what `fault()` is given, a Direct call's second argument, its `request` and its last argument, a Message Handler's Direct call `meta`, `r.fault`, `r.unknownRejection`'s options, `fakeProvider`'s options, a client call's Input and options, `close`'s options, `deliver`'s meta, `applyBrokerPlan`'s limits and their `streamDefaults` and `durableConsumerDefaults`, `readersOf`'s table, and `defineConfig`'s configuration and its `layout`, as the options of `serve`, `consume`, `client()`, `messaging()`, `memory()`, `publish`, `send`, `jetstream()` and `applyBrokerPlan` already did. A union variable given where the parameter is required is refused when any of its members holds such a field at the top; an upcast, an untyped value or the settings one stream or Durable consumer holds in `applyBrokerPlan`'s limits is not refused in its type, and `applyBrokerPlan`'s limits and a configuration are refused at run time, naming the field. A variable that carried a misspelled field, such as `{ committed: 'no', retryable: true, retryAftr: 30 }` given to `fault()`, or a Handler's built Fault given to `r.fault`, no longer type-checks; a wrapper whose type parameter is constrained to one of these types, `<O extends CallOptions>(o: O) => client.getPayment(input, o)`, types its parameter as the concrete type instead. A value whose shape the Contract gives, an Input part, a body, a Context or Resources, stays open.

### Patch Changes

- ae3e590: The READMEs write the glossary's terms as CONTEXT.md spells them, such as Direct call, Former Input, Readers file, Fake Provider and Broker plan, and the messaging README's section "Applying the plan" is "Applying the Broker plan". The messages that name the Broker plan spell it so: `apply the Service's Broker plan` when a Stream or Durable consumer is missing, `<root> has no Broker plan: …` from `cf-loom broker-plan`, and `The value is not the Broker plan of the document cf-loom broker-plan --json prints: …` from `applyBrokerPlan`, which no longer calls the value "the plan" alone.
- 5e5b215: `serve` parses a request's Input and a Guard's demands once instead of twice, with no change to what it answers or to what a Handler receives.
- 30a4343: The TypeScript blocks of the contract, handlers, messaging and server READMEs compile together against one Service; the GuardHandler example rejects with the `www-authenticate` header its Rejection declares, and the server and messaging examples hand `serve` and `consume` the Resources their Handlers take; and the contract README's first declarations are those of `notes-service`, a small Service of its own. `onServiceFault`, `onAnswered` and `onBrokerTrouble` may return a value, which is awaited and ignored.
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
