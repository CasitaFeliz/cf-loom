# @cf-loom/client

`client` and its types (see [Types](#types)). How an Outcome travels, how the client decodes it and which Fault it infers when there is none are in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md; how the package is built is in [ARCHITECTURE.md](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/client/ARCHITECTURE.md). Terms are defined in [CONTEXT.md](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md).

The example leaves out the import of `paymentsDependency`, a Dependency declared as in [Dependencies](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#dependencies) in the contract README.

## Consuming a Contract

```ts
import { client } from '@cf-loom/client';

const payments = client(paymentsDependency, {
  baseUrl,
  headers: { 'x-api-key': settings.paymentsKey },   // a string
});
const outcome = await payments.getPayment({ params: { paymentId } });

switch (outcome.kind) {
  case 'success':
    return outcome.body.amount;
  case 'rejection':
    if (outcome.code === 'NOT_FOUND') return null;   // getPayment lists notFound
    throw new Error(outcome.message);
  case 'unknown-rejection':
    throw new Error(`${outcome.code}: ${outcome.message}`);
  case 'fault':
    if (outcome.committed === 'no' && outcome.retryable) return retry();
    throw new Error(`payments-service failed: ${outcome.source}`);
}
```

The client has one method per Endpoint listed in the Dependency, named after it, and returns an Outcome: it never throws for a Rejection or a Fault. It reads the Provider's Standard Rejection codes from the Provider's Contract Package, so a Caller receives the Provider's codes, not its own. Every method takes an optional second argument, `{ signal }`, to abort the call; cf-loom sets no timeout, the organization does (`AbortSignal.timeout(ms)` is one). The first argument may be left out when no part of the Input is required, counting the headers given to `client()`.

`baseUrl` is a string or a `URL`. Its path is kept as a prefix, such as a gateway's mount, with one trailing slash removed: `client(dependency, { baseUrl: 'https://gw.example/payments/' })` calls `getPayment` at `https://gw.example/payments/payments/<id>`. A `baseUrl` whose scheme is not `http` or `https`, with a username or a password, which `fetch` refuses in a URL, or with a query or a fragment, even an empty one, is a bug, and `client()` throws, never showing the password.

Given a Contract Package whose exported Snapshot is in a format the installed cf-loom does not read (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md), `client()` throws `<provider>'s exported Snapshot is in format <n>, newer than this cf-loom reads: upgrade the @cf-loom packages`, or, when its `format` is no whole number from 1, `<provider>'s exported Snapshot is malformed: format is not a whole number from 1`.

### What a call sends

The client checks the Input as the Provider will read the request it sends, every Guard admitting it (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)). It sends the parsed value, unknown keys stripped, and its path params, query params and headers as text by the rules of [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http), each path param percent-encoded as one segment, its Guards' demanded query params and headers included; an optional query param left `undefined` sends no key.

Input that breaks its schema, one nested too deeply to read included (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)), or whose text cannot travel, is never sent: the method returns the Provider's invalid-input Rejection, `source: 'client'`, with the Provider's code, status and message and cf-loom's body, read as its response would be. For Input that breaks its schema, it holds the Issues the Provider would answer once the Guards before it admit the request; a declared body left out is read as the request it would send, with no content type (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)). Text that cannot travel is answered by the client alone, with no counterpart on the Provider, which never receives it: a header value that is not RFC 9110 field text (a CR or LF, for one), a path param's text that is empty, `.` or `..`, which URL parsing resolves away, or any text that holds a lone surrogate, which no UTF-8 can carry; each is an Issue with `invalid_format`. A required list given with no items is refused as the Provider would refuse it (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)). When the signal is aborted while a header function runs and the Input is then invalid, the invalid-input Rejection is returned; nothing is sent either way.

### Headers

Headers an Endpoint or its Guards demand are typed, with lower-case names. Those given to `client()` need not be passed again; any still missing is a required `headers` field on each call that needs it. Query params, a Guard's included, are always passed per call.

- A header given to `client()` is a value, or a function called per request, which may be async, to refresh a token. Its type is the Input's type for that name, across every listed Endpoint that declares it.
- Its name must be one some listed Endpoint's Input declares. It is sent only to an Endpoint whose Input declares it.
- A header the call passes wins, and the function is then not called. What a function throws reaches the calling code unchanged.

### What a call receives

A Success Outcome carries `status`, and `headers` and `body` where its Endpoint declares them, typed: the same Success a direct call of its Handler returns. The client validates a Success, its headers included, and a Rejection body against the Reader schemas of the Provider's Contract Package (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md): open objects, Unknown cases. A Success header is converted from its text by its node in the Contract Package's exported Snapshot, so an Open Enum header the Caller does not know arrives as `{ unknown: 'lost' }`. Undeclared response headers are not read, except as [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) says.

