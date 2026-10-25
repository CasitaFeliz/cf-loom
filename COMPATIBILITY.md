# Compatibility

How a Contract or a Definitions Package may change. Terms are defined in [CONTEXT.md](CONTEXT.md); the Snapshot the rules compare is specified in [SNAPSHOT.md](SNAPSHOT.md).

## The Compatibility Check

- Every change to a Contract is judged against its Baseline, read from the registry (see [The Baseline](#the-baseline)).
- The Snapshot covers all three Visibilities and resolves every imported Guard and schema from its Definitions Package, so adopting a new Definitions Package version shows up as a change on the Elements that use it.
- Each difference is a Breaking, Additive or Neutral Change. When the tooling cannot prove a change compatible, it is Breaking. There is no warning level. Each Change also has a Verdict (see [Breaking Change Approval](#breaking-change-approval)): allowed, needs an Approval, or refused.
- The types of `@cf-loom/contract` refuse what TypeScript can state exactly, and `generate` repeats every rule the types refuse, since a cast, or a list or path typed wider than a literal, skips them; `generate` fails on every other rule that needs no Baseline, reporting them all at once; `check` adds only the rules that compare with the Baseline. A declaration never throws.
- Breaking means a deployed Consumer or Release can fail at runtime. A Consumer's code that stops compiling when it upgrades the Contract Package, such as an exhaustive `switch` over an enum that lost a value, is visible and opt-in, so it is not Breaking. The exceptions are renaming an Endpoint (see [Elements](#elements)), and removing a Definitions Package's shared schema, Guard or Rejection, since Services import them by name.
- Additive guarantees that what is already deployed keeps working against the new version, not that a Consumer built on the new version works against an older Release. The Input and Success rules rely on this, so a Contract Package version published before a Release implementing it is deployed lets a Consumer depend on Elements, or on Input and Success shapes, that the running Release does not offer yet. Until such a Release is deployed, a Caller meets a Rejection or a Fault (see [Over HTTP](ARCHITECTURE.md#over-http) in ARCHITECTURE.md), or has an Input field the running Release does not declare yet ignored (see [Shapes, not behavior](ARCHITECTURE.md#shapes-not-behavior) in ARCHITECTURE.md), and a Subscriber receives nothing. When a Contract Package version is published, and how publishing is wired into the organization's pipeline, are the organization's: for example once a Release implementing it is deployed, or earlier, when the commit a Release will be deployed from is tagged or merged.
- With no Baseline, because the package was never published, `check` has nothing to compare, so only what `generate` enforces applies (such as [Not allowed in a Contract](#not-allowed-in-a-contract)); the package's first version that is not a prerelease is 1.0.0. `publish` then publishes 1.0.0, or with `--prerelease` 1.0.0-0, and compares nothing.
- A Definitions Package is checked against its own Baseline with the same rules. A shared schema has no Position until an Element uses it, so each is judged in the Message Position, the strongest; adding a shared schema, a Guard or a Rejection is Additive, and removing one is Breaking, except the code a Standard Rejection resolved to, which Services name by its Standard Rejection, never by its code; a Guard's demands are judged as Input, its Context, its `guards` and its `qualifier` are Neutral, and its Rejections follow the Rejection rules. A Service is affected only when it adopts the new version; its own Compatibility Check then judges the change on its Elements, and its `generate` fails until its Endpoints list every Guard an adopted Guard now names and attach each such Guard with a Qualifier its `qualifier` accepts.

### The Baseline

- The Baseline is the highest published version of the package, a prerelease (`2.0.0-rc.1`) included, read from the package's list of versions: never from the `latest` tag, and never from a file in the repository. Its history, the tombstones with their `retiredIn` and the removed codes and Subscriptions, is merged into every publish. `check --against <version|dist-tag>` compares with another version the package lists instead; `publish` takes no `--against`, since every publish goes on the newest major and merges the history of the highest version. There is no publishing on an older major. The version a publish takes is derived as [Versioning](#versioning) says.

## Versioning

| Highest change on Public or Internal Elements | Contract Package bump |
| --- | --- |
| Breaking | major |
| Additive | minor |
| Neutral, or changes on Private Elements only | patch |

Private Elements are checked with the same rules, Breaking Change Approval included, because two Releases of the same Service run side by side; but they never move the version past patch: the version is a signal for Consumers, and Consumers cannot see Private Elements. Nor does a refused Change, whatever its class, since `publish` refuses it before any version matters. When an Element's Visibility changes, the wider of the old and new Visibility decides the bump. An Application's Contract holds only Dependencies, so a change to it never bumps past patch; the peer rule below still applies. A Definitions Package has no Elements: its version follows the table, every Change to it counted as on a Public Element, since the Services that import it may use all of it. A Rejection code is not an Element: a Change to its status or body counts as on the widest Visibility of the Endpoints that answer it, before or after the change, or Private when none does.

The bump applies to the highest published version that is not a prerelease. When the package lists none, the first version is 1.0.0, or the numbers of the Baseline when they are higher. When the Baseline is a prerelease, the version is the higher of that bump and the Baseline's own numbers: with `1.0.0` and `1.1.0-0` listed, a patch Change publishes `1.1.0` and a Breaking Change `2.0.0`. A version that would not be above the Baseline is never published: with a Baseline `1.1.0-rc.1`, which cf-loom's own numbering never produces, `publish --prerelease` would derive `1.1.0-0`, so it exits 3, and the version above the Baseline is published by hand.

The version also protects Consumers' installs. The peers of a Contract Package and of a Definitions Package are `zod` and `@cf-loom/contract`, a caret on each version installed where the root file imports it, and their ranges are compared with the Baseline's, read from the registry's package metadata: a peer moving to a new major publishes a major even when the Snapshot did not change, so a Consumer still on the old major never installs it by accident, and that major needs no Breaking Change Approval, since it is packaging, not a Breaking Change. A new major is read as a caret range reads it: `^4.1.0` to `^5.0.0` is one, and so is `^0.1.0` to `^0.2.0`, while `^0.1.0` to `^0.1.5` is not; a range that is not a caret on a semantic version counts as one, since no overlap can be proven. Any other change to a peer range with an unchanged Snapshot, a peer added or dropped included, publishes a minor. A Dependency declared against a newer version of its Provider, or a newer Definitions Package version that changes no shape, changes the Snapshot (see [Canonical form](SNAPSHOT.md#canonical-form) in SNAPSHOT.md) and bumps patch. When both the Snapshot and a peer range changed, the bump is the highest of the Snapshot's class and the peer rule. When neither the Snapshot's hash nor the peer ranges changed, `publish` does nothing unless `--force` is given, which publishes a patch. A Baseline that is a prerelease is the exception: `publish` promotes it, with or without `--force`, by publishing its numbers as a version that is not a prerelease. With `--prerelease`, `publish` publishes the prerelease `<version>-<n>` of the version it derives, `n` one above the highest such prerelease listed, or 0 when none is; with nothing changed over a Baseline that is a prerelease it does nothing unless `--force` is given, which publishes the next prerelease of the Baseline's numbers (see [Commands](packages/cli/README.md#commands) in the CLI README).

## Rules

### Elements

| Change | Class |
| --- | --- |
| Add an Endpoint, Event or Command | Additive |
| Mark an Element Deprecated | Additive |
| Bring a Deprecated Element back to Active | Neutral; any other change made with it is classified on its own |
| Retire an Element | Breaking (see [Retirement](#retirement)) |
| Bring a Retired Element back to Deprecated or Active | Additive, refused: the check fails; Retired is terminal |
| Delete the declaration of an Element Retired in the Baseline | Neutral: the Snapshot carries it forward as a tombstone |
| Change an Element Retired in the Baseline that is still declared Retired | Neutral: a Retired Element no longer works, so nothing reads what it declares, a shared schema it uses included |
| Delete an Element not Retired in the Baseline | Breaking, refused: the check fails |
| Reuse the identity of a Retired Element (an Endpoint's method and path; a Message's name and version) | Breaking, refused: the check fails. A new Message Version of a Retired one is not a reuse |
| Move an Endpoint's path or method | A new Endpoint plus the retirement of the old one |
| Rename an Endpoint (its `name`; method and path unchanged) | Breaking on a Public or Internal Endpoint, since Callers' generated code uses the name and Dependencies record it. Neutral on a Private one. The Visibility the Baseline had decides, since only its Callers knew the old name; the bump follows the wider of the two |
| Make a Breaking Change to an existing Message Version other than retiring it or narrowing its Visibility | Breaking, refused: the check fails (see [Messages](#messages)) |
| Turn a Command into an Event, or the reverse | A new Message, under a new name, plus the retirement of the old one: a name belongs to one kind across the whole Contract and its history |
| Add an Endpoint that takes a URL routing sent to an existing Endpoint of the same method (`/orders/latest` next to `/orders/:id`) | Breaking on the existing one, whose Input loses that value; the Change names the Endpoint that takes it (routing precedence is in [Over HTTP](ARCHITECTURE.md#over-http) in ARCHITECTURE.md). Which values a param's schema accepts is not read: `/orders/latest` takes from `/orders/:id` even when `id` is a uuid. A Retired Endpoint that is still declared shadows too, but is never shadowed, since it has no Input to lose; deleting it is Neutral. Routes outside the Contract are not seen (see [Endpoints](ARCHITECTURE.md#endpoints) in ARCHITECTURE.md) |
| Widen Visibility (Private → Internal → Public) | Additive |
| Narrow Visibility (Public → Internal, Internal → Private, Public → Private) | Breaking, since a Dependency may lose reach (which Elements a Service or an Application may depend on is in [Dependencies](ARCHITECTURE.md#dependencies) in ARCHITECTURE.md). No Deprecation needed, since the Element stays Active |

### Fields

Every shape is read in one of three Positions:

- **Input**: the Caller writes, the Service reads. Breaking is whatever makes the Service accept less.
- **Success**, and a Rejection's body: the Service writes, the Caller reads. Breaking is whatever makes the Service guarantee less.
- **Message**: written at one time and read at another by any Release: old or new publisher, old or new Subscriber, queued or replayed. A Message change takes the stronger of the Input and Success classes.

Readers of a Read shape (a Success, a Rejection body or a Message body) ignore fields they do not know. Objects are open: a Contract declares no strict object (see [Not allowed](SNAPSHOT.md#not-allowed) in SNAPSHOT.md). Headers follow one more rule (see [Headers, path and query](#headers-path-and-query)).

| Change | Input | Success | Message |
| --- | --- | --- | --- |
| Add a required field | Breaking | Additive | Breaking |
| Add an optional field | Additive | Additive | Additive |
| Optional → required | Breaking | Additive | Breaking |
| Required → optional | Additive | Breaking | Breaking |
| Remove a field | Additive | Breaking | Breaking |
| Remove a key from a record keyed by an enum or literal | Breaking | Breaking | Breaking |
| Rename a field | A removal plus an addition | | |
| Change a type (object ↔ record and array ↔ tuple included) | Breaking | Breaking | Breaking |
| Add nullability | Additive | Breaking | Breaking |
| Remove nullability | Breaking | Additive | Breaking |

### Enums, literals and unions

An Open Enum gives its readers a type with an Unknown case, so they must handle values they do not know. Its writers' type only admits the declared values. Openness only matters to readers that do not control the schema, Callers and Subscribers: in Input the Service is the reader and validates the declared values only, so openness has no effect there. Closed enum → Open Enum is Breaking for readers even though it changes no value: it is what lets values be added later as Additive Changes, which readers deployed with the closed enum would fail on. When one change both adds values and opens or closes an enum, the values added are judged by the Baseline's openness, which its deployed readers hold.

| Change | Input | Success | Message |
| --- | --- | --- | --- |
| Closed enum: add a value | Additive | Breaking | Breaking |
| Closed enum: remove a value | Breaking | Additive | Breaking |
| Open Enum: add a value | Additive | Additive | Additive |
| Open Enum: remove a value | Breaking | Additive | Breaking |
| Closed enum → Open Enum | Neutral | Breaking | Breaking |
| Open Enum → closed enum | Neutral | Additive | Additive |
| Change a literal | Breaking | Breaking | Breaking |
| Widen (literal → enum containing it, enum → its base type) | Additive | Breaking | Breaking |
| Narrow (base type → enum, enum → literal) | Breaking | Additive | Breaking |
| Discriminated union: add a variant | Additive | Breaking | Breaking |
| Discriminated union: remove a variant | Breaking | Additive | Breaking |
| Discriminated union: change inside a variant | Field rules, matching variants by discriminator value | | |
| Discriminated union: rename the discriminator, change a variant's value, or turn it into a plain union | Breaking | Breaking | Breaking |
| Plain union or tuple: any change | Breaking | Breaking | Breaking |

A union of literals is an enum (see [Schemas](SNAPSHOT.md#schemas) in SNAPSHOT.md), and a literal is compared as a closed enum of its one value. Prefer enums and discriminated unions: a change inside a plain union cannot be proven compatible.

### Constraints

Constraints are `min`, `max`, `exclusiveMin`, `exclusiveMax`, item counts, `int`, `multipleOf`, `format` with its options, and `regex`; an exact length is `min` equal to `max`. Each is compared on its own: `min` and `exclusiveMin` are one lower bound, and `max` and `exclusiveMax` one upper bound (see [Schemas](SNAPSHOT.md#schemas)); whether one `multipleOf` is a multiple of another is judged exactly, on its decimal digits. When one constraint tightens and another relaxes, together the Changes are Breaking in every Position.

| Change | Input | Success | Message |
| --- | --- | --- | --- |
| Tighten, or add where there was none (`min: 5` → `exclusiveMin: 5` tightens; so does `multipleOf` moving to a multiple of the old value) | Breaking | Additive | Breaking |
| Relax, or remove (`multipleOf` moving to a divisor of the old value relaxes) | Additive | Breaking | Breaking |
| Replace a format, its options or a regex with a different one, or move `multipleOf` to a value that is neither a multiple nor a divisor of the old | Breaking | Breaking | Breaking |

### Records, arrays, tuples, intersections, recursion, opaque data

- A record's value and an array's items follow the field rules; a record's key schema and an array's item counts follow the constraint rules. A `z.record()` keyed by an enum or literal is compared as the strict object it is stored as, every key a required field, and `z.partialRecord()` as one whose keys are optional (see [Schemas](SNAPSHOT.md#schemas)); removing a key is Breaking in every Position (see [Fields](#fields)).
- A tuple's `rest` schema is compared like an array's items: its type under the field rules, its constraints under the constraint rules. Adding or removing `rest` is Breaking. A tuple's `items` follow the plain-union rule.
- An intersection of objects is compared as the one object it amounts to (which intersections are allowed is in [Schemas](SNAPSHOT.md#schemas)). An intersection with anything else follows the plain-union rule: any change is Breaking.
- A recursive schema is compared by following its `ref`s into each Snapshot's `defs`, as if written inline (see [Recursion](SNAPSHOT.md#recursion)): a def's name is not part of its shape, and a pair of schemas met again within the same schema compares no further. Under the plain-union rule, renaming a def or pointing a `ref` at another def is a change.
- `z.json()` is an opaque JSON value: any change to or from it is Breaking.

### Bodies, Success status and headers

- Changing a Success's status, or whether it has a body (204 or not), is Breaking: Callers may depend on either.
- Adding an Input body is Breaking, since a Caller that sends none is refused as malformed, even when every field of the body is optional; removing one is Additive, since the Service no longer reads it (see [Over HTTP](ARCHITECTURE.md#over-http) in ARCHITECTURE.md).
- A Success's headers are an open object compared under the Success column of the tables above; their schemas may only be the types that travel as text (see [Headers, path and query](#headers-path-and-query)).

### Headers, path and query

- Input headers and query params are the Endpoint's own plus every attached Guard's demands: one required by either is required, and two declarations of the same name with different shapes (see [Neutral](#neutral)) fail `generate`. Header names are compared lower-cased, and a header object, Input or Success, and the merged query are always open (a record keyed by an enum or literal is Not allowed as either). A Guard demands no body (see [Guards](packages/contract/README.md#guards) in the contract README).
- Adding an Input header, optional on the Endpoint or demanded by a newly attached Guard, is Additive only when its schema accepts every text value: a string with no format, regex, min, max or enum. With any other schema it is Breaking, because header names are shared with proxies, gateways and browsers, which may already send one with a value the schema refuses. A required header follows the field rules.
- A path param is part of the path: adding or removing one moves the Endpoint. Its name is not: `/orders/:id` and `/orders/:orderId` are the same path. Renaming the param is Additive on every Visibility: the URL is the same, params are matched by position, and Dependencies do not record param names. Its type and constraints follow the rules above.
- Path params, query params and headers, a Success's included, travel as text (see [Over HTTP](ARCHITECTURE.md#over-http) in ARCHITECTURE.md), so their schemas may only be strings, numbers, booleans, literals and enums, and for query params arrays of those. Changing a param between a single value and a list is a type change.

### Guards

- An Endpoint's Input includes its Guards' demands (above) and its Rejections include those of every Guard it attaches.
- A Guard an Endpoint lists because a listed Guard names it (see [Guards](packages/contract/README.md#guards) in the contract README) is attached like any other, by the rules below.
- Attaching a Guard follows the Input rules for what it demands (a required demand is Breaking; a header, the header rule above) and the Rejection rules for its Rejections; a Guard gaining a Rejection is Additive; detaching a Guard follows the same rules (usually Additive).

### Neutral

Descriptions, examples, a Rejection's message, key order, an Endpoint's `deprecatedAt` (see [Endpoints](SNAPSHOT.md#endpoints) in SNAPSHOT.md), which Guard demands a header or query param (only its effect is compared), the Context a Guard provides (only the Service's own Handlers read it), a node's `origin` (see [Origin](SNAPSHOT.md#origin) in SNAPSHOT.md), a Guard's `guards`, a Guard's `qualifier` and the Qualifier an Endpoint attaches a Guard with (who is admitted is the GuardHandler's decision, which the Check never judged; a change shows in the committed Snapshot's diff), moving an Element or a Subscription between Groups or renaming a Group, and the order of an Endpoint's Guards, within what their `guards` allow. Transport headers on a Message are not part of the Contract (see [Publishing and sending](packages/messaging/README.md#publishing-and-sending) in the messaging README). For Dependencies and Subscriptions see [below](#dependencies).

### Not allowed in a Contract

A Contract describes shapes, not behavior. Only the nodes and checks listed in [Schemas](SNAPSHOT.md#schemas) are allowed; `generate` fails on anything else, defaults, transforms, refinements, coercion and custom validation included (see [Not allowed](SNAPSHOT.md#not-allowed) in SNAPSHOT.md).

### Rejections

| Change | Class |
| --- | --- |
| Add a Rejection to an Endpoint | Additive: Rejection codes are open for Callers, so a client built before the code existed receives it as a Rejection with an unknown code and takes its default case |
| Remove a Rejection from an Endpoint | Additive: a Caller is left with a dead case, never a failing one |
| Rename a code on an Endpoint | A removal plus an addition |
| Change the HTTP status of a code | Breaking |
| Change a Rejection's body | Same rules as a Success: removing a field is Breaking, since a Caller handling that Rejection reads it |
| Change a Rejection's message | Neutral: the message is text, not Contract |

Codes:

- A code has one HTTP status and one body shape across the whole Contract, Guards and imported Definitions Packages included; two declarations with different shapes (see [Neutral](#neutral)) fail `generate`.
- A Rejection's status is 4xx, except the not-implemented Standard Rejection, which is 501; `generate` fails on any other.
- The Snapshot remembers every code that ever existed in the Contract; a removed code declared again is compared with the status and body it last had, as a kept code is: another status is Breaking, and its body follows the rules of a Success.
- Codes cf-loom answers outside the Contract are reserved, and no Contract or Definitions Package may declare them; they travel as Faults and are listed in [Over HTTP](ARCHITECTURE.md#over-http) in ARCHITECTURE.md. A new reserved code only comes with a cf-loom major.

Standard Rejections:

- The invalid-input and not-implemented Rejections are implicit on every Endpoint, since cf-loom's runtime produces them. The not-found Rejection is listed in an Endpoint's `rejections` like any Rejection, so adding it later is Additive. Neither a Contract nor a Definitions Package may declare a Rejection with the code a Standard Rejection resolves to, from the listed Definitions Package or cf-loom's defaults; each Standard Rejection resolves to a code of its own, and the resolved codes count among the codes for the one-status rule above.
- A Definitions Package may declare the code, HTTP status and message of each Standard Rejection; without one, cf-loom's defaults apply, and the body of the invalid-input Rejection is always cf-loom's (see [Rejections](packages/contract/README.md#rejections) in the contract README). The Snapshot carries them resolved, so changing the Definitions Package or upgrading cf-loom shows up in the Compatibility Check.

### Messages

- A Message change takes the stronger of the Input and Success classes (see [Fields](#fields)).
- An existing Message Version never takes a Breaking Change other than its retirement or the narrowing of its Visibility: any other, a Breaking change to its body for one, is Breaking and refused: it fails the check, and no Breaking Change Approval allows it. The change is made as a new Message Version, which is Additive.
- A Message Version is its own Element, identified by name and version. Versions are numbered 1, 2, 3… without gaps. A Command has at most one Active version: adding a new one deprecates the previous one in the same change, or `generate` fails. `generate` judges the declared Message Versions: a version that is not a whole number from 1, a name and version declared twice, and a name declared as both an Event and a Command; `check` judges gaps and a name's kind against the Baseline, whose tombstones keep the Retired versions a declaration no longer lists: a Message Version added is Additive and refused when neither the Baseline nor the declared Snapshot holds the version before it of the same kind, and Breaking and refused when the Baseline holds its name as the other kind; with no Baseline, nothing is compared.

### Retirement

- Every Element must be Deprecated in the Baseline before it can be Retired; retiring one that is not is Breaking and refused.
- **Endpoint or Event:** Breaking, and needs a Breaking Change Approval: the check does not know who still calls the Endpoint or subscribes to the Event, a Public Endpoint's Callers with no Contract included. See also the deploy rule in [ARCHITECTURE.md](ARCHITECTURE.md#messages).
- **Command:** Breaking, but needs no Breaking Change Approval: a Deprecated Command is no longer sent, and the deploy rule drains its durable consumer before the Release that retires it deploys (see [ARCHITECTURE.md](ARCHITECTURE.md#messages)).

### Dependencies

Adding or removing a Dependency is Neutral: no Consumer relies on what a Service itself consumes.

### Subscriptions

Adding or removing a Subscription is Neutral, but a removed Subscription's name is never reused (Breaking and refused), a Subscription to an Event that is Retired fails `generate` (so a Service retiring an Event it subscribes to keeps that Subscription until the retiring Release, which removes it), and a Subscription's Event never changes, because the Releases running side by side share its durable consumer: changing it is Breaking and refused, so the check fails. A new name is a new Subscription, and the old one is removed. Moving to a new Message Version is a new Subscription next to the old one, and the old one is removed in a later Release. While both exist, the same fact arrives once per version, so their Handlers must recognize a fact already handled by its Fact id, not just a Message already received.

## Breaking Change Approval

- A Change's Verdict says what the check does with it. A Change is refused, whatever its class, where [Elements](#elements), [Messages](#messages), [Subscriptions](#subscriptions) and [Retirement](#retirement) say a Change is refused: it fails the check whatever Approval is given, and never moves the version past patch (see [Versioning](#versioning)). Of the others, Additive and Neutral Changes are allowed, and so is retiring a Command; every other Breaking Change needs an Approval.
- A Breaking Change on a Contract, on any Visibility, merges only with a Breaking Change Approval from an Approver of that Contract. The one exception is retiring a Command, which needs none (see [Retirement](#retirement)).
- cf-loom reports which Changes need an Approval, and the organization enforces it with its own review process, which decides who its Approvers are, whether an author may approve their own change, and whether a new commit needs a new Approval (required reviews, owners of `contract.snapshot.json`, dismissing approvals on new commits). `cf-loom check` prints every Change with its class and Verdict and exits 2 when one needs an Approval (see [Commands](packages/cli/README.md#commands) in the CLI README), so a CI job can, for example, require an Approver's Approval when it does.
- Publishing never depends on the Approval: a Breaking Change on a Public or Internal Element publishes as a major whether or not it had one, so the version tells the truth.
- A Definitions Package has its own Approvers. A Service adopting a new version runs its own Compatibility Check, with its own Approval if the change is Breaking on its Elements.
