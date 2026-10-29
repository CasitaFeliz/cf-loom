---
"@cf-loom/contract": patch
---

A removed field whose schema is an `allOf` of `ref`s no longer makes `publish` write a Snapshot that `check` refuses as malformed: a former Input's graft holds every node it writes as the Snapshot does, an `allOf`'s items in shape order and each shape once, when it names a def apart or follows an alias def to the def it leads to.