A Success whose JSON body or headers fail their Reader schemas, a body nested too deeply to read included (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)), is a Fault with `INVALID_OUTCOME`, `committed: 'yes'` and `retryable: false`: the Service processed the request, but answered something its Contract does not describe. A Rejection body that fails them is the same Fault with `committed: 'unknown'`. Either carries `issues`, each with its part (`success.headers`, `success.body` or `body`), path, code and message, never the received value. A Success-status answer whose body is no JSON, a gateway's page for one, is no answer the Provider is shown to have sent, and a Success body whose stream fails while it is read is none it finished: the client infers the Fault of each, as [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) says.

A Rejection Outcome (`kind: 'rejection'`) carries `source`, `code`, `status`, `message`, and `body` where its code declares one. `code` is one of the codes the Endpoint answers, a Standard one the Provider's, `status` is the one received, and `body` has its declared type, absent for a code that declares none, whatever arrived. `source` is `'provider'`, or `'client'` for the invalid-input Rejection the client answered without sending. A `switch` on `code` narrows `body` and is exhaustive. A code the Endpoint does not answer is its own kind, `unknown-rejection`, with `source: 'provider'`, the raw `code`, `status`, `message` and `body` unvalidated, present when one was sent; codes are open, so a Caller handles it. The invalid-input Rejection's body is read with the Reader of the Provider's Contract Package, the Rejection the client makes without sending included, with its `in` and `code` as Open Enums, so a part or issue code the Provider's cf-loom does not know arrives as `{ unknown }`.

