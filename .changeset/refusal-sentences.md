---
"@cf-loom/contract": major
---

Each refusal sentence a declaration's type error and `generate` both write is written once, so the two always agree. Changed type errors:

- A reserved Endpoint, Guard or Subscription name reads `<An Endpoint / A Guard / A Subscription> name is camelCase words and no reserved word: "delete"`.
- An Application depending on an Endpoint that is not Public reads `An Application depends on Public Endpoints only: payments-service's getPayment is internal`.
- Every rule's sentence is a key no value has, so a Guard's `demands.params` or `demands.body` written as the sentence's text is a type error too.

A Provider is another Service. A Service listing a Dependency on, or a Subscription to, an Element of its own Contract Package fails `generate` with `A Provider is another Service: orders-service is this Service`, and either is a type error on `defineService`.
