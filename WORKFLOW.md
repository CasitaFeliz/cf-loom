# Workflow

How an issue becomes code on `main`: plan, implement, review, fix, merge. Code follows
[CODING_STANDARDS.md](CODING_STANDARDS.md); design decisions are the user's ([CLAUDE.md](CLAUDE.md#working-here)).
Each role is an agent defined in [`.claude/agents/`](.claude/agents); a definition names its model, or leaves it out
to run on the session's. The main session spawns an agent by name and passes what its definition lists.

## The unit of work

Each issue has its own plan. Issues that change the same code, or that depend on each other, may share one branch and
one PR, implemented together, while the PR stays one a reviewer can read whole; the others get a branch and a PR each. A
shared PR applies every rule below that names an issue to all its issues together: they are made ready, counted for the
Root-cause cap, held, reviewed, done and merged as one, and an issue they depend on among themselves needs no merge
first. An issue too large for one reviewable PR is split into issues before it is planned. A branch is named
`<type>/<issues>-<slug>`, the numbers of the issues it closes joined by hyphens (`feat/6-zod-walker`,
`feat/178-179-180-definitions`); its PR title is a Conventional Commit, typed by its weightiest change (`feat` over
`fix` over `refactor`) with `!` when any issue breaks, and its body says `Closes #<issue>` for each issue, links the
plans and says what changed.

## Required reading

Every session and agent working on an issue reads these before it starts:

