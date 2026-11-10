import { describe, expect, test } from 'vitest';
import {
  type Around,
  arounds,
  type Kind,
  kinds,
  type NodelessGraph,
  nodelessGraph,
} from '../../test/random-nodeless-schemas.ts';
import { validatedAnswering } from '../../test/validated-answering.ts';
import { refusalsIn, siteTextOf, walkSchemas } from '../internal/index.ts';

const nodelessCycle =
  'a cycle through z.lazy(), unions and intersections alone, which zod cannot parse';

const graphs = Array.from({ length: 5_000 }, (_, index) => nodelessGraph(index + 1));

/*
 * The oracle shares nothing with `src/` and simulates no walk. It reads the graph a seed draws:
 * each schema's kind and the schemas it holds, in order. Two schemas lead to each other with no
 * node between when they hold each other through a union's options, an intersection's items or an
 * alias' target, however `.nullable()`, a description, a nested union or intersection stand around
 * the held schema. A schema fails when it is in such a group or reaches one.
 */
const nodelessKinds: readonly Kind[] = ['union', 'allOf', 'alias'];
const nodelessArounds: readonly Around[] = ['nothing', 'nullable', 'described', 'union', 'allOf'];

type Steps = (graph: NodelessGraph, index: number) => readonly number[];

function nodelessStepsOf(graph: NodelessGraph, index: number): readonly number[] {
  if (!nodelessKinds.includes(graph.kinds[index] ?? 'object')) {
    return [];
  }
  const holds = graph.holds[index] ?? [];
  return holds.filter((hold) => nodelessArounds.includes(hold.around)).map((hold) => hold.to);
}

function allStepsOf(graph: NodelessGraph, index: number): readonly number[] {
  return (graph.holds[index] ?? []).map((hold) => hold.to);
}

/** The schemas reached from `from` by one step or more, `from` itself only if the steps lead back to it. */
function reachedFrom(graph: NodelessGraph, steps: Steps, from: number): ReadonlySet<number> {
  const reached = new Set<number>();
  const pending = [from];
  for (let index = pending.pop(); index !== undefined; index = pending.pop()) {
    for (const to of steps(graph, index)) {
      if (!reached.has(to)) {
        reached.add(to);
        pending.push(to);
      }
    }
  }
  return reached;
}

/** The schemas that lead to each other with `steps` and `index`, itself included, or none if it leads nowhere back. */
function cycleOf(graph: NodelessGraph, steps: Steps, index: number): readonly number[] {
  const reaches = reachedFrom(graph, steps, index);
  if (!reaches.has(index)) {
    return [];
  }
  const members = [...reaches].filter((other) => reachedFrom(graph, steps, other).has(index));
  return [...new Set([index, ...members])].sort((left, right) => left - right);
}

/** What a declaration walks: its schema and every schema it reaches. */
function walkedBy(graph: NodelessGraph, declaration: number): ReadonlySet<number> {
  return new Set([declaration, ...reachedFrom(graph, allStepsOf, declaration)]);
}

function walkedByAny(graph: NodelessGraph): ReadonlySet<number> {
  const walked = new Set<number>();
  for (const declaration of graph.declarations) {
    for (const index of walkedBy(graph, declaration)) {
      walked.add(index);
    }
  }
  return walked;
}

/** A set of schemas that lead back to each other with no node between. */
type Group = { readonly members: readonly number[] };

function nodelessGroupsOf(graph: NodelessGraph): readonly Group[] {
  const groups = new Map<string, Group>();
  for (const index of [...walkedByAny(graph)].sort((left, right) => left - right)) {
    const members = cycleOf(graph, nodelessStepsOf, index);
    if (members.length > 0) {
      groups.set(members.join(), { members });
    }
  }
  return [...groups.values()];
}

/**
 * Whether no member of the group reaches a nodeless group outside its own group of schemas, so
 * no failure of theirs comes before the judgement and the walk tells the whole group.
 */
function isUnhidden(graph: NodelessGraph, groups: readonly Group[], group: Group): boolean {
  const inGroups = new Set(groups.flatMap((other) => other.members));
  return group.members.every((member) => {
    const walkGroup = cycleOf(graph, allStepsOf, member);
    return [...reachedFrom(graph, allStepsOf, member)].every(
      (reached) =>
        !inGroups.has(reached) || group.members.includes(reached) || walkGroup.includes(reached),
    );
  });
}

/** How the walk enters the schemas with an id: in what order, in which declaration, and which it enters while it walks each. */
type Trace = {
  readonly graph: NodelessGraph;
  readonly entries: readonly { index: number; declaration: number }[];
  readonly below: ReadonlyMap<number, ReadonlySet<number>>;
};

/**
 * Where the walk enters each schema with an id: depth first, each schema's holds in the order the
 * zod schema keeps them. A schema with no id is entered each time it is met, and one with an id
 * once.
 */
