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
    if (outcome.committed === 'no' && outcome.retryable) return null;   // a Caller retries here, as Retrying shows
    throw new Error(`payments-service failed: ${outcome.source}`);
}
```

The client has one method per Endpoint listed in the Dependency, named after it, and returns an Outcome: it never throws for a Rejection or a Fault. It reads the Provider's Standard Rejection codes from its Endpoints, which carry them, so a Caller receives the Provider's codes, not its own. Every method takes an optional second argument, `{ signal }`, to abort the call; cf-loom sets no timeout, the organization does (`AbortSignal.timeout(ms)` is one). The first argument may be left out when no part of the Input is required, counting the headers given to `client()`.

`baseUrl` is a string or a `URL`. Its path is kept as a prefix, such as a gateway's mount, with one trailing slash removed: `client(dependency, { baseUrl: 'https://gw.example/payments/' })` calls `getPayment` at `https://gw.example/payments/payments/<id>`. A `baseUrl` whose scheme is not `http` or `https`, with a username or a password, which `fetch` refuses in a URL, or with a query or a fragment, even an empty one, is a bug, and `client()` throws, never showing the password.

Given an Endpoint whose exported Snapshot cut is in a format the installed cf-loom does not read (see [Where it lives](https://github.com/CasitaFeliz/cf-loom/blob/main/SNAPSHOT.md#where-it-lives) in SNAPSHOT.md), `client()` throws `<provider>'s exported Snapshot is in format <n>, newer than this cf-loom reads: upgrade the @cf-loom packages`, or, when it breaks the format it names, `<provider>'s exported Snapshot is malformed: <where> <reason>`, such as `format is not a whole number from 1` or `endpoints.GET /orders/{}.name is missing`. Before cf-loom 1.0.0, a cut that an older cf-loom wrote may be such a malformed one (see [Before cf-loom 1.0.0](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/cli/README.md#before-cf-loom-100) in the CLI README). Given an Endpoint no Contract Package exports, written through a cast or in JavaScript, which carries no cut, `client()` throws `<name> is no Endpoint a Contract Package exports, so it carries no exported Snapshot`.

### What a call sends

The client checks the Input as the Provider will read the request it sends, every Guard admitting it (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)). It sends the parsed value, unknown keys stripped, and its path params, query params and headers as text by the rules of [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http), each path param percent-encoded as one segment, its Guards' demanded query params and headers included; an optional query param left `undefined` sends no key.

Input that breaks its schema, one nested too deeply to read included (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)), or whose text cannot travel, is never sent: the method returns the Provider's invalid-input Rejection, `source: 'client'`, with the Provider's code, status and message and cf-loom's body, read as its response would be. For Input that breaks its schema, it holds the Issues the Provider would answer once the Guards before it admit the request; a declared body left out is read as the request it would send, with no content type (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)). Text that cannot travel is answered by the client alone, with no counterpart on the Provider, which never receives it: a header value that is not RFC 9110 field text (a CR or LF, for one), a path param's text that is empty, `.` or `..`, which URL parsing resolves away, or any text that holds a lone surrogate, which no UTF-8 can carry; each is an Issue with `invalid_format`. A required list given with no items is refused as the Provider would refuse it (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)). A signal aborted before the request is sent, while a header function runs included, returns the call's Fault, `committed: 'no'`, at once, even when the Input is invalid and whatever a header function does after; nothing is sent.

### Headers

Headers an Endpoint or its Guards demand are typed, with lower-case names. Those given to `client()` need not be passed again; any still missing is a required `headers` field on each call that needs it. Query params, a Guard's included, are always passed per call.

