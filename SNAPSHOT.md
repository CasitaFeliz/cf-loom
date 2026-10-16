# Snapshot

The format of a Snapshot: the language-neutral description of a Contract or a Definitions Package that the Compatibility Check compares. Terms are defined in [CONTEXT.md](CONTEXT.md); the rules that compare two Snapshots are in [COMPATIBILITY.md](COMPATIBILITY.md).

## Where it lives

- `cf-loom publish` writes the Snapshot into the published package as `snapshot.json`, and fills in `version`.
- `cf-loom generate` also writes the *declared* Snapshot to `contract.snapshot.json` next to `cf-loom.config.ts`, so every Contract change shows up as a diff in review. It is built from the source alone, offline, and `cf-loom verify` fails if it is out of date.
- The declared Snapshot leaves out `version` and the history only the Baseline knows: tombstones of deleted Retired Elements, removed codes and removed Subscriptions. `check` and `publish` read the Baseline and merge that history in, so the published `snapshot.json` is complete.
- The Baseline is always read from the registry, never from the committed file.

## Choosing the Baseline

- By default the Baseline is the highest published version, read from the package's list of versions, never from the `latest` tag.
- A publish on a maintenance line uses the dist-tag `line-<major>`, so `latest` always points at the newest line.
- A maintenance line (`cf-loom check --line 2`) compares against the highest published `2.x.y` and may only publish a minor or a patch on that line; a Breaking Change there fails.
- Whatever the line, retired identities, Subscription tombstones and Rejection codes are also checked against the highest published version, so nothing retired on the newest line is reused on an older one.

## Canonical form

- JSON, UTF-8, object keys sorted, two-space indentation, a final newline. The same Contract always produces the same bytes, apart from `version` and `generator`.
- Arrays whose order means nothing (Guards' Rejections, an enum's values, Dependencies) are sorted; arrays whose order matters (an Endpoint's Guards, a tuple's items) keep it.
- The Snapshot's hash is the SHA-256 of those bytes without `version` and `generator`. `publish` compares it with the Baseline's to tell whether anything changed.

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

- `format` is the version of this specification; `generator` the cf-loom CLI that wrote the file.
- `kind` is `service`, `application` or `definitions`. An Application's Snapshot holds only `dependencies`; a Definitions Package's holds `guards`, `schemas` (its shared schemas by name), `codes`, `standardRejections` and `defs`.
- `definitions` lists every Definitions Package the Contract uses, at the exact version resolved.

## Identities

| Element | Key | Example |
| --- | --- | --- |
| Endpoint | Method and path, params replaced by `{}` | `GET /orders/{}` |
| Event, Command | Name and version | `OrderCreated@2` |
| Subscription | Its name | `notify-on-settled` |
| Another Service's Element | Service, then the key above | `payments-service:PaymentSettled@1` |

