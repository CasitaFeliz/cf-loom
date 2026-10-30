import { describe, expect, test } from 'vitest';
import { edits } from '../../test/random-def-edits.ts';
import { type DefPair, defPairOf, type ExportPair } from '../../test/random-def-pairs.ts';
import { publishedAt, schemaExports } from '../../test/snapshots.ts';
import {
  type Change,
  type ComparedReport,
  canonicalTextOf,
  compatibilityReportOf,
  type DefinitionsSnapshot,
  type Defs,
  type Difference,
  decodeSnapshot,
  type EndpointFields,
  type Field,
  type ObjectNode,
  type PublishedCode,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type RemovedCode,
  type SchemaNode,
  type ServiceSnapshot,
} from '../internal/index.ts';

type Json = unknown;
type Node = {
  type?: unknown;
  name?: unknown;
  open?: unknown;
  nullable?: unknown;
  options?: unknown;
  items?: unknown;
  [key: string]: unknown;
};
type Neutral = 'description' | 'examples' | 'origin';
type Expected = { readonly shape: Json; readonly class: string };

const neutralNames: readonly Neutral[] = ['description', 'examples', 'origin'];
const nodeTypes: Record<SchemaNode['type'], true> = {
  string: true,
  number: true,
  boolean: true,
  enum: true,
  object: true,
  record: true,
  array: true,
  tuple: true,
  union: true,
  tagged: true,
  allOf: true,
  json: true,
  ref: true,
};
const unprovenTuple = { kind: 'unproven', node: 'tuple' };
const differenceOfWrapper: Record<ExportPair['wrapper'], Json> = {
  union: { kind: 'union-changed' },
  tuple: unprovenTuple,
  'tuple with rest': unprovenTuple,
  allOf: { kind: 'unproven', node: 'allOf' },
};

const emptyPart = { type: 'object', fields: {} } as const;
const invalidInput = 'INVALID_INPUT';
const notFound = 'NOT_FOUND';
const notImplemented = 'NOT_IMPLEMENTED';
const standardRejections = { invalidInput, notFound, notImplemented } as const;
const standardCode = { origin: 'standard', headers: emptyPart } as const;
const definitionsHeading = {
  format: 1,
  kind: 'definitions',
  name: '@org/definitions',
  standardRejections,
  guards: {},
  codes: {
    [invalidInput]: { ...standardCode, status: 400, message: 'Invalid', body: emptyPart },
    [notFound]: { ...standardCode, status: 404, message: 'Not found', body: null },
    [notImplemented]: { ...standardCode, status: 501, message: 'No', body: null },
  },
} as const;

/** The Baseline and the proposed Snapshot of a Definitions Package that exports each def in its wrapper. */
function snapshotsOf(pair: DefPair) {
  const held = Object.entries(pair.exports);
  const baselineExports = Object.fromEntries(held.map(([name, one]) => [name, one.baseline]));
  const proposedExports = Object.fromEntries(held.map(([name, one]) => [name, one.proposed]));
  const baseline: PublishedDefinitionsSnapshot = {
    ...definitionsHeading,
    ...publishedAt('1.0.0'),
    defs: pair.baseline,
    exports: schemaExports(baselineExports),
  };
  const proposed: DefinitionsSnapshot = {
    ...definitionsHeading,
    defs: pair.proposed,
    exports: schemaExports(proposedExports),
  };
  return { baseline, proposed };
}

function isNode(value: Json): value is Node {
  return (
    typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string'
  );
}

function isMap(value: Json): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A JSON value as text, its keys in order; a node's Neutral annotations left out when asked. */
function textOf(value: Json, leavesNeutralOut: boolean): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => textOf(item, leavesNeutralOut)).join(',')}]`;
  }
  if (!isMap(value)) {
    return JSON.stringify(value) ?? 'undefined';
  }
  const isLeftOut = (key: string) =>
    leavesNeutralOut && isNode(value) && neutralNames.some((name) => name === key);
  const keys = Object.keys(value)
    .filter((key) => !isLeftOut(key))
    .sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${textOf(value[key], leavesNeutralOut)}`,
  );
  return `{${entries.join(',')}}`;
}

/** Every node inside a value, and the value when it is one. */
function nodesIn(value: Json): Node[] {
  const found: Node[] = [];
  const pending = [value];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (isNode(next)) {
      found.push(next);
    }
    if (typeof next === 'object' && next !== null) {
      for (const inner of Object.values(next)) {
        pending.push(inner);
      }
    }
  }
  return found;
}

