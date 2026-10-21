# cf-loom

Organization-agnostic tooling for service Contracts: HTTP Endpoints and messaging, written in TypeScript with zod. This repository holds the tools, and in `examples/` fictional Services and the Definitions Package they share, used as end-to-end tests; never a real Service's Contract. The design is in the documents below; the packages are under `packages/`.

## Documents

| File | Holds |
| --- | --- |
| `CONTEXT.md` | The glossary: every term, with words to avoid |
| `COMPATIBILITY.md` | How a Contract may change: the Compatibility Check and its rules |
| `ARCHITECTURE.md` | How the pieces fit: packages, runtime, the Wire protocol, what cf-loom leaves to the organization |
| `SNAPSHOT.md` | The Snapshot format the Compatibility Check compares |
| `CODING_STANDARDS.md` | How the code is written and reviewed (C1–C28) |
| `WORKFLOW.md` | How an issue becomes code on `main`: plan, Definition of Ready, implement, review, fix, Definition of Done, merge |
| `README.md` | What cf-loom is, a first Service, and the packages table |
| `packages/<pkg>/README.md` | How to use the package: its API, options, examples |
| `packages/<pkg>/ARCHITECTURE.md` | The package's internal details, repo only (not in the package's `files`) |

- Everything is written in English, code and documents alike.
- No `docs/` folder: a compatibility rule goes in `COMPATIBILITY.md`, an architecture concern in `ARCHITECTURE.md`.
- Each rule lives in one document; the others link to it.
- The documents describe the current design only, never the history of decisions. A changed decision replaces the old text.
- Use the glossary's terms, capitalized, and never its _Avoid_ words.

## Repository

- pnpm 12 workspaces under `packages/`, `examples/` and `examples/*/contract-package`, every example `private: true`; shared versions in the catalog of `pnpm-workspace.yaml`, with `autoInstallPeers: false`, so pnpm never fetches a generated Contract Package's peer `@cf-loom/contract` from the registry, where it is not published. Node 24 (`.node-version`).
- ESM only; built with `tsc -b` and project references; tested with Vitest projects; formatted and linted with Biome.
- Each package has `tsconfig.build.json` (src to dist, no tests) and `tsconfig.test.json` (type-checks tests); `contract` and `client` build without Node types, since Applications run them in browsers.
- cf-loom packages depend on each other only as peers (plus a devDependency), never as dependencies.
- A package shares code with other cf-loom packages only through an undocumented `./internal` export; no README lists it.
- Relative imports name the `.ts` file (`./serve.ts`); `tsc` rewrites them to `.js`. Only erasable TypeScript syntax: no enums, namespaces or parameter properties.
- `tsconfig.tooling.json` type-checks root files (`*.config.ts`, `scripts/`).
- `lint/` holds Biome GritQL plugins and `scripts/check-tsdoc.ts` checks TSDoc, both for [CODING_STANDARDS.md](CODING_STANDARDS.md).
- Every package under `packages/` lays out its `src/` as [Package layout](ARCHITECTURE.md#package-layout) says; `scripts/check-layout.ts` checks it.
- Tests sit next to the code (`*.test.ts`) and import as [C23](CODING_STANDARDS.md#tests) says.
- The examples follow [Layout](README.md#layout) in README.md, with their tests in `test/`: `org-definitions` (`@org/definitions`, a Definitions Package), `orders-service` (a Provider) and `billing-service` (its Consumer), both Services listing `@org/definitions` as `workspace:*`. Each Service has one `tsconfig.json` and runs from source; orders' `tsconfig.contract-package.json` builds its Contract Package within `tsc -b`. The Definitions Package's `tsconfig.json` type-checks it and its `tsconfig.build.json` builds `src/` to `dist/`, which the Services and the CLI load. The generated files are committed: every example's `contract.snapshot.json`, the Services' `src/*.generated.ts` and orders' `contract-package/` without `dist/`; tests check them with `cf-loom verify` and `cf-loom package --out`. After changing a declaration, run org-definitions' `pnpm generate`, then `pnpm build`, then orders' `pnpm generate`, then `pnpm build`, then billing's `pnpm generate`. Biome skips `contract.snapshot.json` and the Services' `src/*.generated.ts`, which `verify` compares byte for byte, and `contract-package/`, which `cf-loom package` rewrites and orders' `generated.test.ts` compares. `.changeset/config.json` ignores `@org/*`: the examples and orders' generated Contract Package.
- Changesets with one fixed group: every package releases together. No PR carries a changeset before the first release candidate; from it on, every PR that changes a package carries one. cf-loom reaches 1.0.0 before any Contract Package publishes a version that is not a prerelease; before it, a Contract Package is published only as a prerelease.
- Published to npmjs.com as `@cf-loom/<name>`, with restricted access, from GitHub Actions.
- Commands: `pnpm build`, `pnpm test` (builds, then runs Vitest), `pnpm check` (Biome failing on warnings as CI does, the TSDoc check and the layout check), `pnpm format`, `pnpm clean`, `pnpm changeset`.

## Design principles

- **Organization-agnostic.** cf-loom derives what follows from Contracts (plans, reports, interfaces) and exposes it. Infrastructure and process policy (who applies broker or gateway config, limits, permissions, review process) belongs to the organization: offer optional adapters, never defaults that impose a policy.
- **Shapes, not behavior.** A Contract declares shapes and declarative constraints only; nothing in it is implied or defaulted.
- **Can't prove it compatible, it's Breaking.** There is no warning level.

## Working here

- Design decisions are the user's: propose options with a recommendation and ask one question at a time.
- Every issue follows [WORKFLOW.md](WORKFLOW.md).
- Commits follow Conventional Commits (`docs: …`, `feat(cli): …`).
