# @cf-loom/cli

The `cf-loom` command and `defineConfig`; how its `src/` is split into modules is in [ARCHITECTURE.md](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/ARCHITECTURE.md). Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md); the Compatibility Check the command runs is in [COMPATIBILITY.md](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md), and the Snapshot it writes in [SNAPSHOT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md).

## Configuration

Each Service, Application or Definitions Package configures the tools in `cf-loom.config.ts`, next to its package.json: at the root of its repository, or in its own directory of a monorepo, where the CLI runs. The CLI reads its `config` export; it is never part of the Snapshot or the published package. Like the Contract's files, it is erasable TypeScript (see [Where Contracts live](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#where-contracts-live) in the root ARCHITECTURE.md).

```ts
// cf-loom.config.ts
import { defineConfig } from '@cf-loom/cli';

export const config = defineConfig({
  scope: '@org',                     // publishes @org/contract-orders-service
});
```

`scope` is always required. `check`, `publish`, `broker-plan` and `route-plan` read the registry through npm (see below); `generate`, `verify` and `package` run offline.

cf-loom reads and publishes through the `npm` on your `PATH`, run in the project's directory with its environment, so the registry and the login are your npm configuration, exactly as for installing: `@org:registry=` or `registry=` and an auth token in an `.npmrc` (the project's, yours, or one `NPM_CONFIG_USERCONFIG` names) or in `npm_config_*` variables. cf-loom has no registry or login setting of its own. The Baseline is the highest version `npm view` lists that is not a prerelease; its `cfLoom` and peer ranges come from `npm view`, and only its tarball is downloaded, with `npm pack`, to read `snapshot.json`; cf-loom requires the tarball to hash to a sha512 that `npm view` lists for the version. A package npm cannot find counts as never published only when `npm whoami` reports a user on the registry your scope uses; a login that cannot read the package also looks unpublished, so the printed line names the registry and the user. Any npm error, a package that lists no version or has no `latest` dist-tag (which `npm view` needs to list them), a package whose versions were all unpublished, a highest version without `cfLoom` or of another kind, a tarball without a sha512 integrity or that does not hash to it, a tarball with a tar entry that `npm pack` does not write, such as a link or a GNU long name, or with a path that is not printable ASCII (0x20 to 0x7E) or holds a `:` or a `\`, such as a file named with an accented letter (cf-loom reads `snapshot.json` out of the tarball by hand, as `npm pack` writes tarballs for printable-ASCII paths without `:` or `\`, and refuses anything else, since npm could unpack it differently), or a `snapshot.json` that cannot be decoded fails with exit 3. So does a package npm cannot find when the registry that serves your scope, `@org:registry=` or else `registry=`, holds a user and password in its URL, which npm will not print: put them in a `//host/:_authToken` or `//host/:_auth` line instead. A registry URL in a printed line never carries a user or password.

A Contract Package is named `<scope>/contract-<name>`, and a Definitions Package `<scope>/<name>`. A Contract Package `cf-loom package` writes is `0.0.0`, in its package.json and in `contract.version`, so a Dependency declared on it records `against: '0.0.0'`; only `publish` derives a version.

## Commands

