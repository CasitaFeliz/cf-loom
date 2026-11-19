# @cf-loom/cli

## 1.0.0-rc.4

### Major Changes

- d675c8a: `check` and `publish` read the output of npm 12, which prints one version of `npm view` in a list and `npm pack` keyed by package name, and `@cf-loom/cli` declares the npm releases it is tested on in `engines.npm`, `^11.13.0 || ^12.2.1`: npm warns when another npm installs it and refuses under `engine-strict`. `publish` of a Definitions Package lists the project's own files whatever `workspaces` or `workspace` its `.npmrc` sets, and a print of npm that `check` or `publish` cannot read, such as another npm may make, fails with `<npm call> printed <its JSON, cut at 60 characters, or nothing>, not <what that call prints>`, instead of a line about the package's versions or dist-tags.

### Patch Changes

- d4b12a0: `check` and `publish` tell a Change inside a recursive schema from that schema, `defs.<id>` with the id the proposed Contract gives it, where they told it from the Endpoint through every recursive schema above it, so a report grows with its Changes and a Change no longer moves when another field reaches the schema first. Two schema Differences at one place, with one Position and one shape, are one Change, the first found. The `--json` document's `format` is 2 in every command: a Change inside a recursive schema has `at` as `["defs", "<id>", …]` and `path` as `defs.<id>…`. A reader that requires `format` 1 must accept 2.
- 85febfc: `publish` of a Definitions Package leaves `packageExtensions` out of the package.json it publishes, beside `publishConfig.tag`, since only the project itself reads it and npm 12 refuses to publish a package that has it (`EPACKAGEEXTENSIONS`); `publish --dry-run` and `publish` now agree on it. The project's own package.json is not changed.
- 85febfc: A first `check` or `publish`, of a package the registry does not know yet, takes the registry from the URL npm's 404 names, and asks `npm whoami` there, instead of asking `npm config get` which registry serves the package, which npm refuses under a `workspaces` setting and in a member of an npm workspaces root. Every npm call cf-loom makes runs with `--workspaces=null`, so a first `check` or `publish` works under `workspaces=true` from any `.npmrc` or `npm_config_workspaces`, and in a workspace member. When npm refuses `npm whoami` under a `workspace` setting, as it does unless the project is a member of a workspaces root, the run exits 3 with a line that names the setting, where it printed `npm config get @org:registry failed (ENOWORKSPACES: …)`. A package name npm prints redacted in its 404, because it holds a UUID or a token shape, is matched with the name cf-loom knows. A registry URL npm prints redacted fails with a line that says so: `npm view <package> failed: npm redacts a registry URL that holds credentials: …` for a password, `npm view <package> failed: npm redacted part of the registry URL (…), so cf-loom cannot name the registry to ask npm whoami` for a UUID or a token, and `npm view <package>'s 404 names no registry: …` for a 404 that names none, in place of `npm config get <key> failed: npm will not print a registry URL that holds credentials: …` and `npm did not say which registry serves <package>`.
- fb46173: The packages are published to npmjs.com with public access and licensed `MIT OR Apache-2.0`: each package holds `LICENSE-MIT` and `LICENSE-APACHE`, and its `license` says `(MIT OR Apache-2.0)`. Versions 1.0.0-rc.0 to 1.0.0-rc.3 stay published as they are, public with the license `UNLICENSED`; 1.0.0-rc.4 is the first licensed version.
- 173a819: A list of names in a line a library or the CLI writes closes with a word, `a and b` or `a, b or c`, after a colon too, where about twenty lines listed with bare commas: the settings a Broker's limits leave unset, the subjects a Stream lacks, the Messages handed back, the methods a Fake Provider's Mistake says a path takes (`GET or POST`), the other sites of a refused schema, and the values outside an enum (`is not "public", "internal" or "private"`). A Durable consumer's differences are joined by `; `. A type error that shares a sentence with `generate` is now exactly its line or lines: the `:names` of a path, the Guards a Guard requires earlier and the Providers of a Dependency are listed in the order `generate` lists them, and a refusal `generate` writes once for each header name, Endpoint or refused construct is one type error for each. `generate` lists the Providers of a Dependency in the order its Endpoints list them, no longer sorted by code point, and the type error of a Dependency names each Provider its type is refused for, once. The types no longer judge the `params` of an Endpoint whose `path` is a union of literals, as they do not for a `string`: `generate` judges the path the value holds.
- 51cbdc3: The defs a Snapshot's schemas reach, the def a `ref` stands for and what each def reaches are answered in one place for each set of defs. Reports, published Snapshots, generated files and Contract Packages are unchanged.
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
