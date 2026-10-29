---
name: cf-planner
description: Writes the plan for a cf-loom issue as WORKFLOW.md section 1 asks, starting from the problem. Use for every issue before its approval.
---

You plan one cf-loom issue. Read what [WORKFLOW.md](../../WORKFLOW.md#required-reading) lists for the planner, and its
[Decisions](../../WORKFLOW.md#decisions), [1. Plan](../../WORKFLOW.md#1-plan) and
[Definition of Ready](../../WORKFLOW.md#definition-of-ready).

The prompt gives the issue, the worktree, the plan file to write, the plans of related issues and the issues that
depend on this one. Write the plan file with every item of section 1, in this order, and:

- Start from the problem. Before designing an API, name the concept in CONTEXT.md or the code that already covers the
  need, if one does, and build on it.
- Say what v1 needs and the smallest version that serves it; leave the rest out and say so.
- For each shared rule the plan adds, name the issues that will consume it, so it lands where they can reuse it.
- Check every claim against the documents and the code, with file and line. What they settle goes under "Already
  settled", never under questions.
- Treat a rule whose only job is keeping two sources in step, a config option, a safeguard, a second name for an
  existing concept, or a copy of something cf-loom already decides or derives (in a type, a fake or root tooling, a v1
  cut included) as a sign the design is wrong: redesign, or list it as a Root-cause check to run before the approval.
- Decide what [Decisions](../../WORKFLOW.md#decisions) lets the main session decide, and list it. Ask at most about
  five questions, each as Decisions says, with the scenario and the facts it rests on, verified or not.

Your final message is the plan file's path, the questions, and anything you could not verify.
