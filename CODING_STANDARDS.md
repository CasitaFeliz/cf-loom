# Coding standards

How cf-loom's code is written and reviewed. Rules marked **(lint)** are enforced by Biome and **(check)** by a script
(see [Mechanical and judgment](#mechanical-and-judgment)); the rest are judgment, exercised in review (C27). Terms are
defined in [CONTEXT.md](CONTEXT.md).

## Design

**C1. One rule, one place.** Before writing a check, find the code that already decides it: a predicate, a kind, a
Snapshot node, a wire rule. If one exists, call it; if none does, write it once in the package that owns the rule and
call it from every other place, across packages through that package's `./internal` export. *Why:* a rule implemented
twice drifts, and the second copy is where the next special case lands. A rule found in two places is a design bug to
report, never a third copy to add.

```ts
// bad: the server and the client each decide which statuses carry a Rejection
if (status >= 400 && status < 500) return decodeRejection(body);   // client
if (status >= 400 && status < 500) return encodeRejection(outcome); // server

// good: the wire rule lives once, in @cf-loom/contract's ./internal; both call it
export function isRejectionStatus(status: number): boolean
```

**C2. Fix by removing.** When a case is mishandled, first ask whether the model can make it impossible or ordinary;
delete the special case if it can. A special case is added only when no model change removes it, and the PR says
why. *Why:* each special case is a rule nobody wrote down, and they compound: the fifth fix cannot be understood
without the four before it.

```ts
// bad: a review found an optional array item, so a branch guards it
if (node.type !== 'object' && node.optional) return notAllowed(path, 'optional');

// good: only an object's field can be optional, so the type has nowhere to put it elsewhere
type Field = { readonly required: boolean; readonly schema: SchemaNode };
```

**C3. No fixed-point loops.** Nothing repeats "until nothing changes", cascades, or re-sorts what an earlier pass
placed, unless the design says so. If a pass seems to need a second one, stop and report: the order of the steps or
the model is wrong. *Why:* a loop that runs until stable hides which rule produced the result and makes every test
order-dependent.

```ts
// bad
let changed = true;
while (changed) changed = sortOnce(snapshot);

// good: each node is put in canonical form once, children before their parent
function canonical(node: SchemaNode): SchemaNode
```

**C4. Deep modules with small interfaces.** A module exports a few functions whose signatures say what they decide;
the work behind them stays private, however long. Six exported one-use helpers called in sequence by the caller are
the caller's body, not an interface. *Why:* a reader of the caller sees the decision, not its mechanics, and the
mechanics can change without touching anyone.

**C5. No shims for a compatibility nobody needs.** New code imports nothing from the code it replaces: move what it
needs into the new place and delete the old file. No re-export "kept for callers", no feature flag, no adapter from
the old shape, no `v2` beside a `v1`. *Why:* every caller of an internal is in this repository; a shim is a second
place for the same rule (C1) that outlives its reason.

What this repository does not hold alone changes only as its own rules say, never through a shim in the code: a
Contract, by [COMPATIBILITY.md](COMPATIBILITY.md); the Snapshot format, which the CLI reads in every version it ever
wrote ([SNAPSHOT.md](SNAPSHOT.md)); the Wire protocol ([ARCHITECTURE.md](ARCHITECTURE.md#wire-protocol)); and the
packages' public APIs, by semver through Changesets.

**C6. Split a file by responsibility, never by count.** A file holds at most 200 lines, blank lines not counted
**(lint)**; tests and generated files are exempt. When a file nears the cap, name the two responsibilities it holds
(walking a schema and checking what it allows, matching an Endpoint and converting its text) and give each its own
file with its own name; a file of one trivial function joins its caller. Never `part-1`, `-helpers`, `-utils`,
`-extra`. *Why:* the cap is a cohesion check, not a length check; a mechanical split keeps the tangle and hides it
across files.

When a file holds ONE responsibility and splitting it would only scatter that responsibility across files that import
each other, keep it whole and lift the cap for that file alone, with the reason on the directive: `// biome-ignore-all
lint/style/noExcessiveLinesPerFile: one responsibility: <what it is>; split, it crosses files both ways`. The reason
names the responsibility; "too long to split" is not one. A reviewer checks every such directive: it stays only if the
file really does one thing and reads top to bottom (C7). Raising the cap in `biome.json` is never the answer.

## Functions and control flow

**C7. A function reads top to bottom at one level of abstraction.** An orchestrating function names its steps and
calls them; a step does its work and no orchestration. A function body holds at most 30 lines, blank lines not counted
**(lint)**. A function that makes ONE decision too wide for the cap, such as an exhaustive `switch` over every zod
type (C16), keeps it whole with the reason on the directive, as C6 does for a file:
`// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one decision: <what it decides>`. *Why:* the reader
learns what happens from the orchestrator and how from the step, and never both at once.

```ts
// good
async function answer(endpoints: Endpoints, request: Request): Promise<Response> {
  const match = matchEndpoint(endpoints, request);
  if (match.kind === 'none') return noSuchEndpoint();
  const input = await readInput(match.endpoint, request);
  if (input.kind === 'invalid') return invalidInput(input.issues);
  const outcome = await runEndpoint(match.endpoint, input.value);
  return responseOf(match.endpoint, outcome);
}
```

**C8. Return early, nest nothing.** Guard clauses leave at the top; the main path runs unindented. No `else` after a
`return` **(lint)**, and the cognitive complexity ceiling of 15 holds **(lint)**. *Why:* every level of nesting is a
condition the reader carries to the end.

**C9. A line holds one step.** The formatter wraps at 100 characters; within that, break a long expression into named
intermediate values, never one line that filters, maps and decides. *Why:* a name on an intermediate value is the
comment the expression needed, and a diff on one step touches one line.

```ts
// bad
const codes = Object.values(snapshot.endpoints).flatMap((endpoint) => endpoint.rejections.map((code) => ({ code, status: snapshot.codes[code]?.status ?? 400 }))).filter((entry) => entry.status !== 501);

// good
const declared = Object.values(snapshot.endpoints).flatMap(rejectionsOf);
const resolved = declared.map((code) => resolveCode(snapshot.codes, code));
const businessCodes = resolved.filter(isBusinessRejection);
```

**C29. A read whose depth the author controls uses an explicit stack, never recursion.** A walk of zod schemas,
nested through defs, lazies or wrappers, of Snapshot nodes through `ref`s, of failure trees or of nested JSON keeps
the parts it has still to read in an array and loops over it, as `leadsBackWithNoNode` and `refusalsIn` do; a walk that
must return to a part after reading what it holds keeps one frame per part on that array, as the walker's driver
does. *Why:* the call stack is a few thousand frames, set by Node rather than by any rule of the Contract, so a read
that recurses fails a Contract the documents allow, at a depth that shifts with the shape and with the field order.

```ts
// bad
function reachedFrom(node: SchemaNode): readonly SchemaNode[] {
  return [node, ...refsOf(node).flatMap((ref) => reachedFrom(defs[ref.name]))];
}

// good
const pending = [node];
for (let next = pending.pop(); next !== undefined; next = pending.pop()) { … }
```

## Expressions and idioms

**C10. Filter with a type guard** **(lint)**. `.filter(isEvent)` with `function isEvent(message: Message): message is
Event`; never `flatMap((x) => cond ? [x] : [])`, never a `filter` followed by a cast. *Why:* the guard names the
subset and types it; the `flatMap` trick says neither.

```ts
// bad
const events = messages.flatMap((message) => (message.kind === 'event' ? [message] : []));

// good
const events = messages.filter(isEvent);
```

**C11. No nested ternary** **(lint)**. One ternary for a two-way value; an `if` chain or a `switch` over a closed
value for anything more. *Why:* a nested ternary reads differently to every reader.

```ts
// bad
const status = outcome.kind === 'success' ? outcome.status : outcome.kind === 'rejection' ? outcome.status : 500;

// good
function statusOf(outcome: Outcome): number {
  switch (outcome.kind) { … }
}
```

**C12. Plain loops over clever folds** **(lint)**. A `for` loop that pushes into a named array, or a `map`; never a
`reduce`. A `Map` is built from entries, not by mutation inside a fold. *Why:* a loop
shows its state; a fold hides it in the accumulator's shape.

## Naming

**C13. Names come from the vocabulary.** A thing is called what [CONTEXT.md](CONTEXT.md) calls it, in camelCase or
PascalCase: a Contract, an Element, an Endpoint, a Guard, an Outcome, a Rejection, a Fault, a Message Version, a Fact
id, a Subscription, a Snapshot, a Baseline; never a word CONTEXT.md lists under _Avoid_ as a name for that entry's own
thing (`request` is no violation in `HandledRequest`, which is no Command). A new concept gets its word in CONTEXT.md
with the change that introduces it. *Why:* one word per concept lets the code, the documents and the
people say the same thing.

**C14. No vague names.** Not `one`, `entry`, `item`, `common`, `data`, `info`, `result2`, `tmp`; a single letter only
inside a lambda of one expression **(lint)**, where an imported name keeps its library's spelling (`z`), `_` marks an
unused parameter and a `catch` binding may be `e`. A loop variable is the singular of its collection; a map is
`xById`; a derivation is `xOf(y)`; a predicate is `isX` or `hasX`. *Why:* a vague name sends the reader to the
declaration and back for every use.

```ts
// bad
for (const entry of endpoints) { const one = codes.get(entry.rejections[0]); … }

// good
for (const endpoint of endpoints) { const rejection = rejectionsByCode.get(endpoint.rejections[0]); … }
```

**C15. A name says the role, not the history.** No `new`, `old`, `legacy`, `fixed`, `real`, `actual` and no version
suffix in a name: when the old thing is gone (C5), the name is free. A Message Version's name in code
(`orderCreatedV2`) is the one exception, since its number is part of the Contract. A function that decides is named
for what it answers (`isRejectionStatus`, `statusOf`), one that acts for what it does (`writeSnapshot`, `applyPlan`).
*Why:* a name that refers to another version only means something while both exist.

## Types

**C16. Closed unions and an exhaustive `switch`.** Every decision on a kind, a node type, a Visibility or an Outcome
is a `switch` over a closed union, with no `default` that swallows a member: Biome fails when a member is missing
**(lint)**. A string that can take only a few values is a union of literals, never `string`; no TypeScript `enum`
(`erasableSyntaxOnly`). *Why:* adding a member then lists every place that must decide about it.

**C17. No boolean flag parameters** **(lint)** for an exported function. A caller passes a closed value that names the
mode, or calls a function named for it. A boolean belongs in data (`committed`, `retryable`) and in predicates, not in
a parameter that switches a function's behavior. *Why:* `generate(contract, true)` says nothing at the call site, and
a flag is a second function hiding in the first.

```ts
// bad
generate(contract, true);

// good
verifyGenerated(contract);   // or generate(contract, { mode: 'verify' })
```

**C18. Expected failures are values.** A failure the code expects (a construct the allow-list refuses, invalid
Input, a missing Durable consumer, a registry that cannot be reached) is a member of a closed union returned to the
caller and decided with a `switch` (C16); cf-loom adds no `Result` library, so its packages keep no runtime dependency
besides their peers. A `throw` is for a bug, with a message a developer reads. A user's Handler that throws is not a
bug of cf-loom: the runtime catches it and answers a Fault, as the design says. *Why:* a failure that throws is a
failure the caller cannot show the person who caused it.

```ts
type Walked =
  | { readonly kind: 'node'; readonly node: SchemaNode }
  | { readonly kind: 'not-allowed'; readonly path: Path; readonly construct: string };
```

**C19. A parameter object has a name and a responsibility.** A function takes at most three parameters **(lint)**: the
values it needs, or one object that is a thing of the domain (a matched Endpoint, a Baseline and its declared
Snapshot). A dependency object narrows what it takes (`Pick<BrokerConnection, 'publish'>`). A twelve-field options
bag handed through every function is a global under another name. *Why:* the signature is the function's contract; a
bag says the contract is "everything".

## Comments and docs

**C20. A doc comment is one or two sentences of why.** It sits above the declaration as TSDoc; no other comment but a
lint directive or a `TODO`. It says why the thing exists or what it decides, never what each line does, and never the
issue number. Every exported declaration carries TSDoc **(check)**, since its users read it in the editor. *Why:* the
what is the code; the why is the one thing it cannot say.

**C21. A comment that chains rules means the code does too much.** When a comment needs dashes, parentheses or a
third sentence to list the cases a function covers, split the function so each has a one-sentence reason. Simplify
the code, not the prose. *Why:* the chain is the design's complexity made visible; the fix is at the design (C2, C4).

```ts
// bad
/**
 * Decodes the response (a Success when the status is declared, unless the body fails its reader — then
 * INVALID_OUTCOME, committed 'yes' — or an envelope, else a Fault inferred from the status or the error).
 */

// good
/** The Outcome a Caller sees for one HTTP response. */
```

**C22. Documents describe what stands.** CONTEXT.md, COMPATIBILITY.md, SNAPSHOT.md, the ARCHITECTURE.md files and the
READMEs are updated by the change that makes them true, by theme, briefly, as [CLAUDE.md](CLAUDE.md) says; history and
reasoning that is not a design decision belong in the issue or the PR. *Why:* a document read against the code must
agree with it, or it is read against nothing.

## Tests

**C23. Behavior, through a public seam.** A test drives a package through its entries (`.`, its subpaths, or
`./internal` where another cf-loom package uses it, or where several of a package's commands share a step) and checks
what a user can see: a declaration's Snapshot, the `Response` `serve` answers, the Outcome a client returns, the exit
status of a command. It imports no private module and asserts no call order of mocks. *Why:* a test of
the mechanics fails on every refactor and passes on every bug.

**C24. A test's name states the behavior in plain English.** `"an optional path param fails generate"`, not
`"handles params"` or `"walk returns not-allowed"`. The `describe` names the seam; the `test` reads as a sentence
about the domain. *Why:* the failing test's name is the bug report.

**C25. Arrange, act, assert.** Three visible blocks, one behavior per test, fixtures from builders with sensible
defaults (`anEndpoint({ method: 'GET' })`), and one reason to fail. A focused or skipped test and a test without an
`expect` are errors **(lint)**. *Why:* a test read in a failure must say what was set up, what was done and what was
expected, in that order, without scrolling.

**C26. Test the compatibility we have, never one we do not.** Snapshots of every released format, the Wire protocol
and the public APIs are compatibility we have: their fixtures and tests stay. No test of a shim (C5), no "still
accepts the old shape" for a shape nothing released, no test that a private helper returns a value. A public record's
key set is pinned by one type test in its package's `types.test.ts`; a test never asserts the absence of one field.
*Why:* such a test pins the thing the next change must delete.

## Reviewing

**C27. A reviewer reads for the design first.** In this order: a rule in two places (C1); a special case the model
could remove (C2); a second pass or a cascade (C3); a function that cannot be read top to bottom (C7, C9); names (C13,
C14); a bag (C19); a comment that explains too much (C21). Then fidelity to the documents, then correctness. *Why:* a
correct patch on a wrong design is the next review's finding.

**C28. A fix removes before it adds.** A review finding is answered by deleting the cause where that is possible, by
changing the model where it is not, and by adding a branch only when both fail, with the reason in the PR. A fix meets
every rule here; a fix that needs a cascade or a shim is a design finding to report, not to land. *Why:* the fixes are
where the special cases came from.

## Mechanical and judgment

Biome enforces, as errors: the file cap of 200 lines (C6, `noExcessiveLinesPerFile`), the function cap of 30 lines
(C7, `noExcessiveLinesPerFunction`), `noUselessElse` and a cognitive complexity of 15 (C8,
`noExcessiveCognitiveComplexity`), `noNestedTernary` (C11), `useExhaustiveSwitchCases` (C16), at most three
parameters (C19, `useMaxParams`), and `noFocusedTests`, `noSkippedTests` and `useExpect` (C25). Blank lines do not
count toward either cap; tests and generated files are exempt from both. The formatter wraps lines at 100 characters
(C9). Type and import rules already configured in `biome.json` (`noExplicitAny`, `useImportType`, `noDefaultExport`,
naming conventions) apply as well.

The GritQL plugins in `lint/` add, as errors: a `flatMap` whose callback returns a conditional array (C10), `reduce`
and `reduceRight` (C12), a single-letter name outside a lambda of one expression, an import or a `catch` (C14), a
`boolean` parameter, by type or by default, of an exported function or arrow function (C17), and, under `walker/`, a
read of a getter zod derives from the schemas a schema holds (`_zod.propValues`, `values`, `optin`, `optout`), as a
member read, a destructuring or a cast of `_zod` (a name bound to `_zod` is out of reach), which reaches what the walk
has not judged (C1). `scripts/check-tsdoc.ts`
fails on an exported declaration in a package's `src` with no TSDoc directly above it (C20); `pnpm check` and CI run
it. `scripts/check-layout.ts` fails on a `src/` that breaks [Package layout](ARCHITECTURE.md#package-layout);
`pnpm check` and CI run it.

The rest stays judgment, and C27 is where it is exercised: the vague words of C14, every name of C15, a boolean
parameter of a function that is not exported or is exported through an `export { … }` list (C17), and whether a doc
comment says why (C20).
