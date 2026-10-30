---
"@cf-loom/cli": patch
"@cf-loom/client": patch
"@cf-loom/contract": patch
"@cf-loom/handlers": patch
"@cf-loom/messaging": patch
"@cf-loom/server": patch
"@cf-loom/testing": patch
---

Every line a library writes stays one line: a key, a name, a path, an id or a message holding a line break, such as a record key a Caller sends that `serve` logs in an Issue, no longer splits an Error's message or a console line in two. Each of CR, LF, VT, FF, FS, GS, RS, U+0085, U+2028 and U+2029 is written as the visible text of its escape, as the CLI wrote the first five, and now writes all ten; a message of several lines still has one line per problem.
