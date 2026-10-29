---
"@cf-loom/cli": major
---

`cf-loom publish` refuses a Definitions Package whose `dependencies`, `optionalDependencies` or `peerDependencies` list a range other than a version, a version range, a dist-tag, or an `npm:` alias of one whose name is a lower-case package name npm accepts: a `workspace:`, `catalog:`, `file:`, `link:` or `portal:` range, a path, a git URL, a GitHub shorthand, a tarball, or an alias of one of them or of a name in upper case. It exits 3 and publishes nothing, since npm publishes the range unchanged and no registry install resolves the ranges it is meant to stop. It names the dependency and its field: `package.json lists <name> in <field> as <range>, no registry range cf-loom keeps (a version, range or tag, or an npm: alias of one under a lower-case package name)`. A package name, of an alias or of the project in `package.json`, is also refused when it is `node_modules` or `favicon.ico`, which npm reserves.