| Role | Reads |
| --- | --- |
| Every role | [CLAUDE.md](CLAUDE.md), [CONTEXT.md](CONTEXT.md), [CODING_STANDARDS.md](CODING_STANDARDS.md), [Rules for every agent](#rules-for-every-agent) |
| Planner | The issue and every document it implements |
| Implementer | This document, the plans, and every document they link |
| Reviewer | The plans, the PR, and the documents its lens checks ([Review](#3-review), [Documentation and chore issues](#documentation-and-chore-issues)) |

## Decisions

The main session asks the user only what changes a public API, a rule or what a document means; what puts a design
principle of [CLAUDE.md](CLAUDE.md#design-principles) in tension; what adds to or removes from v1; a must-fix or
should-fix left after round 2; an issue held after two Root-cause checks; and anything irreversible (a force push,
a publish, deleting what is not its own).

It decides the rest itself and lists what it decided on the plan or PR comment, where the user can overrule it:
internal names, what the documents or the standards already settle, the consequences of a decision already made,
conventional defaults, nits, finishing a round 2 that left only nits, starting the next plan, and deleting merged
branches and worktrees.

A question is asked only when the current issue's code depends on it; one that a later issue needs waits for that
issue. A plan puts at most about five questions to the user: more means the problem is not understood yet, and the
[Root-cause check](#root-cause-check) runs first. Each question is asked alone, with options, recommendation first,
and says in one line why it exists and what it blocks. Its options' previews show a concrete scenario (who breaks, and
how), and every fact an option depends on is marked as verified by a probe or not. One option always questions the
premise. Before 1.0 the recommendation is the fix at the level of the cause, breaking or not; documenting a
limitation is never the recommended option.

## Root-cause check

A `cf-root-cause` agent finds the cause before the user sees options. It runs when:

- a second fix lands on the same area or the same kind of defect in one issue;
- the user rejects every option offered;
- a plan, a vetter's patch, a fix or a decision (the main session's or a root-cause agent's) adds, to cf-loom or to
  the repository's own tooling and tests, a config option, a safeguard, a special case, a second name for a concept
  that already exists, or a second statement of something cf-loom already decides or derives (at the type level, in a
  fake, in root tooling, as a second table, list or pass, or a document defining a term again), unless one is derived
  from the other or a test compares the two over their whole domain;
- a finding is the consequence of an earlier decision;
- a reviewer marks a finding a class or Escalate, or a fixer stops on a possible class.

Its prompt states the symptom in neutral words and the history of the attempts, never a proposed fix. The agent
reproduces each symptom, looks for every instance of the same kind, and names the design-level cause before it
proposes anything: a missing concept, a concept in two places, reimplementing what a dependency owns, or a boundary in
the wrong place. It says whether a documented decision causes it, and offers two or three fixes at the level of the
cause, each with the symptoms it removes and its cost. The main session runs it on Fable when the cause may touch a
glossary concept or a public API an organization implements, and then asks or decides as [Decisions](#decisions) says.

A trigger that a plan, a vet or a finding names runs before the approval or the fix; it is never deferred to review
and never waived by an argument, only by the user, as a question. A decision that accepts a special case, a safeguard
or a copy is never left for the user to overrule later: it runs the check or goes to the user.

The agent prototypes the option it recommends and runs on it the reproductions and every instance found. The main
session adopts a recommendation only when every unverified fact it rests on has been probed, or is put to the user
marked unverified; that fact becomes the plan's first failing test. The invariant the adopted option establishes is
written in the package's ARCHITECTURE.md, with a randomized or exhaustive test, in the same PR. When a check reverses a plan
decision that other decisions rest on, or an earlier check's option, the plan is rewritten and vetted again before
more code is written.

An issue gets at most two Root-cause checks, plan and review together; one run covers every trigger raised at once. When
a third would trigger, the issue is held for the user with its state and what is still open, findings or questions, and
the main session moves on to the next issue that does not depend on it. A must-fix in an area that has already been
through two Root-cause checks holds the issue for the user the same way. The user then decides as after round 2
([Fix](#4-fix)): fix and merge, rework the plan, or split the issue (only the last two before a PR exists).

## 1. Plan

A `cf-planner` agent writes the plan from the issue's problem and constraints; the main session never prescribes the
API in its prompt. The plan is one file per issue, rewritten in place when a decision changes it, and its text is the
plan comment on the issue:

- the problem first: the need in the user's terms, before any API, and the existing concept that already covers it,
  if one does;
- what v1 needs, and the smallest version that serves it;
- the public API: signatures with their TSDoc;
- every file, with its one responsibility;
- its inputs and invariants, each part where it applies:
  - each value the change reads that it did not build (a request, a Message, a file, a generated file, an option, what
    a hook or a Broker returns), with the cases its tests cover: malformed, absent, wide and deep, a name every object
    already has, a throw, rejection or hang from what it calls, and what the platform does by default; or why a case
    does not apply;
  - for code that reads a structure whose size an author or a Caller controls: its bound in time, memory and output
    size against each dimension (depth, width, sharing, count), each covered by a growth test
    ([C30](CODING_STANDARDS.md#tests));
  - the invariants the code must hold (every generated identifier is valid and distinct in its scope), each covered by
    a randomized or exhaustive test whose generator draws what the public API lets an author or a Caller produce,
    including every case where the rule acts and every kind of node the format holds (asserted by the test), checked
    against an independent oracle where one exists; the plan states what the generator leaves out;
  - for each public type, type parameter or parameter whose type it adds or changes, its type promise: the rows that
    must not compile and those that must, each a type test through the public entry point, always including `any`,
    `never`, `unknown`, each type parameter's default, a union, a widened literal, a variable upcast to the shape, a
    missing optional field and a generic wrapper; a row the mechanism cannot refuse is listed outside the promise, and
    no document promises more; the key set of each public record it adds or renames is one row
    ([C26](CODING_STANDARDS.md#tests));
  - when one rule applies to many sites (parameters, records, reads), a test that lists the sites from the code, never
    a hand-written list;
- the test list: plain-English names, each through a public seam (C23);
- the document sections it implements, linked, and every change it makes to them;
- the new terms it adds to [CONTEXT.md](CONTEXT.md), and their existing uses in the documents, which the same PR
  spells as [CLAUDE.md](CLAUDE.md#documents) says;
- every name, option, command, behavior or term it removes, renames or narrows, and each line of the documents and
  TSDoc that states it, found by searching the whole repository, not only the sections it implements;
- when the issue fixes a defect, every other instance of its kind across the packages, each in scope or a follow-up;
- what it leaves out on purpose, each gap with the issue that holds it, an existing one or one opened before the
  approval; a rule that judges what an earlier run, publish or version left behind names the record it reads, or
  lists every input that can change between the two runs;
- what the documents already settle that the issue relies on, kept apart from what is new;
- the decisions the main session took itself, and the questions for the user ([Decisions](#decisions)).

A `cf-plan-vetter` agent reads the plan before the user does. It states the problem and sketches its own answer before
it reads the planner's, its own inputs and invariants among it; probes every fact a decision rests on, checking that
each probe's or oracle's pool holds the cases the decision changes; checks every option against the design principles; and
sorts each question into settled by the documents, a decision for the user, or an implementation detail. The user then
approves the plan or corrects it. Nothing is implemented before the approval.

## Definition of Ready

An issue is ready to code when all of these hold. The main session checks every other item before it asks for the
approval, which completes the Definition of Ready, and says so on the plan comment:

- [ ] the user approved the plan on the issue;
- [ ] the plan was vetted, and every Root-cause check it triggered has run;
- [ ] the public API is fixed: signatures and TSDoc;
- [ ] every file is named, with one responsibility each;
- [ ] the test list covers every behavior the issue asks for, each test through a public seam;
- [ ] its inputs and invariants are listed as [1. Plan](#1-plan) says, with every item the vet's own list found missing;
- [ ] what it removes, renames or narrows was searched across the repository, and every gap it leaves out is an issue;
- [ ] the document sections it implements are linked, and every change to them is written in the plan;
- [ ] its new terms are in the plan's CONTEXT.md changes;
- [ ] what the documents already settle is listed apart from what is new;
- [ ] no design question is open;
- [ ] every issue it depends on is merged to `main`, or shares its PR.

## 2. Implement

A `cf-implementer` agent implements the plan, or the plans of a shared PR one issue after another in dependency
order, in its own git worktree, test first. For each test in its plans it writes
the test and sees it fail, writes the least code that passes, refactors to the standards, and commits. Its report
quotes each test's failing run. The documents change in the same PR as the code that makes them true (C22).

When the agent meets something the plan did not settle (a design question, a document that disagrees, an API the plan
did not foresee), it commits what passes and stops. The main session decides or asks as [Decisions](#decisions) says,
rewrites the plan with the answer, and resumes the same agent.

Before handing back, the agent runs `pnpm test` and `pnpm check`, pushes the branch and opens the PR.

## 3. Review

Once `pnpm build`, `pnpm test` and `pnpm check` pass locally, `cf-reviewer` agents read the whole PR in parallel, one
lens each, the three lenses of C27. A PR that changes fewer than about 400 lines, added and deleted, generated files
and `pnpm-lock.yaml` left out, gets one reviewer with all three lenses.
[`.claude/workflows/review-pr.js`](.claude/workflows/review-pr.js) runs the round.

| Lens | Checks |
| --- | --- |
| Design | Modules, seams, names, types: C1–C21 and C29 |
| Fidelity | The code against the plans; CONTEXT.md, COMPATIBILITY.md, SNAPSHOT.md, the ARCHITECTURE.md files and the READMEs (C22); the documents' use of the glossary's terms ([CLAUDE.md](CLAUDE.md#documents)) |
| Correctness | Bugs, the plan's edges and the ones it left out, growth at two sizes, probes, and the tests: C23–C26 and C30 |

Each finding gives its severity (must-fix, should-fix, nit), file and line, rule, evidence and fix, and three more
fields: **Kind**, a slip or one instance of a class, with the other instances found; **Cause**, why the code came out
this way (a gap in the plan, a missing concept, a misread document); and **Escalate**, yes when its fix would add a
special case or the area was fixed in an earlier round.

The main session merges the reports, removes duplicates, checks each finding against the code and sorts them in C27's
order. A finding that triggers the [Root-cause check](#root-cause-check) waits for it before it is fixed. An Escalate
finding waits for its check, except when its fix only deletes code in favor of an owner the code or the documents
already name, or changes only tests or documents: the round comment then marks it **skipped (deletion only)** or
**skipped (tests or documents only)**. Any other skip is a question to the user, and an Escalate finding on an issue
that already used its two checks holds it. Once the round's fixes are pushed, it posts
one comment on the PR for the round, listing every finding by lens as **fixed**, **asked** (with the user's answer) or
**dismissed** (with the reason).

## 4. Fix

A defect with one evident fix is fixed without asking, removing before adding (C28). A finding that would change a
public API, a rule or what a document means is put to the user. A `cf-fixer` agent, or the resumed implementer, fixes
the findings with the user's answers; it writes a failing test for each bug before fixing it, then runs `pnpm test`
and `pnpm check` and pushes. When a fix lands on an area this PR already fixed, needs a special case, or adds a second
table, list, pass or check for what the code already decides, it stops and
reports a possible class instead.

Round 1 is the first review. Round 2 is one `cf-rechecker` agent, which reads the whole PR with every round's
findings and fixes: it checks each fix and looks for regressions, and says whether successive fixes in one area show a
missing concept, which goes to the Root-cause check. When round 2 finds nothing, or only nits, the nits are fixed and
the PR is done. When it finds a must-fix or a should-fix, the main session brings the state to the user, who decides
to fix and merge, rework the plan, or split the issue.

## Definition of Done

A PR is done when all of these hold; the main session checks them and lists them in the last round's comment:

- [ ] every test in every plan of the PR exists and passes;
- [ ] `pnpm build`, `pnpm test` and `pnpm check` pass locally on the PR's head, and actionlint too when the PR
      changes `.github/workflows/`;
- [ ] the last review round found nothing to fix but nits, now fixed, or the user decided to merge after round 2;
- [ ] every finding of every round is marked fixed, asked or dismissed on the PR, and every Escalate finding checked,
      skipped for one of the two reasons of [Review](#3-review), or asked;
- [ ] the documents changed in the same PR, and every README matches its package's public API;
- [ ] a PR that changes a package carries a changeset (see [.changeset/README.md](.changeset/README.md));
- [ ] no `TODO` is left without a linked issue;
- [ ] each issue's plan comment matches what was built.

## 5. Merge

A done PR is squash-merged without asking and without waiting for CI: the subject is the PR title with `(#<PR>)`, the
branch is deleted and the issue closes. The user's standing approval covers pushing an issue's branch and this merge;
a force push waits for the user, and so does the merge after round 2 found a must-fix or a should-fix ([Fix](#4-fix)).
A CI failure on `main` is fixed before the next merge.

## 6. Next

After a merge, the main session starts the next issue in milestone order without asking. Issues that do not depend on
each other may be planned in parallel, and implemented in parallel when their plans share no code file: documents (`*.md`) and `index.ts` export files may be
shared, code, tests, generated files and `pnpm-lock.yaml` may not. A PR whose base moved gets `main` merged into its
branch, a plain push, and `pnpm build`, `pnpm test` and `pnpm check` run again; when the merge touched a file the PR
changes, a short recheck reads the merge before it merges. At most four agents build or run tests at once, since more
have brought the machine down.

## Milestone sweep

When a milestone's last issue merges, a sweep reads the whole repository, not a diff: every rule and fact in one
place (C1), duplication across packages, every document against the code, and whether each feature is still worth
its cost for v1. Its findings, each verified by a second agent, become issues of the next milestone.

## Documentation and chore issues

An issue that changes only documents or configuration keeps the plan, the Definition of Ready, the fix loop, the
Definition of Done and the merge, without the items that do not apply (a public API, a test list). The main session
makes the change itself, since it holds the design context, and one `cf-doc-reviewer` agent reads the PR for
fidelity, consistency across the documents, and links, and follows every procedure the PR adds or changes as a reader
would; a mechanical change (a rename, a find and replace) gets the
same reviewer on Sonnet. The main session fixes the findings, and the same reviewer reads the whole PR again each
round, at most two rounds. The reviewer reads once the change passes locally.

## Rules for every agent

- Work only in the worktree or the directories the prompt names; never edit the main checkout.
- Probes and scratch files go under the scratchpad directory the prompt names, or a directory of your own from
  `mkdtemp`. Delete only the directories you created, by name, never by a glob.
- A server you start listens on port 0 on 127.0.0.1. Never use another process's port, the user's registry
  (127.0.0.1:4873) or a NATS or moto server you did not start; tests that need NATS or moto start their own
  ([CLAUDE.md](CLAUDE.md#repository)).
- Never read or print `~/.npmrc`, environment variables or any file that holds credentials, and never publish except
  to a registry you started yourself.
- Never reach a real registry, even to read: `npm view`, `npm info`, `npx` and installing a tool all read the user's
  npm configuration. A probe that needs registry data uses a registry you started.
- Never use `git stash`: every worktree shares one stash list. Commit work in progress to your own branch instead.
- Stop only the processes you started, by their PID; never by a pattern (`pkill`, `killall`).
- Never load the machine on purpose to reproduce a timing failure; report it as a test that bounds time.
- Run commands with the Node and npm [CLAUDE.md](CLAUDE.md#repository) names first on `PATH`, as CI does.
- Commit, push or open a PR only when your role says so, with no attribution lines.

[`.claude/settings.json`](.claude/settings.json) denies reading `~/.npmrc` through Claude Code's file tools and running
`git stash`, `pkill`, `killall` and `npx`; a hook, `scripts/shared-state-commands.ts`, refuses the same commands
anywhere in a command line (`git -C <dir> stash`, after `&&`), and another, `scripts/one-question.ts`, refuses an
`AskUserQuestion` call with more than one question ([Decisions](#decisions)). The rest of these rules rest on the
agents.

## Changesets

When a PR carries a changeset is a rule of the repository ([.changeset/README.md](.changeset/README.md)).
While changesets wait on `main`, the [release workflow](.github/workflows/release.yml) keeps the PR
`chore: version packages` open (in pre mode its title ends in ` (rc)`); merging it publishes, and only the user
merges it.