| Command | Does |
| --- | --- |
| `cf-loom init [service \| application \| definitions]` | Creates the root, `src/contract/index.ts` (or `src/definitions/index.ts`) exporting `contract`, `application` or `definitions`, and `cf-loom.config.ts` with the scope of package.json's name when there is none; it writes all of them or nothing, and never overwrites a file. When package.json's name has no scope and `cf-loom.config.ts` does not exist, it fails (exit 3): write the config by hand. A project has one root, exported under one name |
| `cf-loom add-endpoint <group> <name> <METHOD> <path> --visibility <v>` | Creates the Endpoint, its Group if new, and registers both |
| `cf-loom add-guard <name>` | Creates a Guard |
| `cf-loom add-rejection <CODE> --status <n>` | Creates a Rejection |
| `cf-loom add-event <Name> --visibility <v> [--version n]` | Creates an Event, or its next Message Version |
| `cf-loom add-command <Name> [--version n]` | Creates a Command, or its next Message Version |
| `cf-loom add-subscription <name> [<service>] <Name>@<n>` | Creates a Subscription to an Event, the Service's own unless `<service>` is given, in which case the Event is also added to the Dependencies |
| `cf-loom add-dependency <service> <element>` | Adds an Element of an installed Contract Package to the Dependencies: an Endpoint by name, an Event as `<Name>@<n>` |
| `cf-loom generate` | Writes `contract.snapshot.json`, stamping `deprecatedAt` on an Endpoint it first sees Deprecated (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md); for a Service it also regenerates `src/handlers.generated.ts` (its Handlers and each Deprecated Endpoint's `deprecatedAt`) and `src/readers.generated.ts`, and writes the stub of every missing Handler (see [Stubs and the Handler map](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#stubs-and-the-handler-map) in the handlers README), while an Application or a Definitions Package gets `contract.snapshot.json` only. It fails on an Endpoint or attached Guard that nothing exports under its name (no file under `src/contract/`, or its Definitions Package), on a Handler file that no declared Endpoint, Guard, Command's Message Version or Subscription names, on a Handler path that is no file and on a name `src/readers.generated.ts` cannot write (see the exit 3 lines below), and then writes nothing |
| `cf-loom broker-plan [--prefix <p>] [--json] [--limits-skeleton] [--orphans]` | Prints the streams, durable consumers, orphaned durable consumers and permissions the broker must hold; `--limits-skeleton` prints the `limits` for `apply` with every key empty, `--orphans` reads the broker and lists the orphaned durable consumers with their pending counts (see [The broker plan](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#the-broker-plan) in the messaging README) |
| `cf-loom route-plan [--json]` | Prints every route with its Visibility, and the Retired ones, for the organization's gateway or ingress |
| `cf-loom openapi` | Writes an OpenAPI 3.1 document of the Endpoints from the Snapshot (see [JSON Schema](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#json-schema) in SNAPSHOT.md) |
| `cf-loom asyncapi` | Writes an AsyncAPI document of the Events from the Snapshot (see [JSON Schema](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#json-schema) in SNAPSHOT.md) |
| `cf-loom verify` | Fails if `contract.snapshot.json`, `src/handlers.generated.ts` or `src/readers.generated.ts` was edited or is out of date, if a Handler file the Handler map imports is missing or is no file, or if a Handler file names no declared Endpoint, Guard, Command's Message Version or Subscription. It also fails on a name `src/readers.generated.ts` cannot write (see the exit 3 lines below). It compares files only and imports no file under `src/contract/` beyond what the root imports, so it does not repeat `generate`'s export checks; it writes nothing |
| `cf-loom package [--out <dir>]` | Writes the Contract Package of a Service or an Application to `<dir>`, `contract-package/` next to `cf-loom.config.ts` by default, ready for `tsc -p <dir>` (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md, which also says how `publish` generates it). It is generated from the committed `contract.snapshot.json`, which must be what `generate` would write, apart from `generator`, as `verify` compares it (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md). The folder must be missing, empty, or a previous output, which holds only what `package` writes (`package.json` with `cfLoom`, `snapshot.json`, `tsconfig.json`, `src/`), beside a build's `dist/` or an install's `node_modules/`, which are kept while the rest is replaced; anything else, a symbolic link included, is refused and left as it was. A Definitions Package has no Contract Package: it is published from its own source |
| `cf-loom check [--json]` | Runs the Compatibility Check of the committed `contract.snapshot.json`, which must be what `generate` would write, as for `package`, against the Baseline, and prints every Change with its class; it exits 2 when a Change needs a Breaking Change Approval, which your review process enforces (see [Breaking Change Approval](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#breaking-change-approval) in COMPATIBILITY.md). `--json` prints one JSON line instead of the lines on stdout (see [check --json](#check---json)) |
| `cf-loom publish [--force]` | Builds the Contract, writes the Snapshot, derives the version and publishes the Contract Package (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md); `--force` publishes even when nothing changed (see [Versioning](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#versioning) in COMPATIBILITY.md) |

Exit status: 0, done; 1, the check failed (something Not allowed, or a root, or a Snapshot, generated file or Handler file that `generate` must fix); 2, a Change needs a Breaking Change Approval; 3, a tooling error (configuration, registry). Of what a command finds, 3 comes before 1, and 1 before 2; but a command stops at its first failure, so `check` with a stale Snapshot ends with 1 before it reads the registry.

## What the commands print and write

Each command prints one line per thing it did or found, never a stack trace:

| Command | Prints |
| --- | --- |
| `init` | `Created <root file>` |
| `generate` | `Wrote <path>` for each file it wrote, `contract.snapshot.json` first, then the Handler map, the readers and each new stub |
| `verify` | `<path> is up to date` for each file it compared |
| `package` | `Wrote <dir>` |
| `check` | `Checked against <package>@<version>`, then one line per Change, then `No Change against <package>@<version>` when there is none, or `No Change needs a Breaking Change Approval` when no Change is Not allowed or needs one; with no Baseline, only `<package> has no Baseline: it is not in <registry> for the npm user <username>: never published, or that login cannot read it`, or `<package> has no Baseline: it has only prereleases, the highest <version>` |

A Change is one line, `<site> <difference>[ <shape>][ at <path>][ (<position>)][ <field>=<value>…]: <class>`, in the order of the report: the kinds of the Difference and, for a schema, of its shape, from the tables below; the path and Position of a schema; and every other field of the Difference and of its shape, in the order of the tables, as `name=value`. A `value` is written as JSON, so `1` and `"1"` differ. Any other path segment or text that is not made of letters, digits and `_ @ / { } $ -` is written as JSON too (`"two words"`, `"two\nlines"`), so a key with a space or a line break never splits the line. `<site>` is one of `endpoints.<identity>`, `events.<Name@n>`, `commands.<Name@n>`, `codes.<CODE>`, `subscriptions.<name>`, `schemas.<name>` or `guards.<name>`, and `<class>` is one of `Breaking, needs a Breaking Change Approval`, `Breaking, needs no Approval`, `Additive`, `Neutral` or `Not allowed`:

```
endpoints.GET /orders/{} schema field-removed at success.body.fields.total (success): Breaking, needs a Breaking Change Approval
endpoints.GET /orders/{} renamed from=getOrder to=fetchOrder visibility=public: Breaking, needs a Breaking Change Approval
commands.ChargeCard@1 retired: Breaking, needs no Approval
```

The kinds of a Difference, and the fields it carries besides the ones the line has words for. A `schema` Difference also carries `at`, its path from the site, and `position`, `input`, `success`, `message` or `every` (a shared schema, judged in all three), and the kind of its shape:

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
| `renamed` | `from`, `to`, `visibility` | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): rename an Endpoint |
| `shadowed` | `by` | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): add an Endpoint that takes a URL routing sent to an existing Endpoint |
| `visibility-widened` | `from`, `to` | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): widen Visibility |
| `visibility-narrowed` | `from`, `to` | [Elements](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#elements): narrow Visibility |
| `schema` | the shape's | the shape kinds below, in the tables of [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields), [Enums, literals and unions](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#enums-literals-and-unions), [Constraints](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#constraints) and [Records, arrays, tuples, intersections, recursion, opaque data](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#records-arrays-tuples-intersections-recursion-opaque-data) |
| `removed` |  | [The Compatibility Check](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-compatibility-check): remove a shared schema, Guard or Rejection from a Definitions Package |
| `status-changed` | `from`, `to` | [Bodies, Success status and headers](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#bodies-success-status-and-headers): change a Success's status; [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections): change the HTTP status of a code |
| `body-added` |  | [Bodies, Success status and headers](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#bodies-success-status-and-headers): add an Input body, or a body where a Success had none |
| `body-removed` |  | [Bodies, Success status and headers](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#bodies-success-status-and-headers): remove an Input body, or the body of a Success |
| `param-renamed` | `from`, `to` | [Headers, path and query](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#headers-path-and-query): rename a path param |
| `header-refuses-text` |  | [Headers, path and query](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#headers-path-and-query): add an optional Input header whose schema refuses some text |
| `rejection-added` | `code` | [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections): add a Rejection to an Endpoint |
| `rejection-removed` | `code` | [Rejections](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#rejections): remove a Rejection from an Endpoint |

The kinds of a shape, the `<shape>` of a `schema` Difference:

| Kind | Fields | COMPATIBILITY.md |
| --- | --- | --- |
| `field-added` | `required` | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields): add a required field, add an optional field |
| `field-removed` |  | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields): remove a field |
| `key-removed` |  | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields): remove a key from a record keyed by an enum or literal |
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
| `mode-changed` | `from`, `to` (`open` or `strict`) | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields): change a type |
| `type-changed` | `from`, `to` | [Fields](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#fields): change a type |
| `constraint-tightened` | `constraint` | [Constraints](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#constraints): tighten, or add where there was none |
| `constraint-relaxed` | `constraint` | [Constraints](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#constraints): relax, or remove |
| `constraint-replaced` | `constraint` | [Constraints](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#constraints): replace a format, its options or a regex with a different one, or move `multipleOf` to a value that is neither a multiple nor a divisor |
| `rest-added` |  | [Records, arrays, tuples, intersections, recursion, opaque data](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#records-arrays-tuples-intersections-recursion-opaque-data): add a tuple's `rest` |
| `rest-removed` |  | [Records, arrays, tuples, intersections, recursion, opaque data](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#records-arrays-tuples-intersections-recursion-opaque-data): remove a tuple's `rest` |
| `unproven` | `node` (`tuple`, `allOf` or `param`) | [The Compatibility Check](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#the-compatibility-check): a change the tooling cannot prove compatible is Breaking, as under the plain-union rule of [Records, arrays, tuples, intersections, recursion, opaque data](https://github.com/CasitaFeliz/cf-loom/blob/main/COMPATIBILITY.md#records-arrays-tuples-intersections-recursion-opaque-data) |

A failure is one line on stderr. These are every line `init`, `generate`, `verify`, `package` and `check` print, by exit status.

Exit 1, the check failed:

| Line | Command |
| --- | --- |
| `<location> <rule>: <message>`, `<location> not allowed: <construct> (use <instead>)`, one per rule the root breaks | `generate`, `verify`, `package`, `check` |
| `endpoints.<name> is exported by no file under src/contract/` (`guards.<name>` for a Guard) | `generate` |
| `endpoints.<name> is not exported as <name>` (`guards.<name>` for a Guard) | `generate` |
| `guards.<name> is not exported as <name> by <package>`, for a Guard of a Definitions Package | `generate` |
| `<path> names no declared Endpoint, Guard, Command's Message Version or Subscription: delete it` | `generate`, `verify` |
| `<path> is no file: a Handler is a file` | `generate`, `verify` |
| `contract.snapshot.json is missing or out of date: run cf-loom generate` | `package`, `check` |
| `<path> was edited or is out of date: run cf-loom generate` | `verify` |
| `<path> is missing: run cf-loom generate` | `verify` |
| `contract.snapshot.json was edited: it is no JSON (<reason>)` | `verify` |
| `The check failed: <n> Change(s) not allowed` | `check` |

Exit 2, a Change needs a Breaking Change Approval:

| Line | Command |
| --- | --- |
| `<n> Breaking Change(s) need a Breaking Change Approval: your review process enforces it` | `check` |

Exit 3, a tooling error:

| Line | Command |
| --- | --- |
| `package.json not found: cf-loom runs next to the package.json of the project`, `package.json is no JSON: …`, `package.json cannot be read: …`, `package.json names no package`, `package.json names no package npm accepts: <name>`, `package.json has no "type": "module": the config and the Contract's files are ES modules` | every command |
| `cf-loom.config.ts not found: run cf-loom init`, `cf-loom.config.ts cannot be loaded: …`, `cf-loom.config.ts exports no config: export const config = defineConfig({ … })`, `cf-loom.config.ts threw while it was read: …`, `cf-loom.config.ts: scope is required, an npm scope such as '@org'` | `generate`, `verify`, `package`, `check` |
| `No root in src/contract/index.ts or src/definitions/index.ts: run cf-loom init`, `A project has one root: both <file> and <file> exist`, `<file> cannot be loaded: …`, `<file> exports none of contract, application, definitions`, `<file> exports one root, not <name> and <name>`, `<file> threw while it was read: …` | `generate`, `verify`, `package`, `check` |
| `<file> already exists`, `<folder> is no folder: init cannot write <file>`, `cf-loom.config.ts is no file`, `package.json names no scope to write cf-loom.config.ts with`, `init cannot write: …` | `init` |
| `<package> is not installed: install it to list it`, `<package> has no version in its package.json`, `<package> cannot be loaded: …`, for a listed Definitions Package | `generate`, `verify`, `package`, `check` |
| `contract.snapshot.json cannot be read: …` | `generate`, `verify`, `package`, `check` |
| `contract.snapshot.json is no JSON (<reason>): restore it or delete it, then run cf-loom generate` | `generate`, `package`, `check` |
| `npm cannot be run: <reason>: cf-loom reads the registry through npm, which must be on PATH`, `<npm call> failed (<code>: <summary>)`, `<npm call> failed: <first line npm printed on stderr, or exit status <n>>`, `<npm call> printed no JSON: <line>`, `<npm call> printed more than 16 MiB`, `<npm call> did not finish within 10 minutes`, `<npm call> was stopped by <signal>`, where `<npm call>` is `npm view <package>`, `npm view <package>@<version>`, `npm pack <package>@<version>`, `npm config get <key>` or `npm whoami` | `check` |
| `<package> was unpublished: <summary>; its Baseline is gone, so nothing can be checked against it`, `<package> lists no version, or has no latest dist-tag, which npm view needs to list them`, `<package> lists <key>, which is no semantic version` | `check` |
| `<package> is not in <registry>, and npm has no login there it accepts (<reason>): a package your login cannot read looks unpublished`, `npm did not say which registry serves <scope>`, `npm config get <key> failed: npm will not print a registry URL that holds credentials: put them in a //host/:_authToken or //host/:_auth line instead of in the registry URL` | `check` |
| `npm view <spec> printed no metadata`, `<spec> has no cfLoom: it was not published by cf-loom publish`, `<spec> is the package of kind <kind>, not <kind>`, `<spec> has peerDependencies that are no map of ranges`, `<spec> has no tarball`, `<spec> has no sha512 integrity, so its tarball cannot be verified`, where `<spec>` is `<package>@<version>` | `check` |
| `npm pack <spec> printed no tarball`, `<spec>'s tarball does not match the sha512 integrity npm view lists`, `<spec> has no snapshot.json`, `<spec> has more than one snapshot.json`, `<spec>'s snapshot.json is no UTF-8 text` | `check` |
| `<spec>'s tarball cannot be read: <reason>`, where `<reason>` is `is larger than 64 MiB`, `is larger than 64 MiB unpacked`, `is no gzip`, `is no tar archive`, `has data after its end`, `has a tar entry npm does not write`, `has a pax header npm does not write`, `has a pax header with a byte beyond ASCII`, `has a path npm does not write`, `has a path that is not printable ASCII, or that holds a ":" or a "\"`, `has a folder named snapshot.json`, or the message of the error that made the file unreadable | `check` |
| `<spec>'s snapshot.json is no JSON (<reason>)`, `<spec>'s snapshot.json is in format <n>, newer than this cf-loom reads: upgrade @cf-loom/cli`, `<spec>'s snapshot.json is malformed: <location> <reason>`, `<spec>'s snapshot.json is <name>@<version> (<kind>), not <spec>` | `check` |
| `<file> cannot be loaded: …`, for a file under `src/contract/` the root does not import | `generate` |
| `<folder> cannot be read: …`, for a folder under `src/contract/` or the Handlers' folders | `generate`, `verify` |
| `<path> cannot be written: …` | `generate`, `package` |
| `<dir> cannot be read: …` | `package` |
| `<dir> holds files package did not write: package writes to a missing or empty folder, or over its own output` | `package` |
| `<dir> is no folder: package writes a folder` | `package` |
| `<dir> is a symbolic link: package writes a folder of its own` | `package` |
| `<peer> is not installed: a Contract Package is built with it`, for `zod` or `@cf-loom/contract` | `package` |
| `<peer> has no version in its package.json: a Contract Package is built with it` | `package` |
| `A Definitions Package has no Contract Package: it is published from its own source` | `package` |
| `The codes <code> and <code> are one name in code: rename one of them` | `package` |
| `The recursion id <id> is no name in code: rename it` | `generate`, `verify`, `package` |
| `The recursion ids <id> and <id> are one name in code: rename one of them` | `generate`, `verify`, `package` |
| `subscriptions.<name> is <name in code> in code, as <other> is: rename the Subscription`, where `<other>` is another Subscription, a Command's Message Version, an own Event's or Command's Reader, a def or an import of `src/readers.generated.ts` | `generate`, `verify` |
| `cf-loom failed: <what was thrown>`, for a throw, which is a bug of cf-loom: with `check --json`, stdout also holds `{"status":3,"errors":[…]}` | every command |

Exit 3, a usage error, each followed on the same line by the usage:

| Line | Command |
| --- | --- |
| `Unknown command: <command>`, `Unknown command: (none)` with no command | any |
| `Unknown option: <option>` | any |
| `Only package takes --out` | any command but `package`, an unknown one included |
| `Only check takes --json` | any command but `check`, an unknown one included |
| `--out takes a folder` | `package` |
| `--json takes no value` | any command |
| `Unknown kind: <kind>`, `init takes one kind` | `init` |
| `generate takes no argument`, `verify takes no argument`, `package takes no argument`, `check takes no argument` | `generate`, `verify`, `package`, `check` |

Every file `generate` regenerates starts with `// Generated by cf-loom generate. Do not edit.`, and every TypeScript file of a Contract Package with `// Generated by cf-loom package. Do not edit.`; stubs carry no such line, since they are the Service's to replace. A formatter must leave `contract.snapshot.json`, `src/handlers.generated.ts` and `src/readers.generated.ts` byte for byte as `generate` writes them, since `verify` compares them (and `package` the Snapshot) with what `generate` would write, and skip `contract-package/`, which `package` writes whole. What the Contract Package's package.json carries in `cfLoom`, and how `snapshotHash` is taken, is in [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) and [Canonical form](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#canonical-form) in SNAPSHOT.md.

### check --json

With `--json`, stdout holds exactly one line, this document, and stderr keeps its lines. A usage error is the one exception: it stays one line on stderr, with nothing on stdout (see the usage errors above). `at` is the path as the line writes it:

```ts
type CheckJson =
  | { status: 1 | 3; errors: string[] }   // the root's rules, a stale Snapshot (1); a tooling error (3)
  | {
      status: 0 | 1 | 2;
      package: string;
      baseline: string | null;            // the Baseline's version
      reason: string | null;              // why there is no Baseline, as the line says it
      changes: {
        site: string;                     // as in the line, e.g. "endpoints.GET /orders/{}"
        difference: string;               // the Difference kind
        shape: string | null;             // the ShapeDifference kind of a schema difference
        at: string | null;                // the path of a schema Difference
        position: string | null;          // the Position of a schema Difference
        class: 'breaking' | 'additive' | 'neutral' | 'not-allowed';
        approval: 'needed' | 'not-needed' | null;
      }[];
    };
```
