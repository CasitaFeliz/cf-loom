# @casitafeliz/loom-testing

`fakeProvider` and `fakeEvent`. cf-loom keeps its API test-friendly and ships testing helpers only where hand-written test doubles would drift from a Contract: this package fakes the Providers a Consumer depends on. Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

## Faking Providers

Each fake is checked against the Provider's Snapshot, so a fake can never answer what the Provider could not:

```ts
import { fakeProvider, fakeEvent } from '@casitafeliz/loom-testing';
import { paymentsDeps } from '../src/contract/dependencies/payments-service.dependencies';
import notifyOnSettledHandler from '../src/subscriptions/notify-on-settled.handler';

const payments = fakeProvider(paymentsDeps);
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

const settled = fakeEvent(paymentsDeps.events.paymentSettledV1, { paymentId: PAYMENT_ID });
await notifyOnSettledHandler(settled, { messageId: 'PaymentSettled.v1:pay-1', factId: 'pay-1', deliveryCount: 1 });
```

- **Requests.** `fakeProvider` validates each request as the Provider would, its Input and its Guards' demands, and answers the Provider's invalid-input Rejection when it fails; that Rejection uses no step. Every request, valid or not, appears in `calls()`.
- **Steps.** Each step, in `once` or `otherwise`, receives a builder typed by the Endpoint and the request, so codes and bodies autocomplete from the Provider's Contract and nothing collides with `@casitafeliz/loom-contract` or `@casitafeliz/loom-handlers`.
  - `r.success(body)` answers the Success; `r.success({ headers, body })` when the Endpoint declares `success.headers`.
  - `r.reject(code, body?)` answers a declared code with its status; `r.reject({ unknown: code }, body)` answers a code the Provider does not declare, with status 422.
  - `r.fault(…)` may carry a reserved code (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md).
  - `r.noConnection()`, `r.reset()` and `r.status(n, headers?)` let the client infer the Fault, as from a real response (see the inference table in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md); `headers` may carry `Retry-After`.
- **Mistakes in the test.** A call to an Endpoint with no step left and no `otherwise`, or to an Endpoint never scripted, throws the fake's own error out of the client, so the code under test cannot take it for a Fault.
- **Real client.** `payments.client(options)` returns a real client over the fake, and `payments.fetch` serves code that builds its own client with `client(deps, { fetch })` (see [Consuming a Contract](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/README.md#consuming-a-contract) in the client README), so the Consumer's code also runs the client's decoding: bodies and Success headers are validated against the generated readers, unknown codes arrive with `known: false`, Faults are inferred, and a Deprecated Endpoint sends the `Deprecation` header.
- **Values as a reader sees them.** `fakeEvent` builds an Event body as a Subscriber reads it, and scripted Outcomes are written as a Caller reads them. Declared parts are checked against the Provider's schemas, shapes and constraints alike; an Unknown case, `{ unknown: 'refunded' }`, is checked only to make sure `'refunded'` is not a declared value, and an Open Union's Unknown variant sends its `raw` value as it is. That is how a test reaches the code that handles values the Provider may add later.
- **Scope.** The package fakes only other Services. A Service's own Handlers, Guards and Messages are tested by calling them (see [Testing a Service's own code](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/handlers/README.md#testing-a-services-own-code) in the handlers README) and with the in-memory adapter (see [In memory](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/messaging/README.md#in-memory) in the messaging README); a body for its own Event is written directly, since what its writers produce is also what its readers accept.
