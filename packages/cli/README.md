# @cf-loom/cli

The `cf-loom` command and `defineConfig`; how its `src/` is split into modules is in [ARCHITECTURE.md](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/ARCHITECTURE.md). Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md); the Compatibility Check the command runs is in [COMPATIBILITY.md](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md), and the Snapshot it writes in [SNAPSHOT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md).

## Configuration

Each Service, Application or Definitions Package configures the tools in `cf-loom.config.ts`, next to its package.json: at the root of its repository, or in its own directory of a monorepo, where the CLI runs. The CLI reads its `config` export; it is never part of the Snapshot or the published package. Like the Contract's files, it is erasable TypeScript (see [Where Contracts live](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#where-contracts-live) in the root ARCHITECTURE.md).

```ts
// cf-loom.config.ts
import { defineConfig } from '@cf-loom/cli';

export const config = defineConfig({
  scope: '@org',                     // publishes @org/contract-orders-service
  layout: {                          // a Service only; each field is optional
    endpoint: 'src/billing/{name}.handler.ts',
    handlerMap: 'src/generated/handlers.generated.ts',
  },
});
```

`scope` is always required; `layout` is optional and a Service's only (see [The layout field](#the-layout-field)). `check` and `publish` read the registry through npm (see below); `generate`, `verify`, `package`, `broker-plan`, `openapi` and `asyncapi` run offline.

cf-loom reads and publishes through the `npm` on your `PATH`, run in the project's directory with its environment, so the registry and the login are your npm configuration, exactly as for installing: `@org:registry=` or `registry=` and an auth token in an `.npmrc` (the project's, yours, or one `NPM_CONFIG_USERCONFIG` names) or in `npm_config_*` variables. cf-loom has no registry or login setting of its own. `publish` runs `npm publish <folder> --tag <tag> --ignore-scripts` there: `latest` for a version that is not a prerelease, and for a prerelease while the package lists no version that is not a prerelease, else `next`, so the package always has the `latest` dist-tag `npm view` needs to list its versions. No lifecycle script of yours runs, and npm's `tag` setting and a `publishConfig.tag` are overridden: `--tag` is always given, and a Definitions Package's `publishConfig.tag` is left out of what is published, the rest of its `publishConfig` kept. Right before it runs `npm publish`, `publish` lists the package's versions again and exits 3 when a version higher than its Baseline was published meanwhile, so a version is not published against a Baseline that is no longer the highest; rerun it, which reads the registry again. The Baseline is the highest version `npm view` lists, a prerelease included. The version the Compatibility Check compares with is the Baseline, or with `check --against` the one it names; its `cfLoom` and peer ranges come from `npm view`, and only its tarball is downloaded, with `npm pack`, to read `snapshot.json`; cf-loom requires the tarball to hash to a sha512 that `npm view` lists for the version. A package npm cannot find counts as never published only when `npm whoami` reports a user on the registry your scope uses; a login that cannot read the package also looks unpublished, so the printed line names the registry and the user. Any npm error, a package that lists no version or has no `latest` dist-tag (which `npm view` needs to list them), a package whose versions were all unpublished, a highest version without `cfLoom` or of another kind, a tarball without a sha512 integrity or that does not hash to it, a tarball with a tar entry that `npm pack` does not write, such as a link or a GNU long name, or with a path that is not printable ASCII (0x20 to 0x7E) or holds a `:` or a `\`, such as a file named with an accented letter (cf-loom reads `snapshot.json` out of the tarball by hand, as `npm pack` writes tarballs for printable-ASCII paths without `:` or `\`, and refuses anything else, since npm could unpack it differently), or a `snapshot.json` that cannot be decoded fails with exit 3. So does a package npm cannot find when the registry that serves your scope, `@org:registry=` or else `registry=`, holds a user and password in its URL, which npm will not print: put them in a `//host/:_authToken` or `//host/:_auth` line instead. A registry URL in a printed line never carries a user or password.

A Contract Package is named `<scope>/contract-<name>`, and a Definitions Package `<scope>/<name>`. A Contract Package `cf-loom package` writes is `0.0.0`, in its package.json and in `contract.version`, so a Dependency declared on it records `against: '0.0.0'`; only `publish` derives a version. `publish` refuses a Definitions Package whose package.json is not named `<scope>/<name>`.

### The layout field

A Service places its Handler files, and the two files `generate` regenerates, with `layout`: each field is a path from the project's directory, written under `src/`, and a field left out keeps its default. `generate` writes the stub of each Handler at its path, the Handler map imports the Handlers from there, and `verify` compares the files there.

| Field | Places | Variables | Default |
| --- | --- | --- | --- |
| `endpoint` | an Endpoint's Handler | `{group}`, `{name}` | `src/endpoints/{group}/{name}.handler.ts` |
| `guard` | a Guard's Handler | `{name}` | `src/guards/{name}.handler.ts` |
| `command` | a Command's Handler, one per Message Version | `{group}`, `{name}`, `{version}` | `src/commands/{group}/{name}.v{version}.handler.ts` |
| `subscription` | a Subscription's Handler | `{group}`, `{name}` | `src/subscriptions/{group}/{name}.handler.ts` |
| `handlerMap` | the Handler map | none | `src/handlers.generated.ts` |
| `readers` | the readers | none | `src/readers.generated.ts` |

A path may hold the variables its field takes, each written in braces. `{group}` is the name of the Group that lists the Element; `{name}` is the Element's name in kebab-case, as files are named (`getOrder` is `get-order` and the Command `ChargeCard` is `charge-card`); `{version}` is the Message Version's number. With `endpoint: 'src/billing/{name}.handler.ts'`, the Endpoint `getOrder` has its Handler at `src/billing/get-order.handler.ts`.

A path that breaks one of these rules stops every command that reads the config with exit 3:

- It starts with `src/`, not `src/contract/`, which holds only the Contract.
- A Handler's path ends with `.handler.ts` and a generated file's with `.generated.ts`, so a formatter that skips `*.generated.ts` skips what `verify` compares, wherever the layout puts it; no folder ends with either.
- Each segment is not empty, does not start with a dot, and its text outside the variables holds only lower-case letters, digits, `-`, `_` and `.`: paths are portable, and two names never differ by case alone. A file name holds no `.d.`, which TypeScript reads as a declaration file.
- It holds only the variables its field takes in the table.
- `handlerMap` and `readers` are two files.

Two Elements at one Handler path fail `generate` and `verify` (exit 3), naming both, a path being one file whatever link leads to it: a `command` path without `{version}` fails while a Command declares two Message Versions that are not Retired. A Handler path that, once filled, lies under `src/contract/`, through a link too, fails `generate` and `verify` too (exit 3), naming its Element, as `src/{group}/{name}.handler.ts` does for a Group named `contract`. An Application or a Definitions Package has no Handlers, so a `layout` in its config fails with exit 3.