function refsIn(value: Json): string[] {
  const refs = nodesIn(value).filter((node) => node.type === 'ref');
  return refs.map((node) => String(node.name));
}

/** The defs the names reach through `ref`s and the names themselves, by a walk over the defs' JSON. */
function closureOf(names: readonly string[], defs: Defs): string[] {
  const reached = new Set<string>();
  const pending = [...names];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (!reached.has(name)) {
      reached.add(name);
      for (const inner of refsIn(defs[name])) {
        pending.push(inner);
      }
    }
  }
  return [...reached];
}

function holdsCycle(pair: DefPair, closure: readonly string[]): boolean {
  return closure.some((name) =>
    closureOf(refsIn(pair.baseline[name]), pair.baseline).includes(name),
  );
}

/** The Neutral annotations two trees of one shape differ in, read side by side; the top node's are left out when asked. */
function annotationsDiffering(baseline: Json, proposed: Json, readsTop: boolean): Set<Neutral> {
  const differing = new Set<Neutral>();
  for (const [inner, counterpart] of childPairsOf(baseline, proposed)) {
    for (const name of annotationsDiffering(inner, counterpart, true)) {
      differing.add(name);
    }
  }
  if (readsTop && isNode(baseline)) {
    for (const name of neutralNames) {
      const counterpart = isMap(proposed) ? proposed[name] : undefined;
      if (textOf(baseline[name], false) !== textOf(counterpart, false)) {
        differing.add(name);
      }
    }
  }
  return differing;
}

/** The values inside a list or a map and those at the same index or key in the other, a node's annotations apart. */
function childPairsOf(baseline: Json, proposed: Json): [Json, Json][] {
  if (Array.isArray(baseline)) {
    return baseline.map((inner, index): [Json, Json] => [
      inner,
      Array.isArray(proposed) ? proposed[index] : undefined,
    ]);
  }
  if (!isMap(baseline)) {
    return [];
  }
  const keys = Object.keys(baseline).filter((key) => !neutralNames.some((name) => name === key));
  return keys.map((key): [Json, Json] => [
    baseline[key],
    isMap(proposed) ? proposed[key] : undefined,
  ]);
}

function withoutKey(node: Node, dropped: string): Node {
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== dropped));
}

/** What the plain-union rule's words say of one export: the parts of a draw they decide. */
function inspect(pair: DefPair, held: ExportPair) {
  const baseline = withoutKey(held.baseline as Node, 'rest');
  const proposed = withoutKey(held.proposed as Node, 'rest');
  const closure = closureOf(refsIn(baseline), pair.baseline);
  const isChanged = (name: string) => {
    const [before, after] = [pair.baseline[name], pair.proposed[name]];
    return (
      before === undefined || after === undefined || textOf(before, true) !== textOf(after, true)
    );
  };
  const wrapperNode = (node: Node) => textOf(withoutKey(node, 'nullable'), true);
  const inline = annotationsDiffering(baseline, proposed, false);
  const inDefs = new Set<Neutral>();
  for (const name of closure) {
    for (const annotation of annotationsDiffering(pair.baseline[name], pair.proposed[name], true)) {
      inDefs.add(annotation);
    }
  }
  return {
    closure,
    annotations: new Set([...inline, ...inDefs]),
    inDefs,
    hasChangedDef: closure.some(isChanged),
    hasChangedWrapper: wrapperNode(baseline) !== wrapperNode(proposed),
  };
}

function neutralChange(annotation: Neutral): Expected {
  return { shape: { kind: 'annotation-changed', annotation }, class: 'neutral' };
}

/** The Changes the rule gives at an export itself: its own annotations and nullability, then the rule's. */
function expectedOf(pair: DefPair, held: ExportPair): Expected[] {
  const { annotations, hasChangedDef, hasChangedWrapper } = inspect(pair, held);
  const own = neutralNames.filter(
    (name) => textOf(held.baseline[name], false) !== textOf(held.proposed[name], false),
  );
  const nullable =
    held.baseline.nullable === held.proposed.nullable
      ? []
      : [
          {
            shape: { kind: held.proposed.nullable ? 'nullability-added' : 'nullability-removed' },
            class: 'breaking',
          },
        ];
  const inner =
    hasChangedDef || hasChangedWrapper
      ? [{ shape: differenceOfWrapper[held.wrapper], class: 'breaking' }]
      : neutralNames.filter((name) => annotations.has(name)).map(neutralChange);
  return [...own.map(neutralChange), ...nullable, ...inner];
}

