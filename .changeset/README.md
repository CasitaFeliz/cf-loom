# Changesets

Run `pnpm changeset` to describe a change. Every `@cf-loom/*` package is in one fixed group and releases with the same version.

A PR that changes a file under `packages/` carries a changeset: its source, tests, README or ARCHITECTURE.md, whatever the change. CI fails the PR otherwise, except the release workflow's `chore: version packages` PR. A change that releases nothing carries an empty changeset, from `pnpm changeset --empty`. The examples (`@org/*`) are not released: a PR that changes only them, or only files outside `packages/`, needs none.

The bump follows the PR title: `major` when the title has `!` (`feat!: …`), since a refusal of what used to work is breaking; otherwise `minor` for `feat` and `patch` for the rest. A change to a published file with no change to code, such as a README or the TSDoc of `src/`, is a `patch`; a change to files that publish nothing, such as tests only, is an empty changeset. CI fails a PR whose title has `!` and carries no `major` changeset, and a PR without `!` that carries one.

Until 1.0.0 the repository is in pre mode `rc` (`.changeset/pre.json`): pick the bump as for a release, since it sets the CHANGELOG heading; consumed changesets stay in `.changeset/pre/`.

How changesets become published versions, and the npm setup it needs: [`.github/workflows/release.yml`](../.github/workflows/release.yml).
