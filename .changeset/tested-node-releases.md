---
"@cf-loom/cli": major
"@cf-loom/client": major
"@cf-loom/contract": major
"@cf-loom/handlers": major
"@cf-loom/messaging": major
"@cf-loom/server": major
"@cf-loom/testing": major
---

Every package declares the Node releases it is tested on in `engines.node`, `^24.16.0 || ^26.13.0`, instead of `>=24`: npm warns when another Node installs it and refuses under `engine-strict`. CI runs every test on each of the two releases, and the README promises TypeScript `~7.0.2`, the release cf-loom is built and tested with, instead of any TypeScript 7.