- A declared path must already be canonical, or the check fails: it starts with `/`, has no trailing slash (except `/` itself), literal segments match `[a-z0-9-]+`, a param is a whole segment written `:camelCase`, and there is no `//`, `.`, percent-encoding or query. At runtime a request path must match exactly.
- A path param's name is not part of the identity; the Endpoint stores its param names separately.
- When two Endpoints with the same method match one URL, the literal segment wins. Adding a path that shadows an existing param path narrows that Endpoint's Input, so it is a Breaking Change on it.
- A Message name is a Command or an Event, never both, across the whole Contract and its history.

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
  "success": { "status": 200, "body": { "type": "object", "mode": "open", "fields": {} } },
  "rejections": ["INVALID_INPUT", "NOT_FOUND", "NOT_IMPLEMENTED", "ORDER_LOCKED", "UNAUTHENTICATED"]
}
```

- `params` is always stored `strict` (exactly the path's params) and `headers` always `open`, whatever mode the zod object was written with.
- `input.headers` and `input.query` are resolved: the Endpoint's own plus every attached Guard's demands, header names lower-cased.
- `rejections` is resolved too: the Endpoint's own, its Guards', and the Standard Rejections that apply to it, by code.

## Messages

```json
"events":   { "OrderCreated@2": { "visibility": "internal", "lifecycle": "active", "description": "", "body": {} } },
"commands": { "ChargeCard@1":   { "lifecycle": "active", "description": "", "body": {} } }
```

Subjects and stream names are derived from these keys at runtime and are not stored.

## Guards

```json
"apiKey": {
  "origin": "local",
  "demands": { "headers": {}, "query": null },
  "context": {},
  "rejections": ["UNAUTHENTICATED"]
}
```

`origin` is `local` or the Definitions Package and version it came from.

## Rejection codes

```json
"codes": {
  "ORDER_LOCKED": { "status": 409, "message": "The order can no longer be changed", "body": {}, "removed": false }
}
```

Every code that ever existed in the Contract stays here, with the status and body it last had and its `origin` (`local`, a Definitions Package, or `standard`): the Contract's own codes, those reached through imported Guards, and every code a Standard Rejection has had. `removed` marks one no Endpoint answers any more. `standardRejections` holds the resolved code, status, message and origin of each Standard Rejection, and the invalid-input body cf-loom defines.

## Subscriptions and Dependencies

```json
"subscriptions": {
  "notify-on-settled": { "event": "payments-service:PaymentSettled@1" },
  "legacy-sync": { "removedIn": "3.2.0" }
},
"dependencies": {
  "payments-service": {
    "against": "5.1.0",
    "endpoints": [{ "id": "GET /payments/{}", "name": "getPayment" }],
    "events": ["PaymentSettled@1"]
  }
}
```

- A removed Subscription stays as a tombstone; its name is never reused (see [Subscriptions](COMPATIBILITY.md#subscriptions)), and tombstones are how `broker-plan` finds consumers to remove.
- A Dependency records the provider's Contract Package version it was declared against, and each Endpoint's identity together with its name.

## Lifecycle and tombstones

- `lifecycle` is `active`, `deprecated` or `retired`.
- A Retired Element that is still declared keeps its full entry.
- Once its declaration is deleted, `publish` carries it forward from the Baseline as a tombstone: `{ "lifecycle": "retired", "retiredIn": "3.0.0" }`, plus `name` for an Endpoint. Its identity is never reused.

## Schemas

Every shape is written fully inline wherever it is used; `defs` and `ref` exist only for recursion: a recursive schema is named with `.meta({ id })` and `z.lazy()` refers to it. Only these nodes exist. A zod construct that does not map to one of them fails `generate`.

| Node | Fields | From zod |
| --- | --- | --- |
| `string` | `format?`, `regex?`, `min?`, `max?` | `z.string()`, `z.uuid()`, `z.email()`, `z.iso.datetime()`… |
| `number` | `int?`, `min?`, `max?`, `exclusiveMin?`, `exclusiveMax?`, `multipleOf?` | `z.number()`, `z.int()` |
| `boolean` | | `z.boolean()` |
| `literal` | `value` | `z.literal()` |
| `enum` | `values`, `open` | `z.enum()`, `openEnum()`, a union of literals |
| `object` | `mode` (`open` or `strict`), `fields` | `z.object()`, `z.strictObject()`, an intersection of objects, `z.record()` with an enum or literal key (zod requires every key, so each becomes a required field) |
| `record` | `key`, `value`, `min?`, `max?` | `z.record()` with a string key, `z.partialRecord()` |
| `array` | `items`, `min?`, `max?` | `z.array()` |
| `tuple` | `items` | `z.tuple()` |
| `union` | `options` | `z.union()` |
| `tagged` | `discriminator`, `variants` (by value), `open` | `z.discriminatedUnion()`, `openUnion()` |
| `allOf` | `items` | any other intersection |
| `json` | | `z.json()`: any JSON value |
| `ref` | `name` | `z.lazy()` |

- `.describe()` and `.meta()` are allowed and only set `description`, `examples` and the recursion `id`.
- Every node may carry `nullable`, `description`, `examples` and `origin` (the Definitions Package schema it came from). `description`, `examples` and `origin` are Neutral.
- A field is `{ "required": true | false, "schema": … }`; optional and nullable are separate.
- `regex` stores the source and flags; two regexes are equal only if both are identical.
- A query param whose schema is an `array` is a list; anything else, and every path param, is a single value.
- `z.unknown()` and `z.any()` are not allowed: opaque data is described with `z.record()` or `z.json()`. Any change to or from a `json` node is Breaking.
- Open Enums and Open Unions are stored with `open: true`. The reader and writer types are generated from that: readers get the declared values plus a tagged Unknown case carrying the raw value (`{ unknown: 'refunded' }`), writers only the declared values.

## Definitions Packages

A Definitions Package's own check judges each schema in all three positions (Input, Success, Message) and takes the strongest class; a change of object strictness counts only with its Input class. A Guard's demands are judged as Input, its Context is Neutral, and Rejections follow the Rejection rules. The verdict that matters to a Service still comes when it adopts the new version.
