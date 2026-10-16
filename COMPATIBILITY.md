# Compatibility

How a Contract or a Definitions Package may change. Terms are defined in [CONTEXT.md](CONTEXT.md); the Snapshot the rules compare is specified in [SNAPSHOT.md](SNAPSHOT.md).

## The Compatibility Check

- Every change to a Contract is judged against its Baseline: the Snapshot of the highest published version of its Contract Package on the line being published (see [Choosing the Baseline](SNAPSHOT.md#choosing-the-baseline)), never a file in the Service repository.
- The Snapshot covers all three Visibilities and resolves every imported Guard and schema from its Definitions Package, so adopting a new Definitions Package version shows up as a change on the Elements that use it.
- A Definitions Package is checked against its own Baseline with the same rules. A shared schema has no position until an Element uses it, so each is judged in all three positions and takes the strongest class, strictness aside; a Guard's demands are judged as Input.
- Each difference is a Breaking, Additive or Neutral Change.
- With no Baseline (the first publish), only the shape rules are checked ([Not allowed in a Contract](#not-allowed-in-a-contract)); the package publishes as 1.0.0.

## Versioning

| Highest change on Public or Internal Elements | Contract Package bump |
| --- | --- |
| Breaking | major |
| Additive | minor |
| Neutral, or changes on Private Elements only | patch |

Private Elements are checked with the same rules, Breaking Change Approval included, because two Releases of the same Service run side by side; but they never move the version past patch: the version is a signal for Consumers, and Consumers cannot see Private Elements. When an Element's Visibility changes, the wider of the old and new Visibility decides the bump. An Application's Contract holds only Dependencies, so it only ever bumps patch.

The version also protects Consumers' installs: a Contract Package whose `@cf-loom/contract` peer moves to a new major is published as a major even when the Contract did not change, so a Consumer still on the old cf-loom major never installs it by accident. That major needs no Breaking Change Approval. When neither the Snapshot nor the peer ranges changed, `publish` does nothing unless forced.

## Rules

### Elements

| Change | Class |
| --- | --- |
| Add an Endpoint, Event or Command | Additive |
| Mark an Element Deprecated | Additive |
| Bring a Deprecated Element back to Active | Neutral; any other change made with it is classified on its own |
| Retire an Element | Breaking (see [Retirement](#retirement)) |
| Delete an Element present in the Baseline | Not allowed unless it is Retired in the Baseline; the Snapshot carries every Retired Element forward |
| Reuse the identity of a Retired Element (an Endpoint's method and path; a Message's name and version) | Not allowed: the check fails. A new Message Version of a Retired one is not a reuse |
| Move an Endpoint's path or method | A new Endpoint plus the retirement of the old one |
| Rename an Endpoint (its `name`; method and path unchanged) | Breaking on a Public or Internal Endpoint, since Callers' generated code uses the name, and the check lists every Dependency on it; Neutral on a Private one |
| Turn a Command into an Event, or the reverse | A new Message, under a new name, plus the retirement of the old one: a name belongs to one kind forever |
| Add an Endpoint whose literal path shadows an existing param path (`/orders/latest` next to `/orders/:id`) | Breaking on the param Endpoint, whose Input loses that value; the literal path wins when routing |
| Widen Visibility (Private → Internal → Public) | Additive |
| Narrow Visibility (Public → Internal, Internal → Private, Public → Private) | Breaking. No Deprecation needed, since the Element stays Active, but no Dependency may lose reach, and an Endpoint also needs a Breaking Change Approval |

### Fields

Every shape is read in one of three positions:

- **Input**: the Caller writes, the Service reads. Breaking is whatever makes the Service accept less.
- **Success**, and a Rejection's body: the Service writes, the Caller reads. Breaking is whatever makes the Service guarantee less.
- **Message**: written at one time and read at another by any Release: old or new publisher, old or new Subscriber, queued or replayed. A Message change takes the stronger of the Input and Success classes, except for object strictness, which has no effect because Message readers ignore unknown fields.

When the tooling cannot prove a change compatible, it is Breaking. There is no warning level.

Breaking means a deployed Consumer or Release can fail at runtime. A Consumer's code that stops compiling when it upgrades the Contract Package, such as an exhaustive `switch` over an enum that lost a value, is visible and opt-in, so it is not Breaking. The one exception is renaming an Endpoint, because Dependencies and generated clients are keyed by its name.

Readers of a Success, a Rejection body or a Message ignore fields they do not know. A strict object (`z.strictObject`) therefore only has an effect on Input, where the Service reads; any other object (`z.object`) is open.

| Change | Input | Success | Message |
| --- | --- | --- | --- |
| Add a required field | Breaking | Additive | Breaking |
| Add an optional field | Additive | Additive | Additive |
| Optional → required | Breaking | Additive | Breaking |
| Required → optional | Additive | Breaking | Breaking |
| Remove a field, open object | Additive | Breaking | Breaking |
| Remove a field, strict object | Breaking | Breaking | Breaking |
| Rename a field | A removal plus an addition | | |
| Change a type (object ↔ record and array ↔ tuple included) | Breaking | Breaking | Breaking |
| Add nullability | Additive | Breaking | Breaking |
| Remove nullability | Breaking | Additive | Breaking |
| Open → strict object | Breaking | Neutral | Neutral |
| Strict → open object | Additive | Neutral | Neutral |

### Enums, literals and unions

An Open Enum or Open Union gives its readers a type with an Unknown case, so they must handle values they do not know. Its writers' type only admits the declared values. Openness only matters to readers that do not control the schema, Callers and Subscribers: in Input the Service is the reader and validates the declared values only, so openness has no effect there. Closed → open is Breaking for readers even though it changes no value: it is what lets values be added later as Additive Changes, which readers deployed with the closed enum would fail on.

| Change | Input | Success | Message |
| --- | --- | --- | --- |
| Closed enum: add a value | Additive | Breaking | Breaking |
| Closed enum: remove a value | Breaking | Additive | Breaking |
| Open Enum: add a value | Additive | Additive | Additive |
| Open Enum: remove a value | Breaking | Additive | Breaking |
| Closed → open | Neutral | Breaking | Breaking |
| Open → closed | Neutral | Additive | Additive |
| Change a literal | Breaking | Breaking | Breaking |
| Widen (literal → enum containing it, enum → its base type) | Additive | Breaking | Breaking |
| Narrow (base type → enum, enum → literal) | Breaking | Additive | Breaking |
| Discriminated union: add a variant | Additive | Breaking | Breaking |
| Open Union: add a variant | Additive | Additive | Additive |
| Open Union: remove a variant | Breaking | Additive | Breaking |
| Discriminated union: remove a variant | Breaking | Additive | Breaking |
| Discriminated union: change inside a variant | Field rules, matching variants by discriminator value | | |
| Discriminated union: rename the discriminator, change a variant's value, or turn it into a plain union | Breaking | Breaking | Breaking |
| Plain union or tuple: any change | Breaking | Breaking | Breaking |

A union of literals is compared as an enum, and `T | null` as a nullable `T`, before these rules apply. Prefer enums and discriminated unions: a change inside a plain union cannot be proven compatible.

### Constraints

Constraints are `min`, `max`, `length`, item counts, `int`, `multipleOf`, `format` and `regex`.

| Change | Input | Success | Message |
| --- | --- | --- | --- |
| Tighten, or add where there was none | Breaking | Additive | Breaking |
| Relax, or remove | Additive | Breaking | Breaking |
| Replace a format or regex with a different one | Breaking | Breaking | Breaking |

### Records, arrays, intersections, recursion

- A record's value and an array's items follow the field rules; a record's key schema and an array's item counts follow the constraint rules. A `z.record()` keyed by an enum or literal requires every key in zod, so it is compared as an object whose keys are required fields; `z.partialRecord()` is the open form.
- An intersection of objects is compared as the one object it amounts to. An intersection with anything else follows the plain-union rule: any change is Breaking.
- A recursive schema (`z.lazy`) is compared by following its references.

### Success status

- Changing a Success's status, or whether it has a body (204 or not), is Breaking: Callers may depend on either.

### Headers, path and query

- Headers and query params are the Endpoint's own plus every attached Guard's demands: one required by either is required, and two declarations of the same name with different schemas fail the check. Header names are compared lower-cased, and the header object is always open. A strict query object applies to the merged set. A Guard never demands a body.
- A path param is part of the path: adding or removing one moves the Endpoint. Its name is not: `/orders/:id` and `/orders/:orderId` are the same path. Renaming the param is Breaking on a Public or Internal Endpoint, since Callers' code names it, and Neutral on a Private one. Its type and constraints follow the rules above.
- Path params, query params and headers travel as text; the tooling converts them to the declared type. Their schemas may only be strings, numbers, booleans, literals and enums, and for query params arrays of those. Changing a param between a single value and a list is a type change.

### Neutral

Descriptions, examples, titles, a Rejection's message, key order, which Guard demands a header or query param (only its effect is compared), the Context a Guard provides (only the Service's own Handlers read it), moving an Element between Groups or renaming a Group, a Service's Subscriptions to its own Events, the order of an Endpoint's Guards, and Dependencies.

### Not allowed in a Contract

A Contract describes shapes, not behavior. Only the constructs listed in [Schemas](SNAPSHOT.md#schemas) are allowed; generating the Snapshot fails on anything else. That excludes, among others, `.default()`, `.catch()`, `.transform()`, `.preprocess()`, `.pipe()`, `.refine()`, `.superRefine()`, `.check()`, `z.custom()`, `z.codec()`, `z.date()` (use `z.iso.datetime()`), `z.coerce.*`, `z.stringbool()`, `z.unknown()` and `z.any()` (use `z.record()` or `z.json()`), `.passthrough()`, `.catchall()` and `z.looseObject()` (use `z.record()` for dynamic keys).

### Rejections

| Change | Class |
| --- | --- |
| Add a Rejection to an Endpoint | Additive: Rejection codes are open for Callers, so a client built before the code existed receives it as a Rejection with an unknown code and takes its default branch |
| Remove a Rejection | Additive: a Caller is left with a dead branch, never a failing one |
| Rename a code | A removal plus an addition |
| Change the HTTP status of a code | Breaking |
| Change a Rejection's body | Same rules as a Success: removing a field is Breaking, since a Caller handling that Rejection reads it |
| Change a Rejection's message | Neutral: the message is text, not Contract |

- A code has one HTTP status and one body schema across the whole Contract, Guards and imported Definitions Packages included; two declarations that disagree fail the check.
- Codes cf-loom answers outside the Contract are reserved, and no Contract or Definitions Package may declare them: `RETIRED`, `NO_SUCH_ENDPOINT` and `BODY_TOO_LARGE`. A new reserved code only comes with a cf-loom major.
- The Snapshot remembers every code that ever existed in the Contract; redeclaring a removed code with another status or body is Breaking.
- Standard Rejections: the invalid-input and not-implemented Rejections are implicit on every Endpoint, and the not-found Rejection on every Endpoint with path params. Any other Endpoint may declare the not-found Rejection (for example for an id in the body), but no Contract may redefine a Standard Rejection.
- A Definitions Package may declare the code, HTTP status and message of each Standard Rejection; without one, cf-loom's defaults apply (`INVALID_INPUT` 400, `NOT_FOUND` 404, `NOT_IMPLEMENTED` 501). The body of the invalid-input Rejection (each refused field and why) is defined by cf-loom, whose runtime produces it. The Snapshot carries them resolved, so changing the Definitions Package or upgrading cf-loom shows up in the Compatibility Check.
- An Endpoint's Rejections include those of every Guard it attaches. Attaching a Guard that demands something new of the request is Breaking; a Guard gaining a Rejection is Additive; detaching a Guard follows the Input and Rejection rules (usually Additive).

### Messages

- A Message change takes the stronger of the Input and Success classes, strictness aside (see [Fields](#fields)).
- An existing Message Version never takes a Breaking Change other than its retirement or the narrowing of its Visibility. An incompatible change is a new Message Version, which is Additive.
- A Message Version is its own Element, identified by name and version. A name is either a Command or an Event across the whole Contract and its history. Versions are numbered 1, 2, 3… without gaps. A Command has at most one Active version: adding a new one deprecates the previous one in the same change, or the check fails.
- A Deprecated Event is still published until it is Retired, so Subscribers that have not moved on keep receiving it. A Deprecated Command is no longer sent, but its CommandHandler keeps running to drain what is already queued.

### Retirement

- Every Element must be Deprecated in the Baseline before it can be Retired.
- The check reads, for every Contract Package listed by the Contract directory, the highest published version of each of its live lines (the newest line and every line still tagged `line-<major>`) (see [ARCHITECTURE.md](ARCHITECTURE.md#dependencies)), Applications' included, and lists every Dependency on the Element. An incomplete directory fails the check rather than letting it pass.
- **Endpoint:** Breaking. No Dependency may use it, and it still needs a Breaking Change Approval, since a Public Endpoint may have Callers with no Contract.
- **Message:** Breaking, but needs no Breaking Change Approval; instead, no Dependency may use it. See also the deploy rule in [ARCHITECTURE.md](ARCHITECTURE.md).

### Dependencies

Adding or removing a Dependency is Neutral: no Consumer relies on what a Service itself consumes.

### Subscriptions

Adding or removing a Subscription is Neutral, but a removed Subscription's name is never reused, a Subscription to an Event that is Retired fails the check (so a Service retiring an Event it subscribes to removes that Subscription in the same Release), and a Subscription's Event and name never change, because the Releases running side by side share its durable queue: changing either fails the check. Moving to a new Message Version is a new Subscription next to the old one, and the old one is removed in a later Release. While both exist, the same fact arrives once per version, so their Handlers must recognize a fact already handled by its fact id, not just a Message already received.

## Breaking Change Approval

- A Breaking Change on a Contract, on any Visibility, merges only with a Breaking Change Approval from an Approver of that Contract, tied to the exact commit: a new commit after the approval needs a new one. The author of a change should not approve it, unless the Contract allows it, for example while one person works on it. The one exception is retiring or narrowing a Message, which is gated by its conditions instead.
- By default cf-loom only says which changes need an Approval: `cf-loom check` reports them and exits with a status of its own for "needs an Approval", distinct from a failed check, and the organization enforces the Approval with its own review process (required reviewers, owners of `contract.snapshot.json`, dismissing approvals on new commits).
- An organization that wants cf-loom to verify the Approval configures an approval source, which tells `check` who approved which commit. cf-loom then checks the commit, the configured Approvers and self-approval itself. cf-loom ships no default source.
- Publishing never depends on the approval: a Breaking Change on a Public or Internal Element that reaches the default branch still publishes as a major, so the version tells the truth.
- A Definitions Package has its own Approver. A Service is affected only when it adopts the new version; its own Compatibility Check then judges the change on its Elements, with its own Approval if Breaking.
