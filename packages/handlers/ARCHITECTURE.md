# Internals of @casitafeliz/loom-handlers

How the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires. The entries `src/index.ts` (`.`) and `src/internal/index.ts` (`./internal`) re-export from the modules' `index.ts`.

## Modules

| Module | Holds | Depends on |
| --- | --- | --- |
| `outcomes/` | `success`, `reject`, `admit`, `fault`; the built and resolved Outcome and Admission types, `Fault`, `Committed`; the runtime shapes, telling an Outcome or an Admission by its kind and fields; the fixed message `Internal error` | none |
| `checks/` | what a call is given and what a Handler built, part by part with `schemaOf`, against the schemas of its Endpoint or Guard, as Issues with their part; the resolution of a Rejection against the Standard Rejections | `outcomes` |
| `calls/` | running one call: check what it is given, run the implementation, check what it built; a return that is no Outcome, or anything thrown while running or checking, is the Fault with its `cause`, so a run never throws; `InvalidInputError`, `InvalidOutcomeError` and the direct call's answer, which throws on them | `checks`, `outcomes` |
| `handlers/` | `handle`, `handle.stub`, the Handler types and `HandlerMap`; what a Handler was written with, its stub mark included, hidden from its call signature; `runEndpoint`, `runGuard`, `isStub` and `isWrittenFor` for `./internal` | `calls`, `checks`, `outcomes` |

## The runtime's seam

A Handler is a function carrying its `element`, the Endpoint or Guard it was written for; what it was written with sits beside it, out of its type, so `serve` takes Handlers of every Endpoint or Guard through one parameter type. `./internal`'s `runEndpoint` and `runGuard` run the same call as a direct call and return how it went as a value for `serve` to answer: `invalid-input`, `invalid-outcome`, `thrown` (a throw, or a return that is no Outcome, as the Fault with its `cause`; a throw while checking what the call is given is not committed, since the implementation never ran) or `answered`, a Fault the Handler returned included; `serve` alone sends them to `onServiceFault`. Inside `serve`, an Issue at `context` or `qualifier` is the runtime's own bug, since `serve` builds both: it answers it as a Fault and reports it to `onServiceFault`. A direct call is that run plus a throw on the two invalid kinds. `isWrittenFor` tells whether a value is a Handler `handle()` returned for a given Endpoint or Guard, which `serve` checks of every Handler in the map before the first request.
