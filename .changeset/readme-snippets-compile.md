---
"@cf-loom/contract": patch
"@cf-loom/handlers": patch
"@cf-loom/messaging": patch
"@cf-loom/server": patch
---

The TypeScript blocks of the contract, handlers, messaging and server READMEs compile together against one Service, the GuardHandler example rejects with the `www-authenticate` header its Rejection declares, and the server and messaging examples hand `serve` and `consume` the Resources their Handlers take. `onServiceFault`, `onAnswered` and `onBrokerTrouble` may return a value, which is awaited and ignored.
