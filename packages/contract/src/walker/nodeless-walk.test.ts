import { describe, expect, test } from 'vitest';
import {
  type Around,
  arounds,
  type Kind,
  kinds,
  type NodelessGraph,
  nodelessGraph,
} from '../../test/random-nodeless-schemas.ts';
import { aRootPackage } from '../../test/root-package.ts';
import { defineEndpoint, defineGroup, defineService } from '../index.ts';
import { refusalsIn, siteTextOf, validateRoot, walkSchemas } from '../internal/index.ts';

const nodelessCycle =
  'a cycle through z.lazy(), unions and intersections alone, which zod cannot parse';

const graphs = Array.from({ length: 5_000 }, (_, index) => nodelessGraph(index + 1));

/*
 * The oracle shares nothing with `src/`. It reads the graph a seed draws: each schema's kind and the
 * schemas it holds, in order. Two schemas lead to each other with no node between when they hold
 * each other through a union's options, an intersection's items or an alias' target, however
 * `.nullable()`, a description, a nested union or intersection stand around the held schema.
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

/** A group the walk tells: its schemas, the one entered first, and the declaration it was entered in. */
type Told = {
  readonly members: readonly number[];
  readonly first: number;
  readonly declaration: number;
};

/** What the walk of a graph is expected to do, derived from the graph by the rules the documents give. */
type Expected = {
  readonly told: readonly Told[];
  /** Whether each declaration's schema is accepted. */
  readonly accepted: readonly boolean[];
  /** The schemas with an id that are defs when the walk ends. */
  readonly defs: readonly number[];
};

/** The state of the graph's expected walk. */
type Run = {
  readonly graph: NodelessGraph;
  readonly entries: { index: number; declaration: number }[];
  readonly written: Set<number>;
  readonly failed: Set<number>;
  readonly told: Told[];
  declaration: number;
};

const entryOf = (run: Run, index: number) =>
  run.entries.findIndex((entry) => entry.index === index);

/**
 * The walk, run on the graph. A schema is entered each time it is met, and one with an id once; a
 * schema with an id whose own walk holds no refusal is a def, and one that holds a refusal fails
 * and gives its failure to the schemas of its group entered below it. A group of schemas that lead
 * back to each other is closed by the schema entered first, which tells each group of defs that
 * lead back to themselves with no node between at the def entered first, and fails the group.
 */
function expectedOf(graph: NodelessGraph): Expected {
  const run: Run = {
    graph,
    entries: [],
    written: new Set(),
    failed: new Set(),
    told: [],
    declaration: 0,
  };
  const accepted = graph.declarations.map((root, position) => {
    run.declaration = position;
    return !enter(run, root);
  });
  const defs = run.entries.map((entry) => entry.index).filter((index) => !run.failed.has(index));
  return { told: run.told, accepted, defs };
}

/** Whether the walk of a schema holds a refusal. */
function enter(run: Run, index: number): boolean {
  const { graph } = run;
  const hasId = graph.hasId[index] === true;
  if (hasId && entryOf(run, index) >= 0) {
    return run.failed.has(index);
  }
  const position = run.entries.length;
  if (hasId) {
    run.entries.push({ index, declaration: run.declaration });
  }
  let isRefused = false;
  for (const to of allStepsOf(graph, index)) {
    isRefused = enter(run, to) || isRefused;
  }
  if (!hasId) {
    return isRefused;
  }
  settle(run, index, isRefused);
  const group = cycleOf(graph, allStepsOf, index);
  const isRoot = group.every((member) => entryOf(run, member) >= position);
  return (isRoot && closeGroup(run, index)) || isRefused;
}

/** A schema with an id whose walk ended is a def, or fails and fails the schemas of its group entered below it. */
function settle(run: Run, index: number, isRefused: boolean): void {
  if (!isRefused) {
    run.written.add(index);
    return;
  }
  run.failed.add(index);
  const group = cycleOf(run.graph, allStepsOf, index);
  for (const entry of run.entries.slice(entryOf(run, index) + 1)) {
    if (group.includes(entry.index)) {
      run.failed.add(entry.index);
    }
  }
}