- A header given to `client()` is a value, or a function called per request with the call's options as given (`{}` when the call has none), `{ signal? }`, which may be async, to refresh a token and cancel it with the call (pass `call` on as it is, not `{ signal: call.signal }`). Its type is the Input's type for that name, across every listed Endpoint that declares it.
- Its name must be one some listed Endpoint's Input declares. It is sent only to an Endpoint whose Input declares it.
- A header the call passes wins, and the function is then not called. The call stops waiting for a function when its signal is aborted, calls no other, and returns its Fault (see [What a call sends](#what-a-call-sends)); what the function throws or rejects with after that is dropped. Otherwise what a function throws reaches the calling code unchanged.

### What a call receives

A Success Outcome carries `status`, and `headers` and `body` where its Endpoint declares them, typed: the same Success a direct call of its Handler returns. The client validates a Success and a Rejection, their headers included, against the Reader schemas of the Provider's Contract Package (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md): open objects, Unknown cases. A Success or Rejection header is converted from its text by its node in the exported Snapshot cut its Endpoint carries, so an Open Enum header the Caller does not know arrives as `{ unknown: 'lost' }`. Undeclared response headers are not read, except as [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) says.

A Success whose JSON body or headers fail their Reader schemas, a body nested too deeply to read included (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)), is a Fault with `INVALID_OUTCOME`, `committed: 'yes'` and `retryable: false`: the Service processed the request, but answered something its Contract does not describe. A Rejection whose headers or body fail them is the same Fault with `committed: 'unknown'`. Either carries `issues`, each with its part (`success.headers`, `success.body`, or a Rejection's `headers` or `body`), path, code and message, never the received value. A Success-status answer whose body is no JSON, a gateway's page for one, is no answer the Provider is shown to have sent, and a Success body whose stream fails while it is read is none it finished: the client infers the Fault of each, as [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) says.

A Rejection Outcome (`kind: 'rejection'`) carries `source`, `code`, `status`, `message`, and `headers` and `body` where its code declares them. `code` is one of the codes the Endpoint answers, a Standard one the Provider's, `status` is the one received, and `headers` and `body` have their declared types, absent for a code that declares none, whatever arrived. `source` is `'provider'`, or `'client'` for the invalid-input Rejection the client answered without sending. A `switch` on `code` narrows `headers` and `body` and is exhaustive. A code the Endpoint does not answer is its own kind, `unknown-rejection`, with `source: 'provider'`, the raw `code`, `status`, `message` and `body` unvalidated, present when one was sent; codes are open, so a Caller handles it. The invalid-input Rejection's body is read with the Reader of the Provider's Contract Package, the Rejection the client makes without sending included, with its `in` and `code` as Open Enums, so a part or issue code the Provider's cf-loom does not know arrives as `{ unknown }`.

A Fault Outcome carries `source`, where it came from, `committed`, `retryable`, `message`, `status` whenever a response arrived, the reserved `code` when there is one, `retryAfter`, the `Retry-After` header as received, on a Fault the Provider sent or the client inferred from a response that carried one, `cause`, the error `fetch` threw, the stream failed with or the signal was aborted with, and `issues` on an `INVALID_OUTCOME` the client produced. `source` is `provider` for a Fault the Provider sent, `invalid-outcome` for an `INVALID_OUTCOME`, and else what the client met: `aborted`, `timeout`, `no-connection`, `connection-lost`, `connection-failed`, `status` or `unreadable-body` (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)). A Fault code that is not reserved is dropped. Whether to send the call again is the Caller's to decide (see [Retrying](#retrying)).

### Retrying

Only a Fault is ever retried: a Success and a Rejection, an Unknown Rejection included, are answers. A Caller decides by two fields of the Fault (see [Fault](https://github.com/CasitaFeliz/cf-loom/blob/main/CONTEXT.md#language) in CONTEXT.md):

- `committed === 'no' && retryable`: nothing happened, and the same request could succeed later.
- `committed !== 'yes' && retryable`, for a call sent again with the same idempotency key: the first attempt may have happened, and the Provider replays its Success instead of doing it twice. cf-loom requires no idempotency; the pattern for it is a Guard in a Definitions Package that demands an `idempotency-key` header, whose Service stores each key with its Success and replays it.

Without a key, a call that timed out after the request was sent is never retried: its Fault is `committed: 'unknown'`. A Caller's own abort is never retryable, so neither rule retries a cancelled call.

The Faults the client infers from what it met are in the table in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http), and hold wherever `fetch` runs. A 429 and a timeout before the request was sent are `committed: 'no'`, `retryable: true`, so both rules retry them; a 503 and a timeout after it was sent are `committed: 'unknown'`, `retryable: true`, so only a call with a key retries them. What differs is the `TypeError` `fetch` throws for a network failure. Node's carries a `cause.code`: a refused connection is `no-connection`, retried by both rules, and a lost one `connection-lost`, retried only with a key. A browser's is a bare `TypeError`, `connection-failed`: `committed: 'unknown'`, `retryable: false`, so neither rule retries it until `inferFault` relaxes it (see [In a browser](#in-a-browser-applications)). `retryAfter` is the `Retry-After` header as received, a string of whole seconds or an HTTP date.

The Provider's Guard demands the key, its GuardHandler admits the request with it, and its Handler stores each Success under the key and replays it (the examples leave out their imports, and the Service's Resources has a `payments` Resource with `byKey` and `create`):

```ts
// definitions/src/definitions/guards/idempotency-key.guard.ts
export const idempotencyKey = defineGuard({
  name: 'idempotencyKey',
  description: 'The key of one attempt to do a thing, sent again with each retry of it',
  demands: { headers: z.object({ 'idempotency-key': z.string().min(1) }) },
  context: z.object({ key: z.string() }),
});

// src/contract/endpoints/payments/create-payment.endpoint.ts
export const createPayment = defineEndpoint({
  name: 'createPayment',
  method: 'POST',
  path: '/payments',
  visibility: 'public',
  description: 'A new payment',
  guards: [idempotencyKey],
  input: { body: z.object({ amount: z.int() }) },
  success: { status: 201, body: z.object({ id: z.string(), amount: z.int() }) },
});

// src/guards/idempotency-key.handler.ts
export default handle(idempotencyKey, ({ headers }) => admit({ key: headers['idempotency-key'] }));

// src/endpoints/payments/create-payment.handler.ts
export default handle(
  createPayment,
  async ({ body }, { context }, { resources: { payments } }: Needs<'payments'>) => {
    const { key } = context.idempotencyKey;
    const done = await payments.byKey(key);
    if (done) return success(done);   // the first attempt happened: the same Success again
    const payment = await payments.create(key, body.amount);
    return success(payment);
  },
);
```

The Caller's Dependency lists `createPaymentEndpoint` from the Provider's Contract Package beside `getPaymentEndpoint`, so its client has `createPayment`. It makes one key per payment, sends it with every attempt, waits as long as `retryAfter` says and stops after three attempts:

```ts
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry-After as received, whole seconds or an HTTP date, in milliseconds; a second without a usable one
function delayOf(retryAfter: string | undefined): number {
  if (retryAfter === undefined) return 1000;
  if (/^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  const until = Date.parse(retryAfter) - Date.now();
  return Number.isNaN(until) ? 1000 : Math.max(0, until);
}

async function pay(amount: number) {
  const key = crypto.randomUUID();   // the same on every attempt at this payment
  for (let attempt = 1; ; attempt += 1) {
    const outcome = await payments.createPayment({
      headers: { 'idempotency-key': key },
      body: { amount },
    });
    if (outcome.kind !== 'fault') return outcome;
    const mayRetry = outcome.committed !== 'yes' && outcome.retryable;   // the key makes 'unknown' safe
    if (!mayRetry || attempt === 3) return outcome;                      // at most three attempts
    await pause(delayOf(outcome.retryAfter));
  }
}
```

`delayOf` takes `Retry-After` at its word. A Caller that cannot wait as long as a Provider asks bounds the wait itself, as in `Math.min(delayOf(outcome.retryAfter), limit)`, or stops retrying.

### fetch and inferFault

`client(dependency, { fetch })` replaces the global `fetch`, for instrumentation (tracing headers, timing), a runtime without one, a test (see [Faking Providers](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/testing/README.md#faking-providers) in the testing README) or any other concern of the Request, such as a browser's `credentials`. It is called with the one `Request` each call sends, its headers, body, signal and `redirect: 'manual'` set, as a plain function and never as a method, so a browser's own `fetch` is passed as it is. A wrapper changes it (`request.headers.set('traceparent', t)`) or builds another from it (`new Request(request, { credentials: 'include' })`) and passes it on; one that reads the body reads a `request.clone()`. A wrapper that wants redirects followed passes on `new Request(request, { redirect: 'follow' })`. `globalThis.fetch` is an `Http`, and so is what `serve` returns: `client(dependency, { baseUrl, fetch: serve(contract, handlers, { resources }) })` calls a Provider in the same process. Without the option, the global `fetch` is called as it is when the call is made. Only a network failure, an abort or a timeout of `fetch` becomes a Fault, inferred as in [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md; any other error `fetch` throws reaches the calling code unchanged. A `TypeError` a `fetch` wrapper throws is taken for a network failure, `committed: 'unknown'`, `retryable: false`.

`client(dependency, { inferFault })` replaces that inference, so an organization that knows its network (a gateway that only answers 502 before forwarding, for one) can relax it. `inferFault(happened, inferred)` receives what happened and cf-loom's inference, and returns `{ committed, retryable }`, or `undefined` to keep cf-loom's; the message stays cf-loom's. What happened is one of:

- `{ kind: 'no-connection' | 'connection-lost' | 'connection-failed', error }`: `fetch` threw a `TypeError`: no connection was made, one was lost after the request may have gone out, or any other failure;
- `{ kind: 'aborted', error }` and `{ kind: 'timeout', error }`: `fetch` threw an abort or a timeout, or the call's signal was aborted, `error` its reason; with the `status` and `headers` of the response when the body was being read;
- `{ kind: 'status', status, headers }`: a response that was neither the Success nor an Envelope, or a Success-status response whose body is no JSON;
- `{ kind: 'unreadable-body', status, headers, error }`: a response whose body failed while it was read.

A call whose signal was aborted before anything was sent is never offered: its Fault is `committed: 'no'`, retryable only when its reason is a `TimeoutError`. What `inferFault` throws reaches the calling code unchanged; a value it returns is not checked, so the Fault carries its `committed` and `retryable` as they are: either is the organization's bug.

### Deprecation

A Deprecated Endpoint still works, and its responses carry `Deprecation` (see [Lifecycle](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#lifecycle) in the contract README). The first response of a method that carries it calls `onDeprecation({ provider, endpoint, deprecatedAt })`, once per method of each client, with the instant as a UTC instant to the second; without `onDeprecation`, `console.warn` writes `<provider>: <endpoint> is Deprecated as of <deprecatedAt>`, true whether the instant has passed or is still to come. A client created per request warns per request. `onDeprecation` may be async and is not awaited; what it throws or rejects with is caught and written with `console.error`, `<provider>: <endpoint>: onDeprecation threw` and the error, so the Outcome is never lost or held back.

## In a browser (Applications)

An Application (see [Applications](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#applications) in the contract README) calls its Providers from a browser with this same `client`. The package uses only web-standard APIs, no Node API. The browser's own concerns of a Request, `credentials` for one, go through the `fetch` option (see [fetch and inferFault](#fetch-and-inferfault)):

```ts
const orders = client(ordersDependency, {
  baseUrl: 'https://api.example.com',
  headers: { 'x-api-key': apiKey },
  fetch: (request) => fetch(new Request(request, { credentials: 'include' })),   // cookies on a cross-origin call
});
```

- **Only what it lists.** A bundle carries only the Endpoints the Dependency lists and what calling them needs: each is imported from the Provider's Contract Package as `<name>Endpoint` (see [The Root](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#the-root) in the contract README), and that package declares no side effects, so a bundler drops the rest (see [The Contract Package](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#the-contract-package) in the root ARCHITECTURE.md).
- **Cookies through `credentials`.** No Contract declares a header the browser owns, such as `cookie` or `origin`, or `set-cookie`, which a browser never exposes (see [Groups](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#groups) in the contract README). The browser sends and stores cookies itself, cross-origin when the `fetch` option asks for `credentials`, as above.
- **Public Endpoints only.** An Application's Dependency lists Public Endpoints only, since an Application runs outside the internal network; any other is a type error (see [Applications](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/contract/README.md#applications) in the contract README).
- **CORS is the host's or the gateway's.** The client sets no CORS header and `serve` adds none to an Endpoint's own response; whatever wraps the handler `serve` returns, or the organization's gateway, does. A header such as `x-api-key` makes the browser send a preflight `OPTIONS` first, which `serve` answers `METHOD_NOT_ALLOWED`, or `NO_SUCH_ENDPOINT` on a path no Endpoint declares, unless the Service's `fallback`, the host or the gateway answers it (see [Serving](https://github.com/CasitaFeliz/cf-loom/blob/main/packages/server/README.md#serving) in the server README and [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http) in the root ARCHITECTURE.md).
- **The declared response headers are exposed.** A cross-origin response hides from the client every header the CORS safelist leaves out, unless it names the header in `Access-Control-Expose-Headers`. A hidden header an Endpoint's Success or Rejection requires fails the Outcome as `INVALID_OUTCOME` (see [What a call receives](#what-a-call-receives)), and a hidden optional one reads as absent, with no error. `Deprecation` and `Retry-After` are hidden the same way, so a Deprecated Endpoint tells nobody and a Fault has no `retryAfter`. The host or the gateway exposes every header the listed Endpoints' Successes and Rejections declare, which `cf-loom openapi` lists under each response, and `Deprecation` and `Retry-After`; with `credentials` it names each of them, since `*` then exposes none.
- **A network failure is not retryable.** A browser reports a refused connection, a DNS failure and a request blocked by CORS alike as a bare `TypeError`, which tells nothing about whether the request went out, so the client infers `connection-failed`: `committed: 'unknown'`, `retryable: false` (see [Over HTTP](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#over-http)). An organization that knows its network relaxes that with `inferFault`.

## Types

- An object parameter whose shape cf-loom gives, such as an options object, refuses in its type a field it does not declare, given as a literal or through a variable; a value whose shape the Contract gives is open (see [Runtime](https://github.com/CasitaFeliz/cf-loom/blob/main/ARCHITECTURE.md#runtime) in the root ARCHITECTURE.md).
- `ClientOptions<D, Configured>`, `{ baseUrl, headers?, fetch?, inferFault?, onDeprecation? }`, what `client(dependency, options)` takes; `Http`, re-exported from `@cf-loom/contract`, the type of its `fetch`, and `OnDeprecation`, the type of its `onDeprecation`.
- `Client<D, Configured>`, what `client()` returns: one method per listed Endpoint, `(input, { signal }?) => Promise<ReceivedOutcome<D, Name>>`. Code that calls another Service can depend on `Client<typeof paymentsDependency, 'x-api-key'>` rather than on `client()` itself; its second parameter, `Configured`, names the headers given to `client()`, which its methods no longer require, and is a name some listed Endpoint's Input declares, so a typo does not compile; `ClientOptions` takes it the same way, and `CallInput<E, Configured>` a name `E`'s own Input declares.
- `CallInput<E, Configured>`, the Input a method takes, and `CallOptions`, `{ signal? }`, which a header function given to `client()` also receives.
- `ReceivedOutcome<D, Name>`, what the method `Name` of a client of the Dependency `D` returns: one of `ReceivedSuccess<D, Name>`, `ReceivedRejection<D, Name>`, `ReceivedUnknownRejection` and `ReceivedFault`. A Caller names a Success body by `ReceivedSuccess<typeof paymentsDependency, 'getPayment'>['body']`; the Provider's Standard Rejections, which each listed Endpoint carries, type the invalid-input body by its Reader.
- `Committed`, `Issue` and `ReservedCode`, re-exported from `@cf-loom/contract`: the types of a Fault's `committed`, `issues` and `code`.
- `Happened`, `InferredFault` and `InferFault`, what `inferFault` receives and returns; `FaultSource`, the values of a Fault's `source`; `DeprecationNotice`, what `onDeprecation` receives.
