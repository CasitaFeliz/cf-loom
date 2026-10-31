---
"@cf-loom/contract": patch
"@cf-loom/messaging": patch
"@cf-loom/server": patch
---

Without an `onServiceFault`, the console lists a Fault's Issues as the invalid-input body does, the first 100 within 64 KiB of the lines written, and counts the others on a last line, `<source>: <count> more Issues`, instead of writing one line per Issue, which made a Message or a Success of a million invalid items write about a hundred megabytes. `onServiceFault` still receives every Issue.
