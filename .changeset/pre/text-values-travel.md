---
"@cf-loom/contract": major
"@cf-loom/server": major
---

`generate`, and `serve` at startup, refuse a text part's enum holding a value whose text its part cannot carry, in an Input, a Guard's demands, a Success or a Rejection: no Caller could send it, and no Outcome holding it would be valid. A header's value must be HTTP field text (not `' 1'`, `'é\n'` or `'€'`), a path param's a segment that is not `''`, `.` or `..`, and a query value or a path param well-formed (no lone surrogate). One line names every such value of a field, `A header's values each travel as HTTP field text: x-s has " 1" and "é\n"`, rule `unsendable-text`. A `z.string()` with a regex, a format or a length keeps passing: its values are not closed, and the runtime refuses each one as it is sent.
