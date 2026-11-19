---
"@cf-loom/cli": patch
---

`publish` of a Definitions Package leaves `packageExtensions` out of the package.json it publishes, beside `publishConfig.tag`, since only the project itself reads it and npm 12 refuses to publish a package that has it (`EPACKAGEEXTENSIONS`); `publish --dry-run` and `publish` now agree on it. The project's own package.json is not changed.
