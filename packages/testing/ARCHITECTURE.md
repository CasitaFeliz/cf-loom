# Internals of @casitafeliz/loom-testing

How a fake (see [README.md](README.md)) answers a request, and how the package's `src/` is split into modules, as [Package layout](../../ARCHITECTURE.md#package-layout) in the root ARCHITECTURE.md requires. How an Outcome travels over HTTP and which Fault the client infers when there is none are in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md.

`@casitafeliz/loom-server` and `@casitafeliz/loom-handlers` are devDependencies, so the tests compare a fake's responses with `serve`'s; `tsconfig.test.json` alone references the server.

## Modules

The entry `src/index.ts` (`.`) re-exports from `faking/`, `mistakes/` and `scripting/`.

| Module | Holds | Depends on |
| --- | --- | --- |
| `mistakes/` | `FakeProviderError`, and a mistake's message: the Provider, the Endpoint, what went wrong and each Issue on its own line | none |
| `provided/` | each Endpoint the Contract Package exports, matched as `serve` matches it, and each listed one prepared once: its packaged declaration, the nodes its text parts are read by, its `deprecatedAt` and its Rejections by code; a request's path under the base URL's, matched to a listed Endpoint or the test's mistake | `mistakes` |
| `receiving/` | one request as the Provider reads it: its Guards' demands, then its body, then its Input | `provided` |
| `scripting/` | `Script`, `Step`, `StepBuilder` and the one builder every step receives; the closed union of what a step scripts, held in a `ScriptedAnswer` no test can build; each Endpoint's steps and the turns its requests take them in | none |
| `answering/` | a scripted answer as the Provider sends it: a Success or a Rejection body written back through its readers, a Fault, a reserved code or a bare status as a `Response` with its `Deprecation`, a network failure thrown as `fetch` throws it | `provided`, `scripting`, `mistakes` |
| `faking/` | `fakeProvider` and its types; one request top to bottom; the calls each Endpoint received; an abort | all of the above |

The rules a fake shares with `serve` and the client live in `@casitafeliz/loom-contract`'s `./internal`: matching a request and reading its text parts and body, the Guards' demands in Attachment order, parsing a party's parts, writing a value back through a Reader schema, the invalid-input Rejection's response, the `Response` of each Outcome, the schema a Rejection's body is read with and the `Deprecation` header. The client is the real one, and `AnyDependencies` and `ConfiguredName` come from its `./internal`.

## A request

1. The request's path, under the base URL's path, is matched against every exported Endpoint; one outside it, matching none, or reaching an Endpoint the Dependency does not list, is the test's mistake.
2. Its place among the Endpoint's calls is kept, and its turn taken behind the requests that reached `fetch` before it.
3. It is read as the Provider reads it, and its call recorded. What fails answers the invalid-input Rejection, and the request takes no step.
4. Once every earlier request took its step, it takes the next: a `once` step, else `otherwise`, else none, the test's mistake.
5. The step runs, and what it scripted is sent as the Provider would send it, or thrown as `fetch` throws a network failure. A signal aborted meanwhile rejects `fetch` with its reason.