function traceOf(graph: NodelessGraph): Trace {
  const entries: { index: number; declaration: number }[] = [];
  const below = new Map<number, Set<number>>();
  const open: number[] = [];
  const enter = (index: number, declaration: number): void => {
    const hasId = graph.hasId[index] === true;
    if (hasId && below.has(index)) {
      return;
    }
    if (hasId) {
      entries.push({ index, declaration });
      for (const ancestor of open) {
        below.get(ancestor)?.add(index);
      }
      below.set(index, new Set());
      open.push(index);
    }
    for (const to of allStepsOf(graph, index)) {
      enter(to, declaration);
    }
    if (hasId) {
      open.pop();
    }
  };
  for (const [declaration, root] of graph.declarations.entries()) {
    enter(root, declaration);
  }
  return { graph, entries, below };
}

function reaches(graph: NodelessGraph, groups: readonly Group[], index: number): boolean {
  const walked = walkedBy(graph, index);
  return groups.some((group) => group.members.some((member) => walked.has(member)));
}

function placeAt(position: number) {
  const site = { kind: 'export', name: `r${position}` } as const;
  return { site, declaration: undefined, steps: undefined } as const;
}

function walkOf(graph: NodelessGraph) {
  const located = graph.declarations.map((root, position) => ({
    at: placeAt(position),
    schema: graph.schemas[root]!,
  }));
  return walkSchemas(located, () => undefined);
}

function refusalsOf(walked: ReturnType<typeof walkSchemas>) {
  const refusals = walked.located.flatMap(({ walked: located }) =>
    located.kind === 'walked' ? [] : refusalsIn(located.tree),
  );
  return [...new Set(refusals)];
}

function endpointTextAt(position: number): string {
  const name = ['First', 'Second', 'Third'][position] ?? '';
  return `endpoints.GET /${name.toLowerCase()} (get${name})`;
}

/** A case a graph holds, written when its condition does. */
function holds(cases: string[], condition: boolean, name: string): void {
  if (condition) {
    cases.push(name);
  }
}

/** The cases of the rule one graph holds, as the plan lists them. */
function casesOf(graph: NodelessGraph): readonly string[] {
  const cases: string[] = [];
  const groups = nodelessGroupsOf(graph);
  for (const index of walkedByAny(graph)) {
    cases.push(`kind ${graph.kinds[index]}`);
    for (const hold of graph.holds[index] ?? []) {
      cases.push(`around ${hold.around}`, `reach ${hold.reach}`);
    }
  }
  holds(cases, groups.length === 0, 'no group');
  const hidden = groups.filter((group) => !isUnhidden(graph, groups, group));
  holds(cases, hidden.length > 0, 'a group hidden below another');
  for (const group of groups) {
    for (const drawn of casesOfGroup(graph, group, groups)) {
      cases.push(drawn);
    }
  }
  return cases;
}

function casesOfGroup(graph: NodelessGraph, group: Group, groups: readonly Group[]): string[] {
  const first = group.members[0] ?? 0;
  const cases = [`group of ${Math.min(group.members.length, 3)}`];
  holds(cases, group.members.length === 1, `lone ${graph.kinds[first]}`);
  for (const member of group.members) {
    cases.push(`group member ${graph.kinds[member]}`);
    const inside = (graph.holds[member] ?? []).filter(
      (hold) => nodelessArounds.includes(hold.around) && group.members.includes(hold.to),
    );
    for (const hold of inside) {
      cases.push(`group through ${hold.around}`);
    }
    holds(cases, inside.length > 1, 'a def on two cycles');
  }
  const walkGroup = cycleOf(graph, allStepsOf, first);
  const declared = graph.declarations.filter((root) => reaches(graph, [group], root));
  holds(cases, declared.length > 1, 'a group reached from two declarations');
  holds(cases, group.members.length < walkGroup.length, 'a group inside a larger one');
  const inWalkGroup = groups.filter((other) => walkGroup.includes(other.members[0] ?? 0));
  holds(cases, inWalkGroup.length > 1, 'two groups in one walk group');
  const above = [...walkedByAny(graph)].filter(
    (index) =>
      graph.hasId[index] === true &&
      !group.members.includes(index) &&
      reaches(graph, [group], index),
  );
  holds(cases, above.length > 0, 'a def reaching a group off it');
  return cases;
}

/** The refusals of a nodeless cycle the walk raised, each as the schema it sits at and where. */
function toldIn(graph: NodelessGraph) {
  const refusals = refusalsOf(walkOf(graph));
  return {
    told: refusals
      .filter(({ construct }) => construct === nodelessCycle)
      .map((refusal) => ({
        index: graph.schemas.indexOf(refusal.schema as never),
        site: siteTextOf(refusal.site),
      })),
    others: refusals.filter(({ construct }) => construct !== nodelessCycle),
  };
}

/**
 * The cycles the walk is expected to tell of a graph, each as the schema entered first and where:
 * every nodeless group once, whether a member of it failed on its own or not.
 */
function expectedToldOf(graph: NodelessGraph): readonly string[] {
  const { entries } = traceOf(graph);
  return nodelessGroupsOf(graph)
    .map((group) => entries.find((entry) => group.members.includes(entry.index)))
    .map((first) => `n${first?.index} at exports.r${first?.declaration}`)
    .sort();
}

