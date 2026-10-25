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

- pnpm 12 workspaces under `packages/` and `examples/`, every example `private: true`; shared versions in the catalog of `pnpm-workspace.yaml`. Node 24 (`.node-version`).
- ESM only; built with `tsc -b` and project references; tested with Vitest projects; formatted and linted with Biome.
- Each package has `tsconfig.build.json` (src to dist, no tests) and `tsconfig.test.json` (type-checks tests); `contract` and `client` build without Node types, since Applications run them in browsers.
- cf-loom packages depend on each other only as peers (plus a devDependency), never as dependencies.
- A package shares code with other cf-loom packages only through an undocumented `./internal` export; no README lists it.
- Relative imports name the `.ts` file (`./serve.ts`); `tsc` rewrites them to `.js`. Only erasable TypeScript syntax: no enums, namespaces or parameter properties.
- `tsconfig.tooling.json` type-checks root files (`*.config.ts`, `scripts/`).
- `lint/` holds Biome GritQL plugins and `scripts/check-tsdoc.ts` checks TSDoc, both for [CODING_STANDARDS.md](CODING_STANDARDS.md).
- Every package under `packages/` lays out its `src/` as [Package layout](ARCHITECTURE.md#package-layout) says; `scripts/check-layout.ts` checks it.
- Tests sit next to the code (`*.test.ts`) and import as [C23](CODING_STANDARDS.md#tests) says.
- The examples follow [Layout](README.md#layout) in README.md, with their tests in `test/`: `org-definitions` (`@org/definitions`, a Definitions Package), `orders-service` (a Provider) and `billing-service` (its Consumer), both Services listing `@org/definitions` as `workspace:*`. Orders follows Layout; billing places its Handlers in its Group's folder, `src/billing/`, through `src/{group}/{name}.handler.ts`, and its generated files in `src/generated/` with `layout` in its `cf-loom.config.ts`. Each Service has one `tsconfig.json` and runs from source. orders' Contract Package is not committed: `pnpm build` builds the CLI and org-definitions, writes it to orders' `.cf-loom/contract-package/` with `cf-loom package`, then runs `tsc -b`, where orders' `tsconfig.contract-package.json` builds it; billing lists it as `link:../orders-service/.cf-loom/contract-package`, so `pnpm install` passes before it exists. The Definitions Package's `tsconfig.json` type-checks it and its `tsconfig.build.json` builds `src/` to `dist/`, which the Services and the CLI load. The other generated files are committed: every example's `contract.snapshot.json` and the Services' `src/**/*.generated.ts`, which tests check with `cf-loom verify`; orders' `generated.test.ts` checks that the Contract Package billing links is what `cf-loom package --out` writes. After changing a declaration, run org-definitions' `pnpm generate`, which also builds it, then orders' `pnpm generate`, then `pnpm build`, then billing's `pnpm generate`. Biome skips `contract.snapshot.json` and the Services' `src/**/*.generated.ts`, which `verify` compares byte for byte; `.gitignore` keeps `.cf-loom/` out of git and of Biome. `.changeset/config.json` ignores `@org/*`, the examples. `packages/cli/src/examples.test.ts` publishes temporary copies of all three to a fake registry it starts on a free port, and checks changed copies of orders against them; it writes nothing in `examples/`. Both Services' `main.ts` run messaging over NATS JetStream and refuse to start without `NATS_URL`; billing's `test/over-nats.test.ts`, the examples' acceptance test over NATS, and `test/over-http.test.ts` start a nats-server of their own with `packages/messaging/test/nats-server.ts`, apply the plans `broker-plan --json` prints, and start the Services' `main.ts` with an environment they write out, never the test's own; so billing's `tsconfig.json` has the repository as its `rootDir` and includes that one file.
- Tests that need NATS JetStream start their own `nats-server` from `PATH` with `packages/messaging/test/nats-server.ts`: a random local port read from its ports file, and a temporary store it removes; never a fixed port or another NATS. CI installs the release pinned, with its SHA-256, in `.github/workflows/ci.yml`; locally, put that release, checksum-verified, on `PATH`. CI also lints `.github/workflows/` with actionlint, pinned with its SHA-256 in `ci.yml`; `pnpm check` does not run it.
- Changesets with one fixed group: every package releases together. No PR carries a changeset before the first release candidate; from it on, every PR that changes a package carries one. cf-loom reaches 1.0.0 before any real Contract Package or Definitions Package publishes a version that is not a prerelease; before it, a real one is published only as a prerelease, with `cf-loom publish --prerelease`. The examples are not real packages: their acceptance test publishes them as any version, to the throwaway registry it starts.
- Published to npmjs.com as `@cf-loom/<name>`, with restricted access, from GitHub Actions: `.github/workflows/release.yml` publishes the changesets on `main`, and its header says how a version is released and what the organization sets up on npmjs.com and GitHub. The one exception is a placeholder `0.0.0` of each package, which an owner of the npm org publishes by hand once, since npm trusted publishing needs the package to exist.
- Commands: `pnpm build`, `pnpm test` (builds, then runs Vitest), `pnpm check` (Biome failing on warnings as CI does, the TSDoc check and the layout check), `pnpm format`, `pnpm clean`, `pnpm changeset`.

## Design principles

- **Organization-agnostic.** cf-loom derives what follows from Contracts (plans, reports, interfaces) and exposes it. Infrastructure and process policy (who applies broker or gateway config, limits, permissions, review process) belongs to the organization: offer optional adapters, never defaults that impose a policy.
- **Shapes, not behavior.** A Contract declares shapes and declarative constraints only; nothing in it is implied or defaulted.
- **Can't prove it compatible, it's Breaking.** There is no warning level.

## Working here

- Design decisions are the user's: propose options with a recommendation and ask one question at a time.
- Every issue follows [WORKFLOW.md](WORKFLOW.md).
- Commits follow Conventional Commits (`docs: …`, `feat(cli): …`).
