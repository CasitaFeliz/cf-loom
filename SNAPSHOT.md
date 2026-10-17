# Snapshot

The format of a Snapshot: the language-neutral description of a Contract or a Definitions Package that the Compatibility Check compares. Terms are defined in [CONTEXT.md](CONTEXT.md); the rules that compare two Snapshots are in [COMPATIBILITY.md](COMPATIBILITY.md).

## Where it lives

- `cf-loom publish` writes the Snapshot into the published package as `snapshot.json`, and fills in `version`. The package.json it publishes carries `cfLoom: { format, snapshotHash, kind, dependencies }`, so the dependency graph and whether anything changed are read from the registry's package metadata; only the Baseline's `snapshot.json` is downloaded.
- `cf-loom generate` also writes the *declared* Snapshot to `contract.snapshot.json` next to `cf-loom.config.ts`, so every Contract change shows up in review. It is built from the source, offline; the one thing it reads from the committed file is each Endpoint's `deprecatedAt` (see [Endpoints](#endpoints)). `cf-loom verify` fails if it is out of date.
- The declared Snapshot leaves out `version` and the history only the Baseline knows: tombstones of deleted Retired Elements, removed codes and removed Subscriptions. `check` and `publish` read the Baseline and merge that history in, so the published `snapshot.json` is complete.
- The Baseline is always read from the registry, never from the committed file (see [The Baseline](COMPATIBILITY.md#the-baseline)).

## Canonical form

- JSON, UTF-8, object keys sorted by code point, two-space indentation, a final newline. The same Contract always produces the same bytes, apart from `version`, `generator` and the `deprecatedAt` stamps carried forward.
- Arrays whose order means nothing are sorted: Rejection codes by code, Dependencies by Service, each Dependency's `endpoints` by `id` and `events` by identity, and `enum.values`, `union.options` and `allOf.items` by the canonical JSON of each item. Arrays whose order matters (an Endpoint's Guards, its `params`, a tuple's items) keep it.
- The Snapshot's hash is the SHA-256 of those bytes without `version` and `generator`; `publish` compares it with the Baseline's (see [Versioning](COMPATIBILITY.md#versioning) in COMPATIBILITY.md). Each Dependency's `against` and the `definitions` versions are in it, so adopting a newer version changes the hash even when no shape changed.

## Top level

```json
{
  "format": 1,
  "kind": "service",
  "name": "orders-service",
  "version": "3.4.0",
  "generator": "@casitafeliz/loom-cli@2.1.0",
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

- `format` is the version of this specification, and the CLI reads a Baseline written in any format it ever wrote; `generator` is the cf-loom CLI that wrote the file.
- `kind` is `service`, `application` or `definitions`. An Application's Snapshot holds only `dependencies`; a Definitions Package's holds `guards`, `schemas` (its shared schemas by name), `codes`, `standardRejections` and `defs`.
- `definitions` lists every Definitions Package the Contract uses, at the exact version resolved.

A Definitions Package's Snapshot:

```json
{
  "format": 1,
  "kind": "definitions",
  "name": "definitions",
  "version": "4.2.0",
  "generator": "@casitafeliz/loom-cli@2.1.0",
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

- A declared path must already be canonical, or the check fails: it starts with `/`, has no trailing slash (except `/` itself), literal segments match `[a-z0-9-]+`, a param is a whole segment written `:camelCase`, and there is no `//`, `.`, percent-encoding or query. At runtime a request path must match exactly.
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
  "guards": ["apiKey"],
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

- `params` is always stored `strict` (exactly the path's params) and a `headers` object, `input` or `success`, always `open`, whatever mode the zod object was written with.
- `input.headers` and `input.query` are resolved: the Endpoint's own plus every attached Guard's demands, header names lower-cased.
- `rejections` is resolved too: the Endpoint's own, `notFound` included when it lists it, its Guards', and the invalid-input and not-implemented Rejections, by code.
- A Deprecated Endpoint carries `deprecatedAt`, an ISO 8601 UTC instant (`"deprecatedAt": "2026-10-17T09:30:00Z"`): `generate` takes it from the committed `contract.snapshot.json`, else stamps it; `check` and `publish` keep the Baseline's `deprecatedAt` when it has one, so the published Snapshot carries it too. It is Neutral; `serve` sends it in the `Deprecation` header (see [Lifecycle](packages/contract/README.md#lifecycle) in the contract README).

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
  "demands": { "headers": {}, "query": null },
  "context": {},
  "rejections": ["UNAUTHENTICATED"]
}
```

## Rejection codes

```json
"codes": {
  "ORDER_LOCKED": { "origin": "local", "status": 409, "message": "The order can no longer be changed", "body": {}, "removed": false }
}
```

Every code that ever existed in the Contract stays here, with the status and body it last had and its `origin`: the Contract's own codes, those reached through imported Guards, and every code a Standard Rejection has had. The allowed `status` values are in [Rejections](COMPATIBILITY.md#rejections) in COMPATIBILITY.md. `removed` marks one no Endpoint answers any more. `standardRejections` holds the resolved code, status, message and `origin` of each Standard Rejection, and the body of the invalid-input Rejection (see [Rejections](packages/contract/README.md#rejections) in the contract README).

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
- A Retired Element that is still declared keeps its full entry.
- Once its declaration is deleted, `publish` carries it forward from the Baseline as a tombstone: `{ "lifecycle": "retired", "retiredIn": "3.0.0" }`, plus `name` for an Endpoint. Its identity is never reused.

## Schemas

Every shape is written fully inline wherever it is used; `defs` and `ref` exist only for recursion (see [Recursion](#recursion)). `generate` walks each schema's `_zod.def`, never `instanceof`, so `zod/mini` works too, and maps only the nodes and checks below; anything else fails `generate` (see [Not allowed](#not-allowed)).

| Node | Fields | From zod |
| --- | --- | --- |
| `string` | `format?`, `formatOptions?`, `regex?`, `min?`, `max?` | `z.string()`, `z.uuid()`, `z.email()`, `z.iso.datetime()`… |
| `number` | `int?`, `min?`, `max?`, `exclusiveMin?`, `exclusiveMax?`, `multipleOf?` | `z.number()`, `z.int()` |
| `boolean` | | `z.boolean()` |
| `literal` | `value` | `z.literal()` |
| `enum` | `values`, `open` | `z.enum()`, `openEnum()`, a union of literals |
| `object` | `mode` (`open` or `strict`), `fields` | `z.object()`, `z.strictObject()`, an intersection of objects; `z.record()` with an enum or literal key is `strict` with every key a required field, and `z.partialRecord()` is `strict` with every key optional |
| `record` | `key`, `value`, `min?`, `max?` | `z.record()` with a string key |
| `array` | `items`, `min?`, `max?` | `z.array()` |
| `tuple` | `items`, `rest?` | `z.tuple()` |
| `union` | `options` | `z.union()` |
| `tagged` | `discriminator`, `variants` (keyed by the canonical JSON of each discriminator value), `open` | `z.discriminatedUnion()`, `openUnion()` |
| `allOf` | `items` | any other intersection |
| `json` | | `z.json()`: any JSON value |
| `ref` | `name` | the schema that closes a cycle |

- Only declared checks map to constraints: min and max length, an exact length (`min` equal to `max`), greater and less than (inclusive as `min` and `max`, exclusive as `exclusiveMin` and `exclusiveMax`), `multipleOf`, `int`, a known string format and `regex`. `z.int()` is `int: true` and nothing more: no safe-integer bounds are implied.
- `format` carries its options as `formatOptions` (`{ "format": "datetime", "formatOptions": { "offset": true, "precision": 3 } }`).
- `regex` stores `source` and `flags` as `RegExp.prototype.source` and `RegExp.prototype.flags` give them; two regexes are equal only if both are identical.
- `enum.values` and a `literal`'s `value` keep their JSON type: `true` and `"true"` are different values, and `variants` keys them by their canonical JSON (`true`, `"true"`), so they never collide.
- An intersection of objects is one `object` only when every item is open and the keys they share have identical schemas; otherwise `generate` fails. Prefer `.extend()`.
- `.describe()` and `.meta()` are allowed and only set `description`, `examples` and the recursion `id`; any other `.meta()` key fails `generate`.
- Every node may carry `nullable`, `description`, `examples` and `origin` (see [Origin](#origin)). `description` and `examples` are Neutral.
- A field is `{ "required": true | false, "schema": … }`; optional and nullable are separate.
- A query param whose schema is an `array` is a list; anything else, and every path param, is a single value.
- Open Enums and Open Unions are stored with `open: true`; the reader and writer types are generated from that (see [Open Enums and Open Unions](packages/contract/README.md#open-enums-and-open-unions) in the contract README).
- The node names `binary` and `stream` are reserved: bodies are JSON (see [Shapes, not behavior](ARCHITECTURE.md#shapes-not-behavior) in ARCHITECTURE.md).

### JSON Schema

`cf-loom openapi` and `cf-loom asyncapi` (see [Commands](packages/cli/README.md#commands) in the CLI README) read the Snapshot and write each node as JSON Schema 2020-12: `string`, `number`, `boolean`, `array`, `record` (`additionalProperties`) and `object` (`additionalProperties: false` when `strict`) as their counterparts, with the constraints as the matching keywords; `literal` as `const`; a closed `enum` as `enum`, an open one as `anyOf: [enum, string]`; `tuple` as `prefixItems` with `items` for `rest`; `union` as `anyOf`; `tagged` as `oneOf` with a `discriminator` on the variants, an open one with a further variant whose discriminator is any string; `allOf` as `allOf`; `json` as `{}`; `nullable` as a `type` that includes `null`; and `ref` as a `$ref` into `$defs`. The Rejection and Fault envelopes (see [Over HTTP](ARCHITECTURE.md#over-http) in ARCHITECTURE.md) are written once as components. `description` and `examples` are carried over.

### Recursion

A cycle is detected as the same schema instance met again during the walk, through a getter (`get children() { return z.array(node); }`) or `z.lazy()`, which is transparent. The schema that closes the cycle must be named with `.meta({ id })`, or `generate` fails; it is written once under `defs`, keyed by that id, and `ref` points at it. Ids are read from the schema's own `.meta()`, never from zod's global registry, and are unique within the Snapshot: two schemas with the same id, local or from Definitions Packages, fail `generate`. `.meta({ id })` on a schema that closes no cycle is ignored, and the schema stays inline.

### Not allowed

A zod construct that does not map to a node or check above fails `generate`. Among them: `.default()`, `.prefault()`, `.catch()`, `.transform()`, `.preprocess()`, `.pipe()`, `.refine()`, `.superRefine()`, `.check()` and any custom check, `z.custom()`, `z.codec()`, `z.coerce.*`, `z.date()` (use `z.iso.datetime()`), `z.stringbool()`, `z.templateLiteral()`, `z.unknown()` and `z.any()` (use `z.record()` or `z.json()`), `.passthrough()`, `.catchall()` and `z.looseObject()` (use `z.record()` for dynamic keys), the mutating checks `.trim()`, `.toLowerCase()`, `.toUpperCase()`, `.normalize()` and `.overwrite()`, `.startsWith()`, `.endsWith()` and `.includes()`, `.brand()`, `.readonly()`, numeric `z.enum()` values, `.optional()` anywhere but directly on an object field, a standalone `z.null()`, `z.undefined()` or `z.literal(null)` (use `nullable`), and a discriminated union variant whose discriminator has several values.
