# @cf-loom/client

`client` and its types (see [Types](#types)). How an Outcome travels, how the client decodes it and which Fault it infers when there is none are in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md; how the package is built is in [ARCHITECTURE.md](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/ARCHITECTURE.md). Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

The example leaves out the import of `paymentsDeps`, a Dependency declared as in [Dependencies](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#dependencies) in the contract README.

## Consuming a Contract

```ts
import { client } from '@cf-loom/client';

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

The client has one method per Endpoint listed in the Dependency, named after it, and returns an Outcome: it never throws for a Rejection or a Fault. It reads the Provider's Standard Rejection codes from the Provider's Contract Package, so a Caller receives the Provider's codes, not its own. Every method takes an optional second argument, `{ signal }`, to abort the call; cf-loom sets no timeout, the organization does (`AbortSignal.timeout(ms)` is one). The first argument may be left out when no part of the Input is required, counting the headers given to `client()`.

`baseUrl` is a string or a `URL`. Its path is kept as a prefix, such as a gateway's mount, with one trailing slash removed: `client(deps, { baseUrl: 'https://gw.example/payments/' })` calls `getPayment` at `https://gw.example/payments/payments/<id>`. A `baseUrl` with a username or a password, which `fetch` refuses in a URL, or with a query or a fragment, even an empty one, is a bug, and `client()` throws, never showing the password.

Given a Contract Package whose exported Snapshot is in a format the installed cf-loom does not read (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md), `client()` throws `<provider>'s exported Snapshot is in format <n>, newer than this cf-loom reads: upgrade the @cf-loom packages`, or, when its `format` is no whole number from 1, `<provider>'s exported Snapshot is malformed: format is not a whole number from 1`.

### What a call sends

The client checks the Input as the Provider will read the request it sends, every Guard admitting it (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)). It sends the parsed value, unknown keys stripped, and its path params, query params and headers as text by the rules of [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http), each path param percent-encoded as one segment; an optional query param left `undefined` sends no key.

Input that breaks its schema, or whose text cannot travel, is never sent: the method returns the Provider's invalid-input Rejection, `known: true`, with the Provider's code and message and cf-loom's body. For Input that breaks its schema, it holds the Issues the Provider would answer once the Guards before it admit the request; a declared body left out is read as the request it would send, with no content type (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)). Text that cannot travel is answered by the client alone, with no counterpart on the Provider, which never receives it: a header value that is not RFC 9110 field text (a CR or LF, for one), a path param's text that is empty, `.` or `..`, which URL parsing resolves away, or any text that holds a lone surrogate, which no UTF-8 can carry; each is an Issue with `invalid_format`. A required list given with no items is refused as the Provider would refuse it (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)). When the signal is aborted while a header function runs and the Input is then invalid, the invalid-input Rejection is returned; nothing is sent either way.

### Headers

Headers an Endpoint or its Guards demand are typed, with lower-case names. Those given to `client()` need not be passed again; any still missing is a required `headers` field on each call that needs it. Query params, a Guard's included, are always passed per call.

- A header given to `client()` is a value, or a function called per request, which may be async, to refresh a token. Its type is the Input's type for that name, across every listed Endpoint that declares it.
- Its name must be one some listed Endpoint's Input declares. It is sent only to an Endpoint whose Input declares it.
- A header the call passes wins, and the function is then not called. What a function throws reaches the calling code unchanged.

### What a call receives

A Success Outcome carries `value`, the body, and `headers`, the declared Success headers, typed. The client validates a Success, its headers included, and a Rejection body against the Reader schemas of the Provider's Contract Package (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md): open objects, Unknown cases. A Success header is converted from its text by its node in the Contract Package's exported Snapshot, so an Open Enum header the Caller does not know arrives as `{ unknown: 'lost' }`. Undeclared response headers are not read, except as [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) says.

A Success that fails its Reader schemas, a body that is no JSON included, is a Fault with `INVALID_OUTCOME`, `committed: 'yes'` and `retryable: false`: the Service processed the request, but answered something its Contract does not describe. A Rejection body that fails them is the same Fault with `committed: 'unknown'`. Either carries `issues`, each with its part (`success.headers`, `success.body` or `body`), path, code and message, never the received value. A Success body whose stream fails while it is read is no answer the Provider finished: the client infers its Fault, as [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) says for a body that fails.

A Rejection Outcome carries `known`, `code`, `message` and `body`: when `known` is `true`, `code` is one of the codes the Endpoint answers and `body` its declared type, or `undefined` for a code that declares none, whatever arrived; when `false`, the client did not know the code, and `code` is the raw string and `body` unvalidated. Checking `known` first lets TypeScript narrow by code. The invalid-input Rejection's body is cf-loom's, read with its `in` and `code` as Open Enums, so a part or issue code a later cf-loom adds arrives as `{ unknown }`.

A Fault Outcome carries `committed`, `retryable`, `message`, the reserved `code` when there is one, `retryAfter`, the `Retry-After` header as received, on a Fault the Provider sent or the client inferred from a response that carried one, `cause`, the error `fetch` threw or the stream failed with, and `issues` on an `INVALID_OUTCOME` the client produced. A Fault code that is not reserved is dropped. A Caller may retry on its own only when `committed === 'no' && retryable`: nothing happened, and the same request could succeed later (see [Fault](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md#language) in CONTEXT.md). cf-loom requires no idempotency; the pattern for it is a Guard in a Definitions Package that demands an `idempotency-key` header, whose Service stores each key with its Success and replays it. A Caller of such an Endpoint may retry whenever `committed !== 'yes' && retryable`, with the same key.

### fetch and inferFault

`client(deps, { fetch })` replaces the global `fetch`, for instrumentation (tracing headers, timing), a runtime without one, a test (see [Faking Providers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/testing/README.md#faking-providers) in the testing README) or any other `RequestInit` concern, such as a browser's `credentials`: `client(deps, { fetch: (url, init) => fetch(url, { ...init, credentials: 'include' }) })`. Without it, the global `fetch` is called as it is when the call is made. Only a network failure, an abort or a timeout of `fetch` becomes a Fault, inferred as in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md; any other error `fetch` throws reaches the calling code unchanged. A `TypeError` a `fetch` wrapper throws is taken for a network failure, `committed: 'unknown'`, `retryable: false`.

`client(deps, { inferFault })` replaces that inference, so an organization that knows its network (a gateway that only answers 502 before forwarding, for one) can relax it. `inferFault(happened, inferred)` receives what happened and cf-loom's inference, and returns `{ committed, retryable }`, or `undefined` to keep cf-loom's; the message stays cf-loom's. What happened is one of:

- `{ kind: 'thrown', error }`: `fetch` threw a network failure, an abort or a timeout;
- `{ kind: 'status', status, headers }`: a response that was neither the Success nor an Envelope;
- `{ kind: 'unreadable-body', status, headers, error }`: a response whose body failed while it was read.

A call whose signal was aborted before anything was sent is never offered: its Fault is `committed: 'no'`, `retryable: true`. What `inferFault` throws reaches the calling code unchanged; a value it returns is not checked, so the Fault carries its `committed` and `retryable` as they are: either is the organization's bug.

### Deprecation

A Deprecated Endpoint still works, and its responses carry `Deprecation` (see [Lifecycle](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#lifecycle) in the contract README). The first response of a method that carries it calls `onDeprecation({ provider, endpoint, deprecatedAt })`, once per method of each client, with the instant as a `deprecatedAt` stamp; without `onDeprecation`, `console.warn` writes `<provider>: <endpoint> is Deprecated since <deprecatedAt>`. A client created per request warns per request. What `onDeprecation` throws is caught and written with `console.error`, `<provider>: <endpoint>: onDeprecation threw` and the error, so the Outcome is never lost.

## Types

- `ClientOptions<D, Configured>`, `{ baseUrl, headers?, fetch?, inferFault?, onDeprecation? }`, what `client(deps, options)` takes; `Fetch` and `OnDeprecation`, the types of its `fetch` and `onDeprecation`.
- `Client<D, Configured>`, what `client()` returns: one method per listed Endpoint, `(input, { signal }?) => Promise<ReceivedOutcome<D, Name>>`. Code that calls another Service can depend on `Client<typeof paymentsDeps, 'x-api-key'>` rather than on `client()` itself; its second parameter names the headers given to `client()`, which its methods no longer require.
- `CallInput<E, Configured>`, the Input a method takes, and `CallOptions`, `{ signal? }`.
- `ReceivedOutcome<D, Name>`, what the method `Name` of a client of the Dependency `D` returns: one of `ReceivedSuccess<E>`, `ReceivedRejection<E, Standards>` and `ReceivedFault`, where `E` is its Endpoint and `Standards` the Provider's Standard codes, `D['standardRejections']`.
- `Happened`, `InferredFault` and `InferFault`, what `inferFault` receives and returns; `DeprecationNotice`, what `onDeprecation` receives.