`generate` and `verify` claim no `*.handler.ts` by its path: the Handler map on disk, and any file `generate` wrote that is left at a path the layout no longer names, record every Handler cf-loom imports and the Element each one serves. A recorded Handler that the layout now places elsewhere is moved there by `generate`, which prints `Moved <old> to <new>`; one whose Element is Retired or no longer declared, or whose new path already holds a file, fails `generate` and `verify` (exit 1) with the line saying what to decide, and nothing is moved or written until none stands; so a changed `layout`, a changed default, a renamed Group or a renamed Element never leaves an implemented Handler behind a fresh stub. Any other `*.handler.ts`, such as a Lambda's, is yours, under every layout. A `*.generated.ts` under `src/`, outside `src/contract/`, that starts with `// Generated by cf-loom generate. Do not edit.` at neither `handlerMap` nor `readers` is the record `generate` reads before it writes; `generate` deletes it once the new files are written, printing `Deleted <path>`, and `verify` fails on it (exit 1). Inside the layout only `generate` places a file: what its lines ask of you is to delete a file or to move it off its path, never to put one at a path the layout names. To keep a gone Handler's code for the Element that replaces it, move the file off its path, run `generate`, which writes the replacement's stub and prints `Wrote <path>`, and put the code there. Move no Handler to a path the layout names and delete no generated file by hand: the Handler map names the old paths until `generate` rewrites it, so a path one Handler leaves and another takes cannot be told apart after a hand move, and a deleted map leaves nothing to move from.

## Commands

