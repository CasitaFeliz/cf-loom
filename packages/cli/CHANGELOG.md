# @cf-loom/cli

## 1.0.0-rc.3

### Patch Changes

- Updated dependencies [5f109cb]
- Updated dependencies [c7fe597]
- Updated dependencies [78db080]
- Updated dependencies [9b10210]
- Updated dependencies [81c45a1]
  - @cf-loom/contract@1.0.0-rc.3

## 1.0.0-rc.2

### Minor Changes

- 2310f15: `cf-loom asyncapi --broker sqs` describes the SNS/SQS wire: the four message attributes as `BrokerHeaders` and each channel's SNS topic. `--broker jetstream`, the default, prints the document as before.

### Patch Changes

- Updated dependencies [dbab5a7]
- Updated dependencies [82776d6]
- Updated dependencies [ecd2a47]
- Updated dependencies [7a3d3f9]
  - @cf-loom/contract@1.0.0-rc.2

## 1.0.0-rc.1

### Major Changes

- 276b379: Every object parameter whose shape cf-loom gives refuses in its type a field it does not declare, given through a variable whose type is one object type as well as a literal: what `fault()` is given, a Direct call's second argument, its `request` and its last argument, a Message Handler's Direct call `meta`, `r.fault`, `r.unknownRejection`'s options, `fakeProvider`'s options, a client call's Input and options, `close`'s options, `deliver`'s meta, `applyBrokerPlan`'s limits and their `streamDefaults` and `durableConsumerDefaults`, `readersOf`'s table, and `defineConfig`'s configuration and its `layout`, as the options of `serve`, `consume`, `client()`, `messaging()`, `memory()`, `publish`, `send`, `jetstream()` and `applyBrokerPlan` already did. A union variable given where the parameter is required is refused when any of its members holds such a field at the top; an upcast, an untyped value or the settings one stream or Durable consumer holds in `applyBrokerPlan`'s limits is not refused in its type, and `applyBrokerPlan`'s limits and a configuration are refused at run time, naming the field. A variable that carried a misspelled field, such as `{ committed: 'no', retryable: true, retryAftr: 30 }` given to `fault()`, or a Handler's built Fault given to `r.fault`, no longer type-checks; a wrapper whose type parameter is constrained to one of these types, `<O extends CallOptions>(o: O) => client.getPayment(input, o)`, types its parameter as the concrete type instead. A value whose shape the Contract gives, an Input part, a body, a Context or Resources, stays open.
- a3b38a1: `cf-loom publish` refuses a Definitions Package whose `dependencies`, `optionalDependencies` or `peerDependencies` list a range other than a version, a version range, a dist-tag, or an `npm:` alias of one whose name is a lower-case package name npm accepts: a `workspace:`, `catalog:`, `file:`, `link:` or `portal:` range, a path, a git URL, a GitHub shorthand, a tarball, or an alias of one of them or of a name in upper case. It exits 3 and publishes nothing, since npm publishes the range unchanged and no registry install resolves the ranges it is meant to stop. It names the dependency and its field: `package.json lists <name> in <field> as <range>, no registry range cf-loom keeps (a version, range or tag, or an npm: alias of one under a lower-case package name)`. A package name, of an alias or of the project in `package.json`, is also refused when it is `node_modules` or `favicon.ico`, which npm reserves.
- 375be53: `cf-loom generate` and `cf-loom verify` fill and record a Handler path only where the layout's rules and the project's `src/` allow. A Handler path that breaks a rule of the layout once its variables are filled, such as a file name holding `.d.` when an Endpoint, a Guard, a Subscription or a Group is named `d`, exits 3 naming the declaration and the path. A Handler path, `handlerMap` or `readers` that a link leads out of `src/` or into `src/contract/` exits 3 too, and a `*.generated.ts` file or a folder that a link leads there is never read, moved from or deleted. An import in a file `generate` wrote that records a Handler at a path `generate` could not have placed exits 1 with a line naming the file and the path, before anything is moved or written.
- 699b98c: `cf-loom publish` packs the package it built once, reads that tarball as `cf-loom check` reads a Baseline's, and publishes that same tarball. A package whose tarball `check` could not read as a Baseline, such as a Definitions Package holding a file named with a non-ASCII letter or a colon, or a `Snapshot.json` beside its `snapshot.json`, exits 3 before anything is put, instead of becoming a version that every later `check` and `publish` of the package fails on. `--dry-run` packs and reads the tarball too.
- 71750b6: `generate` refuses every string format check zod runs through a function, whatever pattern sits beside it: any `z.stringFormat()` (a regex given to it included) and the formats zod builds from a regex, `z.hex()`, `z.hostname()`, `z.currencyCode()` and `z.hash()`. The last four are named by every spelling that builds them (`z.hex() or z.stringFormat("hex")`), each with `(use .regex(z.regexes.<name>))`. Write `z.string().regex(z.regexes.hex)` (or `z.regexes.sha256_hex` for `z.hash('sha256')`): the Snapshot then holds the regex, and OpenAPI and AsyncAPI documents a `pattern` instead of a `format`. The Snapshot format 1 no longer knows the formats `hex`, `hostname`, `currency_code` and the hash formats, so a Snapshot holding one is malformed.

### Patch Changes

- d71925d: The README's table of Difference kinds says a Definitions Package's Guard or Rejection is `added` or `removed` at its export, not on its own.
- ae3e590: The READMEs write the glossary's terms as CONTEXT.md spells them, such as Direct call, Former Input, Readers file, Fake Provider and Broker plan, and the messaging README's section "Applying the plan" is "Applying the Broker plan". The messages that name the Broker plan spell it so: `apply the Service's Broker plan` when a Stream or Durable consumer is missing, `<root> has no Broker plan: …` from `cf-loom broker-plan`, and `The value is not the Broker plan of the document cf-loom broker-plan --json prints: …` from `applyBrokerPlan`, which no longer calls the value "the plan" alone.
- f507835: The OpenAPI and AsyncAPI documents now bound an `int` to the safe integers, as zod's `z.int()` checks, instead of leaving it unbounded.
- 8a0ec78: `check` no longer hints at `openEnum` for a value added to a closed enum, since opening the enum is itself a Breaking Change.
- a3b1910: A list of three or more names in a failure line is written `a, b and c` by one helper, where two lines wrote `a and b and c`: a Root file that exports three Roots, and a code three or more sources declare.
- d9601a0: Rules that several packages wrote out separately, such as the broker needs of a Contract and the reserved header names, now live in one place, with no change to what cf-loom reads or writes.
- 6d3a5df: The CLI and contract READMEs use the glossary's terms, such as the Readers file, and the contract README gains a first-declarations example of an Endpoint, a Group and a Root.
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
