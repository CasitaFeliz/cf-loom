# @casitafeliz/loom-client

`client` and the `Client<D, Configured>` type. How an Outcome travels, how the client decodes it and which Fault it infers when there is none are in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md. Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

The example leaves out the import of `paymentsDeps`, a Dependency declared as in [Dependencies](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#dependencies) in the contract README.

## Consuming a Contract

```ts
import { client } from '@casitafeliz/loom-client';

const payments = client(paymentsDeps, {
  baseUrl,
  headers: { 'x-api-key': settings.paymentsKey },   // a string
});
const outcome = await payments.getPayment({ params: { paymentId } });

switch (outcome.kind) {
  case 'success':
    return outcome.value.amount;
  case 'rejection':
    if (outcome.known && outcome.code === 'NOT_FOUND') return null;   // getPayment lists notFound
    throw new Error(outcome.message);
  case 'fault':
    if (outcome.committed === 'no' && outcome.retryable) return retry();
    throw new Error('payments-service failed');
}
```

The client has one method per Endpoint listed in the Dependency, named after it, and returns an Outcome: it never throws for a Rejection or a Fault. It reads the Provider's Standard Rejection codes from the Provider's Contract Package, so a Caller receives the Provider's codes, not its own. Every method takes an optional second argument, `{ signal }`, to abort the call; cf-loom sets no timeout, the organization does. How an Outcome travels is in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md.

A Success Outcome carries `value`, the body, and `headers`, the declared Success headers, typed. The client validates a Success, its headers included, and a Rejection body against the reader schemas of the Provider's Contract Package (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md): open objects, Unknown cases. A Success that fails them is a Fault with `INVALID_OUTCOME`, `committed: 'yes'` and `retryable: false`: the Service processed the request, but answered something its Contract does not describe. A Rejection body that fails them is the same Fault with `committed: 'unknown'`.

A Rejection Outcome carries `known`, `code`, `message` and `body`: when `known` is `true`, `code` is one of the declared codes and `body` its declared type; when `false`, the client did not know the code, and `code` is the raw string and `body` unvalidated. Checking `known` first lets TypeScript narrow by code.

A Fault Outcome carries `committed`, `retryable`, `message`, the reserved `code` when there is one, and `retryAfter`, the `Retry-After` header when the response carried one. A Caller may retry on its own only when `committed === 'no' && retryable`: nothing happened, and the same request could succeed later (see [Fault](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md#language) in CONTEXT.md). cf-loom requires no idempotency; the pattern for it is a Guard in a Definitions Package that demands an `idempotency-key` header, whose Service stores each key with its Success and replays it. A Caller of such an Endpoint may retry whenever `committed !== 'yes' && retryable`, with the same key.

`client(deps, { fetch })` replaces the global `fetch`, for instrumentation (tracing headers, timing), a runtime without one, a test (see [Faking Providers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/testing/README.md#faking-providers) in the testing README) or any other `RequestInit` concern, such as a browser's `credentials`: `client(deps, { fetch: (url, init) => fetch(url, { ...init, credentials: 'include' }) })`. Only a network failure, an abort or a timeout of `fetch` becomes a Fault, inferred as in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md; any other error `fetch` throws reaches the calling code unchanged. `client(deps, { inferFault })` replaces that inference, so an organization that knows its network (a gateway that only answers 502 before forwarding, for one) can relax it. Code that calls another Service can depend on the `Client<typeof paymentsDeps, 'x-api-key'>` type rather than on `client()` itself; its second parameter names the headers supplied when the client is created, which its methods no longer require.

Headers an Endpoint or its Guards demand are typed, with lower-case names. Those given to `client()`, as values or as a function called per request (which may be async, to refresh a token), need not be passed again; any still missing is a required `headers` field on each call that needs it. Query params, a Guard's included, are always passed per call.
