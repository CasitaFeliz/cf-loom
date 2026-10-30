---
"@cf-loom/contract": major
---

The invalid-input Rejection's body lists at most 100 Issues within 64 KiB of JSON, the first ones the Provider read, and counts every other one in a required `omittedIssues`, so a small request can no longer get a Response many times its size. `serve`, the client's unsent Rejection and the fake Provider write the same body; `@cf-loom/testing`'s `InvalidCall` is that body, `{ issues, omittedIssues }`, and a step that scripts the invalid-input Rejection gives `omittedIssues`. Upgrading cf-loom adds `omittedIssues` to every Service's Snapshot, an Additive Change on its invalid-input code; a Reader generated with it reads an older Provider's body as `INVALID_OUTCOME`.
