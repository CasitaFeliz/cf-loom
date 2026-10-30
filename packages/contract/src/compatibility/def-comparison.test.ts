import { describe, expect, test } from 'vitest';
import { edits } from '../../test/random-def-edits.ts';
import { type DefPair, defPairOf, type ExportPair } from '../../test/random-def-pairs.ts';
import { publishedAt, schemaExports } from '../../test/snapshots.ts';
import {
  type Change,
  type ChangeSite,
  type CommandSnapshot,
  type ComparedReport,
  canonicalTextOf,
  compatibilityReportOf,
  type DefinitionsSnapshot,
  type Defs,
  type Difference,
  decodeSnapshot,
  type EndpointFields,
  type EndpointSnapshot,
  type Field,
  type GuardSnapshot,
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
  fields?: unknown;
  variants?: unknown;
  key?: unknown;
  value?: unknown;
  rest?: unknown;
  schema?: unknown;
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

const serviceHeading = {
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

/** The seeded pairs of def graphs every test over a seeded graph draws from. */
const pairs = Array.from({ length: 3_000 }, (_, seed) => defPairOf(seed));

/** The Baseline and the proposed Snapshot of a Definitions Package that exports each def in its wrapper. */
function snapshotsOf(pair: DefPair) {
  const held = Object.entries(pair.exports);
  const baselineExports = Object.fromEntries(
    held.map(([name, exported]) => [name, exported.baseline]),
  );
  const proposedExports = Object.fromEntries(
    held.map(([name, exported]) => [name, exported.proposed]),
  );
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

function isRecordValue(value: Json): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A JSON value as text, its keys in order; a node's Neutral annotations left out when asked. The
 * oracle's helpers are written apart from the generator's on purpose, so it shares no code with it.
 */
function textOf(value: Json, leavesNeutralOut: boolean): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => textOf(item, leavesNeutralOut)).join(',')}]`;
  }
  if (!isRecordValue(value)) {
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

/**
 * Every node of a graph's defs and exports, found by the place a Snapshot puts a node in, so a
 * node that lost its `type` is found too, which a search for nodes by their `type` would miss.
 */
function placedNodesIn(roots: readonly Json[]): Json[] {
  const placed: Json[] = [];
  const pending = [...roots];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    placed.push(next);
    for (const inner of nodesPlacedIn(next)) {
      pending.push(inner);
    }
  }
  return placed;
}

/** The nodes a node holds directly: its fields' schemas, key, value, rest, items, options and variants. */
function nodesPlacedIn(node: Json): Json[] {
  if (!isRecordValue(node)) {
    return [];
  }
  const fields = Object.values(isRecordValue(node.fields) ? node.fields : {});
  const variants = Object.values(isRecordValue(node.variants) ? node.variants : {});
  const lists = [node.items, node.options].flatMap((list) => (Array.isArray(list) ? list : []));
  const held = [
    ...fields.map((field) => (isRecordValue(field) ? field.schema : undefined)),
    ...variants,
    ...lists,
    node.items,
    node.key,
    node.value,
    node.rest,
  ];
  return held.filter(isRecordValue);
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
      const counterpart = isRecordValue(proposed) ? proposed[name] : undefined;
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
  if (!isRecordValue(baseline)) {
    return [];
  }
  const keys = Object.keys(baseline).filter((key) => !neutralNames.some((name) => name === key));
  return keys.map((key): [Json, Json] => [
    baseline[key],
    isRecordValue(proposed) ? proposed[key] : undefined,
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
      'a def named like an Object member': pairs.filter((pair) =>
        Object.hasOwn(pair.baseline, 'constructor'),
      ).length,
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

  test('every node of every proposed copy the generator draws has a type a Snapshot node has', () => {
    const types: readonly unknown[] = Object.keys(nodeTypes);
    const untyped = pairs.flatMap((pair, seed) => {
      const proposedExports = exportsOf(pair).map((held) => held.proposed);
      const nodes = placedNodesIn([...Object.values(pair.proposed), ...proposedExports]);
      return nodes
        .filter((node) => !isRecordValue(node) || !types.includes(node.type))
        .map((node) => `draw ${seed} (${pair.edit}): ${textOf(node, false)}`);
    });

    expect(untyped.slice(0, 3)).toEqual([]);
    expect(untyped).toHaveLength(0);
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
      ...serviceHeading,
      ...publishedAt('3.4.0'),
      formerInputs: [],
      defs: { tree: defs.baseline },
      endpoints: { [identity]: anEndpoint([taken]) },
      codes: { [gone]: removed, [taken]: aCode() },
    };
    const proposed: ServiceSnapshot = {
      ...serviceHeading,
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
  /** A Definitions Package whose one export holds a plain union over its recursive `tree` def. */
  function exportingTree(held: ObjectNode) {
    return {
      ...definitionsHeading,
      defs: { tree: held },
      exports: schemaExports({ wrapped: unionWithTree }),
    };
  }

  test('one Baseline checked against two proposed Snapshots is judged against each one’s own defs: the unchanged one reports nothing, and the one whose tree differs one Breaking Change', () => {
    const baseline: PublishedDefinitionsSnapshot = {
      ...exportingTree(aTree()),
      ...publishedAt('1.0.0'),
    };
    const unchanged: DefinitionsSnapshot = exportingTree(aTree());
    const grown: DefinitionsSnapshot = exportingTree(aTree('label'));

    const reports = [unchanged, grown].map(
      (proposed) => compatibilityReportOf(baseline, proposed).changes,
    );

    expect(reports).toEqual([
      [],
      [
        {
          site: { kind: 'export', name: 'wrapped', visibility: 'public' },
          difference: {
            kind: 'schema',
            position: 'message',
            at: [],
            shape: { kind: 'union-changed' },
          },
          class: 'breaking',
          verdict: 'approval-needed',
        },
      ],
    ]);
  });
});

describe('compatibilityReportOf, a plain union whose reached def and option both differ in a Neutral annotation', () => {
  /** A Definitions Package whose one export is a plain union of a described def and a boolean with examples. */
  function exportingUnion(description: string, examples: readonly string[]) {
    const described: SchemaNode = {
      type: 'object',
      description,
      fields: { a: { required: true, schema: { type: 'string' } } },
    };
    const options: SchemaNode[] = [
      { type: 'ref', name: 'described' },
      { type: 'boolean', examples },
    ];
    const wrapped: SchemaNode = { type: 'union', options };
    return {
      ...definitionsHeading,
      defs: { described },
      exports: schemaExports({ wrapped }),
    };
  }

  function neutralAt(annotation: Neutral): Change {
    return {
      site: { kind: 'export', name: 'wrapped', visibility: 'public' },
      difference: {
        kind: 'schema',
        position: 'message',
        at: [],
        shape: { kind: 'annotation-changed', annotation },
      },
      class: 'neutral',
      verdict: 'allowed',
    };
  }

  test('a reached def’s description and an option’s examples that both differ are two Neutral Changes, in the order description, examples', () => {
    const baseline: PublishedDefinitionsSnapshot = {
      ...exportingUnion('x', ['1']),
      ...publishedAt('1.0.0'),
    };
    const proposed: DefinitionsSnapshot = exportingUnion('y', ['2']);

    const changes = compatibilityReportOf(baseline, proposed).changes;

    expect(changes).toEqual([neutralAt('description'), neutralAt('examples')]);
  });
});

/** The keys of a Guard that hold a schema: its Qualifier and Context, and its demands, which hold two. */
type SchemaKeyOfGuard = {
  [Key in keyof GuardSnapshot]: GuardSnapshot[Key] extends
    | SchemaNode
    | null
    | { readonly headers: SchemaNode; readonly query: SchemaNode }
    ? Key
    : never;
}[keyof GuardSnapshot];

/**
 * How a Guard names a def in each schema it holds. Its demands are text parts, which hold no
 * recursive schema in any Snapshot, so they name none.
 */
const guardsNaming = {
  qualifier: (ref) => ({ qualifier: ref }),
  context: (ref) => ({
    context: { type: 'object', fields: { at: { required: true, schema: ref } } },
  }),
  demands: () => ({}),
} satisfies Record<SchemaKeyOfGuard, (ref: SchemaNode) => Partial<GuardSnapshot>>;

function aGuardNaming(name: string): GuardSnapshot {
  const ref: SchemaNode = { type: 'ref', name };
  let guard: GuardSnapshot = {
    origin: 'local',
    description: 'Authenticates the Caller',
    guards: [],
    qualifier: null,
    demands: { headers: emptyPart, query: emptyPart },
    context: null,
    rejections: [],
  };
  for (const naming of Object.values(guardsNaming)) {
    guard = { ...guard, ...naming(ref) };
  }
  return guard;
}

/** A value of a Service Snapshot that a Neutral rule reads with the defs it reaches, on both sides. */
type Site = {
  /** What the Check tells when the site differs. */
  readonly change: string;
  readonly baseline: Json;
  readonly proposed: Json;
};

/** What moves with an Element's lifecycle, which a Retired Element's declaration is compared without. */
const historyKeys = ['lifecycle', 'retiredIn', 'deprecatedAt'];

function declaredWithoutHistory(declaration: object): Json {
  const kept = Object.entries(declaration).filter(([key]) => !historyKeys.includes(key));
  return Object.fromEntries(kept);
}

/** A Change as the sites below tell it: what differs, and where, by name or identity. */
function changeTextOf(kind: string, site: ChangeSite): string {
  if ('identity' in site) {
    return `${kind} at ${site.kind} ${site.identity}`;
  }
  return 'name' in site ? `${kind} at ${site.kind} ${site.name}` : `${kind} at ${site.kind}`;
}

/**
 * A Service Snapshot on each side of a seeded graph: for each def, a Guard whose Qualifier names
 * it and whose Context holds it in a field, and a Command and an Endpoint Retired on both sides
 * whose bodies name it, the Endpoint in its Input and its Success; and each export of the draw as
 * the body of one more Retired Command, so every def of both sides is reached.
 */
function servicesOf(pair: DefPair) {
  const names = Object.keys(pair.baseline);
  const named = (name: string): SchemaNode => ({
    type: 'object',
    fields: { at: { required: true, schema: { type: 'ref', name } } },
  });
  const commandOf = (body: SchemaNode, retiredIn: object): CommandSnapshot => ({
    group: 'orders',
    description: 'Charge a card',
    body,
    lifecycle: 'retired',
    ...retiredIn,
  });
  const endpointOf = (body: SchemaNode, retiredIn: object): EndpointSnapshot => ({
    name: 'getOrder',
    group: 'orders',
    visibility: 'public',
    description: 'One order',
    params: [],
    guards: [],
    input: { params: null, query: emptyPart, headers: emptyPart, body },
    success: { status: 200, headers: emptyPart, body },
    rejections: [],
    lifecycle: 'retired',
    ...retiredIn,
  });
  const sideOf = (side: 'baseline' | 'proposed', retiredIn: object) => {
    const guards = names.map((name, index) => [`g${index}`, aGuardNaming(name)]);
    const retiredCommands = names.map((name, index) => [
      `Retired${index}@1`,
      commandOf(named(name), retiredIn),
    ]);
    const exportCommands = Object.entries(pair.exports).map(([name, held]) => [
      `Export${name}@1`,
      commandOf(held[side], retiredIn),
    ]);
    const endpoints = names.map((name, index) => [
      `GET /retired${index}`,
      endpointOf(named(name), retiredIn),
    ]);
    return {
      ...serviceHeading,
      defs: pair[side],
      guards: Object.fromEntries(guards),
      commands: Object.fromEntries([...retiredCommands, ...exportCommands]),
      endpoints: Object.fromEntries(endpoints),
      codes: {},
    };
  };
  const baseline: PublishedServiceSnapshot = {
    ...sideOf('baseline', { retiredIn: '3.0.0' }),
    ...publishedAt('3.4.0'),
    formerInputs: [],
  };
  const proposed: ServiceSnapshot = sideOf('proposed', {});
  return { baseline, proposed, sites: sitesOf(baseline, proposed) };
}

function sitesOf(baseline: PublishedServiceSnapshot, proposed: ServiceSnapshot): Site[] {
  const guards = Object.entries(baseline.guards).flatMap(([name, guard]): Site[] => {
    const after = proposed.guards[name] as GuardSnapshot;
    const change = (kind: string) => `${kind} at guard ${name}`;
    return [
      { change: change('qualifier-changed'), baseline: guard.qualifier, proposed: after.qualifier },
      { change: change('context-changed'), baseline: guard.context, proposed: after.context },
    ];
  });
  const retired = (kind: 'command' | 'endpoint', held: object, after: object): Site[] =>
    Object.entries(held).map(([identity, declaration]) => ({
      change: `retired-changed at ${kind} ${identity}`,
      baseline: declaredWithoutHistory(declaration),
      proposed: declaredWithoutHistory(Reflect.get(after, identity)),
    }));
  return [
    ...guards,
    ...retired('command', baseline.commands, proposed.commands),
    ...retired('endpoint', baseline.endpoints, proposed.endpoints),
  ];
}

/**
 * A site's value as text with, in the order a walk of its `ref`s meets them, every def it reaches
 * and that def's text: it differs exactly when the value or a def it reaches does.
 */
function keyOf(value: Json, defs: Defs): string {
  const reached = closureOf(refsIn(value), defs);
  return textOf([value, reached.map((name) => [name, defs[name]])], false);
}

describe('compatibilityReportOf, the defs a Guard’s schemas and a Retired Element reach, over a seeded def graph', () => {
  const services = pairs.map((pair) => ({ pair, ...servicesOf(pair) }));
  const sites = services.flatMap(({ pair, sites: held }) => held.map((site) => ({ pair, site })));
  const differs = ({ pair, site }: (typeof sites)[number]) =>
    keyOf(site.baseline, pair.baseline) !== keyOf(site.proposed, pair.proposed);
  const hasSameText = ({ site }: (typeof sites)[number]) =>
    textOf(site.baseline, false) === textOf(site.proposed, false);

  /** Whether the defs a site reaches are the same names and the same shapes on both sides. */
  function reachesSameShapes({ pair, site }: (typeof sites)[number]): boolean {
    const before = closureOf(refsIn(site.baseline), pair.baseline);
    const after = closureOf(refsIn(site.proposed), pair.proposed);
    const hasSameShape = (name: string) =>
      textOf(pair.baseline[name], true) === textOf(pair.proposed[name], true);
    return (
      before.length === after.length &&
      before.every((name) => after.includes(name) && hasSameShape(name))
    );
  }

  test('the generator draws sites that differ only in a def they reach, only in an annotation within one, through a cycle, and not at all', () => {
    const facts = {
      'differ only in a def they reach': sites.filter((held) => hasSameText(held) && differs(held)),
      'differ only in a Neutral annotation within a def they reach': sites.filter(
        (held) => hasSameText(held) && differs(held) && reachesSameShapes(held),
      ),
      'reach a cycle': sites.filter(({ pair, site }) =>
        holdsCycle(pair, closureOf(refsIn(site.baseline), pair.baseline)),
      ),
      'do not differ': sites.filter((held) => !differs(held)),
    };

    for (const [fact, held] of Object.entries(facts)) {
      expect(held.length, fact).toBeGreaterThanOrEqual(100);
    }
  });

  test('a Guard’s Qualifier and Context and a Retired Element’s declaration give their Neutral Change exactly when they or a def they reach differ in their text', () => {
    const problems: string[] = [];

    for (const [seed, { pair, baseline, proposed, sites: held }] of services.entries()) {
      try {
        const reported = compatibilityReportOf(baseline, proposed).changes.map(
          ({ site, difference }) => changeTextOf(difference.kind, site),
        );
        const expected = held.filter((site) => differs({ pair, site })).map(({ change }) => change);
        if (reported.sort().join() !== expected.sort().join()) {
          problems.push(
            `draw ${seed} (${pair.edit}): reported ${reported.join(' ')}, expected ${expected.join(' ')}`,
          );
        }
      } catch (error) {
        problems.push(`draw ${seed}: ${String(error)}`);
      }
    }

    expect(problems.slice(0, 3)).toEqual([]);
    expect(problems).toHaveLength(0);
  });
});