/** Tells each group of the defs of the group of schemas closing that leads back to itself with no node between. */
function closeGroup(run: Run, root: number): boolean {
  const group = cycleOf(run.graph, allStepsOf, root);
  const defs = group.filter((member) => run.written.has(member));
  const stepsAmongDefs: Steps = (graph, index) =>
    nodelessStepsOf(graph, index).filter((to) => defs.includes(to));
  const cycles = new Map<string, readonly number[]>();
  for (const member of defs) {
    const members = cycleOf(run.graph, stepsAmongDefs, member);
    if (members.length > 0) {
      cycles.set(members.join(), members);
    }
  }
  for (const members of cycles.values()) {
    const byEntry = members.toSorted((left, right) => entryOf(run, left) - entryOf(run, right));
    const first = byEntry[0] ?? 0;
    const declaration = run.entries[entryOf(run, first)]?.declaration ?? 0;
    run.told.push({ members, first, declaration });
  }
  for (const member of cycles.size > 0 ? group : []) {
    run.failed.add(member);
  }
  return cycles.size > 0;
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

/** A Service whose Endpoints `getFirst`, `getSecond` and `getThird` answer the schemas of the graph's declarations. */
function validatedBy(graph: NodelessGraph) {
  const names = ['First', 'Second', 'Third'] as const;
  const endpointAt = (position: number) =>
    defineEndpoint({
      name: `get${names[position]}`,
      method: 'GET',
      path: `/${names[position]?.toLowerCase()}`,
      visibility: 'public',
      description: 'A schema',
      success: { status: 200, body: graph.schemas[graph.declarations[position] ?? 0]! },
    });
  const [first, ...others] = graph.declarations.map((_, position) => endpointAt(position));
  const endpoints = [first ?? endpointAt(0), ...others] as const;
  const group = defineGroup({ name: 'schemas', description: 'Schemas', endpoints });
  const service = defineService({ name: 'orders-service', groups: [group] });
  return validateRoot(service, aRootPackage(service));
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
  const told = expectedOf(graph).told;
  for (const index of walkedByAny(graph)) {
    cases.push(`kind ${graph.kinds[index]}`);
    for (const hold of graph.holds[index] ?? []) {
      cases.push(`around ${hold.around}`, `reach ${hold.reach}`);
    }
  }
  holds(cases, groups.length === 0, 'no group');
  holds(cases, told.length < groups.length, 'a group hidden below another');
  for (const group of told) {
    for (const drawn of casesOfGroup(graph, group, told)) {
      cases.push(drawn);
    }
  }
  return cases;
}

function casesOfGroup(graph: NodelessGraph, group: Told, told: readonly Told[]): string[] {
  const cases = [`group of ${Math.min(group.members.length, 3)}`];
  holds(cases, group.members.length === 1, `lone ${graph.kinds[group.first]}`);
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
  const walkGroup = cycleOf(graph, allStepsOf, group.first);
  const declared = graph.declarations.filter((root) => reaches(graph, [group], root));
  holds(cases, declared.length > 1, 'a group reached from two declarations');
  holds(cases, group.members.length < walkGroup.length, 'a group inside a larger one');
  const inWalkGroup = told.filter((other) => walkGroup.includes(other.first));
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

describe('walkSchemas: nodeless cycles of random graphs', () => {
  test('the walk tells each nodeless group once, at its first entered def, and nothing else', () => {
    const wrong: string[] = [];

    for (const [position, graph] of graphs.entries()) {
      const expected = expectedOf(graph).told.map(
        ({ first, declaration }) => `n${first} at exports.r${declaration}`,
      );
      const refusals = refusalsOf(walkOf(graph));
      const told = refusals
        .filter(({ construct }) => construct === nodelessCycle)
        .map(
          (refusal) =>
            `n${graph.schemas.indexOf(refusal.schema as never)} at ${siteTextOf(refusal.site)}`,
        );
      const others = refusals.filter(({ construct }) => construct !== nodelessCycle);
      if (told.sort().join() !== expected.sort().join() || others.length > 0) {
        const text = `${told.join()} not ${expected.join()}, ${others.length} others`;
        wrong.push(`seed ${position + 1}: ${text}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test('the walk writes none of the defs of a group it tells, nor of a schema that reaches one, and every other id is a def', () => {
    const wrong: string[] = [];

    for (const [position, graph] of graphs.entries()) {
      const expected = expectedOf(graph);
      const walked = walkOf(graph);
      const accepted = walked.located.map(({ walked: located }) => located.kind === 'walked');
      const defs = Object.keys(walked.defs).sort().join();
      const expectedDefs = expected.defs
        .map((index) => `n${index}`)
        .sort()
        .join();
      if (defs !== expectedDefs || accepted.join() !== expected.accepted.join()) {
        wrong.push(`seed ${position + 1}: ${defs} not ${expectedDefs}`);
      }
    }

    expect(wrong).toEqual([]);
  });

  test('the line of a cycle lists every declaration that reaches its schema, once', () => {
    const wrong: string[] = [];

    for (const [position, graph] of graphs.entries()) {
      const validated = validatedBy(graph);
      const failures = validated.kind === 'valid' ? [] : validated.failures;
      const told = failures.map((failure) =>
        failure.kind === 'not-allowed' && failure.construct === nodelessCycle
          ? [failure.site, ...failure.alsoIn].map(siteTextOf).sort().join()
          : `other ${failure.kind}`,
      );
      const expected = expectedOf(graph).told.map((group) =>
        graph.declarations
          .map((root, declared) => ({ root, declared }))
          .filter(({ root }) => reaches(graph, [group], root))
          .map(({ declared }) => endpointTextAt(declared))
          .sort()
          .join(),
      );
      if (told.sort().join('|') !== expected.sort().join('|')) {
        wrong.push(`seed ${position + 1}: ${told.join('|')} not ${expected.join('|')}`);
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
