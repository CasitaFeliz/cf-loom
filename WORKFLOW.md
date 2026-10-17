# Workflow

How an issue becomes code on `main`: plan, implement, review, fix, merge. Code follows
[CODING_STANDARDS.md](CODING_STANDARDS.md); design decisions are the user's ([CLAUDE.md](CLAUDE.md#working-here)).

## The unit of work

One issue is one branch and one PR. An issue too large for one reviewable PR is split into issues before it is
planned. A branch is named `<type>/<issue>-<slug>` (`feat/6-zod-walker`), its PR title is a Conventional Commit, and
its body says `Closes #<issue>`, links the plan and says what changed.

## 1. Plan

The main session reads the issue and the documents it implements and posts the plan as a comment on the issue:

- the public API: signatures with their TSDoc;
- every file, with its one responsibility;
- the test list: plain-English names, each through a public seam (C23);
- the document sections it implements, linked, and every change it makes to them;
- the new terms it adds to [CONTEXT.md](CONTEXT.md);
- its design questions, put to the user one at a time and answered in the plan.

The user approves the plan or corrects it. Nothing is implemented before the approval.

## Definition of Ready

An issue is ready to code when all of these hold; the main session checks them and says so on the plan comment:

- [ ] the user approved the plan on the issue;
- [ ] the public API is fixed: signatures and TSDoc;
- [ ] every file is named, with one responsibility each;
- [ ] the test list covers every behavior the issue asks for, each test through a public seam;
- [ ] the document sections it implements are linked, and every change to them is written in the plan;
- [ ] its new terms are in the plan's CONTEXT.md changes;
- [ ] no design question is open;
- [ ] every issue it depends on is merged to `main`.

## 2. Implement

An Opus agent implements the plan in its own git worktree, test first. For each test in the plan it writes the test
and sees it fail, writes the least code that passes, refactors to the standards, and commits. The documents change in
the same PR as the code that makes them true (C22).

When the agent meets something the plan did not settle (a design question, a document that disagrees, an API the plan
did not foresee), it commits what passes and stops. The main session puts the question to the user, updates the plan
comment with the answer, and resumes the same agent.

Before handing back, the agent runs `pnpm test` and `pnpm check`, pushes the branch and opens the PR.

## 3. Review

Once CI passes, three Opus reviewers read the whole PR in parallel, one lens each, in the order of C27:

| Lens | Checks |
| --- | --- |
| Design | Modules, seams, names, types: C1–C21 |
| Fidelity | The code against the plan, CONTEXT.md, COMPATIBILITY.md, SNAPSHOT.md, the ARCHITECTURE.md files and the READMEs |
| Correctness | Bugs, edge cases, probes, and the tests: C23–C26 |

The main session merges the three reports, removes duplicates and checks each finding against the code. It posts one
comment on the PR per round, listing every finding by lens as **fixed**, **asked** (with the user's answer) or
**dismissed** (with the reason).

## 4. Fix

A defect with one evident fix is fixed without asking. A finding that would change a public API, a rule or what a
document means is put to the user. The implementer agent is resumed with the findings to fix and the user's answers;
it writes a failing test for each bug before fixing it, then runs `pnpm test` and `pnpm check` and pushes.

After the fixes, the three lenses review the whole PR again. The loop ends when a round finds nothing to fix. When the
second round still finds something, the main session stops and brings the state to the user, who decides to merge as
it stands, rework the plan, or split the issue.

## Definition of Done

A PR is done when all of these hold; the main session checks them and lists them in the last round's comment:

- [ ] every test in the plan exists and passes;
- [ ] CI passes: Biome, the TSDoc check, `tsc -b` and Vitest;
- [ ] the last review round found nothing to fix;
- [ ] every finding of every round is marked fixed, asked or dismissed on the PR;
- [ ] the documents changed in the same PR, and every README matches its package's public API;
- [ ] no `TODO` is left without a linked issue;
- [ ] the plan comment matches what was built.

## 5. Merge

A done PR is squash-merged without asking: the subject is the PR title with `(#<PR>)`, the branch is deleted and the
issue closes. The user's standing approval covers pushing an issue's branch and this merge; a force push, and a merge
after the second round still found something, wait for the user.

## 6. Next

After a merge, the main session takes the next issue in milestone order, posts its plan and waits for the user's
approval.

## Documentation and chore issues

An issue that changes only documents or configuration keeps the plan, the Definition of Ready, the fix loop, the
Definition of Done and the merge, without the items that do not apply (a public API, a test list). The main session
makes the change itself, since it holds the design context, and one Opus reviewer reads the PR for fidelity,
consistency across the documents, and links.

## Changesets

No PR carries a changeset before the pilot. From the first release candidate on, every PR that changes a package
carries one ([CLAUDE.md](CLAUDE.md#repository)).
