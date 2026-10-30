---
"@cf-loom/contract": patch
---

The Compatibility Check, in `cf-loom check` and `publish`, compares a graph of recursive schemas that nothing differs in once, however many exports, Endpoint bodies, Message bodies, Guards or Retired Elements reach it, where it read the whole graph again for each, so a Definitions Package or Service that holds many of them over a large graph was checked in time that grew with their number times the graph's size. Its report is the same.
