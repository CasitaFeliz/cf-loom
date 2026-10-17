# cf-loom

Organization-agnostic tooling for service Contracts: HTTP Endpoints and messaging, written in TypeScript with zod. This repository holds the tools only, never a Service's Contract. The design is in the documents below; the packages are under `packages/`.

## Documents

| File | Holds |
| --- | --- |
| `CONTEXT.md` | The glossary: every term, with words to avoid |
| `COMPATIBILITY.md` | How a Contract may change: the Compatibility Check and its rules |
| `ARCHITECTURE.md` | How the pieces fit: packages, runtime, what cf-loom leaves to the organization |
| `AUTHORING.md` | The authoring API, layout, examples, configuration and CLI |
| `SNAPSHOT.md` | The Snapshot format the Compatibility Check compares |

- Everything is written in English, code and documents alike.
- No `docs/` folder: a compatibility rule goes in `COMPATIBILITY.md`, an architecture concern in `ARCHITECTURE.md`.
- Each rule lives in one document; the others link to it.
- The documents describe the current design only, never the history of decisions. A changed decision replaces the old text.
- Use the glossary's terms, capitalized, and never its _Avoid_ words.

## Repository

- pnpm 12 workspaces under `packages/`; shared versions in the catalog of `pnpm-workspace.yaml`. Node 24 (`.node-version`).
- ESM only; built with `tsc -b` and project references; tested with Vitest projects; formatted and linted with Biome.
- Each package has `tsconfig.build.json` (src to dist, no tests) and `tsconfig.test.json` (type-checks tests); `contract` and `client` build without Node types, since Applications run them in browsers.
- cf-loom packages depend on each other only as peers (plus a devDependency), never as dependencies.
- A package shares code with other cf-loom packages only through an undocumented `./internal` export; AUTHORING.md never lists it.
- Relative imports name the `.ts` file (`./serve.ts`); `tsc` rewrites them to `.js`. Only erasable TypeScript syntax: no enums, namespaces or parameter properties.
- `tsconfig.tooling.json` type-checks root files (`*.config.ts`, `scripts/`).
- Tests sit next to the code (`*.test.ts`) and import only a package's public entries.
- Changesets with one fixed group: every package releases together. cf-loom reaches 1.0.0 before any Contract Package is published.
- Published to GitHub Packages as `@casitafeliz/loom-<name>` from GitHub Actions.
- Commands: `pnpm build`, `pnpm test` (builds, then runs Vitest), `pnpm check` (Biome), `pnpm format`, `pnpm clean`, `pnpm changeset`.

## Design principles

- **Organization-agnostic.** cf-loom derives what follows from Contracts (plans, reports, interfaces) and exposes it. Infrastructure and process policy (who applies broker or gateway config, limits, permissions, review process) belongs to the organization: offer optional adapters, never defaults that impose a policy.
- **Shapes, not behavior.** A Contract declares shapes and declarative constraints only; nothing in it is implied or defaulted.
- **Can't prove it compatible, it's Breaking.** There is no warning level.

## Working here

- Design decisions are the user's: propose options with a recommendation and ask one question at a time.
- Commits follow Conventional Commits (`docs: …`, `feat(cli): …`).
