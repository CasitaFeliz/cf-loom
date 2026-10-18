# Internals of @casitafeliz/loom-contract

How the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires. The entries `src/index.ts` (`.`) and `src/internal/index.ts` (`./internal`) re-export from the modules' `index.ts`.

## Modules

| Module | Holds | Depends on |
| --- | --- | --- |
| `declarations/` | every `define*`, its types and type rules, the runtime consts beside the types (`http`, `element`, Standard Rejections), Attachments, inference types, predicates, the freeze | none |
| `open/` | Open Enums and Open Unions: `openEnum`, `openUnion` and `isOpen` | none |
| `walker/` | zod schemas to Snapshot nodes | `open` |
| `validation/` | every rule `generate` enforces, and the valid result | `declarations`, `walker` |
| `snapshot/` | the declared Snapshot of a valid root, its types and its canonical bytes | `declarations`, `walker`, `validation` |
