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

**Group**:
A named set of Endpoints, Events, Commands and Subscriptions, for organizing code and documentation only; it adds nothing to what it lists.
_Avoid_: router, family, tag, module

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
A technical failure any Handler can produce and no Endpoint, Guard or Message declares (a database down, a timeout, a bug). It says whether the change was committed (`committed`: `'no'`, `'yes'` or `'unknown'`), which alone decides whether retrying is safe, and whether the same request could succeed later (`retryable`), which says whether retrying is worth it; over HTTP, a retryable one may say in whole seconds when to retry.
_Avoid_: error, server error, operation failure

**Envelope**:
The body cf-loom defines, in which a Rejection or a Fault travels over HTTP.
_Avoid_: error body, error payload, problem details (RFC 9457 is another format)

**Open Enum**:
An enum declared open: its readers receive values they do not know as a tagged **Unknown** case and must handle it.
_Avoid_: extensible enum, loose enum

### Messaging

**Message**:
A Command or an Event: what travels through the Broker rather than over HTTP.
_Avoid_: payload (for the Message itself), envelope (for the Message itself)

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

**Broker**:
The message system a Service's messaging runs on, through an adapter: it holds the Services' streams and durable consumers, and delivers Messages at least once.
_Avoid_: bus, queue, message bus

**Release**:
One deployed version of a Service. During a rollout two Releases of the same Service run side by side and exchange its Messages.
_Avoid_: deployment, build, instance

### Dependencies

**Dependency**:
A declaration, in a Contract, of what its owner uses of one other Service, the Provider: it holds the Provider's Contract Package and the Public or Internal Endpoints its owner calls. A Subscription to an Event that Contract Package exports needs the Dependency listed.
_Avoid_: import, integration, upstream

**Provider**:
The Service whose Contract Package a Dependency holds.
_Avoid_: upstream, producer, server

**Subscription**:
A declaration that a Service receives an Event, its own or one a listed Dependency's Provider exports, taken from that Provider's Contract Package.
_Avoid_: listener, binding

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

**Handler map**:
The plain data the Handler map's file exports (`handlers.generated.ts` by default), which `generate` regenerates and `serve` and `consume` take: every Handler of a Service's Endpoints that are not Retired, of its Guards, of its Commands' Message Versions that are not Retired, and of its Subscriptions, keyed by name, with the `readers` that pair each Command's Message Version and Subscription with the Reader its Handler reads, and the `deprecatedAt` of each Deprecated Endpoint. Its imports are the record of which Handler files are cf-loom's: `generate` moves one the layout places elsewhere, drops one only once its file is gone, and deletes the map and the readers it wrote at a path the layout no longer names once it has written them where it does. The author only deletes a file or moves it off its path.
_Avoid_: registry, router

**Resources**:
What a Service hands `serve` and `consume` once, at startup, for its Handlers to reach what lies outside the Contract: its repositories, the clients of its Providers, its EventPublisher and CommandSender. Each Handler takes the ones it needs.
_Avoid_: dependencies (a Dependency is declared in a Contract), adapters (a broker or host adapter), context (what Guards provide), environment, container; and a REST resource, which a Contract calls an Endpoint

**Issue**:
One way a value broke its part of the Contract: the part and path, cf-loom's code and a message, never the received value.
_Avoid_: error, violation

**Plan**:
A desired state the tooling derives from Contracts for infrastructure it does not manage: the broker plan, the streams and durable consumers a Service needs on the Broker. The organization decides how to apply it.
_Avoid_: manifest, deployment config

**EventPublisher**:
What a Service publishes its Events with.
_Avoid_: emitter, bus

**CommandSender**:
What a Service sends its Commands with.
_Avoid_: dispatcher, bus

### Compatibility

**Snapshot**:
A language-neutral description of a Contract or a Definitions Package, frozen when it is published and carried inside the published package. The **declared Snapshot** is what `generate` writes from the source; the **published Snapshot** is `snapshot.json`, which adds `version` and the history; the **exported Snapshot** is the cut of whichever of them a Contract Package is generated from, to what the package exports.
_Avoid_: schema dump, manifest

**Baseline**:
The Snapshot of the highest published version of a Contract Package or Definitions Package, a prerelease included, against which every proposed change is judged.
_Avoid_: previous snapshot, reference

**Reader schema**:
A schema generated from a Snapshot for whoever reads a Success, a Rejection body or a Message: every object in it open and every Open Enum with its Unknown case, so it admits what any later compatible version may send.
_Avoid_: loose schema, consumer schema

**Read shape**:
A shape a Service writes for any reader, another Release of its own included, to read with a Reader schema: a Success, a Rejection body or a Message body. Every object in it is open to its readers.
_Avoid_: output, response, payload

**Position**:
Where a shape is read, which decides what makes a change to it Breaking: Input (the Service reads it), Success (a Caller reads it, a Rejection's body included) or Message (any Release reads it, at any time). A Definitions Package's shared schema has none until an Element uses it, so the Compatibility Check judges it as a Message, which is the strongest.
_Avoid_: direction, side, context (that is a Guard's)

**Compatibility Check**:
The comparison of a Contract or a Definitions Package against its Baseline that classifies each difference as a Breaking, Additive or Neutral Change and gives it a Verdict.
_Avoid_: diff, lint, compatibility review

**Breaking Change**:
A difference that can make an existing Consumer, or another Release of the same Service running side by side, fail at runtime. A Consumer's code that stops compiling after upgrading the Contract Package is not, by itself, a Breaking Change; the exceptions, renaming an Endpoint and removing a Definitions Package's shared schema, Guard or Rejection, are in [The Compatibility Check](COMPATIBILITY.md#the-compatibility-check).
_Avoid_: incompatible change, error

**Additive Change**:
A difference no existing Consumer or running Release can fail on, but that a Consumer can notice.
_Avoid_: non-breaking change, safe change

**Neutral Change**:
A difference that changes nothing a Consumer or another Release relies on or notices, such as a description.
_Avoid_: patch change, cosmetic change

**Verdict**:
What the Compatibility Check does with a Change: allows it, needs a Breaking Change Approval for it, or refuses it, which fails the check whatever Approval is given.
_Avoid_: not allowed (a construct `generate` refuses), outcome (an Endpoint's), severity, level

**Breaking Change Approval** (an Approval, for short):
An explicit approval by an Approver, given under the organization's own review process, that lets a Breaking Change merge.
_Avoid_: authorization, sign-off, label

**Approver**:
Whoever the organization's review process lets give a Breaking Change Approval for a Contract or a Definitions Package: a person or a team.
_Avoid_: authorizer, reviewer, tech lead

### Lifecycle

**Active**, **Deprecated**, **Retired**:
The lifecycle of an Element. Deprecated is still declared and warns its Consumers. Retired no longer works and has no Handler, but stays recorded in every later Snapshot, as a **tombstone** once its declaration is deleted; removed Subscriptions are kept as tombstones too.
_Avoid_: obsolete, removed (for an Element: Elements are Retired; Subscriptions and codes are removed), sunset
