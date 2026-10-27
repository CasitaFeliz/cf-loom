# Snapshot

The format of a Snapshot: the language-neutral description of a Contract or a Definitions Package that the Compatibility Check compares. Terms are defined in [CONTEXT.md](CONTEXT.md); the rules that compare two Snapshots are in [COMPATIBILITY.md](COMPATIBILITY.md).

## Where it lives

- `cf-loom publish` writes the Snapshot into the published package as `snapshot.json`, and fills in `version` and `generator`; `cf-loom package` writes the declared Snapshot into the package it writes, with the `generator` of the CLI that runs it and without `version` (see [Commands](packages/cli/README.md#commands) in the CLI README). The package.json it publishes carries `cfLoom: { format, snapshotHash, kind, dependencies }`: the registry's package metadata says which kind of package each version is and records every Provider it uses, each as the Snapshot records it with `events`, the identities of the Provider's Events its Subscriptions receive, sorted (empty for an Application), and `snapshotHash` lets the organization's tooling tell from the metadata whether two versions' Snapshots differ, though cf-loom itself never reads it; `check` and `publish` read the Baseline's `cfLoom` and peer ranges from the metadata and download only its `snapshot.json`. A Definitions Package is published from its own package.json and files, into which `publish` writes `version`, `cfLoom` (with `dependencies` empty) and `peerDependencies` (the two ranges the CLI declares, as [Versioning](COMPATIBILITY.md#versioning) in COMPATIBILITY.md says), and beside which it adds `snapshot.json`, listed in its `files` when it has them.
- Each Endpoint a Service's Contract Package exports also carries the exported Snapshot cut to it (the Snapshot cut to what the package exports, then to that Endpoint): the Endpoint, its Guards, codes and defs, keyed as here, with `format` and no other heading, no Events, and a `shadowing` key (see [The Contract Package](ARCHITECTURE.md#the-contract-package) in ARCHITECTURE.md). The client and `@cf-loom/testing` read Snapshot nodes from it at runtime, by the format it names and once per Endpoint, so they too read every format number the CLI ever wrote, as the Compatibility Check does, and refuse any other, or a Snapshot its format does not describe, never reading it as far as it goes (see [Consuming a Contract](packages/client/README.md#consuming-a-contract) in the client README).
- `cf-loom generate` also writes the *declared* Snapshot to `contract.snapshot.json` next to package.json, so every Contract change shows up in review. It is built offline, a function of the source and the installed packages. `cf-loom verify` fails if it differs from what `generate` would write.
- The declared Snapshot leaves out `version`, `generator` and the history only the Baseline knows: the version each Retired Element was Retired in, tombstones of deleted Retired Elements, removed codes (each with the `removedIn` that first published it removed, and the defs it reached then), removed Subscriptions, and the former Inputs of its Endpoints (each with the `removedIn` that first published a field of it removed, and the defs it reached then). `check` and `publish` read the Baseline and merge that history in, so the published `snapshot.json` is complete.
- The Baseline is always read from the registry, never from the committed file (see [The Baseline](COMPATIBILITY.md#the-baseline)).

## Canonical form

- JSON, UTF-8, two-space indentation, a final newline. The heading comes first, in this order: `format`, `kind`, `name`, then `version` and `generator` where the file holds them; the other top-level keys follow, and every nested key, sorted by code point. The same Contract always produces the same bytes, apart from `version` and `generator`, which only a published or packaged file holds.
- A Snapshot's JSON nests at most 256 levels, the outermost object being the first, and a schema node at most 252 levels, its root the first; a node's root sits at most 4 keys below the outermost object, so the rest of the Snapshot, such as a Qualifier's value, has the 256 and a node keeps within them wherever the merge keeps it, a removed code's and a former Input's defs included; a Contract that breaks either limit is [Not allowed](packages/contract/README.md#not-allowed), so every Snapshot `generate` writes, and every Snapshot `publish` merges from it, reads back.
- The Snapshot writes one spelling for one shape. A text part (`input.query`, `input.headers`, `success.headers`, a code's `headers`, a Guard's `demands.headers` and `demands.query`) is always an open object, with no field when none is declared, so a part declared with `z.object({})` and one not declared write the same Snapshot. A def is never `nullable`: `.nullable()` belongs to a use, so `.meta({ id })` on a schema that admits `null` fails `generate` (see [Recursion](packages/contract/README.md#recursion) in the contract README); every `ref` to a def carries its own `nullable`.
- Arrays whose order means nothing are sorted: Rejection codes by code, Providers by Service, each Provider's `endpoints` by `id`, and `enum.values` and `allOf.items` by the canonical JSON of each item. Arrays whose order matters (an Endpoint's Guards, a Guard's `guards`, an Endpoint's `params`, a tuple's items, a union's `options`, since zod's union returns the first option that parses, a Qualifier's list) keep it. `formerInputs` is sorted by `endpoint`, each Endpoint's in the order its former Inputs were recorded, oldest first.
- The Snapshot's hash is the SHA-256 of those bytes without `version` and `generator`, written in lowercase hex; the published package.json carries it as `snapshotHash`, and the Compatibility Check reports every difference in those bytes as a Change (see [Versioning](COMPATIBILITY.md#versioning) in COMPATIBILITY.md). Each Provider's `against` and the version in every `origin` are in it, so adopting a newer version is a Neutral Change even when no shape changed.

## Top level

```json
{
  "format": 1,
  "kind": "service",
  "name": "orders-service",
  "version": "3.4.0",
  "generator": "@cf-loom/cli@2.1.0",
  "codes": {},
  "commands": {},
  "defs": {},
  "dependencies": {},
  "endpoints": {},
  "events": {},
  "formerInputs": [],
  "groups": { "orders": { "description": "Order lifecycle" } },
  "guards": {},
  "standardRejections": { "invalidInput": "INVALID_INPUT", "notFound": "NOT_FOUND", "notImplemented": "NOT_IMPLEMENTED" },
  "subscriptions": {}
}
```

- `format` is the version of this specification, and the CLI reads a Baseline written in any format number it ever wrote; `generator` is the cf-loom CLI that wrote a published or packaged file; the declared file has none. From cf-loom 1.0.0 on, anything this specification adds or changes is a new format; before it, format 1 still changes in place, so a newer cf-loom may find a Baseline or an exported Snapshot cut that an older one wrote malformed (see [Before cf-loom 1.0.0](packages/cli/README.md#before-cf-loom-100) in the CLI README).
- The CLI decodes a `snapshot.json` by the format it names and fails closed. Each of these is a tooling error, never read as far as it goes: no JSON; a format newer than the CLI; a key or value its format does not define, a map's key `__proto__` included; a Snapshot too large to read; no `version`, or a `version`, `retiredIn` or `removedIn` that is not a semantic version; an identity it cannot read; a name the Snapshot uses and does not hold, such as a `ref`'s def (a removed code's or a former Input's in its own `defs`, every other in the Snapshot's), a code an Endpoint or Guard lists, a Standard Rejection names or an export names, a Guard an Endpoint attaches, a Guard lists or an export names, the Group a declared Endpoint, Event, Command or Subscription records, or the Endpoint a former Input names, which it must declare and not hold Retired; a body on the code a Standard Rejection names that the Rejection does not have, none on the invalid-input one or one on the not-found and not-implemented ones, or headers on any of them; a def, a removed code's or a former Input's included, that leads back to itself through `ref`s, `union` options and `allOf` items alone, with no other node between. It also judges again, with the rules `generate` uses, what makes the Check or the hash wrong when broken: arrays whose order means nothing in canonical order, each item once, and `formerInputs` by `endpoint`, each Endpoint's `removedIn` once; `against` a semantic version; `deprecatedAt` only on a Deprecated Endpoint; a Success status `generate` allows, and a code status of 4xx, or 501 on the code the not-implemented Standard Rejection names or on a removed code; `formatOptions` by option; a node's bounds that admit a value, and an enum, union or tagged with at least one value or option; a text part that is not an object, a def that is `nullable`, and an Endpoint's `params` that are not its identity's `{}`, each once, or an `input.params` that is not `null` for a path without params, or not exactly those params as required fields; and a JSON nesting of at most 256 levels, judged once the format is read and before the structure, and each schema node nested at most 252 levels, judged after it as `generate` does. It does not judge again the other rules `generate` enforced, such as a code declared once or a Guard's closure.
- `kind` is `service`, `application` or `definitions`. `name` is a Service's or Application's Root name, and a Definitions Package's package.json name, scope included. An Application's Snapshot holds only `dependencies`; a Definitions Package's holds `exports` (what its Root file exports, by name: a Guard by its name, a Rejection by its code, a shared schema's node), `guards`, `codes`, `standardRejections` and `defs`.

A Service's `groups` holds each of its Groups by name with its `description`, which is Neutral; every `group` a declared Element or Subscription records is held there, and every Group lists at least one Element or Subscription.

A Definitions Package's Snapshot:

```json
{
  "format": 1,
  "kind": "definitions",
  "name": "@org/definitions",
  "version": "4.2.0",
  "generator": "@cf-loom/cli@2.1.0",
  "codes": {},
  "defs": {},
  "exports": {
    "apiKey": { "kind": "guard", "guard": "apiKey" },
    "money": { "kind": "schema", "schema": {} },
    "unauthenticated": { "kind": "rejection", "code": "UNAUTHENTICATED" }
  },
  "guards": {},
  "standardRejections": { "invalidInput": "INVALID_INPUT", "notFound": "NOT_FOUND", "notImplemented": "NOT_IMPLEMENTED" }
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
    "params": {
      "type": "object",
      "fields": { "orderId": { "required": true, "schema": { "type": "string" } } }
    },
    "query": { "type": "object", "fields": {} },
    "headers": { "type": "object", "fields": {} },
    "body": null
  },
  "success": {
    "status": 200,
    "headers": { "type": "object", "fields": {} },
    "body": { "type": "object", "fields": {} }
  },
  "rejections": ["BAD_REQUEST", "NOT_FOUND", "NOT_IMPLEMENTED", "ORDER_LOCKED", "UNAUTHENTICATED"]
}
```

- `params` holds exactly the path's params.
- `guards` lists the Endpoint's Attachments in order: each Guard by name, with its Qualifier as canonical JSON, or `null` when the Guard declares no `qualifier`.
- `input.headers` and `input.query` are resolved: the Endpoint's own plus every attached Guard's demands, header names lower-cased. Two declarations of one name agree on the shape (see [Headers, path and query](COMPATIBILITY.md#headers-path-and-query) in COMPATIBILITY.md); the `description`, `examples` and `origin` written are the first declaration's, the Endpoint's own before its Guards', in Attachment order.
- `rejections` is resolved too: the Endpoint's own, `notFound` included when it lists it, its Guards', and the invalid-input and not-implemented Rejections, by code.
- A Deprecated Endpoint carries `deprecatedAt`, an ISO 8601 UTC instant to the second (`"deprecatedAt": "2026-10-17T09:30:00Z"`), the one its declaration states, which may lie in the future. It is Neutral, and moving it is a Neutral Change, `deprecation-moved`; `serve` sends it in the `Deprecation` header (see [Lifecycle](packages/contract/README.md#lifecycle) in the contract README).

## Former Inputs

```json
"formerInputs": [
  {
    "endpoint": "POST /orders",
    "removedIn": "1.1.0",
    "input": {
      "query": { "type": "object", "fields": {} },
      "body": {
        "type": "object",
        "fields": {
          "id": { "required": true, "schema": { "type": "string" } },
          "note": { "required": false, "schema": { "type": "number" } }
        }
      }
    },
    "defs": {}
  }
]
```

A published Service Snapshot's `formerInputs` holds each query and body an Endpoint declared before a later version removed a field from them, while the Endpoint still lacks a field of it and declares nothing Breaking against it (see [Fields](COMPATIBILITY.md#fields) in COMPATIBILITY.md). `endpoint` is the identity of an Endpoint the Snapshot declares and does not hold Retired; `removedIn` is the version that first published a field of it removed, a prerelease included; `input` holds the `query` and `body` as that version's Baseline declared them, the body `null` when the Endpoint had none, and no `headers` or `params`; `defs` are the defs its `query` and `body` reached in that Baseline, keyed as the Snapshot's are and `{}` when none, which its `ref`s name and never the Snapshot's `defs`. It is `[]` when there is none; the declared Snapshot, a packaged one, a Definitions Package's, an Application's and the exported cut have none.

## Messages

```json
"events":   { "OrderCreated@2": { "group": "orders", "visibility": "internal", "lifecycle": "active", "description": "", "body": {} } },
"commands": { "ChargeCard@1":   { "group": "orders", "lifecycle": "active", "description": "", "body": {} } }
```

`group` names the Group that lists the Message Version, as an Endpoint's does; a tombstone has none.

Subjects, Stream names and Durable consumer names are derived from these identities, by the adapter and by `cf-loom broker-plan`, and subjects also by `cf-loom asyncapi`, and are not stored.

## Origin

`origin`, on a Guard, a code or a schema node, says where it was declared: `"local"`, `"standard"` (a Standard Rejection's code with cf-loom's defaults) or the Definitions Package and version it came from, the one that exports it and imports it from none of the others that do, `"@org/definitions@4.2.0"`. Which package that is never depends on package.json: a declaration that belongs to a package whose package.json has no name or no version fails validation (`definitions-unidentified`), however it was re-exported. An origin is written with `#<name>` for a shared schema, the first name in code point order it is exported under, `"@org/definitions@4.2.0#money"`. A clone of a shared schema (`money.describe('…')`) is a new schema and carries no `origin`. Which Definitions Packages a Contract uses, at which versions, is read from its origins alone; two installed copies of one package are two origins. `origin` is Neutral.

## Guards

```json
"apiKey": {
  "origin": "local",
  "description": "An API key per Caller",
  "guards": [],
  "qualifier": null,
  "demands": { "headers": {}, "query": {} },
  "context": {},
  "rejections": ["UNAUTHENTICATED"]
}
```

`description` is Neutral. `guards` names the Guards whose Context its GuardHandler reads, in declared order; `qualifier` is the schema node of its Qualifier, or `null` (see [Guards](packages/contract/README.md#guards) in the contract README). A Service's Snapshot writes the Guards its Endpoints attach, directly or through a Guard's `guards`; a Definitions Package's other Guards stay out, while a Definitions Package's own Snapshot writes every Guard it exports.

## Rejection codes

```json
"codes": {
  "ORDER_LOCKED": { "origin": "local", "status": 409, "message": "The order can no longer be changed", "headers": {}, "body": {} },
  "ORDER_PURGED": { "origin": "local", "status": 410, "message": "The order was purged", "headers": {}, "body": null, "removedIn": "3.2.0", "defs": {} },
  "UNAUTHENTICATED": {
    "origin": "@org/definitions@4.2.0",
    "status": 401,
    "message": "The API key is missing or unknown",
    "headers": { "type": "object", "fields": { "www-authenticate": { "required": true, "schema": { "type": "string" } } } },
    "body": null
  }
}
```

Every code that ever existed in the Contract stays here, with the status, headers and body it last had and its `origin`: the Contract's own codes, those reached through imported Guards, and every code a Standard Rejection has had. Each code has one declaration (see [Rejections](COMPATIBILITY.md#rejections) in COMPATIBILITY.md), whose status, message, headers, body and `origin` are written; `headers` is a text part, an open object with no field when the code declares none. A Service's Snapshot writes the codes its Endpoints answer, themselves or through the Guards they reach, and every code a Standard Rejection has had; a Definitions Package's other codes stay out; a Definitions Package's own Snapshot writes every code it exports, or its Guards answer. The allowed `status` values are in [Rejections](COMPATIBILITY.md#rejections) in COMPATIBILITY.md. A published Snapshot keeps a code no Endpoint answers any more, or, in a Definitions Package, one it no longer declares, with `removedIn`, the version that first published it removed, a prerelease included, and with `defs`, the defs its body reached in the Baseline of that publish, keyed as the Snapshot's are and `{}` when it reached none; its `ref`s name those and never the Snapshot's `defs`, so what it last had never changes when a later version changes a def of the same name; the declared Snapshot has neither. `standardRejections` names the code each Standard Rejection resolved to; its status, message, `origin`, headers and body are that code's, under `codes`, and only the invalid-input Rejection has a body, none has headers (see [Rejections](packages/contract/README.md#rejections) in the contract README).

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
- `dependencies` records each Provider a Contract uses, by its Dependencies or its Subscriptions: as `against`, the version in the package.json of the installed Contract Package that exports the Elements it uses, found as a Definitions Package is, by identity among the packages the Root's files import (a Provider whose Elements belong to a package whose package.json has no name or no version fails validation, `dependency-package`, at each Dependency and Subscription that holds one, and so does one whose Elements no installed package exports, or two do and neither imports them from the other), and the identity and name of each Endpoint its Dependencies list, each once, however they are split into Dependencies; a Provider only Subscriptions use lists no Endpoint. The Events a Service receives from a Provider are recorded once, by its Subscriptions, each `event` naming the Provider before the Event's identity.

## Lifecycle and tombstones

- `lifecycle` is `active`, `deprecated` or `retired`.
- A Retired Element that is still declared keeps everything it records; in the published Snapshot it also carries `retiredIn`, the version that first published it Retired, a prerelease included: a version promoted from that prerelease keeps its `retiredIn`.
- Once its declaration is deleted, `publish` carries it forward from the Baseline as a tombstone: `{ "lifecycle": "retired", "retiredIn": "3.0.0" }`, its `retiredIn` the Baseline's, plus `name` for an Endpoint. Its identity is never reused.

## Schemas

Every shape is written fully inline wherever it is used; `defs` and `ref` exist only for recursion (see [Recursion](#recursion)). Which zod construct becomes which node is in [Schemas](packages/contract/README.md#schemas) in the contract README, with what is [Not allowed](packages/contract/README.md#not-allowed) there.

| Node | Fields |
| --- | --- |
| `string` | `format?`, `formatOptions?`, `regex?`, `min?`, `max?` |
| `number` | `int?`, `min?`, `max?`, `exclusiveMin?`, `exclusiveMax?`, `multipleOf?` |
| `boolean` | |
| `enum` | `values`, `open` |
| `object` | `fields` |
| `record` | `key`, `value` |
| `array` | `items`, `min?`, `max?` |
| `tuple` | `items`, `rest?` |
| `union` | `options` |
| `tagged` | `discriminator`, `variants` (keyed by the canonical JSON of each discriminator value; each an `object`, or a `ref` to an `object` in `defs`) |
| `allOf` | `items` |
| `json` | |
| `ref` | `name` |

- A node holds each constraint at most once: one lower bound (`min` or `exclusiveMin`), one upper bound (`max` or `exclusiveMax`), and one of every other (two checks that set one are [Not allowed](packages/contract/README.md#not-allowed)). `min` and `max` are inclusive and `exclusiveMin` and `exclusiveMax` exclusive; on a string `min` and `max` bound its length, on an array its item count, so an exact length is `min` equal to `max`. `multipleOf` is greater than 0; a string's or array's `min` and `max` are non-negative integers; a lower bound never exceeds the upper one, nor equals it when either is exclusive. Only bounds are judged: bounds that admit no integer or no multiple, or a regex that matches nothing, are written as declared.
- The known string formats are the ones zod builds itself: `guid`, `uuid`, `email`, `url`, `emoji`, `nanoid`, `cuid`, `cuid2`, `ulid`, `xid`, `ksuid`, `datetime`, `date`, `time`, `duration`, `ipv4`, `ipv6`, `mac`, `cidrv4`, `cidrv6`, `base64`, `base64url`, `e164`, `credit_card`, `iban`, `jwt`, `hex`, `hostname`, `currency_code`, and the hash formats `<md5|sha1|sha256|sha384|sha512>_<hex|base64|base64url>` (`z.hash()`).
- `format` carries its options as `formatOptions` (`{ "format": "datetime", "formatOptions": { "offset": true, "precision": 3 } }`): only the options zod reads for that format (`version`, `offset`, `local`, `precision`, `protocol`, `hostname`, `alg`, `delimiter`) and only where they differ from zod's default, so `z.mac()` and `z.mac({ delimiter: ':' })` are the same and `z.url({ normalize: false })` has none; a hash's encoding is part of its format name.
- `regex` stores `source` and `flags` as `RegExp.prototype.source` and `RegExp.prototype.flags` give them; two regexes are equal only if both are identical.
- `enum.values` keep their JSON type: `true` and `"true"` are different values, and `variants` keys them by their canonical JSON (`true`, `"true"`), so they never collide.
- An intersection of objects is written as one merged `object` (which intersections are, is in [Schemas](packages/contract/README.md#schemas) in the contract README). A field both items declare is written as the left item's, with its annotations. The merged object, like the `enum` of a union of literals, carries only its own annotations, never those of its items or options; a merged object is `nullable` only when every item is, and the enum of a union of literals is `nullable` when any of its literals is.
- `.describe()` and `.meta()` set a string `description`, `examples` and the recursion `id` (see [Recursion](#recursion)), and nothing else ([Not allowed](packages/contract/README.md#not-allowed)).
- Every node may carry `nullable`, `description`, `examples` and `origin` (see [Origin](#origin)). `description` and `examples` are Neutral.
- A field is `{ "required": true | false, "schema": … }`; optional and nullable are separate.
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

A schema with an id that lies on a cycle is written once under `defs`, keyed by that id, and referenced by a `ref` wherever it is used, whichever schema the walk enters the cycle at; the other schemas of the cycle stay inline. A `z.lazy()` is unwrapped one level at a time, each a schema of its own, with its id and annotations read like any schema's: `z.lazy(() => node).describe('…')` around a schema with an id is a `ref` carrying that description, and two ids on one chain of lazies give a def and an alias def, a `ref` to it, which always leads to a def that is not a `ref`. A removed code and a former Input keep the defs they reached under their own `defs` (see [Rejection codes](#rejection-codes) and [Former Inputs](#former-inputs)). How to write a cycle, and which ones `generate` refuses, is in [Recursion](packages/contract/README.md#recursion) in the contract README.

### Not allowed

A zod construct that maps to no node or check above fails `generate`; which constructs, and what to use instead, are in [Not allowed](packages/contract/README.md#not-allowed) in the contract README.