type SchemaChange = Change & {
  readonly difference: Extract<Difference, { readonly kind: 'schema' }>;
};

function isSchemaChange(change: Change): change is SchemaChange {
  return change.difference.kind === 'schema';
}

/** The Changes a report gives at an export itself, not at a place inside it. */
function reportedAt(report: ComparedReport, name: string): Expected[] {
  const atExport = report.changes
    .filter(isSchemaChange)
    .filter(
      ({ site, difference }) =>
        site.kind === 'export' && site.name === name && difference.at.length === 0,
    );
  return atExport.map(({ difference, class: changeClass }) => ({
    shape: difference.shape,
    class: changeClass,
  }));
}

function directPartsOf(wrapper: Node): Json[] {
  const parts = wrapper.options ?? wrapper.items;
  return Array.isArray(parts) ? parts : [];
}

function sortedTexts(changes: readonly Expected[]): string[] {
  return changes.map((change) => textOf(change, false)).sort();
}

describe('compatibilityReportOf, a plain union, a tuple or an allOf over a seeded def graph', () => {
  const pairs = Array.from({ length: 3_000 }, (_, seed) => defPairOf(seed));
  const exportsOf = (pair: DefPair) => Object.values(pair.exports);

  /** The draws that meet a condition, out of every export drawn. */
  function countOf(isMet: (pair: DefPair, held: ExportPair) => boolean): number {
    return pairs.flatMap((pair) => exportsOf(pair).filter((held) => isMet(pair, held))).length;
  }

  test('the generator draws every node type, every edit, cycles, alias defs and changes both in shape and only in annotations within a reached def', () => {
    const everyNode = pairs.flatMap((pair) =>
      nodesIn([pair.baseline, pair.proposed, exportsOf(pair)]),
    );
    const tops = pairs.flatMap((pair) => Object.values(pair.baseline).map((def) => def as Node));
    const facts = {
      'a reached def’s shape changed': countOf((pair, held) => inspect(pair, held).hasChangedDef),
      'annotations differ only within a reached def': countOf((pair, held) => {
        const { inDefs, hasChangedDef, hasChangedWrapper } = inspect(pair, held);
        return !hasChangedDef && !hasChangedWrapper && inDefs.size > 0;
      }),
      'the closure holds a cycle': countOf((pair, held) =>
        holdsCycle(pair, inspect(pair, held).closure),
      ),
      'a ref below a wrapper’s direct options': countOf((_, held) =>
        directPartsOf(held.baseline as Node).some(
          (part) => isNode(part) && part.type !== 'ref' && refsIn(part).length > 0,
        ),
      ),
      'a wrapper tuple with rest': countOf((_, held) => held.wrapper === 'tuple with rest'),
    };

    expect([...new Set(everyNode.map((node) => node.type))].sort()).toEqual(
      Object.keys(nodeTypes).sort(),
    );
    expect(new Set(pairs.map((pair) => pair.edit))).toEqual(new Set(edits));
    expect(everyNode.some((node) => node.type === 'enum' && node.open === true)).toBe(true);
    expect(everyNode.some((node) => node.type === 'ref' && node.nullable === true)).toBe(true);
    expect(tops.some((def) => def.type === 'ref')).toBe(true);
    expect(tops.some((def) => def.type === 'union' || def.type === 'allOf')).toBe(true);
    for (const [fact, count] of Object.entries(facts)) {
      expect(count, fact).toBeGreaterThanOrEqual(100);
    }
  });

  test('every Baseline it draws decodes', () => {
    const refused: string[] = [];

    for (const [seed, pair] of pairs.entries()) {
      const decoded = decodeSnapshot(canonicalTextOf(snapshotsOf(pair).baseline));
      if (decoded.kind !== 'decoded') {
        refused.push(`draw ${seed}: ${JSON.stringify(decoded)}`);
      }
    }

    expect(refused.slice(0, 3)).toEqual([]);
    expect(refused).toHaveLength(0);
  });

  test('each export reports what the plain-union rule says of everything it reaches: Breaking when a shape in it differs, otherwise each annotation that differs, once', () => {
    const problems: string[] = [];

    for (const [seed, pair] of pairs.entries()) {
      const { baseline, proposed } = snapshotsOf(pair);
      try {
        const report = compatibilityReportOf(baseline, proposed);
        for (const [name, held] of Object.entries(pair.exports)) {
          const reported = sortedTexts(reportedAt(report, name));
          const expected = sortedTexts(expectedOf(pair, held));
          if (reported.join() !== expected.join()) {
            problems.push(
              `draw ${seed}, ${name} (${pair.edit}, ${held.wrapper}): reported ${reported.join(' ')}, expected ${expected.join(' ')}`,
            );
          }
        }
      } catch (error) {
        problems.push(`draw ${seed}: ${String(error)}`);
      }
    }

    expect(problems.slice(0, 3)).toEqual([]);
    expect(problems).toHaveLength(0);
  });
});

