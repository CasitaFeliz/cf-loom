---
"@cf-loom/contract": patch
---

`generate` and every command that validates a Root place the refusals of a chain of defs in time that grows with the chain, however each link holds the one before: a chain of 16,000 defs, each holding the one before twice through a union or an intersection, took 73 s to validate, and four times as long a chain took about sixteen times longer, valid or not. Only the recursive schemas that hold a refusal are placed now, and they are ordered by one walk of their places, instead of comparing each place's whole text with every other. The lines, their order and the declarations they name are unchanged.
