# Internals of @casitafeliz/loom-handlers

How the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires. The entries `src/index.ts` (`.`) and `src/internal/index.ts` (`./internal`) re-export from the modules' `index.ts`.

## Modules

| Module | Holds | Depends on |
| --- | --- | --- |
| `outcomes/` | `success`, `reject`, `admit`, `fault`; the built and resolved Outcome and Admission types, `Fault`, `Committed`; the fixed message `Internal error` | none |
| `checks/` | each part a call is given and each part a Handler built, against the Element's schemas, as Issues with their part; the resolution of a Rejection against the Standard Rejections | `outcomes` |
| `calls/` | running one call: check what it is given, run the implementation with a throw caught into the Fault, check what it built, resolve; `InvalidInputError`, `InvalidOutcomeError` and the direct call's answer, which throws on them | `checks`, `outcomes` |
| `handlers/` | `handle`, `handle.stub` and the Handler types; the implementation and the stub mark, hidden from the Handler's call signature; `runEndpoint`, `runGuard` and `isStub` for `./internal` | `calls`, `outcomes` |

## The runtime's seam

A Handler is a function carrying its `element`; what it was written with sits beside it, out of its type, so `serve` takes Handlers of every Element through one parameter type. `./internal`'s `runEndpoint` and `runGuard` run the same call as a direct call and return how it went, `invalid-input`, `invalid-outcome` or `answered`, as a value for `serve` to answer; a direct call is that run plus a throw on the two invalid kinds.
