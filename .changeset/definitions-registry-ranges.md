---
"@cf-loom/cli": major
---

`cf-loom publish` refuses a Definitions Package whose `dependencies`, `optionalDependencies` or `peerDependencies` list a range other than a version, a version range, a dist-tag, or an `npm:` alias of one whose name is a package name npm accepts for a new package: a `workspace:`, `catalog:`, `file:`, `link:` or `portal:` range, a path, a git URL, a GitHub shorthand, a tarball, or an alias of one of them or of a name in upper case. It exits 3 and publishes nothing, since npm publishes the range unchanged and no registry install resolves the ranges it is meant to stop.
