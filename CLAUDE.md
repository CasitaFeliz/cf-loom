# cf-loom

Organization-agnostic tooling for service Contracts: HTTP Endpoints and messaging, written in TypeScript with zod. This repository holds the tools only, never a Service's Contract. The design is in documents.

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

- pnpm 12 workspaces under `packages/`, with a catalog for zod, TypeScript and Vitest.
- ESM only; built with `tsc -b` and project references; tested with Vitest projects.
- Changesets with one fixed group: every package releases together.
- Published to GitHub Packages as `@casitafeliz/loom-<name>` from GitHub Actions.

## Design principles

- **Organization-agnostic.** cf-loom derives what follows from Contracts (plans, reports, interfaces) and exposes it. Infrastructure and process policy (who applies broker or gateway config, limits, permissions, review process) belongs to the organization: offer optional adapters, never defaults that impose a policy.
- **Shapes, not behavior.** A Contract declares shapes and declarative constraints only; nothing in it is implied or defaulted.
- **Can't prove it compatible, it's Breaking.** There is no warning level.

## Working here

- Design decisions are the user's: propose options with a recommendation and ask one question at a time.
- Commits follow Conventional Commits (`docs: …`, `feat(cli): …`).
