# Internals of @casitafeliz/loom-contract

How the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires. The entries `src/index.ts` (`.`) and `src/internal/index.ts` (`./internal`) re-export from the modules' `index.ts`.

The package builds with `lib: ["ES2024", "WebWorker"]` and no Node types: `wire/` reads web-standard `Request`, `Headers`, `URL` and streams, which the WebWorker library declares without a browser window's globals (`window`, `document`, `localStorage`), so nothing in it can lean on a page or on Node.

## Modules

| Module | Holds | Depends on |
| --- | --- | --- |
| `declarations/` | every `define*`, its types and type rules, the runtime consts beside the types (`http`, `element`, Standard Rejections, the reserved codes), Attachments, inference types, predicates, the freeze | none |
| `open/` | Open Enums and Open Unions: `openEnum`, `openUnion` and `isOpen` | none |
| `issues/` | a value parsed with its schema, zod's failures as cf-loom's issue codes | `declarations` |
| `walker/` | zod schemas to Snapshot nodes; the Not allowed rules judged on walked nodes and slots (open intersections, records keyed by an enum or literal) | `open` |
| `validation/` | every rule `generate` enforces, the valid result, and a failure as one line; the parts a declaration holds schemas in, the Rejections an Endpoint or Guard answers and the Standard Rejections a root resolves; `Issue`, one way a value broke its part; what the runtime reads of a valid root: its Endpoints in Group order, their Attachments with their Qualifiers, a path's segments, and the text parts of one Endpoint or Guard walked and judged by the same text rules `generate` applies | `declarations`, `walker` |
| `wire/` | the Wire protocol's rules `serve`, the client and the fakes share, free of Handlers and hosts: the request side, matching a method and path to a declared Endpoint, reading a party's text parts and reading a body within `maxBodyBytes`; a text part's value from its texts by node and a value as text, which text can travel as a header, and a Success's headers as text or Issues; the Envelopes, the reserved codes with their statuses, `committed` and texts, `Internal error`, the status a Fault travels with, the invalid-input body from Issues, the JSON content type and the `Deprecation` header | `declarations`, `walker`, `validation` |
| `snapshot/` | the declared Snapshot of a valid root, its types and its canonical text | `declarations`, `walker`, `validation` |
