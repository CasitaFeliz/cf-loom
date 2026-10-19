# Internals of @casitafeliz/loom-contract

How the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires. The entries `src/index.ts` (`.`) and `src/internal/index.ts` (`./internal`) re-export from the modules' `index.ts`.

## Modules

| Module | Holds | Depends on |
| --- | --- | --- |
| `declarations/` | every `define*`, its types and type rules, the runtime consts beside the types (`http`, `element`, Standard Rejections), Attachments, inference types, predicates, the freeze | none |
| `open/` | Open Enums and Open Unions: `openEnum`, `openUnion` and `isOpen` | none |
| `issues/` | a value parsed with its schema, zod's failures as cf-loom's issue codes | `declarations` |
| `walker/` | zod schemas to Snapshot nodes; the Not allowed rules judged on walked nodes and slots (open intersections, records keyed by an enum or literal) | `open` |
| `validation/` | every rule `generate` enforces, the valid result, and a failure as one line; the parts a declaration holds schemas in, the Rejections an Endpoint or Guard answers and the Standard Rejections a root resolves; what the runtime reads of a valid root: its Endpoints in Group order, their Attachments with their Qualifiers, a path's segments, and the text parts of one Endpoint or Guard walked and judged by `generate`'s rules | `declarations`, `walker` |
| `wire/` | the Wire protocol's rules `serve`, the client and the fakes share: a text part's value from its texts by node, the Envelopes, the reserved codes with their statuses and `committed`, the status a Fault travels with, the invalid-input body from Issues, the JSON content type and the `Deprecation` header | `declarations`, `walker`, `validation` |
| `snapshot/` | the declared Snapshot of a valid root, its types and its canonical text | `declarations`, `walker`, `validation` |