A Fault Outcome carries `source`, where it came from, `committed`, `retryable`, `message`, `status` whenever a response arrived, the reserved `code` when there is one, `retryAfter`, the `Retry-After` header as received, on a Fault the Provider sent or the client inferred from a response that carried one, `cause`, the error `fetch` threw, the stream failed with or the signal was aborted with, and `issues` on an `INVALID_OUTCOME` the client produced. `source` is `provider` for a Fault the Provider sent, `invalid-outcome` for an `INVALID_OUTCOME`, and else what the client met: `aborted`, `timeout`, `no-connection`, `connection-lost`, `connection-failed`, `status` or `unreadable-body` (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)). A Fault code that is not reserved is dropped. A Caller may retry on its own only when `committed === 'no' && retryable`: nothing happened, and the same request could succeed later (see [Fault](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md#language) in CONTEXT.md). cf-loom requires no idempotency; the pattern for it is a Guard in a Definitions Package that demands an `idempotency-key` header, whose Service stores each key with its Success and replays it. A Caller of such an Endpoint may retry whenever `committed !== 'yes' && retryable`, with the same key. A Caller's own abort is never retryable, so neither rule retries a cancelled call.

### fetch and inferFault

`client(dependency, { fetch })` replaces the global `fetch`, for instrumentation (tracing headers, timing), a runtime without one, a test (see [Faking Providers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/testing/README.md#faking-providers) in the testing README) or any other concern of the Request, such as a browser's `credentials`. It is called with the one `Request` each call sends, its headers, body, signal and `redirect: 'manual'` set. A wrapper changes it (`request.headers.set('traceparent', t)`) or builds another from it (`new Request(request, { credentials: 'include' })`) and passes it on; one that reads the body reads a `request.clone()`. A wrapper that wants redirects followed passes on `new Request(request, { redirect: 'follow' })`. `globalThis.fetch` is an `Http`, and so is what `serve` returns: `client(dependency, { baseUrl, fetch: serve(contract, handlers) })` calls a Provider in the same process. Without the option, the global `fetch` is called as it is when the call is made. Only a network failure, an abort or a timeout of `fetch` becomes a Fault, inferred as in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md; any other error `fetch` throws reaches the calling code unchanged. A `TypeError` a `fetch` wrapper throws is taken for a network failure, `committed: 'unknown'`, `retryable: false`.

`client(dependency, { inferFault })` replaces that inference, so an organization that knows its network (a gateway that only answers 502 before forwarding, for one) can relax it. `inferFault(happened, inferred)` receives what happened and cf-loom's inference, and returns `{ committed, retryable }`, or `undefined` to keep cf-loom's; the message stays cf-loom's. What happened is one of:

- `{ kind: 'no-connection' | 'connection-lost' | 'connection-failed', error }`: `fetch` threw a `TypeError`: no connection was made, one was lost after the request may have gone out, or any other failure;
- `{ kind: 'aborted', error }` and `{ kind: 'timeout', error }`: `fetch` threw an abort or a timeout, or the call's signal was aborted, `error` its reason; with the `status` and `headers` of the response when the body was being read;
- `{ kind: 'status', status, headers }`: a response that was neither the Success nor an Envelope, or a Success-status response whose body is no JSON;
- `{ kind: 'unreadable-body', status, headers, error }`: a response whose body failed while it was read.

A call whose signal was aborted before anything was sent is never offered: its Fault is `committed: 'no'`, retryable only when its reason is a `TimeoutError`. What `inferFault` throws reaches the calling code unchanged; a value it returns is not checked, so the Fault carries its `committed` and `retryable` as they are: either is the organization's bug.

### Deprecation

A Deprecated Endpoint still works, and its responses carry `Deprecation` (see [Lifecycle](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#lifecycle) in the contract README). The first response of a method that carries it calls `onDeprecation({ provider, endpoint, deprecatedAt })`, once per method of each client, with the instant as a `deprecatedAt` stamp; without `onDeprecation`, `console.warn` writes `<provider>: <endpoint> is Deprecated since <deprecatedAt>`. A client created per request warns per request. What `onDeprecation` throws is caught and written with `console.error`, `<provider>: <endpoint>: onDeprecation threw` and the error, so the Outcome is never lost.

## In a browser (Applications)

An Application (see [Applications](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#applications) in the contract README) calls its Providers from a browser with this same `client`. The package uses no Node API, only the web-standard `fetch`, `Request`, `Headers` and `URL`. The browser's own concerns of a Request, `credentials` for one, go through the `fetch` option (see [fetch and inferFault](#fetch-and-inferfault)):

```ts
const orders = client(ordersDependency, {
  baseUrl: 'https://api.example.com',
  headers: { 'x-api-key': apiKey },
  fetch: (request) => fetch(new Request(request, { credentials: 'include' })),   // cookies on a cross-origin call
});
```

- **Public Endpoints only.** An Application's Dependency lists Public Endpoints, since a browser runs outside the internal network; any other is a type error.
- **CORS is the host's or the gateway's.** The client sets no CORS header and `serve` adds none to an Endpoint's own response; whatever wraps the handler `serve` returns, or the organization's gateway, does. A header such as `x-api-key` makes the browser send a preflight `OPTIONS` first, which `serve` answers `METHOD_NOT_ALLOWED` unless the Service's `fallback`, the host or the gateway answers it (see [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README and [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md).
- **A network failure is not retryable.** A browser reports a refused connection, a DNS failure and a request blocked by CORS alike as a bare `TypeError`, which tells nothing about whether the request went out, so the client infers `connection-failed`: `committed: 'unknown'`, `retryable: false` (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)). An organization that knows its network relaxes that with `inferFault`.

## Types

- `ClientOptions<D, Configured>`, `{ baseUrl, headers?, fetch?, inferFault?, onDeprecation? }`, what `client(dependency, options)` takes; `Http`, re-exported from `@cf-loom/contract`, the type of its `fetch`, and `OnDeprecation`, the type of its `onDeprecation`.
- `Client<D, Configured>`, what `client()` returns: one method per listed Endpoint, `(input, { signal }?) => Promise<ReceivedOutcome<D, Name>>`. Code that calls another Service can depend on `Client<typeof paymentsDependency, 'x-api-key'>` rather than on `client()` itself; its second parameter, `Configured`, names the headers given to `client()`, which its methods no longer require, and is a name some listed Endpoint's Input declares, so a typo does not compile; `ClientOptions` takes it the same way, and `CallInput<E, Configured>` a name `E`'s own Input declares.
- `CallInput<E, Configured>`, the Input a method takes, and `CallOptions`, `{ signal? }`.
- `ReceivedOutcome<D, Name>`, what the method `Name` of a client of the Dependency `D` returns: one of `ReceivedSuccess<D, Name>`, `ReceivedRejection<D, Name>`, `ReceivedUnknownRejection` and `ReceivedFault`. A Caller names a Success body by `ReceivedSuccess<typeof paymentsDependency, 'getPayment'>['body']`; the Provider's Standard Rejections, `D['provider']['standardRejections']`, type the invalid-input body by its Reader.
- `Committed`, `Issue` and `ReservedCode`, re-exported from `@cf-loom/contract`: the types of a Fault's `committed`, `issues` and `code`.
- `Happened`, `InferredFault` and `InferFault`, what `inferFault` receives and returns; `FaultSource`, the values of a Fault's `source`; `DeprecationNotice`, what `onDeprecation` receives.
