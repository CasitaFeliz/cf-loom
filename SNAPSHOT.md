# Snapshot

The format of a Snapshot: the language-neutral description of a Contract or a Definitions Package that the Compatibility Check compares. Terms are defined in [CONTEXT.md](CONTEXT.md); the rules that compare two Snapshots are in [COMPATIBILITY.md](COMPATIBILITY.md).

## Where it lives

- `cf-loom publish` writes the Snapshot into the published package as `snapshot.json`, and fills in `version`; `cf-loom package` writes the declared Snapshot into the package it writes, without `version` (see [Commands](packages/cli/README.md#commands) in the CLI README). The package.json it publishes carries `cfLoom: { format, snapshotHash, kind, dependencies }`: the registry's package metadata says which kind of package each version is and records every Dependency it declares, each as the Snapshot records it with `events`, the identities of the Provider's Events its Subscriptions receive, sorted (empty for an Application), and `snapshotHash` lets the organization's tooling tell from the metadata whether two versions' Snapshots differ, though cf-loom itself never reads it; `check` and `publish` read the Baseline's `cfLoom` and peer ranges from the metadata and download only its `snapshot.json`. A Definitions Package is published from its own package.json and files, into which `publish` writes `version`, `cfLoom` (with `dependencies` empty) and `peerDependencies` (a caret on each version of `zod` and `@cf-loom/contract` installed beside the root), and beside which it adds `snapshot.json`, listed in its `files` when it has them.
- A Service's Contract Package also exports `contract.exportedSnapshot`, the Snapshot cut to what the package exports, keyed as here, with `format` and no other heading (see [The Contract Package](ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md). The client and `@cf-loom/testing` read Snapshot nodes from it at runtime, so they too read every format the CLI ever wrote, as the Compatibility Check does, and refuse any other, never reading it as far as it goes (see [Consuming a Contract](packages/client/README.md#consuming-a-contract) in the client README).
- `cf-loom generate` also writes the *declared* Snapshot to `contract.snapshot.json` next to package.json, so every Contract change shows up in review. It is built offline, a function of the source and the installed packages and, for each Deprecated Endpoint, of the `deprecatedAt` in the committed file, or of the clock otherwise (see [Endpoints](#endpoints)). `cf-loom verify` fails if it differs from what `generate` would write, apart from `generator`, so upgrading the CLI alone never fails it.
- The declared Snapshot leaves out `version` and the history only the Baseline knows: the version each Retired Element was Retired in, tombstones of deleted Retired Elements, removed codes and removed Subscriptions. `check` and `publish` read the Baseline and merge that history in, and keep its `deprecatedAt`, so the published `snapshot.json` is complete.
- The Baseline is always read from the registry, never from the committed file (see [The Baseline](COMPATIBILITY.md#the-baseline)).

## Canonical form

- JSON, UTF-8, object keys sorted by code point, two-space indentation, a final newline. The same Contract always produces the same bytes, apart from `version`, `generator` and the `deprecatedAt` stamps carried forward.
- A Snapshot's JSON nests at most 256 levels, the outermost object being the first; `generate` fails on a Contract whose Snapshot would nest deeper, so every Snapshot it writes reads back.
- Arrays whose order means nothing are sorted: Rejection codes by code, Dependencies by Service, each Dependency's `endpoints` by `id`, and `enum.values` and `allOf.items` by the canonical JSON of each item. Arrays whose order matters (an Endpoint's Guards, a Guard's `guards`, an Endpoint's `params`, a tuple's items, a union's `options`, since zod's union returns the first option that parses, a Qualifier's list) keep it.
- The Snapshot's hash is the SHA-256 of those bytes without `version` and `generator`, written in lowercase hex; `publish` compares it with the Baseline's (see [Versioning](COMPATIBILITY.md#versioning) in COMPATIBILITY.md). Each Dependency's `against` and the version in every `origin` are in it, so adopting a newer version changes the hash even when no shape changed.

## Top level

```json
{
  "format": 1,
  "kind": "service",
  "name": "orders-service",
  "version": "3.4.0",
  "generator": "@cf-loom/cli@2.1.0",
  "standardRejections": { "invalidInput": "INVALID_INPUT", "notFound": "NOT_FOUND", "notImplemented": "NOT_IMPLEMENTED" },
  "defs": {},
  "endpoints": {},
  "events": {},
  "commands": {},
  "guards": {},
  "codes": {},
  "subscriptions": {},
  "dependencies": {}
}
```

- `format` is the version of this specification, and the CLI reads a Baseline written in any format it ever wrote; `generator` is the cf-loom CLI that wrote the file. From the first released format on, anything this specification adds or changes is a new format.
- The CLI decodes a `snapshot.json` by the format it names and fails closed. Each of these is a tooling error, never read as far as it goes: no JSON; a format newer than the CLI; a key or value its format does not define, a map's key `__proto__` included; a Snapshot too large to read; no `version`, or a `version`, `retiredIn` or `removedIn` that is not a semantic version; an identity it cannot read; a name the Snapshot uses and does not hold, such as a `ref`'s def, a code an Endpoint or Guard lists, a Standard Rejection names or an export names, or a Guard an Endpoint attaches, a Guard lists or an export names; a body on the code a Standard Rejection names that the Rejection does not have, none on the invalid-input one or one on the not-found and not-implemented ones; a def that leads back to itself through `ref`s, `union` options and `allOf` items alone, with no other node between. It also judges again, with the rules `generate` uses, what makes the Check or the hash wrong when broken: arrays whose order means nothing in canonical order, each item once; `against` a semantic version; `deprecatedAt` only on a Deprecated Endpoint; a Success status `generate` allows, and a code status of 4xx, or 501 on the code the not-implemented Standard Rejection names or on a removed code; `formatOptions` by option; a node's bounds that admit a value, and an enum, union or tagged with at least one value or option; and a JSON nesting of at most 256 levels, judged once the format is read and before the structure. It does not judge again the other rules `generate` enforced, such as a code declared once or a Guard's closure.
- `kind` is `service`, `application` or `definitions`. `name` is a Service's or Application's root name, and a Definitions Package's package.json name, scope included. An Application's Snapshot holds only `dependencies`; a Definitions Package's holds `exports` (what its root file exports, by name: a Guard by its name, a Rejection by its code, a shared schema's node), `guards`, `codes`, `standardRejections` and `defs`.

A Definitions Package's Snapshot:

```json
{
  "format": 1,
  "kind": "definitions",
  "name": "@org/definitions",
  "version": "4.2.0",
  "generator": "@cf-loom/cli@2.1.0",
  "standardRejections": { "invalidInput": "INVALID_INPUT", "notFound": "NOT_FOUND", "notImplemented": "NOT_IMPLEMENTED" },
  "defs": {},
  "exports": {
    "apiKey": { "kind": "guard", "guard": "apiKey" },
    "money": { "kind": "schema", "schema": {} },
    "unauthenticated": { "kind": "rejection", "code": "UNAUTHENTICATED" }
  },
  "guards": {},
  "codes": {}
}
```

## Identities

| Element | Identity | Example |
| --- | --- | --- |
| Endpoint | Method and path, params replaced by `{}` | `GET /orders/{}` |
| Event, Command | Name and version | `OrderCreated@2` |
| Subscription | Its name | `notifyOnSettled` |
| Another Service's Element | Service, then the identity above | `payments-service:PaymentSettled@1` |
| A Subscription's Event | Service, then the identity, its own Service's included | `orders-service:OrderCreated@1` |

- A declared path must already be canonical, or `generate` fails: it starts with `/`, has no trailing slash (except `/` itself), literal segments match `[a-z0-9-]+`, a param is a whole segment written `:camelCase`, each name once, and there is no `//`, `.`, percent-encoding or query. At runtime a request path must match exactly.
- A path param's name is not part of the identity; the Endpoint stores its param names separately.

## Endpoints

```json
"GET /orders/{}": {
  "name": "getOrder",
  "group": "orders",
  "visibility": "public",
  "lifecycle": "active",
  "description": "One order by id",
  "params": ["orderId"],
  "guards": [{ "guard": "apiKey", "qualifier": null }],
  "input": {
    "params": { "type": "object", "fields": {} },
    "query": null,
    "headers": { "type": "object", "fields": {} },
    "body": null
  },
  "success": { "status": 200, "headers": null, "body": { "type": "object", "fields": {} } },
  "rejections": ["BAD_REQUEST", "NOT_FOUND", "NOT_IMPLEMENTED", "ORDER_LOCKED", "UNAUTHENTICATED"]
}
```

- `params` holds exactly the path's params.
- `guards` lists the Endpoint's Attachments in order: each Guard by name, with its Qualifier as canonical JSON, or `null` when the Guard declares no `qualifier`.
- `input.headers` and `input.query` are resolved: the Endpoint's own plus every attached Guard's demands, header names lower-cased. Two declarations of one name agree on the shape (see [Headers, path and query](COMPATIBILITY.md#headers-path-and-query) in COMPATIBILITY.md); the `description`, `examples` and `origin` written are the first declaration's, the Endpoint's own before its Guards', in Attachment order.
- `rejections` is resolved too: the Endpoint's own, `notFound` included when it lists it, its Guards', and the invalid-input and not-implemented Rejections, by code.
- A Deprecated Endpoint carries `deprecatedAt`, an ISO 8601 UTC instant (`"deprecatedAt": "2026-10-17T09:30:00Z"`): `generate` takes it from the committed `contract.snapshot.json` when it is written that way, to the second, else stamps it; `check` and `publish` keep the Baseline's `deprecatedAt` when it has one, so the published Snapshot carries it too. It is Neutral; `generate` also writes it into the Handler map, from which `serve` sends it in the `Deprecation` header (see [Lifecycle](packages/contract/README.md#lifecycle) in the contract README).

## Messages

```json
"events":   { "OrderCreated@2": { "group": "orders", "visibility": "internal", "lifecycle": "active", "description": "", "body": {} } },
"commands": { "ChargeCard@1":   { "group": "orders", "lifecycle": "active", "description": "", "body": {} } }
```

`group` names the Group that lists the Message Version, as an Endpoint's does; a tombstone has none.

Subjects, stream names and durable consumer names are derived from these identities, by the adapter and by `cf-loom broker-plan`, and subjects also by `cf-loom asyncapi`, and are not stored.

## Origin

`origin`, on a Guard, a code or a schema node, says where it was declared: `"local"`, `"standard"` (a Standard Rejection's code with cf-loom's defaults) or the Definitions Package and version it came from, the one that exports it and imports it from none of the others that do, `"@org/definitions@4.2.0"`. Which package that is never depends on package.json: a declaration that belongs to a package whose package.json has no name or no version fails validation (`definitions-unidentified`), however it was re-exported. An origin is written with `#<name>` for a shared schema, the first name in code point order it is exported under, `"@org/definitions@4.2.0#money"`. A clone of a shared schema (`money.describe('…')`) is a new schema and carries no `origin`. Which Definitions Packages a Contract uses, at which versions, is read from its origins alone; two installed copies of one package are two origins. `origin` is Neutral.

## Guards

```json
"apiKey": {
  "origin": "local",
  "description": "An API key per Caller",
  "guards": [],
  "qualifier": null,
  "demands": { "headers": {}, "query": null },
  "context": {},
  "rejections": ["UNAUTHENTICATED"]
}
```

`description` is Neutral. `guards` names the Guards whose Context its GuardHandler reads, in declared order; `qualifier` is the schema node of its Qualifier, or `null` (see [Guards](packages/contract/README.md#guards) in the contract README). A Service's Snapshot writes the Guards its Endpoints attach, directly or through a Guard's `guards`; a Definitions Package's other Guards stay out, while a Definitions Package's own Snapshot writes every Guard it exports.

## Rejection codes

```json
"codes": {
  "ORDER_LOCKED": { "origin": "local", "status": 409, "message": "The order can no longer be changed", "body": {}, "removed": false }
}
```

Every code that ever existed in the Contract stays here, with the status and body it last had and its `origin`: the Contract's own codes, those reached through imported Guards, and every code a Standard Rejection has had. Each code has one declaration (see [Rejections](COMPATIBILITY.md#rejections) in COMPATIBILITY.md), whose status, message, body and `origin` are written. A Service's Snapshot writes the codes its Endpoints answer, themselves or through the Guards they reach, and every code a Standard Rejection has had; a Definitions Package's other codes stay out; a Definitions Package's own Snapshot writes every code it exports, or its Guards answer. The allowed `status` values are in [Rejections](COMPATIBILITY.md#rejections) in COMPATIBILITY.md. `removed` marks one no Endpoint answers any more, or, in a Definitions Package, one it no longer declares. `standardRejections` names the code each Standard Rejection resolved to; its status, message, `origin` and body are that code's, under `codes`, and only the invalid-input Rejection has a body (see [Rejections](packages/contract/README.md#rejections) in the contract README).

## Subscriptions and Dependencies

```json
"subscriptions": {
  "notifyOnSettled": {
    "group": "orders",
    "description": "Notifies the customer of each payment settled",
    "event": "payments-service:PaymentSettled@1"
  },
  "legacySync": { "event": "orders-service:OrderCreated@1", "removedIn": "3.2.0" }
},
"dependencies": {
  "payments-service": {
    "against": "5.1.0",
    "endpoints": [{ "id": "GET /payments/{}", "name": "getPayment" }]
  }
}
```

- A Subscription records the Group that lists it.
- A removed Subscription stays as a tombstone that keeps its Event and drops its Group and description, so its name is never reused (see [Subscriptions](COMPATIBILITY.md#subscriptions)); its `removedIn` is the version that first published it removed, a prerelease included.
- A Dependency records the Provider's Contract Package version it was declared against, and each Endpoint's identity together with its name. The Events a Service receives from a Provider are recorded once, by its Subscriptions, each `event` naming the Provider before the Event's identity.

## Lifecycle and tombstones

- `lifecycle` is `active`, `deprecated` or `retired`.
- A Retired Element that is still declared keeps everything it records; in the published Snapshot it also carries `retiredIn`, the version that first published it Retired, a prerelease included: a version promoted from that prerelease keeps its `retiredIn`.
- Once its declaration is deleted, `publish` carries it forward from the Baseline as a tombstone: `{ "lifecycle": "retired", "retiredIn": "3.0.0" }`, its `retiredIn` the Baseline's, plus `name` for an Endpoint. Its identity is never reused.

## Schemas

Every shape is written fully inline wherever it is used; `defs` and `ref` exist only for recursion (see [Recursion](#recursion)). `generate` walks each schema's `_zod.def`, never `instanceof`, so `zod/mini` works too, and maps only the nodes and checks below; anything else fails `generate` (see [Not allowed](#not-allowed)).

| Node | Fields | From zod |
| --- | --- | --- |
| `string` | `format?`, `formatOptions?`, `regex?`, `min?`, `max?` | `z.string()`, `z.uuid()`, `z.email()`, `z.iso.datetime()`… |
| `number` | `int?`, `min?`, `max?`, `exclusiveMin?`, `exclusiveMax?`, `multipleOf?` | `z.number()`, `z.int()` |
| `boolean` | | `z.boolean()` |
| `enum` | `values`, `open` | `z.enum()`, `openEnum()`, `z.literal()`, a union of literals and closed enums, as one enum of all their values |
| `object` | `fields` | `z.object()`, an intersection of objects |
| `record` | `key`, `value` | `z.record()` or `z.partialRecord()` with a string key |
| `array` | `items`, `min?`, `max?` | `z.array()` |
| `tuple` | `items`, `rest?` | `z.tuple()` |
| `union` | `options` | `z.union()` |
| `tagged` | `discriminator`, `variants` (keyed by the canonical JSON of each discriminator value; each an `object`, or a `ref` to an `object` in `defs`) | `z.discriminatedUnion()` |
| `allOf` | `items` | any other intersection |
| `json` | | `z.json()`: any JSON value |
| `ref` | `name` | a schema with an id on a cycle |

- Only declared checks map to constraints: min and max length, an exact length (`min` equal to `max`), greater and less than (inclusive as `min` and `max`, exclusive as `exclusiveMin` and `exclusiveMax`), `multipleOf`, `int`, a known string format and `regex`. `z.int()` is `int: true` and nothing more: no safe-integer bounds are implied. A schema has at most one lower bound (`min` or `exclusiveMin`) and one upper bound (`max` or `exclusiveMax`); two checks that set one bound or any other constraint fail `generate`, `.positive().nonnegative()` included. `multipleOf` is greater than 0; a string's or array's `min` and `max` are non-negative integers; a lower bound never exceeds the upper one, nor equals it when either is exclusive. Only bounds are judged: bounds that admit no integer or no multiple, or a regex that matches nothing, are written as declared.
- The known string formats are the ones zod builds itself: `guid`, `uuid`, `email`, `url`, `emoji`, `nanoid`, `cuid`, `cuid2`, `ulid`, `xid`, `ksuid`, `datetime`, `date`, `time`, `duration`, `ipv4`, `ipv6`, `mac`, `cidrv4`, `cidrv6`, `base64`, `base64url`, `e164`, `credit_card`, `iban`, `jwt`, `hex`, `hostname`, `currency_code`, and the hash formats `<md5|sha1|sha256|sha384|sha512>_<hex|base64|base64url>` (`z.hash()`).
- `format` carries its options as `formatOptions` (`{ "format": "datetime", "formatOptions": { "offset": true, "precision": 3 } }`): only the options zod reads for that format (`version`, `offset`, `local`, `precision`, `protocol`, `hostname`, `alg`, `delimiter`) and only where they differ from zod's default, so `z.mac()` and `z.mac({ delimiter: ':' })` are the same and `z.url({ normalize: false })` has none; a hash's encoding is part of its format name. A format is checked as zod checks it: it is compared with the format the author's own zod builds for those options, so its pattern is zod's own and no function of the author's stands in for it; a format zod builds from a regex (`hex`, `hostname`, `currency_code` and the hashes) is judged by that regex, by source and flags, and by its check, whose source text must be the one zod gives its own test of a regex.
- `regex` stores `source` and `flags` as `RegExp.prototype.source` and `RegExp.prototype.flags` give them; two regexes are equal only if both are identical.
- `enum.values` keep their JSON type: `true` and `"true"` are different values, and `variants` keys them by their canonical JSON (`true`, `"true"`), so they never collide.
- An intersection of objects is one `object` only when every item is open and the keys they share have the same shape and requiredness (descriptions, examples and origins aside; the left item's are kept); otherwise `generate` fails. Prefer `.extend()`. The merged object, like the `enum` of a union of literals, carries only its own annotations, never those of its items or options; a merged object is `nullable` only when every item is, and the enum of a union of literals is `nullable` when any of its literals is.
- `.describe()` and `.meta()` are allowed and only set a string `description`, `examples` and the recursion `id` (see [Recursion](#recursion)); any other `.meta()` key fails `generate`. Each example must be one its schema accepts.
- Every node may carry `nullable`, `description`, `examples` and `origin` (see [Origin](#origin)). `description` and `examples` are Neutral.
- A field is `{ "required": true | false, "schema": … }`; optional and nullable are separate. `.required()` makes an optional field required again.
- A query param whose schema is an `array` is a list; anything else, and every path param, is a single value.
- Open Enums are stored with `open: true`; the reader and writer types are generated from that (see [Open Enums](packages/contract/README.md#open-enums) in the contract README).
- The node names `binary` and `stream` are reserved: bodies are JSON (see [Shapes, not behavior](ARCHITECTURE.md#shapes-not-behavior) in ARCHITECTURE.md).

### JSON Schema

`cf-loom openapi` and `cf-loom asyncapi` (see [Commands](packages/cli/README.md#commands) in the CLI README) read the Snapshot and write each node as JSON Schema, `openapi` as 2020-12 and `asyncapi` as draft-07, which AsyncAPI's Schema Object extends; the two differ only in a tuple, below:

- `string`, `number`, `boolean`, `array`, `record` (`propertyNames` and `additionalProperties`) and `object` as their counterparts, with the constraints as the matching keywords: `min` and `max` of a string as `minLength` and `maxLength`, of an array as `minItems` and `maxItems`, `int` as `integer`. JSON Schema counts a string's length in code points where zod counts UTF-16 units, so the two differ on characters beyond U+FFFF.
- a closed `enum` of one value as `const`, of several as `enum`, each with the `type` of its values (a list when they differ), so a parameter's text can be coerced to one; an open `enum` as `anyOf: [enum, string]`.
- `tuple` as `prefixItems` with `minItems` of its items, and `items` for `rest`, or `items: false` without one, since zod refuses a missing and an extra item alike; in draft-07, `items` lists the items and `additionalItems` is `rest`, or `false` without one. A tuple with no item is `minItems: 0` with `items` as `rest`, or `false` without one, in both, since neither takes an empty list of items.
- `union` as `anyOf`; `allOf` as `allOf`; `json` as `{}`.
- `tagged` as `oneOf` its variants, each variant's discriminator field a `const`, with no `discriminator`: without a `mapping`, OpenAPI reads a discriminator value as the name of a component, which a variant written inline is not.
- `ref` as a `$ref` to `#/components/schemas/<Id>Def`, the def written once there under the name of its type in the Contract Package (`tree` gives `TreeDef`).
- `nullable` as a `type` that includes `null` for a `string`, `number`, `boolean`, `array`, `tuple`, `record` and `object`; for any other node (a `const` or `enum` would refuse `null` whatever its `type`) as `anyOf` the schema and `{ "type": "null" }`.
- `description` and `examples` are carried over, beside a `$ref` too; in draft-07, where a tool ignores every keyword beside a `$ref`, a `ref` with either is an `allOf` of its `$ref` with them beside it. `origin` and `formatOptions` are left out.

Where JSON Schema cannot say what zod checks, the document says less:

- `format` is written as JSON Schema names it only where both admit the same values: `datetime` as `date-time`, unless the format is `local` or has `precision: -1`, in which case it stays `datetime`. A `time`, a `duration` and an `email` are written with no `format`, since JSON Schema's differ from zod's. Every other format, `url` included, keeps its name, which a tool reads as an annotation where its dialect does not define it: `url` and the cf-loom names in both, and `uuid` in draft-07.
- `regex` is written as `pattern` when its flags are among `g`, `d` and `u`; with any other flag no `pattern` is written, since JSON Schema's takes no flags.

The Rejection and Fault Envelopes (see [Over HTTP](ARCHITECTURE.md#over-http) in ARCHITECTURE.md) are written once as components of the OpenAPI document.

### Recursion

A cycle is detected as the same schema instance met again during the walk, through a getter (`get children() { return z.array(node); }`) or `z.lazy()`, which is transparent. A `z.lazy()` is unwrapped one level at a time, each a schema of its own, with its id and annotations read like any schema's: `z.lazy(() => node).describe('…')` around a schema with an id is a `ref` carrying that description, and two ids on one chain of lazies give a def and an alias def, a `ref` to it. A def must pass through a node other than `ref`, `union` and `allOf` before it leads back to itself, so an alias def always leads to a def that is not a `ref`: a cycle with nothing but `z.lazy()`, unions, intersections, `.nullable()` and annotations on it fails `generate`, whatever the order of a union's options, since zod's parse never ends on a value no other option accepts (see [Not allowed](#not-allowed)). Every cycle needs at least one schema on it named with `.meta({ id })`; a cycle with no id fails `generate`. A schema with an id that lies on a cycle is always written once under `defs`, keyed by that id, and referenced by `ref` wherever it is used, whichever schema the walk enters the cycle at; the other schemas of the cycle stay inline. A def on a cycle that fails `generate` reports the same failures wherever it is used, and no def of that cycle is written under `defs`. Ids are read from the schema's own metadata (`.meta()`), never looked up by name, and are unique within the Snapshot: two schemas with the same id, local or from Definitions Packages, fail `generate`. An id names a cycle: `.meta({ id })` on a schema that lies on no cycle, or on a field's `.optional()` or `.nonoptional()` (put it on the schema inside), fails `generate`. An id is camelCase (`^[a-z][a-zA-Z0-9]*$`), since code names its def `<id>Def`.

### Not allowed

A zod construct that does not map to a node or check above fails `generate`, and what lies inside it is still checked and reported. Among them: `.default()`, `.prefault()`, `.catch()`, `.transform()`, `.preprocess()`, `.pipe()`, `.refine()`, `.superRefine()`, `.check()` and any custom check, `z.custom()`, `z.codec()`, `z.coerce.*`, `z.date()` (use `z.iso.datetime()`), `z.stringbool()`, `z.templateLiteral()`, `z.unknown()` and `z.any()` (use `z.record()` or `z.json()`), `z.strictObject()` and `.strict()` (use `z.object()`: objects are open), `.passthrough()`, `.catchall()` and `z.looseObject()` (use `z.record()` for dynamic keys), the mutating checks `.trim()`, `.toLowerCase()`, `.toUpperCase()`, `.normalize()` and `.overwrite()`, `.startsWith()`, `.endsWith()` and `.includes()`, `.lowercase()` and `.uppercase()`, a `z.stringFormat()`, even under a known format's name, unless it is a regex-built format with zod's own regex and zod's own test of it (see above), a format with a custom `pattern`, `z.url({ normalize })`, a conditional check (`when`), examples that are not JSON values, `.meta({ id })` that is not a camelCase string, on a schema that lies on no cycle, or on a field's `.optional()` or `.nonoptional()` (put it on the schema inside), `.meta({ description })` that is not a string, two checks that set the same constraint (`.min(1).min(2)`), `z.int32()`, `z.uint32()`, `z.float32()` and `z.float64()`, a number that is not finite (`NaN` or `Infinity`), a `multipleOf` of 0 or less, a length bound that is not a non-negative integer, bounds that admit no value (`.min(5).max(3)`, `.gt(5).lt(5)`), a `z.union()` or `z.discriminatedUnion()` without options, an example its schema refuses, `.readonly()`, numeric `z.enum()` values, a `z.enum()` or `z.literal()` without values (every value taken out with `.exclude()`), `z.record()` with a key that is not a string (such as `z.number()`), or a nullable key, a `z.record()` keyed by an `openEnum()` (use `z.record(z.string(), …)`), `z.looseRecord()`, a `z.record()` or `z.partialRecord()` keyed by an enum or literal, which is a strict object (use `z.object()` with the keys as fields), `z.xor()`, `.optional()` anywhere but directly on an object field, `.nonoptional()` anywhere but on an object field (as `.required()` puts it), `z.null()`, a union option included, `z.undefined()` or `z.literal(null)` (use `.nullable()`), a discriminated union variant whose discriminator has several values or is not a literal, a discriminated union variant that is not an object (an intersection, a union or a nullable object), a field named `__proto__`, which zod drops when it parses, or named as another of `Object.prototype`'s own names (`constructor`, `toString`, `valueOf` and the rest), which every object already has and zod reads from the prototype when the field is absent (a `z.record()` reads them as its own keys), a discriminated union as a variant of another, two variants with the same discriminator value, a cycle through `z.lazy()`, unions and intersections alone (`const node = z.union([z.lazy(() => node), z.string()]).meta({ id: 'node' })`), whatever the order of the options, `.nullable()`, `.describe()` and `.meta()` on it included, which zod cannot parse, an intersection that is not of open objects (an `allOf`) reaching an `openEnum()` at any depth, through recursion included, since a reader cannot merge an Unknown case with the value it came from (use `.extend()`), and a `z.union()` reaching an `openEnum()` at any depth, through recursion included, since its reader takes a value another option declares as its Unknown case (use `z.discriminatedUnion()`, or one `openEnum()` of all the values).
