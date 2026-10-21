# Snapshot

The format of a Snapshot: the language-neutral description of a Contract or a Definitions Package that the Compatibility Check compares. Terms are defined in [CONTEXT.md](CONTEXT.md); the rules that compare two Snapshots are in [COMPATIBILITY.md](COMPATIBILITY.md).

## Where it lives

- `cf-loom publish` writes the Snapshot into the published package as `snapshot.json`, and fills in `version`; `cf-loom package` writes the declared Snapshot into the package it writes, without `version` (see [Commands](packages/cli/README.md#commands) in the CLI README). The package.json it publishes carries `cfLoom: { format, snapshotHash, kind, dependencies }`, so the dependency graph and whether anything changed are read from the registry's package metadata; only the Baseline's `snapshot.json` is downloaded.
- A Service's Contract Package also exports `contract.exportedSnapshot`, the Snapshot cut to what the package exports, keyed as here, with `format` and no other heading (see [The Contract Package](ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md). The client and `@cf-loom/testing` read Snapshot nodes from it at runtime, so they too read every format the CLI ever wrote, as the Compatibility Check does.
- `cf-loom generate` also writes the *declared* Snapshot to `contract.snapshot.json` next to `cf-loom.config.ts`, so every Contract change shows up in review. It is built from the source, offline; the one thing it reads from the committed file is each Endpoint's `deprecatedAt` (see [Endpoints](#endpoints)). `cf-loom verify` fails if it differs from what `generate` would write, apart from `generator`, so upgrading the CLI alone never fails it.
- The declared Snapshot leaves out `version` and the history only the Baseline knows: the version each Retired Element was Retired in, tombstones of deleted Retired Elements, removed codes and removed Subscriptions. `check` and `publish` read the Baseline and merge that history in, so the published `snapshot.json` is complete.
- The Baseline is always read from the registry, never from the committed file (see [The Baseline](COMPATIBILITY.md#the-baseline)).

## Canonical form

- JSON, UTF-8, object keys sorted by code point, two-space indentation, a final newline. The same Contract always produces the same bytes, apart from `version`, `generator` and the `deprecatedAt` stamps carried forward.
- Arrays whose order means nothing are sorted: Rejection codes by code, Dependencies by Service, each Dependency's `endpoints` by `id` and `events` by identity, and `enum.values`, `union.options` and `allOf.items` by the canonical JSON of each item. Arrays whose order matters (an Endpoint's Guards, a Guard's `guards`, an Endpoint's `params`, a tuple's items, a Qualifier's list) keep it.
- The Snapshot's hash is the SHA-256 of those bytes without `version` and `generator`, written in lowercase hex; `publish` compares it with the Baseline's (see [Versioning](COMPATIBILITY.md#versioning) in COMPATIBILITY.md). Each Dependency's `against` and the `definitions` versions are in it, so adopting a newer version changes the hash even when no shape changed.

## Top level

```json
{
  "format": 1,
  "kind": "service",
  "name": "orders-service",
  "version": "3.4.0",
  "generator": "@cf-loom/cli@2.1.0",
  "definitions": { "@org/definitions": "4.2.0" },
  "standardRejections": { "invalidInput": {}, "notFound": {}, "notImplemented": {} },
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
- The CLI decodes a `snapshot.json` by the format it names and fails closed. Each of these is a tooling error, never read as far as it goes: no JSON; a format newer than the CLI; a key or value its format does not define, a map's key `__proto__` included; a Snapshot too large or nested too deeply to read; no `version`, or a `version`, `retiredIn` or `removedIn` that is not a semantic version; an identity it cannot read; a name the Snapshot uses and does not hold, such as a `ref`'s def, a code an Endpoint or Guard lists, or a Guard an Endpoint attaches or a Guard lists; a def that leads back to itself through `ref`s, `union` options and `allOf` items alone, with no other node between. It does not judge again the rules `generate` enforced when the file was written.
- `kind` is `service`, `application` or `definitions`. An Application's Snapshot holds only `dependencies`; a Definitions Package's holds `guards`, `schemas` (its shared schemas by name), `codes`, `standardRejections` and `defs`.
- `definitions` lists every Definitions Package the Contract uses, at the exact version resolved.

A Definitions Package's Snapshot:

```json
{
  "format": 1,
  "kind": "definitions",
  "name": "definitions",
  "version": "4.2.0",
  "generator": "@cf-loom/cli@2.1.0",
  "standardRejections": { "invalidInput": {}, "notFound": {}, "notImplemented": {} },
  "defs": {},
  "schemas": { "money": {}, "pagination": {} },
  "guards": {},
  "codes": {}
}
```

## Identities

| Element | Identity | Example |
| --- | --- | --- |
| Endpoint | Method and path, params replaced by `{}` | `GET /orders/{}` |
| Event, Command | Name and version | `OrderCreated@2` |
| Subscription | Its name | `notify-on-settled` |
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
    "params": { "type": "object", "mode": "strict", "fields": {} },
    "query": null,
    "headers": { "type": "object", "mode": "open", "fields": {} },
    "body": null
  },
  "success": { "status": 200, "headers": null, "body": { "type": "object", "mode": "open", "fields": {} } },
  "rejections": ["BAD_REQUEST", "NOT_FOUND", "NOT_IMPLEMENTED", "ORDER_LOCKED", "UNAUTHENTICATED"]
}
```

- `params` is always stored `strict` (exactly the path's params), and `input.query` and a `headers` object, `input` or `success`, always `open`.
- `guards` lists the Endpoint's Attachments in order: each Guard by name, with its Qualifier as canonical JSON, or `null` when the Guard declares no `qualifier`.
- `input.headers` and `input.query` are resolved: the Endpoint's own plus every attached Guard's demands, header names lower-cased. Two declarations of one name agree on the shape (see [Headers, path and query](COMPATIBILITY.md#headers-path-and-query) in COMPATIBILITY.md); the `description`, `examples` and `origin` written are the first declaration's, the Endpoint's own before its Guards', in Attachment order.
- `rejections` is resolved too: the Endpoint's own, `notFound` included when it lists it, its Guards', and the invalid-input and not-implemented Rejections, by code.
- A Deprecated Endpoint carries `deprecatedAt`, an ISO 8601 UTC instant (`"deprecatedAt": "2026-10-17T09:30:00Z"`): `generate` takes it from the committed `contract.snapshot.json` when it is written that way, to the second, else stamps it; `check` and `publish` keep the Baseline's `deprecatedAt` when it has one, so the published Snapshot carries it too. It is Neutral; `generate` also writes it into the Handler map, from which `serve` sends it in the `Deprecation` header (see [Lifecycle](packages/contract/README.md#lifecycle) in the contract README).

## Messages

```json
"events":   { "OrderCreated@2": { "visibility": "internal", "lifecycle": "active", "description": "", "body": {} } },
"commands": { "ChargeCard@1":   { "lifecycle": "active", "description": "", "body": {} } }
```

Subjects and stream names are derived from these identities at runtime and are not stored.

## Origin

`origin`, on a Guard, a code or a schema node, says where it was declared: `"local"`, `"standard"` (a Standard Rejection's code with cf-loom's defaults) or the Definitions Package and version it came from, `"@org/definitions@4.2.0"`, with `#<name>` for a shared schema, `"@org/definitions@4.2.0#money"`. A clone of a shared schema (`money.describe('…')`) is a new schema and carries no `origin`. `origin` is Neutral.

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

`description` is Neutral. `guards` names the Guards whose Context its GuardHandler reads, in declared order; `qualifier` is the schema node of its Qualifier, or `null` (see [Guards](packages/contract/README.md#guards) in the contract README). A Service's Snapshot writes the Guards its Endpoints attach, directly or through a Guard's `guards`; a listed Definitions Package's other Guards stay out, while a Definitions Package's own Snapshot writes every Guard it declares.

## Rejection codes

```json
"codes": {
  "ORDER_LOCKED": { "origin": "local", "status": 409, "message": "The order can no longer be changed", "body": {}, "removed": false }
}
```

Every code that ever existed in the Contract stays here, with the status and body it last had and its `origin`: the Contract's own codes, those reached through imported Guards, and every code a Standard Rejection has had. A code declared more than once has one body shape (see [Rejections](COMPATIBILITY.md#rejections) in COMPATIBILITY.md); the `message`, `description`, `examples` and `origin` written are the first declaration's, in the root's order: a listed Definitions Package's, then the Guards', then the Endpoints'. A Service's Snapshot writes the codes its Endpoints answer, themselves or through the Guards they reach, and every code a Standard Rejection has had; a listed Definitions Package's other codes stay out; a Definitions Package's own Snapshot writes every code it declares. The allowed `status` values are in [Rejections](COMPATIBILITY.md#rejections) in COMPATIBILITY.md. `removed` marks one no Endpoint answers any more, or, in a Definitions Package, one it no longer declares. `standardRejections` holds the resolved code, status, message and `origin` of each Standard Rejection, and the body of the invalid-input Rejection (see [Rejections](packages/contract/README.md#rejections) in the contract README).

## Subscriptions and Dependencies

```json
"subscriptions": {
  "notify-on-settled": { "event": "payments-service:PaymentSettled@1" },
  "legacy-sync": { "event": "orders-service:OrderCreated@1", "removedIn": "3.2.0" }
},
"dependencies": {
  "payments-service": {
    "against": "5.1.0",
    "endpoints": [{ "id": "GET /payments/{}", "name": "getPayment" }],
    "events": ["PaymentSettled@1"]
  }
}
```

- A removed Subscription stays as a tombstone that keeps its Event; its name is never reused (see [Subscriptions](COMPATIBILITY.md#subscriptions)), and tombstones are how `broker-plan` finds the durable consumers to remove and the streams they read.
- A Dependency records the Provider's Contract Package version it was declared against, and each Endpoint's identity together with its name.

## Lifecycle and tombstones

- `lifecycle` is `active`, `deprecated` or `retired`.
- A Retired Element that is still declared keeps everything it records; in the published Snapshot it also carries `retiredIn`, the version that first published it Retired.
- Once its declaration is deleted, `publish` carries it forward from the Baseline as a tombstone: `{ "lifecycle": "retired", "retiredIn": "3.0.0" }`, its `retiredIn` the Baseline's, plus `name` for an Endpoint. Its identity is never reused.

## Schemas

Every shape is written fully inline wherever it is used; `defs` and `ref` exist only for recursion (see [Recursion](#recursion)). `generate` walks each schema's `_zod.def`, never `instanceof`, so `zod/mini` works too, and maps only the nodes and checks below; anything else fails `generate` (see [Not allowed](#not-allowed)).

| Node | Fields | From zod |
| --- | --- | --- |
| `string` | `format?`, `formatOptions?`, `regex?`, `min?`, `max?` | `z.string()`, `z.uuid()`, `z.email()`, `z.iso.datetime()`… |
| `number` | `int?`, `min?`, `max?`, `exclusiveMin?`, `exclusiveMax?`, `multipleOf?` | `z.number()`, `z.int()` |
| `boolean` | | `z.boolean()` |
| `literal` | `value` | `z.literal()` |
| `enum` | `values`, `open` | `z.enum()`, `openEnum()`, a literal of several values, a union of literals (each of one or several values) and closed enums, as one enum of all their values |
| `object` | `mode` (`open` or `strict`), `fields` | `z.object()`, an intersection of objects; `z.record()` with an enum or literal key is `strict` with every key a required field, and `z.partialRecord()` is `strict` with every key optional |
| `record` | `key`, `value` | `z.record()` with a string key |
| `array` | `items`, `min?`, `max?` | `z.array()` |
| `tuple` | `items`, `rest?` | `z.tuple()` |
| `union` | `options` | `z.union()` |
| `tagged` | `discriminator`, `variants` (keyed by the canonical JSON of each discriminator value; each an `object`, or a `ref` to an `object` in `defs`) | `z.discriminatedUnion()` |
| `allOf` | `items` | any other intersection |
| `json` | | `z.json()`: any JSON value |
| `ref` | `name` | a schema with an id on a cycle |

- Only declared checks map to constraints: min and max length, an exact length (`min` equal to `max`), greater and less than (inclusive as `min` and `max`, exclusive as `exclusiveMin` and `exclusiveMax`), `multipleOf`, `int`, a known string format and `regex`. `z.int()` is `int: true` and nothing more: no safe-integer bounds are implied. A schema has at most one lower bound (`min` or `exclusiveMin`) and one upper bound (`max` or `exclusiveMax`); two checks that set one bound or any other constraint fail `generate`, `.positive().nonnegative()` included.
- The known string formats are the ones zod builds itself: `guid`, `uuid`, `email`, `url`, `emoji`, `nanoid`, `cuid`, `cuid2`, `ulid`, `xid`, `ksuid`, `datetime`, `date`, `time`, `duration`, `ipv4`, `ipv6`, `mac`, `cidrv4`, `cidrv6`, `base64`, `base64url`, `e164`, `credit_card`, `iban`, `jwt`, `hex`, `hostname`, `currency_code`, and the hash formats `<md5|sha1|sha256|sha384|sha512>_<hex|base64|base64url>` (`z.hash()`).
- `format` carries its options as `formatOptions` (`{ "format": "datetime", "formatOptions": { "offset": true, "precision": 3 } }`): only the options zod reads for that format (`version`, `offset`, `local`, `precision`, `protocol`, `hostname`, `alg`, `delimiter`) and only where they differ from zod's default, so `z.mac()` and `z.mac({ delimiter: ':' })` are the same and `z.url({ normalize: false })` has none; a hash's encoding is part of its format name. A format is checked as zod checks it: it is compared with the format the author's own zod builds for those options, so its pattern is zod's own and no function of the author's stands in for it; a format zod builds from a regex (`hex`, `hostname`, `currency_code` and the hashes) is judged by that regex alone, by source and flags.
- `regex` stores `source` and `flags` as `RegExp.prototype.source` and `RegExp.prototype.flags` give them; two regexes are equal only if both are identical.
- `enum.values` and a `literal`'s `value` keep their JSON type: `true` and `"true"` are different values, and `variants` keys them by their canonical JSON (`true`, `"true"`), so they never collide.
- An intersection of objects is one `object` only when every item is open and the keys they share have identical schemas; otherwise `generate` fails. Prefer `.extend()`. The merged object, like the `strict` object of an enum- or literal-keyed record and the `enum` of a union of literals, carries only its own annotations, never those of its items, key or options; a merged object is `nullable` only when every item is, and the enum of a union of literals is `nullable` when any of its literals is.
- `.describe()` and `.meta()` are allowed and only set `description`, `examples` and the recursion `id`; any other `.meta()` key fails `generate`.
- Every node may carry `nullable`, `description`, `examples` and `origin` (see [Origin](#origin)). `description` and `examples` are Neutral.
- A field is `{ "required": true | false, "schema": … }`; optional and nullable are separate. `.required()` makes an optional field required again.
- A query param whose schema is an `array` is a list; anything else, and every path param, is a single value.
- Open Enums are stored with `open: true`; the reader and writer types are generated from that (see [Open Enums](packages/contract/README.md#open-enums) in the contract README).
- The node names `binary` and `stream` are reserved: bodies are JSON (see [Shapes, not behavior](ARCHITECTURE.md#shapes-not-behavior) in ARCHITECTURE.md).

### JSON Schema

`cf-loom openapi` and `cf-loom asyncapi` (see [Commands](packages/cli/README.md#commands) in the CLI README) read the Snapshot and write each node as JSON Schema 2020-12: `string`, `number`, `boolean`, `array`, `record` (`additionalProperties`) and `object` (`additionalProperties: false` when `strict`) as their counterparts, with the constraints as the matching keywords; `literal` as `const`; a closed `enum` as `enum`, an open one as `anyOf: [enum, string]`; `tuple` as `prefixItems` with `items` for `rest`; `union` as `anyOf`; `tagged` as `oneOf` with a `discriminator` on the variants; `allOf` as `allOf`; `json` as `{}`; `nullable` as a `type` that includes `null`; and `ref` as a `$ref` into `$defs`. The Rejection and Fault Envelopes (see [Over HTTP](ARCHITECTURE.md#over-http) in ARCHITECTURE.md) are written once as components. `description` and `examples` are carried over.

### Recursion

A cycle is detected as the same schema instance met again during the walk, through a getter (`get children() { return z.array(node); }`) or `z.lazy()`, which is transparent. A `z.lazy()` is unwrapped one level at a time, each a schema of its own, with its id and annotations read like any schema's: `z.lazy(() => node).describe('…')` around a schema with an id is a `ref` carrying that description, and two ids on one chain of lazies give a def and an alias def, a `ref` to it. A def must pass through a node other than `ref`, `union` and `allOf` before it leads back to itself, so an alias def always leads to a def that is not a `ref`: a cycle with nothing but `z.lazy()`, unions, intersections, `.nullable()` and annotations on it fails `generate`, whatever the order of a union's options, since zod's parse never ends on a value no other option accepts (see [Not allowed](#not-allowed)). Every cycle needs at least one schema on it named with `.meta({ id })`; a cycle with no id fails `generate`. A schema with an id that lies on a cycle is always written once under `defs`, keyed by that id, and referenced by `ref` wherever it is used, whichever schema the walk enters the cycle at; the other schemas of the cycle stay inline. Ids are read from the schema's own metadata (`.meta()`), never looked up by name, and are unique within the Snapshot: two schemas with the same id, local or from Definitions Packages, fail `generate`. `.meta({ id })` on a schema that lies on no cycle is ignored, and the schema stays inline.

### Not allowed

A zod construct that does not map to a node or check above fails `generate`. Among them: `.default()`, `.prefault()`, `.catch()`, `.transform()`, `.preprocess()`, `.pipe()`, `.refine()`, `.superRefine()`, `.check()` and any custom check, `z.custom()`, `z.codec()`, `z.coerce.*`, `z.date()` (use `z.iso.datetime()`), `z.stringbool()`, `z.templateLiteral()`, `z.unknown()` and `z.any()` (use `z.record()` or `z.json()`), `z.strictObject()` and `.strict()` (use `z.object()`: objects are open), `.passthrough()`, `.catchall()` and `z.looseObject()` (use `z.record()` for dynamic keys), the mutating checks `.trim()`, `.toLowerCase()`, `.toUpperCase()`, `.normalize()` and `.overwrite()`, `.startsWith()`, `.endsWith()` and `.includes()`, `.lowercase()` and `.uppercase()`, a `z.stringFormat()`, even under a known format's name, unless it is a regex-built format with zod's own regex (see above), a format with a custom `pattern`, `z.url({ normalize })`, a conditional check (`when`), examples that are not JSON values, two checks that set the same constraint (`.min(1).min(2)`), `z.int32()`, `z.uint32()`, `z.float32()` and `z.float64()`, a number that is not finite (`NaN` or `Infinity`), `.readonly()`, numeric `z.enum()` values, `z.record()` with a key that is not a string, an enum or a literal (such as `z.number()`), or a nullable key, a `z.record()` keyed by an `openEnum()` (use `z.record(z.string(), …)`), `z.looseRecord()`, a `z.record()` keyed by an enum or literal, or a `z.partialRecord()`, as `query` or `headers`, a Success's included (use `z.object()`), or in a Read shape, at any depth, through recursion included, since it refuses the keys a request or a writer may add (use `z.object()` or a string-keyed `z.record()`), `z.xor()`, `.optional()` anywhere but directly on an object field, `.nonoptional()` anywhere but on an object field (as `.required()` puts it), `z.null()`, a union option included, `z.undefined()` or `z.literal(null)` (use `.nullable()`), a discriminated union variant whose discriminator has several values or is not a literal, a discriminated union variant that is not an object (an intersection, a union or a nullable object), a field named `__proto__`, a declared record key included, which zod drops when it parses, a discriminated union as a variant of another, two variants with the same discriminator value, a cycle through `z.lazy()`, unions and intersections alone (`const node = z.union([z.lazy(() => node), z.string()]).meta({ id: 'node' })`), whatever the order of the options, `.nullable()`, `.describe()` and `.meta()` on it included, which zod cannot parse, and an intersection that is not of open objects (an `allOf`) reaching an `openEnum()` at any depth, through recursion included, since a reader cannot merge an Unknown case with the value it came from (use `.extend()`).
