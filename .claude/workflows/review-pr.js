export const meta = {
  name: 'review-pr',
  description: 'Round 1 review of a cf-loom PR with cf-reviewer: three lenses, or one for a small PR',
  whenToUse:
    'WORKFLOW.md section 3. Args: { pr, title, worktree, head, plan (one path, or the paths of a shared PR), probe, small?, notes? }; small runs one reviewer with all three lenses.',
  phases: [{ title: 'Review', detail: 'design, fidelity, correctness' }],
};

const LENSES = {
  design: 'design, C1–C21 and C29',
  fidelity: 'fidelity, C22: the code against the plans and the documents, and the glossary terms in the documents',
  correctness: 'correctness, C23–C26 and C30: bugs, the plan\'s edges and the ones it left out, growth at two sizes, probes and the tests',
};

const brief = (lens, probe) =>
  [
    `Review cf-loom PR #${args.pr} (${args.title}). Lens: ${lens}.`,
    `Worktree ${args.worktree}, head ${args.head}; diff: git -C ${args.worktree} diff origin/main...HEAD.`,
    `Plans: ${args.plan}. Probes only under ${probe}.`,
    args.notes ? `From the main session: ${args.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');

const review = (key, lens) =>
  agent(brief(lens, `${args.probe}/${key}`), {
    label: `${args.pr}:${key}`,
    phase: 'Review',
    agentType: 'cf-reviewer',
  }).then((report) => ({ lens: key, report }));

const lenses = args.small
  ? [['all', Object.values(LENSES).join('; ')]]
  : Object.entries(LENSES);

const reports = await parallel(lenses.map(([key, lens]) => () => review(key, lens)));
return reports.filter(Boolean);
