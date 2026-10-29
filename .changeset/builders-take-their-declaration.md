---
"@cf-loom/handlers": major
"@cf-loom/testing": major
---

`success()` and `admit()` take their declaration first, as `reject()` takes its Rejection: `success(getOrder, body)`, `success(createOrder, { headers, body })`, `success(deleteOrder)` for a 204 without headers, `admit(apiKey, { callerId })`, and `admit(permission)` for a Guard that provides no Context. A literal with a field the Endpoint or the Guard does not declare, such as a misspelled optional field or header, is now a type error where it is written; a variable may carry more, which the runtime strips, and a Success built in a helper or into a variable before its `return` type-checks. Every `success(…)` and `admit(…)` call gains its declaration as the first argument. A generic wrapper of `success` is refused; one typed with the concrete Endpoint, `(body: SuccessOf<typeof getOrder>['body']) => success(getOrder, body)`, compiles.
