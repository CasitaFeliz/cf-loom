# Internals of @casitafeliz/loom-contract

How the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires. The entries `src/index.ts` (`.`) and `src/internal/index.ts` (`./internal`) re-export from the modules' `index.ts`.

## Modules

| Module | Holds | Depends on |
| --- | --- | --- |
| `declarations/` | every `define*`, its types and type rules, the runtime consts beside the types (`http`, `element`, Standard Rejections), Attachments, inference types, predicates, the freeze | none |
| `open/` | Open Enums and Open Unions: `openEnum`, `openUnion` and `isOpen` | none |
| `issues/` | a value parsed with its schema, zod's failures as cf-loom's issue codes | `declarations` |
| `walker/` | zod schemas to Snapshot nodes | `open` |
| `validation/` | every rule `generate` enforces, the valid result; the parts a declaration holds schemas in, the Rejections an Endpoint or Guard answers and the Standard Rejections a root resolves | `declarations`, `walker` |
| `snapshot/` | the declared Snapshot of a valid root, its types and its canonical text | `declarations`, `walker`, `validation` |
