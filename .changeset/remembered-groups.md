---
"@cf-loom/contract": patch
---

`generate` no longer tells a `.meta({ id })` on a schema that lies on a cycle that it lies on no cycle when the cycle's only way back runs through a schema it already walked, such as a def that fails, a def a failure above it dropped, a cycle no id names, a second schema with a taken id, or a schema a second declaration walks afresh; the verdict no longer depends on the schema the walk enters first. A schema with a recursion id is walked once, whatever it fails by, so a Contract whose ids off a cycle, or cut for their depth, each hold the next twice no longer takes time exponential in their number, and a second schema with a taken id reached at several places is told once, at the first, with the others in `alsoIn`.