/**
 * What the walk got wrong of a graph: a cycle refused that is no nodeless group, told twice or
 * told away from its first entered member, or one of them left untold.
 */
function problemsOfTold(graph: NodelessGraph): readonly string[] {
  const { told, others } = toldIn(graph);
  const problems = others.map(({ construct }) => `refused ${construct}`);
  const actual = told.map(({ index, site }) => `n${index} at ${site}`).sort();
  const expected = expectedToldOf(graph);
  holds(
    problems,
    actual.join() !== expected.join(),
    `told ${actual.join()} not ${expected.join()}`,
  );
  return problems;
}

/** Whether a nodeless group sits in a group of schemas that holds a nodeless group of its own to the side, so a failure of the one comes before the judgement of the other. */
function isPartlyHidden(graph: NodelessGraph): boolean {
  const groups = nodelessGroupsOf(graph);
  return groups.some((group) => !isUnhidden(graph, groups, group));
}

describe('walkSchemas: nodeless cycles of random graphs', () => {
  test('the walk tells each set of schemas that lead back to each other once, at its first entered member, failing or not, and nothing else', () => {
    const wrong: string[] = [];

    for (const [position, graph] of graphs.entries()) {
      const problems = problemsOfTold(graph);
      if (problems.length > 0) {
        wrong.push(`seed ${position + 1}: ${problems.join('; ')}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test('the walk tells the schemas of a group a failure partly hides the same', () => {
    const wrong: string[] = [];
    const drawn = Array.from({ length: 40_000 }, (_, index) => ({
      seed: index + 5_001,
      graph: nodelessGraph(index + 5_001),
    }));
    const partlyHidden = drawn.filter(({ graph }) => isPartlyHidden(graph));

    for (const { seed, graph } of partlyHidden) {
      const problems = problemsOfTold(graph);
      if (problems.length > 0) {
        wrong.push(`seed ${seed}: ${problems.join('; ')}`);
      }
    }

    expect(wrong).toEqual([]);
    expect(partlyHidden.length).toBeGreaterThan(100);
  });

  test('a declaration is accepted exactly when it reaches no nodeless group, and the defs are the ids that reach none', () => {
    const wrong: string[] = [];

    for (const [position, graph] of graphs.entries()) {
      const groups = nodelessGroupsOf(graph);
      const walked = walkOf(graph);
      const accepted = walked.located.map(({ walked: located }) => located.kind === 'walked');
      const expectedAccepted = graph.declarations.map((root) => !reaches(graph, groups, root));
      const defs = Object.keys(walked.defs).sort().join();
      const expectedDefs = [...walkedByAny(graph)]
        .filter((index) => graph.hasId[index] === true && !reaches(graph, groups, index))
        .map((index) => `n${index}`)
        .sort()
        .join();
      if (defs !== expectedDefs || accepted.join() !== expectedAccepted.join()) {
        wrong.push(`seed ${position + 1}: ${defs} not ${expectedDefs}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test('the line of a cycle lists every declaration that reaches its schema, once', () => {
    const wrong: string[] = [];

    for (const [position, graph] of graphs.entries()) {
      const groups = nodelessGroupsOf(graph);
      const validated = validatedAnswering(graph.declarations.map((root) => graph.schemas[root]!));
      const failures = validated.kind === 'valid' ? [] : validated.failures;
      const lines = failures.map((failure) =>
        failure.kind === 'not-allowed' && failure.construct === nodelessCycle
          ? [failure.site, ...failure.alsoIn].map(siteTextOf).sort().join()
          : `other ${failure.kind}`,
      );
      const expected = toldIn(graph).told.map(({ index }) => {
        const group = groups.find((other) => other.members.includes(index));
        return graph.declarations
          .map((root, declared) => ({ root, declared }))
          .filter(({ root }) => group !== undefined && reaches(graph, [group], root))
          .map(({ declared }) => endpointTextAt(declared))
          .sort()
          .join();
      });
      if (lines.sort().join('|') !== expected.sort().join('|')) {
        wrong.push(`seed ${position + 1}: ${lines.join('|')} not ${expected.join('|')}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test('the generator draws every node kind and every case where the rule acts', () => {
    const counts = new Map<string, number>();
    for (const graph of graphs) {
      for (const drawn of casesOf(graph)) {
        counts.set(drawn, (counts.get(drawn) ?? 0) + 1);
      }
    }

    const required = [
      ...kinds.map((kind) => `kind ${kind}`),
      ...arounds.map((around) => `around ${around}`),
      'reach direct',
      'reach lazy',
      'no group',
      'group of 1',
      'group of 2',
      'group of 3',
      'lone alias',
      'lone union',
      'lone allOf',
      'group member union',
      'group member allOf',
      'group member alias',
      'group through nullable',
      'group through described',
      'group through union',
      'group through allOf',
      'a def on two cycles',
      'a def reaching a group off it',
      'a group inside a larger one',
      'two groups in one walk group',
      'a group reached from two declarations',
      'a group hidden below another',
    ];
    const rare = required.filter((drawn) => (counts.get(drawn) ?? 0) < 100);
    expect(rare).toEqual([]);
  });
});
