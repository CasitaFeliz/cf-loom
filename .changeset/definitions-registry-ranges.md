---
"@cf-loom/cli": major
---

`cf-loom publish` refuses a Definitions Package whose `dependencies`, `optionalDependencies` or `peerDependencies` list a range that npm does not resolve from the registry: a `workspace:`, `catalog:`, `file:`, `link:` or `portal:` range, a path, a git URL, a GitHub shorthand, a tarball, or an `npm:` alias of one of them. It exits 3 and publishes nothing, since npm publishes the range unchanged and no registry install can resolve it. A version, a version range, a dist-tag and an `npm:` alias of one are kept.
