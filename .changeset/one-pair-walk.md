---
"@cf-loom/contract": patch
---

The Compatibility Check and the Former Input graft read the pairs of Baseline and proposed schemas through one walk, and the graft records each Former Input in one walk, following a `ref` through its alias defs in one step. A publish whose Endpoints reach a long chain of schemas in which no field was removed no longer takes time that grows with the Endpoints times the chain's length. Reports, published Snapshots and decoded Snapshots are unchanged.
