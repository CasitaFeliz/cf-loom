# Workflow

How an issue becomes code on `main`: plan, implement, review, fix, merge. Code follows
[CODING_STANDARDS.md](CODING_STANDARDS.md); design decisions are the user's ([CLAUDE.md](CLAUDE.md#working-here)).
Each role is an agent defined in [`.claude/agents/`](.claude/agents); a definition names its model, or leaves it out
to run on the session's. The main session spawns an agent by name and passes what its definition lists.

## The unit of work

One issue is one branch and one PR. An issue too large for one reviewable PR is split into issues before it is
planned. A branch is named `<type>/<issue>-<slug>` (`feat/6-zod-walker`), its PR title is a Conventional Commit, and
its body says `Closes #<issue>`, links the plan and says what changed.

## Required reading

Every session and agent working on an issue reads these before it starts:

| Role | Reads |
| --- | --- |
| Every role | [CLAUDE.md](CLAUDE.md), [CONTEXT.md](CONTEXT.md), [CODING_STANDARDS.md](CODING_STANDARDS.md), [Rules for every agent](#rules-for-every-agent) |
| Planner | The issue and every document it implements |
| Implementer | This document, the plan, and every document the plan links |
| Reviewer | The plan, the PR, and the documents its lens checks ([Review](#3-review), [Documentation and chore issues](#documentation-and-chore-issues)) |

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
- a plan or a fix adds to cf-loom a config option, a rule whose only job is keeping two sources in step, a
  safeguard, a special case, or a second name for a concept that already exists;
- a finding is the consequence of an earlier decision;
- a reviewer marks a finding a class or Escalate, or a fixer stops on a possible class.

Its prompt states the symptom in neutral words and the history of the attempts, never a proposed fix. The agent
reproduces each symptom, looks for every instance of the same kind, and names the design-level cause before it
proposes anything: a missing concept, a concept in two places, reimplementing what a dependency owns, or a boundary in
the wrong place. It says whether a documented decision causes it, and offers two or three fixes at the level of the
cause, each with the symptoms it removes and its cost. The main session runs it on Fable when the cause may touch a
glossary concept or a public API an organization implements, and then asks or decides as [Decisions](#decisions) says.

An issue gets at most two Root-cause checks, plan and review together; one run covers every trigger raised at
once. When a third would trigger, the issue is held for the user with its state and what is still open, findings or
questions, and the main session moves on to the next issue that does not depend on it. The user then decides as after
round 2 ([Fix](#4-fix)): fix and merge, rework the plan, or split the issue.

## 1. Plan

A `cf-planner` agent writes the plan from the issue's problem and constraints; the main session never prescribes the
API in its prompt. The plan is one file per issue, rewritten in place when a decision changes it, and its text is the
plan comment on the issue:

- the problem first: the need in the user's terms, before any API, and the existing concept that already covers it,
  if one does;
- what v1 needs, and the smallest version that serves it;
- the public API: signatures with their TSDoc;
- every file, with its one responsibility;
- the invariants the code must hold (every generated identifier is valid and distinct in its scope), each covered by a
  randomized or exhaustive test;
- the test list: plain-English names, each through a public seam (C23);
- the document sections it implements, linked, and every change it makes to them;
- the new terms it adds to [CONTEXT.md](CONTEXT.md);
- what the documents already settle that the issue relies on, kept apart from what is new;
- the decisions the main session took itself, and the questions for the user ([Decisions](#decisions)).

A `cf-plan-vetter` agent reads the plan before the user does. It states the problem and sketches its own answer before
it reads the planner's; probes every fact a decision rests on; checks every option against the design principles; and
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
- [ ] the document sections it implements are linked, and every change to them is written in the plan;
- [ ] its new terms are in the plan's CONTEXT.md changes;
- [ ] what the documents already settle is listed apart from what is new;
- [ ] no design question is open;
- [ ] every issue it depends on is merged to `main`.

## 2. Implement

A `cf-implementer` agent implements the plan in its own git worktree, test first. For each test in the plan it writes
the test and sees it fail, writes the least code that passes, refactors to the standards, and commits. Its report
quotes each test's failing run. The documents change in the same PR as the code that makes them true (C22).

When the agent meets something the plan did not settle (a design question, a document that disagrees, an API the plan
did not foresee), it commits what passes and stops. The main session decides or asks as [Decisions](#decisions) says,
rewrites the plan with the answer, and resumes the same agent.

Before handing back, the agent runs `pnpm test` and `pnpm check`, pushes the branch and opens the PR.

## 3. Review

Once `pnpm build`, `pnpm test` and `pnpm check` pass locally, `cf-reviewer` agents read the whole PR in parallel, one
lens each, the three lenses of C27. A PR that changes fewer than about 400 lines, added and deleted, generated files
left out, gets one reviewer with all three lenses. [`.claude/workflows/review-pr.js`](.claude/workflows/review-pr.js)
runs the round.

| Lens | Checks |
| --- | --- |
| Design | Modules, seams, names, types: C1–C21 |
| Fidelity | The code against the plan; CONTEXT.md, COMPATIBILITY.md, SNAPSHOT.md, the ARCHITECTURE.md files and the READMEs (C22) |
| Correctness | Bugs, edge cases, probes, and the tests: C23–C26 |

Each finding gives its severity (must-fix, should-fix, nit), file and line, rule, evidence and fix, and three more
fields: **Kind**, a slip or one instance of a class, with the other instances found; **Cause**, why the code came out
this way (a gap in the plan, a missing concept, a misread document); and **Escalate**, yes when its fix would add a
special case or the area was fixed in an earlier round.

The main session merges the reports, removes duplicates, checks each finding against the code and sorts them in
C27's order. A finding that triggers the [Root-cause check](#root-cause-check) waits for it before it is fixed. Once
the round's fixes are pushed, it posts one comment on the PR for the round, listing every finding by lens as
**fixed**, **asked** (with the user's answer) or **dismissed** (with the reason).

## 4. Fix

A defect with one evident fix is fixed without asking, removing before adding (C28). A finding that would change a
public API, a rule or what a document means is put to the user. A `cf-fixer` agent, or the resumed implementer, fixes
the findings with the user's answers; it writes a failing test for each bug before fixing it, then runs `pnpm test`
and `pnpm check` and pushes. When a fix lands on an area this PR already fixed, or needs a special case, it stops and
reports a possible class instead.

Round 1 is the first review. Round 2 is one `cf-rechecker` agent, which reads the whole PR with every round's
findings and fixes: it checks each fix and looks for regressions, and says whether successive fixes in one area show a
missing concept, which goes to the Root-cause check. When round 2 finds nothing, or only nits, the nits are fixed and
the PR is done. When it finds a must-fix or a should-fix, the main session brings the state to the user, who decides
to fix and merge, rework the plan, or split the issue.

## Definition of Done

A PR is done when all of these hold; the main session checks them and lists them in the last round's comment:

- [ ] every test in the plan exists and passes;
- [ ] `pnpm build`, `pnpm test` and `pnpm check` pass locally on the PR's head, and actionlint too when the PR
      changes `.github/workflows/`;
- [ ] the last review round found nothing to fix but nits, now fixed, or the user decided to merge after round 2;
- [ ] every finding of every round is marked fixed, asked or dismissed on the PR;
- [ ] the documents changed in the same PR, and every README matches its package's public API;
- [ ] no `TODO` is left without a linked issue;
- [ ] the plan comment matches what was built.

## 5. Merge

A done PR is squash-merged without asking and without waiting for CI: the subject is the PR title with `(#<PR>)`, the
branch is deleted and the issue closes. The user's standing approval covers pushing an issue's branch and this merge;
a force push waits for the user, and so does the merge after round 2 found a must-fix or a should-fix ([Fix](#4-fix)).
A CI failure on `main` is fixed before the next merge.

## 6. Next

After a merge, the main session starts the next issue in milestone order without asking. Issues that do not depend on
each other may be planned in parallel, and implemented in parallel when their plans' file lists are disjoint,
generated files and `pnpm-lock.yaml` included. A PR whose base moved gets `main` merged into its branch, a plain push,
and `pnpm build`, `pnpm test` and `pnpm check` run again before it merges.

## Milestone sweep

When a milestone's last issue merges, a sweep reads the whole repository, not a diff: every rule and fact in one
place (C1), duplication across packages, every document against the code, and whether each feature is still worth
its cost for v1. Its findings, each verified by a second agent, become issues of the next milestone.

## Documentation and chore issues

An issue that changes only documents or configuration keeps the plan, the Definition of Ready, the fix loop, the
Definition of Done and the merge, without the items that do not apply (a public API, a test list). The main session
makes the change itself, since it holds the design context, and one `cf-doc-reviewer` agent reads the PR for
fidelity, consistency across the documents, and links; a mechanical change (a rename, a find and replace) gets the
same reviewer on Sonnet. The main session fixes the findings, and the same reviewer reads the whole PR again each
round, at most two rounds. The reviewer reads once the change passes locally.

## Rules for every agent

- Work only in the worktree or the directories the prompt names; never edit the main checkout.
- Probes and scratch files go under the scratchpad directory the prompt names, or a directory of your own from
  `mkdtemp`. Delete only the directories you created, by name, never by a glob.
- A server you start listens on port 0 on 127.0.0.1. Never use another process's port, the user's registry
  (127.0.0.1:4873) or a NATS server you did not start; tests that need NATS start their own
  ([CLAUDE.md](CLAUDE.md#repository)).
- Never read or print `~/.npmrc`, environment variables or any file that holds credentials, and never publish except
  to a registry you started yourself.
- Commit, push or open a PR only when your role says so, with no attribution lines.

[`.claude/settings.json`](.claude/settings.json) denies reading `~/.npmrc` through Claude Code's file tools; the rest
of these rules rest on the agents.

## Changesets

When a PR carries a changeset is a rule of the repository ([CLAUDE.md](CLAUDE.md#repository)).
While changesets wait on `main`, the [release workflow](.github/workflows/release.yml) keeps the PR
`chore: version packages` open; merging it publishes, and only the user merges it.
