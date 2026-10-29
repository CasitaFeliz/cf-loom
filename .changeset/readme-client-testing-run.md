---
"@cf-loom/client": patch
"@cf-loom/contract": patch
"@cf-loom/messaging": patch
"@cf-loom/server": patch
"@cf-loom/testing": patch
---

The TypeScript blocks of the client and testing READMEs compile with those of the contract, handlers, messaging and server READMEs against one Service, and their tests run them: the client README's first example is a whole file exporting `payments` and `amountOf`, its Provider-side files name `payments-service/` and import what they use, and its browser example is a file of `web-admin` calling through `adminPaymentsDependency`; the testing README's examples import the Handler they call from `src/endpoints/orders/`; the contract README's Definitions Package exports `idempotencyKey`, its Dependency lists `createPaymentEndpoint` and its orders Group lists `settlePayment`; and the server README's `main.ts` gives its Resources the `payments` client.
