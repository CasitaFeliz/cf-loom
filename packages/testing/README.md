# @cf-loom/testing

`fakeProvider`, `FakeProviderError` and `fakeEvent`, and their types (see [Types](#types)). cf-loom keeps its API test-friendly and ships testing helpers only where hand-written test doubles would drift from a Contract: this package fakes the Providers a Consumer depends on. How the package is built is in [ARCHITECTURE.md](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/testing/ARCHITECTURE.md). Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

## Faking Providers

Each fake is checked against the Provider's Snapshot, as its Contract Package exports it in `contract.exportedSnapshot` (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md), so a fake can never answer what the Provider could not:

```ts
import { fakeProvider } from '@cf-loom/testing';
import { paymentsDependency } from '../src/contract/dependencies/payments-service.dependency.ts';

const payments = fakeProvider(paymentsDependency);
payments.on('getPayment')
  .once((r) => r.reject('NOT_FOUND'))                    // getPayment lists notFound: a declared code, with its declared body
  .once((r) => r.reject({ unknown: 'CARD_EXPIRED' }, {})) // a code the Provider does not declare
  .once((r) => r.fault({ committed: 'no', retryable: true }))
  .once((r) => r.noConnection())                         // the client infers the Fault: committed 'no'
  .once((r) => r.reset())                                // a reset after sending: committed 'unknown', retryable
  .once((r) => r.status(502))                            // committed 'unknown', not retryable
  .otherwise((r, { params }) => r.success({ id: params.paymentId, amount }));

const settlement = new SettlementService(payments.client({ headers: { 'x-api-key': 'k' } }));
await settlement.settle(PAYMENT_ID);
payments.calls('getPayment');                            // the requests the code made, in order
```

- **Requests.** `fakeProvider` reads each request as the Provider would (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md), every Guard admitting it, since a step answers for its GuardHandlers. A request that fails answers the Provider's invalid-input Rejection, with the Provider's code, status and message and cf-loom's body, and takes no step. The client never sends Input that breaks its schema (see [What a call sends](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#what-a-call-sends) in the client README), so through `payments.client()` only the requests the code sends reach the fake; `payments.fetch` reads whatever Request it is given.
- **Where requests go.** `fakeProvider(dependency, { baseUrl })` is reached at `baseUrl`, `https://<provider>.test` by default, and `payments.client()` always calls it there; a `baseUrl` with a username or a password, or with a query or a fragment, is a bug, and `fakeProvider` throws, as `client()` does. Given a Contract Package in a format it does not read, `fakeProvider` throws when it is created, as `client()` does (see [Consuming a Contract](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#consuming-a-contract) in the client README). Only a request's path is compared, under the base URL's path, from any origin. It is matched against every Endpoint the Contract Package exports, so routing precedence is the Provider's among them (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md). A test that wants `NO_SUCH_ENDPOINT` scripts it, `r.fault({ code: 'NO_SUCH_ENDPOINT' })`.
- **Steps.** Each step, in `once` or `otherwise`, receives a builder typed by the Endpoint and the request, so codes and bodies autocomplete from the Provider's Contract and nothing collides with `@cf-loom/contract` or `@cf-loom/handlers`, and the request's Input as the Provider parses it. A step may be async.
  - `r.success(body)` answers the Success; `r.success({ headers, body })` when the Endpoint declares `success.headers`, `r.success({ headers })` with no body, and `r.success()` with neither.
  - `r.reject(code, body?)` answers a code the Endpoint answers, a Standard one by the Provider's code, with its status and message, and its body when it declares one.
  - `r.reject({ unknown: code, message? }, body)` answers a code the Provider does not declare, with status 422, its message the code unless given, and any JSON value as its body.
  - `r.fault({ committed, retryable, message? })` answers a Fault, with status 503 when it is retryable and 500 otherwise, saying `Internal error` unless given a message; `r.fault({ code })` answers a reserved code alone, with its status, `committed` and message (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md).
  - `r.noConnection()`, `r.reset()` and `r.status(n, headers?)` let the client infer the Fault, as from a real response (see the inference table in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md): a refused connection, a connection reset after the request was sent, and a status from 200 to 599 other than the Success's, with no body; `headers` may carry `Retry-After`.
- **Scripts.** `once` adds a step that answers one request, in the order added; `otherwise` answers every request after them, and a later `otherwise` replaces an earlier one. An Endpoint's requests take their steps in the order they reached `fetch`, whichever is read first, and a step runs without waiting for another. A signal aborted while a request is answered makes `fetch` reject with its reason; a request aborted before it takes its step, while its body is read or while it waits for its turn, records no call, takes no step and holds no later request back. A script is never reset: a test creates its own fake.
- **Calls.** `payments.calls('getPayment')` lists the requests the Endpoint received, in the order they reached `fetch`, each read as `{ kind: 'valid', input }`, its Input parsed, or `{ kind: 'invalid', issues }`, the Issues of the invalid-input body it answered; the list is a frozen copy.
- **Mistakes in the test.** A mistake throws `FakeProviderError`, out of `fetch`, which the client passes through unchanged, so the code under test cannot take it for a Fault (see [fetch and inferFault](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#fetch-and-inferfault) in the client README), and out of `fakeEvent` (see [Faking Events](#faking-events)). Its message names the Provider and the Endpoint when the request reached one, or, from `fakeEvent`, the Message Version, and what went wrong, then each Issue on its own line, never the value. It is a mistake to call an Endpoint never scripted, or one with no step left and no `otherwise`; to script a value that breaks the readers, a header that cannot travel as text, or anything that throws while it is read; to give `r.reject` a code the Endpoint does not answer; to give `r.reject({ unknown })` a code the Endpoint answers, a reserved code or one that is no `UPPER_SNAKE_CASE`, which no Contract can declare, or a body that is no JSON value; to give `r.status` anything but an integer from 200 to 599 other than the Success's status, or headers that cannot be sent; to return from a step anything its `r` did not build, or to throw from one, what it threw kept as `cause`; and to send a request whose path lies outside the base URL's path, matches no exported Endpoint, or reaches one the Dependency does not list.
- **Real client.** `payments.client(options)` returns a real client over the fake, and `payments.fetch` serves code that builds its own client with `client(dependency, { fetch })` (see [Consuming a Contract](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#consuming-a-contract) in the client README), so the Consumer's code also runs the client's decoding: bodies and Success headers are validated against the generated readers, unknown codes arrive as `unknown-rejection`, Faults are inferred, and a Deprecated Endpoint sends the `Deprecation` header.
- **Values as a reader sees them.** Scripted Outcomes are written as a Caller reads them, and sent as the Provider would send them: written back through the Provider's generated readers, so their constraints are checked, their unknown keys stripped and each Unknown case turned into its text. Declared parts are checked against the Provider's schemas, shapes and constraints alike; an Unknown case, `{ unknown: 'refunded' }`, is checked only to make sure `'refunded'` is not a declared value, and a bare `'refunded'` where an Open Enum is declared breaks its reader. That is how a test reaches the code that handles values the Provider may add later.
- **Responses as `serve` sends them.** A fake answers with the status, the declared headers, the content type and the JSON value `serve` would send for the same Outcome, and every response of a Deprecated Endpoint, whatever it answers, carries `Deprecation`, from the `deprecatedAt` the exported Snapshot records.
- **Scope.** The package fakes only other Services. A Service's own Handlers, Guards and Messages are tested by calling them (see [Testing a Service's own code](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#testing-a-services-own-code) in the handlers README) and with the in-memory adapter (see [In memory](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#in-memory) in the messaging README); a body for its own Event is written directly, since what its writers produce is also what its readers accept.

## Faking Events

```ts
import { fakeEvent } from '@cf-loom/testing';
import notifyOnSettledHandler from '../src/subscriptions/orders/notify-on-settled.handler.ts';

const settled = fakeEvent(payments.events.paymentSettledV1, { paymentId: PAYMENT_ID });
await notifyOnSettledHandler(
  settled,
  { messageId: 'event.PaymentSettled.v1:pay-1', factId: 'pay-1', deliveryCount: 1 },
  { resources: { notifications } },
);
```

`fakeEvent(event, body)` builds the body of an Internal Event a Provider's Contract Package exports, as its Subscribers read it. The body is given as a Subscriber reads it, with Unknown cases written `{ unknown: … }`. It is written back through the Event's Reader schema and read with it again, as scripted values are (see [Values as a reader sees them](#faking-providers)): its constraints are checked and its unknown keys stripped, and what `fakeEvent` returns is what the Subscription's Handler receives from a direct call, and from `deliver` too (see [In memory](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#in-memory) in the messaging README), which sends it as JSON, so a key given as `undefined` does not arrive. A body that breaks the Reader, or throws while it is read, is the test's mistake: `fakeEvent` throws `FakeProviderError`, its message naming the Message Version (`PaymentSettled@1`) and what went wrong, then each Issue at `body` on its own line, never the value, with what threw kept as `cause`. A Private Event, which is always the Service's own, is a type error (see [Scope](#faking-providers)).

## Types

- `FakeProvider<D>`, what `fakeProvider(dependency, options?)` returns: `fetch`, an `Http`, `client(options?)`, `on(name)` and `calls(name)`, each name one the Dependency `D` lists; `FakeProviderOptions`, `{ baseUrl? }`; `FakeClientOptions<D, Configured>`, what `client()` takes: `ClientOptions` without `baseUrl` and `fetch`, the fake's own.
- `Script<E, Standards>`, what `on(name)` returns, `{ once(step), otherwise(step) }`; `Step<E, Standards>`, `(r, input) => ScriptedAnswer | Promise<ScriptedAnswer>`, where `input` is `InputOf<E>`; `StepBuilder<E, Standards>`, the `r` a step receives, typed by the Success and Rejections a Caller of `E` receives (see [Types](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#types) in the client README), `Standards` being the Provider's Standard Rejections, which type the invalid-input body by its Reader; `ScriptedAnswer`, what only `r` builds.
- `FakeCall<E>`, one request `calls(name)` lists.
