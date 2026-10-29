---
"@cf-loom/contract": major
---

An intersection that is no merged object holds each shape once, in the order of the items' shapes, the left item kept with its annotations, so a description no longer reorders or merges an `allOf`'s items. A Snapshot whose `allOf` items are in another order, or hold one shape twice, is malformed. The Compatibility Check compares annotations inside plain unions, tuples and `allOf`s position by position, so an annotation moved between two items of one shape is a Neutral Change instead of making `check` and `publish` fail with `The Snapshot changed but no Change was found: a bug.`
