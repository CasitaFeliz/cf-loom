# cf-loom

Tooling for defining, publishing, verifying and consuming the Contracts of Services: their HTTP Endpoints, their Messages and what they depend on. A Contract is the single source of truth for what a Service offers and what it requires; Handlers implement it and Consumers use it.

This file defines the language. The rules live in [COMPATIBILITY.md](COMPATIBILITY.md) (how a Contract may change) and [ARCHITECTURE.md](ARCHITECTURE.md) (how the pieces fit); [README.md](README.md) walks through a first Service and links each package's README, and [SNAPSHOT.md](SNAPSHOT.md) specifies the Snapshot.

## Language

### Contract and its parties

**Contract**:
The complete, versioned definition of one Service or Application: what it offers to Consumers (Public and Internal Endpoints, Internal Events), what it keeps for itself (Private Elements and Subscriptions to its own Events), what it requires (Dependencies), and the Guards its Endpoints attach.
_Avoid_: schema (overloaded with the zod schemas inside a Contract), registry (for the Contract itself), API definition

**Element**:
A declared part of a Contract that has a Visibility and a lifecycle: an Endpoint or a Message Version (of an Event or a Command).
_Avoid_: item, entry, member

**Contract Package**:
The published artifact that carries exactly one Contract: its Public and Internal Elements and its Snapshot, which also records its Dependencies. Versioned with semantic versioning.
_Avoid_: schemas package, public package (Visibility is not about the registry)

**Definitions Package**:
A versioned package of declarations that several Contracts import, such as Guards and common schemas. It owns no Elements and no Handlers.
_Avoid_: shared kit, common contract, library

**Service**:
The deployable unit that owns and implements exactly one Contract and offers Elements.
_Avoid_: microservice, API, backend

**Application**:
A deployable Consumer that offers no Elements, such as a frontend or a CLI. Its Contract holds only Dependencies.
_Avoid_: frontend (one kind of Application), client, app

**Consumer**:
Any party other than the owning Service that uses a Service through its Contract: a Caller or a Subscriber.
_Avoid_: client (that is the library), user

**Caller**:
Any party that calls an Endpoint: an Application, another Service, or a party with no Contract at all.
_Avoid_: client, requester

**Subscriber**:
A Service that receives an Event through a Subscription. A Subscriber of another Service's Event is a Consumer.
_Avoid_: listener

**Visibility**:
How far on the network an Element reaches. **Public**: the internet. **Internal**: other Services on the internal network. **Private**: only the owning Service.
_Avoid_: access, exposure, scope (for Visibility)

### HTTP

**Endpoint**:
One HTTP method on one literal path, which identify it, with a name for code, the schemas of its Input, its Success and its Rejections, and the Guards it attaches.
_Avoid_: route, operation, action, call

**Group**:
A named set of Endpoints, for organizing code and documentation only; it adds nothing to the Endpoints in it.
_Avoid_: router, family, tag

**Guard**:
A reusable requirement an Endpoint attaches explicitly: what it demands from the request, the Guards whose Context it reads, the Context it provides, and the Rejections it may answer instead of admitting the request.
_Avoid_: middleware, policy, interceptor

**Attachment**:
A Guard as an Endpoint lists it, with its Qualifier when the Guard declares one.
_Avoid_: binding, usage

**Qualifier**:
The value an Endpoint attaches a Guard with, such as the permissions it requires. The Guard's GuardHandler receives it; it enforces nothing by itself.
_Avoid_: argument, parameter, scope

**Input**:
What the Caller sends to an Endpoint: its path params, query params, headers and body, validated against the Endpoint's schemas.
_Avoid_: arguments, payload

**Context**:
What the Guards of an Endpoint provide to its EndpointHandler, and to the Guards that list them, as opposed to the Input the Caller sent.
_Avoid_: locals, principal, session

**Outcome**:
What an Endpoint answers and a Caller receives: exactly one of a Success, a Rejection or a Fault. A Handler builds it with a Rejection's declaration and body; the Caller receives it with the Rejection's code, status and message resolved.
_Avoid_: result (taken by `Result<T, E>` libraries), response, reply

**Success**:
What an Endpoint returns when it does what was asked: its declared status, headers and body.
_Avoid_: response, answer, data

**Rejection**:
A declared business decision not to do what was asked, which a Caller is expected to handle (for example `INSUFFICIENT_FUNDS`). Identified by its code; it has an HTTP status, a body schema and a message. Codes are open: a Caller must handle codes it does not know.
_Avoid_: error, refusal, failure, exception

**Standard Rejection**:
One of the three Rejections whose code, status and message come from a Definitions Package or cf-loom's defaults, never from a Contract: invalid input and not implemented, which cf-loom's runtime produces, so every Endpoint has them without declaring them; and not found, which an Endpoint lists like any Rejection.
_Avoid_: generic error, built-in error

**Fault**:
A technical failure any Handler can produce and no Endpoint, Guard or Message declares (a database down, a timeout, a bug). It says whether the change was committed (`committed`: `'no'`, `'yes'` or `'unknown'`), which alone decides whether retrying is safe, and whether the same request could succeed later (`retryable`), which says whether retrying is worth it.
_Avoid_: error, server error, operation failure

