---
"@cf-loom/cli": major
---

`cf-loom generate` and `cf-loom verify` fill and record a Handler path only where the layout's rules and the project's `src/` allow. A Handler path that breaks a rule of the layout once its variables are filled, such as a file name holding `.d.` when an Endpoint, a Guard, a Subscription or a Group is named `d`, exits 3 naming the declaration and the path. A Handler path, `handlerMap` or `readers` that a link leads out of `src/` or into `src/contract/` exits 3 too, and a `*.generated.ts` file or a folder that a link leads there is never read, moved from or deleted. An import in a file `generate` wrote that records a Handler at a path `generate` could not have placed exits 1 with a line naming the file and the path, before anything is moved or written.
