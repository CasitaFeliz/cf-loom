---
"@cf-loom/cli": major
---

`check` and `publish` read the output of npm 12, which prints one version of `npm view` in a list and `npm pack` keyed by package name, and `@cf-loom/cli` declares the npm releases it is tested on in `engines.npm`, `^11.13.0 || ^12.2.1`: npm warns when another npm installs it and refuses under `engine-strict`. `publish` of a Definitions Package lists the project's own files whatever `workspaces` or `workspace` its `.npmrc` sets, and `check --against` of a dist-tag fails with `npm view <package> dist-tags printed no dist-tags` when npm prints no dist-tags, instead of saying the package lists no such dist-tag.