describe('compatibilityReportOf, the defs each pair compares', () => {
  const taken = 'TAKEN';
  const gone = 'GONE';
  const identity = 'GET /orders/{}';
  const tree: SchemaNode = { type: 'ref', name: 'tree' };
  const unionWithTree: SchemaNode = { type: 'union', options: [tree, { type: 'boolean' }] };
  const body = anObject({ tree: required(unionWithTree) });

  function required(schema: SchemaNode): Field {
    return { required: true, schema };
  }

  function anObject(fields: Readonly<Record<string, Field>> = {}): ObjectNode {
    return { type: 'object', fields };
  }

  /** A recursive def, with the given labels. */
  function aTree(...labels: readonly string[]): ObjectNode {
    const children = required({ type: 'array', items: tree });
    const named = labels.map((label): [string, Field] => [label, required({ type: 'string' })]);
    return anObject({ children, ...Object.fromEntries(named) });
  }

  function aCode(fields: Partial<PublishedCode> = {}): PublishedCode {
    return { origin: 'local', status: 409, message: 'Locked', headers: emptyPart, body, ...fields };
  }

  function anEndpoint(rejections: readonly string[]): EndpointFields & { lifecycle: 'active' } {
    return {
      name: 'getOrder',
      group: 'orders',
      visibility: 'public',
      description: 'One order',
      params: [],
      guards: [],
      input: { params: null, query: emptyPart, headers: emptyPart, body: null },
      success: { status: 200, headers: emptyPart, body: null },
      rejections,
      lifecycle: 'active',
    };
  }

  const heading = {
    format: 1,
    kind: 'service',
    name: 'orders-service',
    standardRejections,
    groups: {},
    guards: {},
    events: {},
    commands: {},
    subscriptions: {},
    dependencies: {},
  } as const;

  /**
   * A Service whose Baseline holds a kept code and a removed one with defs of its own, the
   * removed one declared again, and the codes' changes the Check finds.
   */
  function codeChangesOf(defs: {
    goneWas: ObjectNode;
    baseline: ObjectNode;
    proposed: ObjectNode;
  }) {
    const removed: RemovedCode = { ...aCode(), removedIn: '3.2.0', defs: { tree: defs.goneWas } };
    const baseline: PublishedServiceSnapshot = {
      ...heading,
      ...publishedAt('3.4.0'),
      formerInputs: [],
      defs: { tree: defs.baseline },
      endpoints: { [identity]: anEndpoint([taken]) },
      codes: { [gone]: removed, [taken]: aCode() },
    };
    const proposed: ServiceSnapshot = {
      ...heading,
      defs: { tree: defs.proposed },
      endpoints: { [identity]: anEndpoint([gone, taken]) },
      codes: { [gone]: aCode(), [taken]: aCode() },
    };
    return compatibilityReportOf(baseline, proposed).changes.filter(
      ({ site }) => site.kind === 'code',
    );
  }

  function breakingAt(code: string): Change {
    const at = [
      { kind: 'part', name: 'body' },
      { kind: 'field', name: 'tree' },
    ] as const;
    return {
      site: { kind: 'code', code, visibility: 'public' },
      difference: { kind: 'schema', position: 'success', at, shape: { kind: 'union-changed' } },
      class: 'breaking',
      verdict: 'approval-needed',
    };
  }

  test('a removed code declared again is judged by the defs it was removed with: its tree differing is one Breaking Change, at GONE, and none at TAKEN', () => {
    const changes = codeChangesOf({
      goneWas: aTree('label'),
      baseline: aTree(),
      proposed: aTree(),
    });

    expect(changes).toEqual([breakingAt(gone)]);
  });

  test('a kept code is judged by the Snapshot’s defs: the Snapshot’s tree differing is one Breaking Change, at TAKEN, and none at GONE', () => {
    const changes = codeChangesOf({
      goneWas: aTree(),
      baseline: aTree('label'),
      proposed: aTree(),
    });

    expect(changes).toEqual([breakingAt(taken)]);
  });
});
