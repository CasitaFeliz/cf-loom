# Internals of @casitafeliz/loom-contract

How the package's `src/` is split into modules, as [Package layout](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires. The entries `src/index.ts` (`.`) and `src/internal/index.ts` (`./internal`) re-export from the modules' `index.ts`.

## Modules

| Module | Holds | Depends on |
| --- | --- | --- |
| `declarations/` | every `define*`, its types and type rules, the runtime consts beside the types (`http`, `element`, Standard Rejections), Attachments, Open Enums and Unions, inference types, predicates, the freeze | none |
| `walker/` | zod schemas to Snapshot nodes | `declarations` |
| `validation/` | every rule `generate` enforces, and the valid result | `declarations`, `walker` |