**Open Enum**, **Open Union**:
An enum, or a discriminated union, declared open: its readers receive values or variants they do not know as a tagged **Unknown** case and must handle it.
_Avoid_: extensible enum, loose enum

### Messaging

**Message**:
A Command or an Event: what travels through the broker rather than over HTTP.
_Avoid_: payload (for the Message itself), envelope

**Command**:
An instruction a Service sends to itself, handled by one CommandHandler.
_Avoid_: job, task, request, operation

**Event**:
A fact a Service publishes about something that already happened, for any number of Subscribers.
_Avoid_: message (covers both kinds), notification, signal

**Message Version**:
One numbered version of a Command or Event (`PaymentCreated@2`), declared anew to carry an incompatible change and living side by side with the previous one. Each is its own Element.
_Avoid_: schema version, major (that is the Contract Package's version)

**Fact id**:
The id shared by every Message one `publish` or `send` call sends for the same fact, so a Handler can recognize a fact it already handled.
_Avoid_: correlation id, event id

**Release**:
One deployed version of a Service. During a rollout two Releases of the same Service run side by side and exchange its Messages.
_Avoid_: deployment, build, instance

### Dependencies

**Dependency**:
A declaration, in a Contract, that its owner uses a Public or Internal Element of another Service, the Provider: an Endpoint it calls or an Event it subscribes to.
_Avoid_: import, integration, upstream

**Provider**:
The Service whose Element a Dependency targets.
_Avoid_: upstream, producer, server

**Subscription**:
A declaration that a Service receives an Event, its own or another Service's. A Subscription to another Service's Event is also a Dependency.
_Avoid_: listener, binding

**Contract directory**:
Where the tooling gets the complete list of an organization's Contract Packages, to read every Dependency. It returns the whole list or fails.
_Avoid_: catalog, index (one kind of directory)

### Implementation

**Handler**: **EndpointHandler**, **CommandHandler**, **EventHandler**, **GuardHandler**:
The code the runtime invokes with something incoming: a call to an Endpoint, a Command, an Event through a Subscription, or a request a Guard must judge (the GuardHandler decides whether to admit it). CommandHandlers and EventHandlers together are Message Handlers.
_Avoid_: controller, listener, resolver, processor

**Admission**:
What a GuardHandler answers: the request admitted with the Context its Guard provides, or a Rejection or a Fault instead.
_Avoid_: verdict, pass, result

**Stub**:
A Handler `generate` writes for an Endpoint, a Guard, a Command's Message Version or a Subscription not implemented yet, and marks as such: an Endpoint or Guard stub answers the not-implemented Rejection, and `consume` does not pull for a Message Handler stub.
_Avoid_: placeholder, mock

**Issue**:
One way a value broke its part of the Contract: the part and path, cf-loom's code and a message, never the received value.
_Avoid_: error, violation

**Plan**:
A desired state the tooling derives from Contracts for infrastructure it does not manage: the broker plan (streams, durable consumers, permissions) and the route plan (routes by Visibility). The organization decides how to apply it.
_Avoid_: manifest, deployment config

**EventPublisher**:
What a Service publishes its Events with.
_Avoid_: emitter, bus

**CommandSender**:
What a Service sends its Commands with.
_Avoid_: dispatcher, bus

### Compatibility

**Snapshot**:
A language-neutral description of a Contract or a Definitions Package, frozen when it is published and carried inside the published package.
_Avoid_: schema dump, manifest

**Baseline**:
The Snapshot of the highest published version of a Contract Package or Definitions Package, against which every proposed change is judged.
_Avoid_: previous snapshot, reference

**Compatibility Check**:
The comparison of a Contract or a Definitions Package against its Baseline that classifies each difference as a Breaking, Additive or Neutral Change.
_Avoid_: diff, lint, compatibility review

**Breaking Change**:
A difference that can make an existing Consumer, or another Release of the same Service running side by side, fail at runtime. A Consumer's code that stops compiling after upgrading the Contract Package is not, by itself, a Breaking Change; the one exception is in [The Compatibility Check](COMPATIBILITY.md#the-compatibility-check).
_Avoid_: incompatible change, error

**Additive Change**:
A difference no existing Consumer or running Release can fail on, but that a Consumer can notice.
_Avoid_: non-breaking change, safe change

**Neutral Change**:
A difference that changes nothing a Consumer or another Release relies on or notices, such as a description.
_Avoid_: patch change, cosmetic change

**Breaking Change Approval** (an Approval, for short):
An explicit approval, tied to the exact commit, that lets a Breaking Change merge.
_Avoid_: authorization, sign-off, label

**Approval source**:
An optional source, configured by the organization, that tells the tooling who approved which commit, so it can verify a Breaking Change Approval itself.
_Avoid_: approval provider, gate

**Approver**:
Whoever may give a Breaking Change Approval for a Contract or a Definitions Package: a person or a team.
_Avoid_: authorizer, reviewer, tech lead

### Lifecycle

**Active**, **Deprecated**, **Retired**:
The lifecycle of an Element. Deprecated is still declared and warns its Consumers. Retired no longer works, but stays recorded in every later Snapshot, as a **tombstone** once its declaration is deleted; removed Subscriptions are kept as tombstones too.
_Avoid_: obsolete, removed (for an Element: Elements are Retired; Subscriptions and codes are removed), sunset