| Command | Does |
| --- | --- |
| `cf-loom init [service \| application \| definitions]` | Creates the root, `src/contract/index.ts` (or `src/definitions/index.ts`) exporting `contract`, `application` or `definitions`, and `cf-loom.config.ts` with the scope of package.json's name when there is none; it writes all of them or nothing, and never overwrites a file. When package.json's name has no scope and `cf-loom.config.ts` does not exist, it fails (exit 3): write the config by hand. A project has one root, exported under one name |
| `cf-loom add-endpoint <group> <name> <METHOD> <path> --visibility <v>` | Creates the Endpoint, its Group if new, and registers both |
| `cf-loom add-guard <name>` | Creates a Guard |
| `cf-loom add-rejection <CODE> --status <n>` | Creates a Rejection |
| `cf-loom add-event <Name> --visibility <v> [--version n]` | Creates an Event, or its next Message Version |
| `cf-loom add-command <Name> [--version n]` | Creates a Command, or its next Message Version |
| `cf-loom add-subscription <name> [<service>] <Name>@<n>` | Creates a Subscription to an Event, the Service's own unless `<service>` is given, in which case the Event is taken from that Service's installed Contract Package and a Dependency on it is added when none is listed |
| `cf-loom add-dependency <service> <endpoint>` | Adds an Endpoint of an installed Contract Package, by name, to the Dependency on it, which it creates when none is listed |
| `cf-loom generate` | Writes `contract.snapshot.json`, stamping `deprecatedAt` on an Endpoint it first sees Deprecated (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md); for a Service it also regenerates the Handler map (its Handlers, the readers file's `readers` and each Deprecated Endpoint's `deprecatedAt`) and the readers, `src/handlers.generated.ts` and `src/readers.generated.ts` unless the [layout](#the-layout-field) places them, moves each Handler the Handler map imported to where the layout now places it, deletes each file it wrote that is left at a path the layout no longer names, and writes the stub of every missing Handler (see [Stubs and the Handler map](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#stubs-and-the-handler-map) in the handlers README), while an Application or a Definitions Package gets `contract.snapshot.json` only, and `generate` and `verify` import only its root, not every file beside it, so none of the checks on what a file exports applies to it. It fails on an Endpoint, attached Guard, Command's Message Version or Subscription that nothing exports (no file under `src/contract/`, or its Definitions Package's entry), on an Endpoint, Event, Command's Message Version or Subscription that a file under `src/contract/` exports and no Group lists, on a Group such a file exports that the root does not list, on a Handler the Handler map imported whose Element is Retired or gone, or whose new path already holds a file, on a Handler path that is no file, on a Handler path under `src/contract/` and on two Elements at one Handler path, and then writes nothing |
| `cf-loom broker-plan [--prefix <p>] [--json]` | Prints the streams and durable consumers the Broker must hold for a Service, from the committed `contract.snapshot.json`, which must be what `generate` would write, as for `package`; it reads neither the registry nor the Broker (see [The broker plan](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#the-broker-plan) in the messaging README); `--json` prints it as one JSON line instead (see [broker-plan --json](#broker-plan---json)). An Application or a Definitions Package has none |
| `cf-loom openapi` | Prints an OpenAPI 3.1 document of every Endpoint of a Service as JSON, from the committed `contract.snapshot.json`, which must be what `generate` would write, apart from `generator`, as for `package`; it reads neither the registry nor the Broker, and writes no file: redirect it, `cf-loom openapi > openapi.json`. See [openapi](#openapi) for what it writes of each Endpoint, and [JSON Schema](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#json-schema) in SNAPSHOT.md for its schemas. An Application or a Definitions Package has none |
| `cf-loom asyncapi [--prefix <p>]` | Prints an AsyncAPI 3.1 document of every Event of a Service that is not Retired as JSON, from the committed `contract.snapshot.json`, which must be what `generate` would write, apart from `generator`, as for `package`; it reads neither the registry nor the Broker, and writes no file: redirect it, `cf-loom asyncapi > asyncapi.json`. `--prefix` puts the prefix in front of every address, as for `broker-plan`. See [asyncapi](#asyncapi) for what it writes of each Event, and [JSON Schema](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#json-schema) in SNAPSHOT.md for its schemas. An Application or a Definitions Package has none |
| `cf-loom verify` | Fails if `contract.snapshot.json`, the Handler map or the readers was edited or is out of date, if a Handler file the Handler map imports is missing or is no file, if a Handler the Handler map imported is left where the layout no longer places it, its Element is Retired or gone, or its new path already holds a file, or if a generated file is left at a path the layout no longer names. It also fails on a Handler path under `src/contract/` and on two Elements at one Handler path. It imports every file under `src/contract/`, as `generate` does, and fails on the same exports and the same unlisted declarations; it writes nothing |
| `cf-loom package [--out <dir>]` | Writes the Contract Package of a Service or an Application to `<dir>`, `.cf-loom/contract-package/` next to `cf-loom.config.ts` by default (it creates `.cf-loom/`, which holds only output, so keep it out of version control), ready for `tsc -p <dir>` (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md, which also says how `publish` generates it). It is generated from the committed `contract.snapshot.json`, which must be what `generate` would write, apart from `generator`, as `verify` compares it (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md). The folder must be missing, empty, or a previous output, which holds only what `package` writes (`package.json` with `cfLoom`, `snapshot.json`, `tsconfig.json`, `src/`), beside a build's `dist/` or an install's `node_modules/`, which are kept while the rest is replaced; anything else, a symbolic link included, is refused and left as it was; these rules apply to that folder alone, never to the rest of `.cf-loom/`. A Definitions Package has no Contract Package: `publish` publishes it from its own package.json and built files |
| `cf-loom check [--json] [--against <version\|dist-tag>]` | Runs the Compatibility Check of the committed `contract.snapshot.json`, which must be what `generate` would write, as for `package`, against the Baseline (the highest version the package lists, a prerelease included; `--against` names another version it lists, or a dist-tag whose version it lists, instead), and prints every Change with its class and Verdict; it exits 2 when a Change needs a Breaking Change Approval, which your review process enforces (see [Breaking Change Approval](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#breaking-change-approval) in COMPATIBILITY.md). `--json` prints one JSON line instead of the lines on stdout (see [check --json](#check---json)) |
| `cf-loom publish [--force] [--prerelease]` | Runs the Compatibility Check of the committed `contract.snapshot.json`, which must be what `generate` would write, against the Baseline, and fails on a Change that is refused; it never waits on a Breaking Change Approval. It derives the version (see [Versioning](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#versioning) in COMPATIBILITY.md), merges the Baseline's history into the Snapshot, and publishes through your npm. A Contract Package is generated as `package` writes it, in a temporary folder under `node_modules/.cache/cf-loom` of the project, built with the `typescript` installed there (TypeScript 7, whose `bin.tsc` `publish` runs), and published. A Definitions Package must be built first: its files as `npm pack` lists them are published with `snapshot.json` and `cfLoom` written in, its `version` set and its `peerDependencies` replaced by carets on the installed `zod` and `@cf-loom/contract`, as for a Contract Package; a `workspace:`, `catalog:`, `file:` or `link:` range in its `dependencies` or `optionalDependencies` fails, since npm publishes it unchanged and no registry can install it. `--prerelease` publishes `<version>-<n>` of the version it derives. When nothing changed, `--force` publishes a patch, and `--prerelease` publishes nothing unless `--force` is given. Over a Baseline that is a prerelease, `publish` promotes it instead, with or without `--force`, by publishing its numbers as a version that is not a prerelease, and `--prerelease --force` publishes the next prerelease of those numbers. A version that would not be above the Baseline, as `--prerelease` derives over a Baseline named by hand such as `1.1.0-rc.1`, exits 3: publish a version above it by hand. Until cf-loom 1.0.0 the Snapshot format is not frozen, so publish only prereleases, a Definitions Package included. It exits 3 when, right before `npm publish`, the package lists a version higher than its Baseline, and two publishes that derive the same version cannot both succeed: rerun the one that failed, which reads the registry again. |

Exit status: 0, done; 1, the check failed (a Change refused, or a root, or a Snapshot, generated file or Handler file that `generate` must fix); 2, a Change needs a Breaking Change Approval; 3, a tooling error (configuration, registry). Of what a command finds, 3 comes before 1, and 1 before 2; but a command stops at its first failure, so `check` with a stale Snapshot ends with 1 before it reads the registry. `publish`, `broker-plan`, `openapi` and `asyncapi` never exit 2.

## What the commands print and write

Each command prints one line per thing it did or found, never a stack trace; `openapi` and `asyncapi` print their documents instead:

| Command | Prints |
| --- | --- |
| `init` | `Created <root file>` |
| `generate` | `Moved <old> to <new>` for each Handler it moved, in code point order of `<old>`, then `Wrote <path>` for each file it wrote, `contract.snapshot.json` first, then the Handler map, the readers and each new stub, then `Deleted <path>` for each file it wrote that is left at a path the layout no longer names, in code point order |
| `verify` | `<path> is up to date` for each file it compared |
| `package` | `Wrote <dir>` |
| `check` | `Checked against <package>@<version>`, followed by `(version from <stable>)` when the Baseline is a prerelease above the highest version that is not one, `(no stable version: the first is <first>)` when the package lists only prereleases, `<first>` being 1.0.0 or, when higher, the numbers of the highest prerelease, or `(--against)` when `--against` named the version; then one line per Change, then `No Change against <package>@<version>` when there is none, or `No Change needs a Breaking Change Approval` when no Change is refused or needs one; with no Baseline, only `<package> has no Baseline: it is not in <registry> for the npm user <username>: never published, or that login cannot read it` |
| `broker-plan` | `Stream <stream>: <subject> …`, each subject separated by a space, then `Durable consumer <durable> on <stream>: <subject>` for each durable consumer, each in code point order, or `<service> needs no stream and no durable consumer` |
| `openapi` | the OpenAPI document as JSON indented by two spaces (see [openapi](#openapi)) |
| `asyncapi` | the AsyncAPI document as JSON indented by two spaces (see [asyncapi](#asyncapi)) |
| `publish` | `Checked against <package>@<version>` and one line per Change, or `<package> has no Baseline: <reason>`, as `check` prints them; then `Published <package>@<version>`, or `Nothing to publish: the Snapshot and peer ranges are those of <package>@<version>; --force publishes anyway`; and on stderr, with the exit status the publish had, `node_modules/.cache/cf-loom/publish-<id> was left behind: <reason>: delete it` when it could not remove the folder it staged the package in |

Every line on stdout or stderr, the `--json` document included, is written with each line break inside it (`\r`, `\n`, U+0085, U+2028 and U+2029) replaced by the visible text `\r`, `\n`, `\u0085`, `\u2028` and `\u2029`, so no reader splits a line there.

A Change is one line, `<site> <difference>[ <shape>][ at <path>][ (<position>)][ <field>=<value>…]: <class>[, <verdict>][; <hint>]`, in the order of the report: the kinds of the Difference and, for a schema, of its shape, from the tables below; its path, when it has one; its Position, when the path does not start with it; and every other field of the Difference and of its shape, in the order of the tables, as `name=value`. A `value` is written as JSON, so `1` and `"1"` differ. Any other path segment or text that is not made of ASCII letters, digits and `_ @ / $ -` is written as JSON too (`"two words"`, `"two\nlines"`), so a key with a space or a line break never splits the line. `<site>` is one of `endpoints.<identity> (<name>)`, `events.<Name@n>`, `commands.<Name@n>`, `codes.<CODE>`, `subscriptions.<name>`, `schemas.<name>` or `guards.<name>`. `<class>` is `Breaking`, `Additive` or `Neutral`, and the Verdict (see [Breaking Change Approval](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#breaking-change-approval) in COMPATIBILITY.md) adds to it `needs a Breaking Change Approval`, or `refused`; a Breaking Change that is allowed says `needs no Approval`, and an Additive or Neutral one that is allowed adds nothing:

```
endpoints.GET /orders/{} (getOrder) schema field-removed at success.body.total: Breaking, needs a Breaking Change Approval
endpoints.GET /orders/{} (fetchOrder) renamed from=getOrder to=fetchOrder baselineVisibility=public: Breaking, needs a Breaking Change Approval
events.OrderCreated@1 schema field-removed at body.total (message): Breaking, refused; make the change in a new Message Version
commands.ChargeCard@1 retired: Breaking, needs no Approval
```

The path is where the Difference is, in the author's terms: the part of the Endpoint it sits in (`input`, `success`; `params`, `query`, `headers`, `body`), a Rejection's `body`, or a Guard's `demands`; then `.field` for an object's field, `[]` for an array's items, `{}` for a record's value, `{key}` for its key, `[...]` for a tuple's `rest`, and `<discriminator=value>` for a variant of a discriminated union: `success.body.orders[].lines[].kind<type="a">.x`. A Change at the root of a shared schema has no path. The Position, `input`, `success` or `message`, is written after the path when the path does not start with it (`at body.total (message)`, `at demands.query.token (input)`).

The hint says how to avoid a Change, from a closed table; the first row that fits decides:

| When | Hint |
| --- | --- |
| `deleted` | `retire it instead, deprecating it first if it is not, and delete it once the Baseline has it Retired` |
| `retired-before-deprecated` | `deprecate it in one publish and retire it in a later one` |
| `header-refuses-text` | `accept any text` |
| `name-kind-changed` | `declare it under a new name` |
| a Breaking `field-added` that is required | `make it optional` |
| a Breaking `value-added` to a closed enum, when the Verdict needs an Approval | `declare it with openEnum, so readers take values added later` |
| a Breaking change to an Event's or a Command's body, or `identity-reused` on one | `make the change in a new Message Version` |

The kinds of a Difference, and the fields it carries besides the ones the line has words for. A `schema` Difference also carries `at`, its path from the site, and `position`, `input`, `success` or `message` (a shared schema is judged as a Message), and the kind of its shape; a `body-added` or `body-removed` carries `at` and a `position` of `input` or `success`; a `header-refuses-text` carries `at`:

| Kind | Fields | COMPATIBILITY.md |
| --- | --- | --- |
| `added` |  | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): add an Endpoint, Event or Command; [The Compatibility Check](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-compatibility-check): add a shared schema, Guard or Rejection to a Definitions Package |
| `deprecated` |  | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): mark an Element Deprecated |
| `reactivated` |  | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): bring a Deprecated Element back to Active |
| `retired` |  | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): retire an Element, and [Retirement](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#retirement) |
| `retired-before-deprecated` |  | [Retirement](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#retirement): every Element must be Deprecated in the Baseline before it can be Retired |
| `retired-brought-back` | `lifecycle` | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): bring a Retired Element back to Deprecated or Active |
| `tombstoned` |  | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): delete the declaration of an Element Retired in the Baseline |
| `deleted` |  | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): delete an Element not Retired in the Baseline |
| `identity-reused` |  | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): reuse the identity of a Retired Element, and [Subscriptions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#subscriptions): a removed Subscription's name is never reused |
| `version-gap` | `missing` | [Messages](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#messages): a Message Version added whose previous version neither the Baseline nor the declared Snapshot holds |
| `name-kind-changed` | `from` | [Messages](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#messages): a Message Version added under a name the Baseline holds as the other kind |
| `event-changed` | `from`, `to` | [Subscriptions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#subscriptions): a Subscription's Event never changes |
| `renamed` | `from`, `to`, `baselineVisibility` | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): rename an Endpoint |
| `shadowed` | `by` | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): add an Endpoint that takes a URL routing sent to an existing Endpoint |
| `visibility-widened` | `from`, `to` | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): widen Visibility |
| `visibility-narrowed` | `from`, `to` | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): narrow Visibility |
| `schema` | the shape's | the shape kinds below, in the tables of [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields), [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions), [Constraints](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#constraints) and [Records, arrays, tuples, intersections, recursion, opaque data](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#records-arrays-tuples-intersections-recursion-opaque-data) |
| `removed` |  | [The Compatibility Check](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-compatibility-check): remove a shared schema, Guard or Rejection from a Definitions Package |
| `status-changed` | `from`, `to` | [Bodies, Success status and headers](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#bodies-success-status-and-headers): change a Success's status; [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections): change the HTTP status of a code |
| `body-added` |  | [Bodies, Success status and headers](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#bodies-success-status-and-headers): add an Input body, or a body where a Success had none; [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections): a body where a Rejection had none, by the Success rules |
| `body-removed` |  | [Bodies, Success status and headers](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#bodies-success-status-and-headers): remove an Input body, or the body of a Success; [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections): the body of a Rejection, by the Success rules |
| `param-renamed` | `from`, `to` | [Headers, path and query](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#headers-path-and-query): rename a path param |
| `header-refuses-text` |  | [Headers, path and query](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#headers-path-and-query): add an optional Input header whose schema refuses some text |
| `rejection-added` | `code` | [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections): add a Rejection to an Endpoint; [Guards](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#guards): a Guard gaining a Rejection |
| `rejection-removed` | `code` | [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections): remove a Rejection from an Endpoint; [Guards](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#guards): a Guard losing a Rejection, by the Rejection rules |

The kinds of a shape, the `<shape>` of a `schema` Difference:

| Kind | Fields | COMPATIBILITY.md |
| --- | --- | --- |
| `field-added` | `required` | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields): add a required field, add an optional field |
| `field-removed` |  | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields): remove a field |
| `field-made-required` |  | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields): optional → required |
| `field-made-optional` |  | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields): required → optional |
| `nullability-added` |  | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields): add nullability |
| `nullability-removed` |  | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields): remove nullability |
| `value-added` | `value`, `enum` (`open` or `closed`, the Baseline's) | [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions): closed enum or Open Enum, add a value; change a literal |
| `value-removed` | `value` | [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions): closed enum or Open Enum, remove a value; change a literal |
| `enum-opened` |  | [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions): closed enum → Open Enum |
| `enum-closed` |  | [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions): Open Enum → closed enum |
| `enum-widened` | `to` | [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions): widen (literal → enum containing it, enum → its base type) |
| `enum-narrowed` | `from` | [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions): narrow (base type → enum, enum → literal) |
| `variant-added` |  | [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions): discriminated union, add a variant |
| `variant-removed` |  | [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions): discriminated union, remove a variant |
| `discriminator-changed` | `from`, `to` | [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions): discriminated union, rename the discriminator |
| `union-changed` |  | [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions): plain union or tuple, any change; discriminated union turned into a plain union |
| `type-changed` | `from`, `to` | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields): change a type |
| `constraint-tightened` | `constraint` | [Constraints](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#constraints): tighten, or add where there was none |
| `constraint-relaxed` | `constraint` | [Constraints](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#constraints): relax, or remove |
| `constraint-replaced` | `constraint` | [Constraints](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#constraints): replace a format, its options or a regex with a different one, or move `multipleOf` to a value that is neither a multiple nor a divisor |
| `rest-added` |  | [Records, arrays, tuples, intersections, recursion, opaque data](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#records-arrays-tuples-intersections-recursion-opaque-data): add a tuple's `rest` |
| `rest-removed` |  | [Records, arrays, tuples, intersections, recursion, opaque data](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#records-arrays-tuples-intersections-recursion-opaque-data): remove a tuple's `rest` |
| `unproven` | `node` (`tuple`, `allOf` or `param`) | [The Compatibility Check](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-compatibility-check): a change the tooling cannot prove compatible is Breaking, as under the plain-union rule of [Records, arrays, tuples, intersections, recursion, opaque data](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#records-arrays-tuples-intersections-recursion-opaque-data) |

A failure is one line on stderr. These are every line `init`, `generate`, `verify`, `package`, `check`, `broker-plan`, `openapi`, `asyncapi` and `publish` print, by exit status.

Exit 1, the check failed:

| Line | Command |
| --- | --- |
| `<location> <rule>: <message>`, `<location> not allowed: <construct> (use <instead>)`, one per rule the root breaks | `generate`, `verify`, `package`, `check`, `broker-plan`, `openapi`, `asyncapi`, `publish` |
| `endpoints.<name> is exported by no file under src/contract/` (`guards.<name>` for a Guard, `commands.<Name>@<version>` for a Command's Message Version, `subscriptions.<name>` for a Subscription) | `generate`, `verify` |
| `<file> exports <name>, which no Group lists: list it in a Group or delete it`, for an Endpoint, an Event, a Command's Message Version or a Subscription that a file under `src/contract/` exports, once, at the first file in code point order; `<name>` is `default` for a default export | `generate`, `verify` |
| `<file> exports <name>, which the root does not list: list it in groups or delete it`, for a Group, in place of a line for each declaration it lists | `generate`, `verify` |
| `guards.<name> is not exported by <package>`, for a Guard of a Definitions Package | `generate`, `verify` |
| `<path> is the Handler of <element>, which is now <path>: run cf-loom generate`, for a Handler `generate` moves; `<element>` is `endpoints.fetchOrder`, `guards.apiKey`, `commands.ChargeCard@1` or `subscriptions.auditCreated` | `verify` |
| `<path> is the Handler of <element>, which is now <path>, where a file already is: delete the one that is not its Handler` | `generate`, `verify` |
| `<path> is the Handler of <element>, which is Retired: delete it`; `<element>` is `endpoints.listOrders` or `commands.ChargeCard@1` | `generate`, `verify` |
| `<path> is the Handler of <element>, which is no longer declared: delete it, or move it off its path to keep its code for <element>`, when one Element of its kind lacks a Handler once every other line is followed; the first `<element>` is the name in code the Handler map keyed it under, `endpoints.getOrder`, `guards.apiKey`, `subscriptions.auditCreated` or `commands.chargeCardV1`, since `ChargeCard@1` is no longer in the Snapshot, and the second the Element that may replace it | `generate`, `verify` |
| `<path> is the Handler of <element>, which is no longer declared: delete it, or move it off its path to keep its code for the Element that replaces it, <element>, <element> or <element>`, when several lack one, and `…: delete it, or move it off its path to keep its code` when none does | `generate`, `verify` |
| `<path> is a file cf-loom generate wrote, at no path the layout names: run cf-loom generate` | `verify` |
| `<path> is no file: a Handler is a file` | `generate`, `verify` |
| `contract.snapshot.json is missing or out of date: run cf-loom generate` | `package`, `check`, `broker-plan`, `openapi`, `asyncapi`, `publish` |
| `<path> was edited or is out of date: run cf-loom generate` | `verify` |
| `<path> is missing: run cf-loom generate` | `verify` |
| `contract.snapshot.json was edited: it is no JSON (<reason>)` | `verify` |
| `The check failed: <n> Change(s) refused` | `check`, `publish` |

Exit 2, a Change needs a Breaking Change Approval, from `check` only: `publish`, `broker-plan`, `openapi` and `asyncapi` never exit 2.

| Line | Command |
| --- | --- |
| `<n> Breaking Change(s) need a Breaking Change Approval: your review process enforces it` | `check` |

Exit 3, a tooling error:

| Line | Command |
| --- | --- |
| `package.json not found: cf-loom runs next to the package.json of the project`, `package.json is no JSON: …`, `package.json cannot be read: …`, `package.json names no package`, `package.json names no package npm accepts: <name>`, `package.json has no "type": "module": the config and the Contract's files are ES modules` | every command |
| `cf-loom.config.ts not found: run cf-loom init`, `cf-loom.config.ts cannot be loaded: …`, `cf-loom.config.ts exports no config: export const config = defineConfig({ … })`, `cf-loom.config.ts threw while it was read: …`, `cf-loom.config.ts: scope is required, an npm scope such as '@org'`, and for a `layout` that breaks the rules of [The layout field](#the-layout-field), `cf-loom.config.ts: layout is an object of paths, such as { endpoint: 'src/http/{group}/{name}.handler.ts' }`, `cf-loom.config.ts: layout.<field> is no field of layout: it takes endpoint, guard, command, subscription, handlerMap and readers`, `cf-loom.config.ts: layout.<field> is a path such as '<its default>'`, `cf-loom.config.ts: layout.<field> must be under src/ and outside src/contract/: <path>`, `cf-loom.config.ts: layout.<field> must end with .handler.ts: <path>` (`.generated.ts` for `handlerMap` and `readers`), `cf-loom.config.ts: layout.<field> holds {<name>}, but <the field's path> takes only {<variables>}: <path>` (`takes no variable` for `handlerMap` and `readers`), `cf-loom.config.ts: layout.<field> has a segment that is empty, starts with a dot, or holds a character other than a-z, 0-9, -, _ and .: <path>`, `cf-loom.config.ts: layout.<field> has a folder ending .handler.ts or .generated.ts: <path>`, `cf-loom.config.ts: layout.<field> has a file name holding .d., which TypeScript reads as a declaration file: <path>`, `cf-loom.config.ts: layout.handlerMap and layout.readers are one file: <path>` | `generate`, `verify`, `package`, `check`, `broker-plan`, `openapi`, `asyncapi`, `publish` |
| ``cf-loom.config.ts: an Application has no Handlers, so it takes no `layout` ``, ``cf-loom.config.ts: a Definitions Package has no Handlers, so it takes no `layout` ``, for a config that sets a `layout` | `generate`, `verify`, `package`, `check`, `broker-plan`, `openapi`, `asyncapi`, `publish` |
| `No root in src/contract/index.ts or src/definitions/index.ts: run cf-loom init`, `A project has one root: both <file> and <file> exist`, `<file> cannot be loaded: …`, `<file> exports none of contract, application, definitions`, `<file> exports one root, not <name> and <name>`, `<file> threw while it was read: …` | `generate`, `verify`, `package`, `check`, `broker-plan`, `openapi`, `asyncapi`, `publish` |
| `<file> already exists`, `<folder> is no folder: init cannot write <file>`, `cf-loom.config.ts is no file`, `package.json names no scope to write cf-loom.config.ts with`, `init cannot write: …` | `init` |
| `<package> is not installed: install it to list it`, `<package> has no version in its package.json`, `<package> cannot be loaded: …`, for a listed Definitions Package | `generate`, `verify`, `package`, `check`, `broker-plan`, `openapi`, `asyncapi`, `publish` |
| `contract.snapshot.json cannot be read: …` | `generate`, `verify`, `package`, `check`, `broker-plan`, `openapi`, `asyncapi`, `publish` |
| `contract.snapshot.json is no JSON (<reason>): restore it or delete it, then run cf-loom generate` | `generate`, `package`, `check`, `broker-plan`, `openapi`, `asyncapi`, `publish` |
| `npm cannot be run: <reason>: cf-loom reads the registry through npm, which must be on PATH`, `<npm call> failed (<code>: <summary>)`, `<npm call> failed: <first line npm printed on stderr, or exit status <n>>`, `<npm call> printed no JSON: <line>`, `<npm call> printed more than 16 MiB`, `<npm call> did not finish within 10 minutes`, `<npm call> was stopped by <signal>`, where `<npm call>` is `npm view <package>`, `npm view <package> dist-tags`, `npm view <package>@<version>`, `npm pack <package>@<version>`, `npm publish <package>@<version>`, `npm pack --dry-run` or `npm config get <key>`, and `<summary>` is the first line of the summary npm printed, here and in the rows below | `check`, `publish` |
| `<package> was unpublished: <summary>; its Baseline is gone, so nothing can be checked against it`, `<package> lists no version, or has no latest dist-tag, which npm view needs to list them`, `<package> lists <key>, which is no semantic version` | `check`, `publish` |
| `<package> lists no version or dist-tag <name>: --against takes one of them`, which a package npm cannot find also gets | `check` |
| `<package> lists <version>, published while publish ran: rerun publish, which reads the registry again`, `<package>@<version> would not be above the Baseline <baseline>: publish a version above it by hand` | `publish` |
| `<package> is not in <registry>, and npm has no login there it accepts (<reason>): a package your login cannot read looks unpublished`, `npm did not say which registry serves <scope>`, `npm config get <key> failed: npm will not print a registry URL that holds credentials: put them in a //host/:_authToken or //host/:_auth line instead of in the registry URL`, where `<reason>` is `<code>: <summary>`, as npm refused `npm whoami`, `npm whoami printed no user name`, or a failure of `npm whoami` worded as the `<npm call>` lines above say | `check`, `publish` |
| `npm view <spec> printed no metadata`, `<spec> has no cfLoom: it was not published by cf-loom publish`, `<spec> is the package of kind <kind>, not <kind>`, `<spec> has peerDependencies that are no map of ranges`, `<spec> has no tarball`, `<spec> has no sha512 integrity, so its tarball cannot be verified`, where `<spec>` is `<package>@<version>` | `check`, `publish` |
| `npm pack <spec> printed no tarball`, `<spec>'s tarball does not match the sha512 integrity npm view lists`, `<spec> has no snapshot.json`, `<spec> has more than one snapshot.json`, `<spec>'s snapshot.json is no UTF-8 text` | `check`, `publish` |
| `<spec>'s tarball cannot be read: <reason>`, where `<reason>` is `is larger than 64 MiB`, `is larger than 64 MiB unpacked`, `is no gzip`, `is no tar archive`, `has data after its end`, `has a tar entry npm does not write`, `has a pax header npm does not write`, `has a pax header with a byte beyond ASCII`, `has a path npm does not write`, `has a path that is not printable ASCII, or that holds a ":" or a "\"`, `has a folder named snapshot.json`, or the message of the error that made the file unreadable | `check`, `publish` |
| `<spec>'s snapshot.json is no JSON (<reason>)`, `<spec>'s snapshot.json is in format <n>, newer than this cf-loom reads: upgrade @cf-loom/cli`, `<spec>'s snapshot.json is malformed: <location> <reason>`, `<spec>'s snapshot.json is <name>@<version> (<kind>), not <spec>` | `check`, `publish` |
| `<file> cannot be loaded: …`, for a file under `src/contract/` the root does not import | `generate`, `verify` |
| `<folder> cannot be read: …`, for a folder under `src/contract/` or under `src/` | `generate`, `verify` |
| `<file> cannot be read: …`, for a `*.generated.ts` file under `src/` outside `src/contract/` | `generate`, `verify` |
| `<path> cannot be written: …` | `generate`, `package` |
| `node_modules/.cache/cf-loom cannot be written: …`, for the folder `publish` stages a package in | `publish` |
| `<dir> cannot be read: …` | `package` |
| `<dir> holds files package did not write: package writes to a missing or empty folder, or over its own output` | `package` |
| `<dir> is no folder: package writes a folder` | `package` |
| `<dir> is a symbolic link: package writes a folder of its own` | `package` |
| `<peer> is not installed: the package's peer range is taken from it`, for `zod` or `@cf-loom/contract` | `package`, `publish` |
| `<peer> has no version in its package.json: the package's peer range is taken from it` | `package`, `publish` |
| `A Definitions Package has no Contract Package: it is published from its own source` | `package` |
| `An Application has no broker plan: only a Service's Messages travel through the Broker`, `A Definitions Package has no broker plan: only a Service's Messages travel through the Broker` | `broker-plan` |
| `An Application has no OpenAPI document: only a Service offers Endpoints`, `A Definitions Package has no OpenAPI document: only a Service offers Endpoints` | `openapi` |
| `An Application has no AsyncAPI document: only a Service publishes Events`, `A Definitions Package has no AsyncAPI document: only a Service publishes Events` | `asyncapi` |
| `<identity> and <identity> name path param <n> <name> and <name>: an OpenAPI path names it once, so rename one`, for two Endpoints on one path that name one of its params differently (`DELETE /orders/{} and GET /orders/{} name path param 1 id and orderId: …`) | `openapi` |
| `typescript is not installed: publish builds the Contract Package with its tsc`, `typescript has no version in its package.json: publish builds the Contract Package with its tsc`, `typescript has no tsc in its package.json bin` | `publish` |
| `<tsc call> failed: <first line tsc printed on stdout, else on stderr, else exit status <n>>`, `<tsc call> cannot be run: <reason>`, `<tsc call> printed more than 16 MiB`, `<tsc call> did not finish within 10 minutes`, `<tsc call> was stopped by <signal>`, where `<tsc call>` is `tsc on the Contract Package of <package>@<version>` | `publish` |
| `package.json names <name>, but a Definitions Package of scope <scope> publishes as <scope>/<name>` | `publish` |
| `package.json lists <name> in <field> as <range>, which npm cannot install from the registry`, for a `workspace:`, `catalog:`, `file:` or `link:` range in a Definitions Package's `dependencies` or `optionalDependencies`, `<field>` being the one that lists it | `publish` |
| `npm pack --dry-run listed no files` | `publish` |
| `<element> is <path>, under src/contract/, which holds only the Contract: give it another path in the layout of cf-loom.config.ts`, for the first Handler path in the Handler map's order that lies there once filled, where `<element>` is as in the next row | `generate`, `verify` |
| `<element> and <element> are both <path>: give each its own path in the layout of cf-loom.config.ts`, or `<element> and <element> are both the same file, <path> and <path>: give each its own path in the layout of cf-loom.config.ts` when a link makes two paths one file, where `<element>` is `endpoints.<name>`, `guards.<name>`, `commands.<Name>@<version>` or `subscriptions.<name>` | `generate`, `verify` |
| `cf-loom failed: [<file>:<line>: ]<what was thrown>`, for a throw, which is a bug of cf-loom, with the file of cf-loom's own package it was thrown in when its stack names one: with `--json`, stdout also holds `{"format":1,"status":3,"errors":[…]}` | every command |

Exit 3, a usage error, each followed on the same line by the usage:

| Line | Command |
| --- | --- |
| `Unknown command: <command>`, `Unknown command: (none)` with no command | any |
| `Unknown option: <option>` | any |
| `Only package takes --out` | any command but `package`, an unknown one included |
| `Only check and broker-plan take --json` | any command but `check` and `broker-plan`, an unknown one included |
| `Only broker-plan and asyncapi take --prefix` | any command but `broker-plan` and `asyncapi`, an unknown one included |
| `Only check takes --against` | any command but `check`, an unknown one included |
| `Only publish takes --force`, `Only publish takes --prerelease` | any command but `publish`, an unknown one included |
| `--out takes a folder` | `package` |
| `--against takes a version or a dist-tag` | `check` |
| `--prefix takes a prefix in kebab-case, such as staging` | `broker-plan`, `asyncapi` |
| `--json takes no value`, `--force takes no value`, `--prerelease takes no value` | any command |
| `Unknown kind: <kind>`, `init takes one kind` | `init` |
| `generate takes no argument`, `verify takes no argument`, `package takes no argument`, `check takes no argument`, `broker-plan takes no argument`, `openapi takes no argument`, `asyncapi takes no argument`, `publish takes no argument` | `generate`, `verify`, `package`, `check`, `broker-plan`, `openapi`, `asyncapi`, `publish` |

Every file `generate` regenerates starts with `// Generated by cf-loom generate. Do not edit.`, and every TypeScript file of a Contract Package with `// Generated by cf-loom package. Do not edit.`; stubs carry no such line, since they are the Service's to replace. A formatter must leave `contract.snapshot.json`, the Handler map and the readers byte for byte as `generate` writes them (`*.generated.ts` covers both wherever the layout places them), since `verify` compares them (and `package` the Snapshot) with what `generate` would write, and skip `.cf-loom/`, where `package` writes the Contract Package whole. What the Contract Package's package.json carries in `cfLoom`, and how `snapshotHash` is taken, is in [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) and [Canonical form](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#canonical-form) in SNAPSHOT.md.

### check --json

With `--json`, stdout holds exactly one line, this document, and stderr keeps its lines. A usage error is the one exception: it stays one line on stderr, with nothing on stdout (see the usage errors above). `path` is the path as the line writes it, and `hint` the hint it ends with:

```ts
type CheckJson =
  | { format: 1; status: 1 | 3; errors: string[] }   // the root's rules, a stale Snapshot (1); a tooling error (3)
  | {
      format: 1;
      status: 0 | 1 | 2;
      package: string;
      baseline: string | null;            // the version compared with: the Baseline, or the one --against names
      stable: string | null;              // the highest version the package lists that is not a prerelease
      reason: string | null;              // why there is no Baseline, as the line says it
      changes: {
        site:                             // where the Change is, with the Visibility that decides its bump
          | { kind: 'endpoint'; identity: string; name: string; visibility: Visibility }
          | { kind: 'event' | 'command'; identity: string; visibility: Visibility }
          | { kind: 'code'; code: string; visibility: Visibility }
          | { kind: 'subscription' | 'shared-schema' | 'guard'; name: string; visibility: Visibility };
        difference: { kind: string; /* … */ }; // the Difference, with the fields the tables above list; a schema Difference's `shape` is the object { kind: string; /* … */ } of its shape's fields, and `at` is the Snapshot's own path, ["success", "body", "fields", "total"]
        path: string | null;              // in the author's terms; none when the Difference has no `at`, or its `at` is the root of a shared schema
        class: 'breaking' | 'additive' | 'neutral';
        verdict: 'allowed' | 'approval-needed' | 'refused';
        hint: string | null;
      }[];
    };

type Visibility = 'public' | 'internal' | 'private';
```

A package that npm cannot find has no Baseline, and `check` still exits 0 without `--against`. To fail a pipeline when nothing was compared, test `baseline`, keeping `check`'s own status: `set -o pipefail; cf-loom check --json | jq -e '.baseline != null'`.

### broker-plan --json

With `--json`, stdout holds exactly one line: the plan, in the shape [The broker plan](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#the-broker-plan) in the messaging README shows, or, when `broker-plan` stops, `{ format: 1, status: 1 | 3, errors: string[] }`, as for `check --json`; stderr keeps its lines, and a usage error stays one line on stderr with nothing on stdout.

### openapi

`cf-loom openapi` prints one OpenAPI 3.1.1 document for the Service as JSON indented by two spaces; a failure prints nothing on stdout. `info` is the Service's name at version `0.0.0`, as `package` writes, and `tags` are the Groups that list an Endpoint, in code point order. The document names no `servers`, which belong to your organization, and the only security schemes it names are those of the `authorization` header (see below). It describes what `serve` answers, so every Endpoint is written, whatever its Visibility, and your organization filters them (`jq` on `x-cf-loom-visibility`). A body is keyed by `application/json`.

A path is the Endpoint's, each param written in braces (`GET /orders/{}` with `["orderId"]` is `/orders/{orderId}`); the paths are in code point order, and the Endpoints of one path share a path item, each under its method in lower case. OpenAPI allows one template per path, so two Endpoints that name a param of one path differently fail (see the exit 3 lines above). An OpenAPI operation holds:

| Field | From the Endpoint |
| --- | --- |
| `operationId`, `tags`, `description` | its name, its Group in a list, its description (left out when empty) |
| `deprecated: true` | a Deprecated or Retired Endpoint |
| `x-cf-loom-visibility`, `x-cf-loom-guards` | its Visibility, and its Guards as `[{ "guard": "apiKey", "qualifier": null }]`, as the Snapshot lists them |
| `parameters` | the path params in the path's order (`in: path`, required), then each query field, then each header field, Guards' demands included but the `authorization` header, names as the Snapshot stores them; `required` as declared, a list query param has an `array` schema, and the schema's `description` is also on the parameter. OpenAPI tools ignore a header parameter named `accept`, which is written all the same |
| `requestBody` | the Input body, required, as JSON; none when it has none |
| `responses` | by status, below |
| `security` | the `authorization` header's schemes, below; none without that header |

The responses are one per status, in status order; when several answer one status they are joined, their descriptions with `; ` and their schemas as `oneOf`. A Rejection answers as a body of `{ "$ref": "#/components/schemas/<CODE>" }`, described `<CODE>: <message>`:

| Status | Response |
| --- | --- |
| the Success's | `Success`, with its headers (each with its `description`) and its body; none for a body-less Success such as a 204 |
| each Rejection code's | the Endpoint's own, its Guards', invalid-input and not-implemented, and not-found when it lists it |
| 500 and 503 | `FaultEnvelope`: a Fault that is not retryable (or `INVALID_OUTCOME`), and a retryable one |
| 413 | `FaultEnvelope`, for `BODY_TOO_LARGE`, only for an Endpoint with an Input body, and when `serve` is given `maxBodyBytes` |

A Deprecated Endpoint's every response carries the header `deprecation` with the `const` `@<unix seconds>` of its `deprecatedAt`. A Retired Endpoint that is still declared answers only `410` with `RETIRED`, before any Guard, so it keeps its path params and nothing else of its Input.

The `authorization` header is no header parameter, since OpenAPI tools ignore one: it is a security scheme. Each Guard of an Endpoint that is not Retired that demands an `authorization` header is the scheme `components.securitySchemes.<Guard name>`, `{ "type": "apiKey", "in": "header", "name": "authorization" }`; an `authorization` header that no Guard demands, so the Endpoint's own, is the scheme `authorization`. The OpenAPI operation's `security` is one requirement naming every such scheme in code point order, followed by `{}` as an alternative when the header is optional. A document with no such header has no `securitySchemes`.

A literal or closed enum of values of different JSON types, such as `z.literal(['a', 1])`, is written with a `type` list and its `enum`; as a query param or header, a validator that coerces text to the first type that fits may refuse text `serve` accepts (`"1"`).

`components.schemas`, in code point order, holds: `RejectionEnvelope` and `FaultEnvelope`, as [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md describes them; one component per code an Endpoint that is not Retired answers, the `RejectionEnvelope` narrowed to its code as a `const`, any `message` text, and the body it declares (`false`, with no `body` key, when it declares none); and each recursive def a written schema reaches, as `<Id>Def` (see [JSON Schema](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#json-schema) in SNAPSHOT.md).

### asyncapi

`cf-loom asyncapi` prints one AsyncAPI 3.1.0 document for the Service as JSON indented by two spaces; a failure prints nothing on stdout. `info` is the Service's name at version `0.0.0`, as `package` writes, with `tags`, the Groups of the Events it writes, each once, in code point order, and `defaultContentType` is `application/json`, since every body is JSON. The document names no `servers`, which belong to your organization. It describes what the Service's EventPublisher publishes (see [Publishing and sending](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#publishing-and-sending) in the messaging README), so every Event that is not Retired is written, whatever its Visibility, and your organization filters them (`jq` on `x-cf-loom-visibility`, below). Only Events are written: no Command, and no Subscription, since a Subscription to another Service's Event is described by its Provider's document.

Each Message Version is a channel keyed by its identity (`OrderCreated@2`), in code point order, with one AsyncAPI message and one AsyncAPI operation keyed by the same identity:

| Field | From the Message Version |
| --- | --- |
| `channels.<identity>.address` | its subject, `orders-service.event.OrderCreated.v2`, with the prefix in front when `--prefix` is given (see [Over the Broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) in the root ARCHITECTURE.md) |
| `channels.<identity>.x-cf-loom-visibility` | its Visibility, `internal` or `private` |
| `messages.<identity>.name`, `title` | the Event's name, and the identity |
| `messages.<identity>.description` | the Event's description (left out when empty) |
| `messages.<identity>.headers` | `{ "$ref": "#/components/schemas/BrokerHeaders" }` |
| `messages.<identity>.payload` | the body as JSON Schema draft-07, which AsyncAPI's Schema Object extends (see [JSON Schema](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#json-schema) in SNAPSHOT.md); since AsyncAPI ignores what sits beside a `$ref`, a recursive def with a `description` or `examples` is `{ "allOf": [{ "$ref": … }], "description": … }`, and `deprecated: true` is added for a Deprecated Message Version, beside that `allOf` (which a body that is a bare `$ref` gets for the purpose) |
| `operations.<identity>` | `{ "action": "send", "channel": { "$ref": "#/channels/<identity>" }, "tags": [{ "name": "<its Group>" }], "messages": [{ "$ref": "#/channels/<identity>/messages/<identity>" }] }` |

A Retired Message Version is not published, so it has no channel and no AsyncAPI operation, and a recursive def only it reaches is no component. AsyncAPI has no `deprecated` on a channel, an AsyncAPI message or an AsyncAPI operation, which is why a Deprecated Message Version marks its `payload`.

`components.schemas`, in code point order, holds `BrokerHeaders`, when the document has a channel, and each recursive def a `payload` reaches, as `<Id>Def`. `BrokerHeaders` describes the headers every Message travels with (see [Over the Broker](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-the-broker) in the root ARCHITECTURE.md): `Cf-Loom-Fact-Id` and `Nats-Msg-Id` are required, non-empty strings, and any other header is a string; transport headers are those outside the `Cf-Loom-` and `Nats-` namespaces.

To keep the channels a Subscriber may read, drop the Private ones and their AsyncAPI operations:

```sh
cf-loom asyncapi | jq '[.channels | to_entries[] | select(.value["x-cf-loom-visibility"] == "private") | .key] as $private | del(.channels[$private[]], .operations[$private[]])'
```
