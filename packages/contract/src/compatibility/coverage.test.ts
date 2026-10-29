import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { seededNext } from '../../test/random-schemas.ts';
import { publishedAt, publishedServiceAt } from '../../test/snapshots.ts';
import {
  canonicalTextOf,
  compatibilityReportOf,
  decodeSnapshot,
  type Field,
  type ObjectNode,
  type Path,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  publishedSnapshotOf,
  type RefNode,
  type SchemaNode,
  type ServiceSnapshot,
  type Snapshot,
} from '../internal/index.ts';

const examples = ['org-definitions', 'orders-service', 'billing-service'] as const;
const examplesDirectory = new URL('../../../../examples/', import.meta.url);

type Json = unknown;

/** One change to one place of a Snapshot's JSON: a leaf edited, an array or a map reshaped. */
type Mutation = {
  readonly at: Path;
  readonly operation: string;
  readonly change: (snapshot: Json) => Json;
};

function declaredSnapshotOf(example: string): Json {
  const file = new URL(`${example}/contract.snapshot.json`, examplesDirectory);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function valueAt(json: Json, at: Path): Json {
  let value = json;
  for (const key of at) {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    value = Reflect.get(value, key);
  }
  return value;
}

/** A copy of a JSON value with the value at a place replaced by what `change` makes of it, or as it is when the place is gone. */
function changedAt(json: Json, at: Path, change: (value: Json) => Json): Json {
  const copy: Json = structuredClone(json);
  const holder = valueAt(copy, at.slice(0, -1));
  const key = at[at.length - 1] as string | number;
  if (typeof holder !== 'object' || holder === null || !Reflect.has(holder, key)) {
    return copy;
  }
  Reflect.set(holder, key, change(Reflect.get(holder, key)));
  return copy;
}

function placesOf(json: Json, at: Path = []): readonly Path[] {
  if (typeof json !== 'object' || json === null) {
    return [at];
  }
  const inside = Object.entries(json).flatMap(([key, value]) =>
    placesOf(value, [...at, Array.isArray(json) ? Number(key) : key]),
  );
  return [at, ...inside];
}

function mutationsAt(json: Json, at: Path): readonly Mutation[] {
  const value = valueAt(json, at);
  const edit = (operation: string, apply: (value: Json) => Json): Mutation => ({
    at,
    operation,
    change: (snapshot) => changedAt(snapshot, at, apply),
  });
  if (typeof value === 'string') {
    return [edit('append', (text) => `${text as string}x`)];
  }
  if (typeof value === 'number') {
    return [edit('increment', (number) => (number as number) + 1)];
  }
  if (typeof value === 'boolean') {
    return [edit('flip', (flag) => !flag)];
  }
  if (value === null) {
    return [edit('give a value', () => 'x')];
  }
  return Array.isArray(value) ? arrayMutations(value, edit) : mapMutations(value as object, edit);
}

function arrayMutations(
  items: readonly Json[],
  edit: (operation: string, apply: (value: Json) => Json) => Mutation,
): readonly Mutation[] {
  const list = (value: Json) => value as Json[];
  const mutations: Mutation[] = [];
  if (items.length > 1) {
    mutations.push(edit('reorder', (value) => [...list(value)].reverse()));
  }
  if (items.length > 0) {
    mutations.push(edit('shorten', (value) => list(value).slice(0, -1)));
    mutations.push(
      edit('extend', (value) => [...list(value), structuredClone(list(value).at(-1))]),
    );
  }
  return mutations;
}

function mapMutations(
  map: object,
  edit: (operation: string, apply: (value: Json) => Json) => Mutation,
): readonly Mutation[] {
  const keys = Object.keys(map);
  if (keys.length === 0) {
    return [];
  }
  const record = (value: Json) => value as Record<string, Json>;
  const removeLast = (value: Json) => {
    const { [keys.at(-1) as string]: _removed, ...kept } = record(value);
    return kept;
  };
  const addCopy = (value: Json) => ({
    ...record(value),
    added: structuredClone(record(value)[keys[0] as string]),
  });
  return [edit('remove an entry', removeLast), edit('add an entry', addCopy)];
}

/** The keys every Snapshot starts with, which identify the package and the format, not its Contract. */
const headingKeys = ['format', 'kind', 'name'];

/** Whether a place is the heading, which names the package and its format, not its Contract. */
function isHeading(at: Path): boolean {
  return at.length === 1 && headingKeys.includes(String(at[0]));
}

/** A Snapshot with every use of a code under another name, as when a Standard Rejection resolves to it. */
function withCodeRenamed(json: Json, from: string, to: string): Json {
  if (json === from) {
    return to;
  }
  if (Array.isArray(json)) {
    return json.map((item) => withCodeRenamed(item, from, to));
  }
  if (typeof json !== 'object' || json === null) {
    return json;
  }
  const renamed = Object.entries(json).map(([key, value]) => [
    key === from ? to : key,
    withCodeRenamed(value, from, to),
  ]);
  return Object.fromEntries(renamed);
}

/** Each Standard Rejection resolving to another code, which no single place of the Snapshot can change alone. */
function remapsOf(declared: Json): readonly Mutation[] {
  const standard = Reflect.get(declared as object, 'standardRejections') as Record<string, string>;
  return Object.entries(standard).map(([name, code]) => ({
    at: ['standardRejections', name],
    operation: 'resolve to another code',
    change: (snapshot) => withCodeRenamed(snapshot, code, `${code}_REMAPPED`),
  }));
}

function mutationsOf(declared: Json): readonly Mutation[] {
  const kind = String(Reflect.get(declared as object, 'kind'));
  const places = placesOf(declared)
    .filter((at) => at.length > 0 && !isHeading(at))
    .flatMap((at) => mutationsAt(declared, at));
  return kind === 'application' ? places : [...places, ...remapsOf(declared)];
}

/** The mutation as a declared Snapshot `generate` can write, or `undefined` when the decoder refuses it. */
function writableAfter(declared: Json, mutations: readonly Mutation[]): Snapshot | undefined {
  let mutated: Json = declared;
  for (const mutation of mutations) {
    mutated = mutation.change(mutated);
  }
  const kind = Reflect.get(mutated as object, 'kind');
  const heading = kind === 'service' ? publishedServiceAt('1.0.1') : publishedAt('1.0.1');
  const published = JSON.stringify({ ...(mutated as object), ...heading });
  return decodeSnapshot(published).kind === 'decoded' ? (mutated as Snapshot) : undefined;
}

/** Whether the Check finds a difference in the text published over the Baseline and names no Change for it: the bug it then throws. */
function isUnnamed(baseline: PublishedSnapshot, proposed: Snapshot): boolean {
  try {
    compatibilityReportOf(baseline, proposed);
    return false;
  } catch (error) {
    if (error instanceof Error && error.message.includes('no Change was found')) {
      return true;
    }
    throw error;
  }
}

function describeMutations(mutations: readonly Mutation[]): string {
  return mutations.map(({ at, operation }) => `${operation} at ${at.join('.')}`).join('; ');
}

describe('compatibilityReportOf, every difference in the published text is a Change', () => {
  test.each(examples)('every single-place mutation of %s that generate can write', (example) => {
    const declared = declaredSnapshotOf(example);
    const baseline = publishedSnapshotOf(undefined, declared as Snapshot, publishedAt('1.0.0'));
    const missed: string[] = [];
    let checked = 0;

    for (const mutation of mutationsOf(declared)) {
      const proposed = writableAfter(declared, [mutation]);
      if (proposed === undefined) {
        continue;
      }
      checked++;
      if (isUnnamed(baseline, proposed)) {
        missed.push(describeMutations([mutation]));
      }
    }

    expect(missed).toEqual([]);
    expect(checked).toBeGreaterThan(25);
  });

  test.each(examples)(
    'seeded mutations of several places of %s that generate can write',
    (example) => {
      const declared = declaredSnapshotOf(example);
      const baseline = publishedSnapshotOf(undefined, declared as Snapshot, publishedAt('1.0.0'));
      const candidates = mutationsOf(declared);
      const next = seededNext(165);
      const missed: string[] = [];

      for (let round = 0; round < 300; round++) {
        const count = 2 + Math.floor(next() * 3);
        const chosen = Array.from(
          { length: count },
          () => candidates[Math.floor(next() * candidates.length)] as Mutation,
        );
        const proposed = writableAfter(declared, chosen);
        if (proposed === undefined) {
          continue;
        }
        if (isUnnamed(baseline, proposed)) {
          missed.push(describeMutations(chosen));
        }
      }

      expect(missed).toEqual([]);
    },
  );
});

/** The defs a seeded def graph draws its `ref`s from: three objects, an alias def and an alias of an alias. */
const graphDefNames = ['first', 'second', 'third', 'alias', 'aliasOfAlias'] as const;
type GraphDefName = (typeof graphDefNames)[number];
type Fields = Readonly<Record<string, Field>>;
type Annotations = Pick<SchemaNode, 'description' | 'examples' | 'origin'>;
type Alias = { readonly target: GraphDefName; readonly annotations: Annotations };

/** One version of a seeded def graph: the objects' fields, the body's, and where each alias def points. */
type Graph = {
  readonly first: Fields;
  readonly second: Fields;
  readonly third: Fields;
  readonly body: Fields;
  readonly alias: Alias;
  readonly aliasOfAlias: Alias;
};

const fieldNames = ['f', 'g', 'h', 'k'];
const graphLeaves: readonly SchemaNode[] = [
  { type: 'number' },
  { type: 'string' },
  { type: 'boolean' },
  { type: 'number', min: 3 },
];
const aliasAnnotations: readonly Annotations[] = [
  {},
  { description: 'd' },
  { description: 'e' },
  { examples: [1] },
  { origin: 'local' },
];

/** Draws def graphs and their next versions from a seed, so a failing history replays. */
function seededGraphs(seed: number) {
  const next = seededNext(seed);
  const pick = <Value>(values: readonly Value[]): Value =>
    values[Math.floor(next() * values.length)] as Value;
  const aRef = (): SchemaNode => {
    const name = pick(graphDefNames);
    const draw = next();
    if (draw < 0.15) {
      return { type: 'ref', name, nullable: true };
    }
    return draw < 0.25 ? { type: 'ref', name, description: 'd' } : { type: 'ref', name };
  };
  const variantOf = (depth: number): ObjectNode | RefNode =>
    next() < 0.5
      ? { type: 'ref', name: pick(graphDefNames) }
      : objectOf({ k: { required: true, schema: anEnumOf('x') }, ...fieldsOf(depth + 1, 2) });
  const schemaOf = (depth: number): SchemaNode => {
    const draw = next();
    if (depth > 2 || draw < 0.3) {
      return pick(graphLeaves);
    }
    if (draw < 0.55) {
      return aRef();
    }
    if (draw < 0.65) {
      return { type: 'array', items: schemaOf(depth + 1) };
    }
    if (draw < 0.72) {
      return { type: 'record', key: { type: 'string' }, value: schemaOf(depth + 1) };
    }
    if (draw < 0.8) {
      const variants = {
        '"x"': variantOf(depth),
        '"y"': objectOf({ k: { required: true, schema: anEnumOf('y') } }),
      };
      return { type: 'tagged', discriminator: 'k', variants };
    }
    if (draw < 0.86) {
      return {
        type: 'union',
        options: [{ type: 'ref', name: pick(graphDefNames) }, { type: 'number' }],
      };
    }
    if (draw < 0.9) {
      return { type: 'tuple', items: [], rest: schemaOf(depth + 1) };
    }
    return objectOf(fieldsOf(depth + 1, 3));
  };
  const fieldsOf = (depth: number, count: number): Fields => {
    const fields: Record<string, Field> = {};
    for (const name of fieldNames.slice(0, count)) {
      if (next() < 0.6) {
        fields[name] = { required: next() < 0.1, schema: schemaOf(depth) };
      }
    }
    return fields;
  };
  const changedFields = (fields: Fields, depth: number): Fields => {
    const name = pick(fieldNames);
    if (next() < 0.35) {
      const { [name]: _removed, ...kept } = fields;
      return kept;
    }
    return { ...fields, [name]: { required: next() < 0.1, schema: schemaOf(depth) } };
  };
  const changedAlias = (graph: Graph): Graph => {
    const draw = next();
    if (draw < 0.25) {
      return {
        ...graph,
        alias: { ...graph.alias, target: pick(['first', 'second', 'third'] as const) },
      };
    }
    if (draw < 0.5) {
      return {
        ...graph,
        aliasOfAlias: {
          ...graph.aliasOfAlias,
          target: pick(['alias', 'first', 'second'] as const),
        },
      };
    }
    if (draw < 0.75) {
      return { ...graph, alias: { ...graph.alias, annotations: pick(aliasAnnotations) } };
    }
    return {
      ...graph,
      aliasOfAlias: { ...graph.aliasOfAlias, annotations: pick(aliasAnnotations) },
    };
  };
  return {
    initial: (): Graph => ({
      first: fieldsOf(1, 4),
      second: fieldsOf(1, 3),
      third: fieldsOf(1, 2),
      body: fieldsOf(0, 4),
      alias: { target: 'first', annotations: {} },
      aliasOfAlias: { target: 'alias', annotations: {} },
    }),
    changed: (graph: Graph): Graph => {
      const part = pick([
        'first',
        'second',
        'third',
        'body',
        'body',
        'aliases',
        'aliases',
      ] as const);
      if (part === 'aliases') {
        return changedAlias(graph);
      }
      return { ...graph, [part]: changedFields(graph[part], part === 'body' ? 0 : 1) };
    },
  };
}

function objectOf(fields: Fields): ObjectNode {
  return { type: 'object', fields };
}

function anEnumOf(value: string): SchemaNode {
  return { type: 'enum', values: [value], open: false };
}

function namesIn(node: SchemaNode | Fields): readonly string[] {
  const text = JSON.stringify(node);
  const names = [...text.matchAll(/"type":"ref","name":"(\w+)"/g)].map((match) => match[1]);
  return names.filter((name): name is string => name !== undefined);
}

/** The defs a graph's body reaches through `ref`s, as `generate` keeps only those. */
function reachedDefsOf(graph: Graph): Readonly<Record<string, SchemaNode>> {
  const all: Readonly<Record<string, SchemaNode>> = {
    first: objectOf(graph.first),
    second: objectOf(graph.second),
    third: objectOf(graph.third),
    alias: { type: 'ref', name: graph.alias.target, ...graph.alias.annotations },
    aliasOfAlias: {
      type: 'ref',
      name: graph.aliasOfAlias.target,
      ...graph.aliasOfAlias.annotations,
    },
  };
  const reached = new Set<string>();
  const pending = [...namesIn(graph.body)];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    const def = all[name];
    if (reached.has(name) || def === undefined) {
      continue;
    }
    reached.add(name);
    for (const referenced of namesIn(def)) {
      pending.push(referenced);
    }
  }
  const names = [...reached].sort();
  return Object.fromEntries(names.map((name) => [name, all[name] as SchemaNode]));
}

const emptyObject = { type: 'object', fields: {} } as const;
const standardRejections: ServiceSnapshot['standardRejections'] = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};

function aServiceOf(graph: Graph): ServiceSnapshot {
  const code = (status: number, body: SchemaNode | null) => ({
    origin: 'standard' as const,
    status,
    message: 'Standard',
    headers: emptyObject,
    body,
  });
  return {
    format: 1,
    kind: 'service',
    name: 'orders-service',
    standardRejections,
    groups: { orders: { description: 'Orders' } },
    defs: reachedDefsOf(graph),
    endpoints: {
      'POST /orders': {
        name: 'createOrder',
        group: 'orders',
        visibility: 'public',
        lifecycle: 'active',
        description: 'Places an order',
        params: [],
        guards: [],
        input: {
          params: null,
          query: emptyObject,
          headers: emptyObject,
          body: objectOf({ id: { required: true, schema: { type: 'string' } }, ...graph.body }),
        },
        success: { status: 201, headers: emptyObject, body: null },
        rejections: [],
      },
    },
    events: {},
    commands: {},
    guards: {},
    codes: {
      [standardRejections.invalidInput]: code(400, emptyObject),
      [standardRejections.notFound]: code(404, null),
      [standardRejections.notImplemented]: code(501, null),
    },
    subscriptions: {},
    dependencies: {},
  };
}

/** What is wrong with one publish of a history: a Check that throws, a republish that changes, or a Baseline the decoder refuses. */
function publishProblemsOf(
  baseline: PublishedServiceSnapshot | undefined,
  proposed: ServiceSnapshot,
  version: string,
): { readonly published: PublishedServiceSnapshot; readonly problems: readonly string[] } {
  const problems: string[] = [];
  if (baseline !== undefined) {
    compatibilityReportOf(baseline, proposed);
  }
  const published = publishedSnapshotOf(baseline, proposed, publishedAt(version));
  const again = publishedSnapshotOf(published, proposed, publishedAt(version));
  if (canonicalTextOf(again) !== canonicalTextOf(published)) {
    problems.push(`${version}: an unchanged republish changes the Baseline`);
  }
  if (compatibilityReportOf(published, proposed).changes.length > 0) {
    problems.push(`${version}: an unchanged republish reports a Change`);
  }
  if (decodeSnapshot(canonicalTextOf(published)).kind !== 'decoded') {
    problems.push(`${version}: the published Baseline does not decode`);
  }
  return { published, problems };
}

/** What is wrong with the 7 versions of one seeded history, each problem named with the history. */
function historyProblemsOf(graphs: ReturnType<typeof seededGraphs>, history: number): string[] {
  const problems: string[] = [];
  let graph = graphs.initial();
  let baseline: PublishedServiceSnapshot | undefined;
  for (let minor = 0; minor < 7; minor++) {
    graph = minor === 0 ? graph : graphs.changed(graph);
    try {
      const step = publishProblemsOf(baseline, aServiceOf(graph), `1.${minor}.0`);
      for (const problem of step.problems) {
        problems.push(`history ${history}, ${problem}`);
      }
      baseline = step.published;
    } catch (error) {
      problems.push(`history ${history}, 1.${minor}.0: ${String(error)}`);
      break;
    }
  }
  return problems;
}

describe('compatibilityReportOf, every difference in a seeded def graph’s history is a Change', () => {
  test('150 histories of 7 versions, with alias defs in fields, arrays, records, tagged variants, a plain union’s option and a tuple’s rest', () => {
    const graphs = seededGraphs(1);
    const problems: string[] = [];

    for (let history = 0; history < 150; history++) {
      for (const problem of historyProblemsOf(graphs, history)) {
        problems.push(problem);
      }
    }

    expect(problems).toEqual([]);
  });
});

/** A field of an object node. */
function aField(schema: SchemaNode, required = false) {
  return { required, schema };
}

const emptyPart = { type: 'object', fields: {} } as const;
const invalidInput = 'INVALID_INPUT';
const notFound = 'NOT_FOUND';
const notImplemented = 'NOT_IMPLEMENTED';
const taken = 'TAKEN';

/** A declared Service of one Endpoint, `POST /orders`, with the query, body, defs and codes given. */
function anOrdersService(declared: {
  readonly query: ObjectNode['fields'];
  readonly body: ObjectNode['fields'];
  readonly defs: Readonly<Record<string, SchemaNode>>;
  readonly codes: Readonly<Record<string, SchemaNode>>;
}): Snapshot {
  const standard = { origin: 'standard', headers: emptyPart, body: null } as const;
  const local = Object.entries(declared.codes).map(([code, body]) => [
    code,
    { origin: 'local', status: 409, message: 'Taken', headers: emptyPart, body },
  ]);
  return {
    format: 1,
    kind: 'service',
    name: 'orders-service',
    standardRejections: { invalidInput, notFound, notImplemented },
    groups: { orders: { description: 'Orders' } },
    defs: declared.defs,
    endpoints: {
      'POST /orders': {
        name: 'createOrder',
        group: 'orders',
        visibility: 'public',
        lifecycle: 'active',
        description: 'Places an order',
        params: [],
        guards: [],
        input: {
          params: null,
          query: { type: 'object', fields: declared.query },
          headers: emptyPart,
          body: { type: 'object', fields: declared.body },
        },
        success: { status: 201, headers: emptyPart, body: null },
        rejections: Object.keys(declared.codes).sort(),
      },
    },
    events: {},
    commands: {},
    guards: {},
    codes: {
      [invalidInput]: { ...standard, status: 400, message: 'Invalid', body: emptyPart },
      [notFound]: { ...standard, status: 404, message: 'Not found' },
      [notImplemented]: { ...standard, status: 501, message: 'No' },
      ...Object.fromEntries(local),
    },
    subscriptions: {},
    dependencies: {},
  };
}

/**
 * Three publishes of one Endpoint: fields removed from its query and body, a code that reached a
 * def removed, and an alias def dropped, so the last holds former Inputs with defs and a removed code.
 */
function aHistory(): { readonly baseline: PublishedSnapshot; readonly declared: Snapshot } {
  const ref = (name: string): SchemaNode => ({ type: 'ref', name });
  const item: SchemaNode = {
    type: 'object',
    fields: { label: aField({ type: 'string' }), child: aField(ref('item')) },
  };
  const id = aField({ type: 'string' }, true);
  const items = aField({ type: 'array', items: ref('item') });
  const takenBy = { type: 'object', fields: { by: aField(ref('item'), true) } } as const;
  const versions = [
    anOrdersService({
      query: { page: aField({ type: 'number' }) },
      body: { id, first: aField(ref('alias')), count: aField({ type: 'number' }), items },
      defs: { item, alias: ref('item') },
      codes: { [taken]: takenBy },
    }),
    anOrdersService({
      query: {},
      body: { id, first: aField(ref('alias')), items },
      defs: { item, alias: ref('item') },
      codes: {},
    }),
    anOrdersService({ query: {}, body: { id, items }, defs: { item }, codes: {} }),
  ];
  let baseline: PublishedSnapshot | undefined;
  versions.forEach((declared, index) => {
    baseline = publishedSnapshotOf(baseline, declared, publishedAt(`1.${index}.0`));
  });
  return { baseline: baseline as PublishedSnapshot, declared: versions[2] as Snapshot };
}

/** Every mutation of a published Baseline's places but its heading, which names the package and its format. */
function baselineMutationsOf(baseline: Json): readonly Mutation[] {
  const places = placesOf(baseline).filter((at) => at.length > 0 && !isHeading(at));
  return places.flatMap((at) => mutationsAt(baseline, at));
}

/** How a mutated Baseline fares: refused by the decoder, or decoded and checked, or what threw. */
function thrownFor(baseline: Json, mutations: readonly Mutation[], declared: Snapshot) {
  let mutated: Json = baseline;
  for (const mutation of mutations) {
    mutated = mutation.change(mutated);
  }
  try {
    const decoded = decodeSnapshot(JSON.stringify(mutated));
    if (decoded.kind === 'decoded') {
      compatibilityReportOf(decoded.snapshot, declared);
    }
    return undefined;
  } catch (error) {
    return `${describeMutations(mutations)}: ${error instanceof Error ? error.message : error}`;
  }
}

/** What threw for 300 seeded mutations of two to four places each of a Baseline. */
function seededThrownOf(baseline: Json, declared: Snapshot): readonly string[] {
  const candidates = baselineMutationsOf(baseline);
  const next = seededNext(341);
  const thrown: string[] = [];
  for (let round = 0; round < 300; round++) {
    const count = 2 + Math.floor(next() * 3);
    const chosen = Array.from(
      { length: count },
      () => candidates[Math.floor(next() * candidates.length)] as Mutation,
    );
    const line = thrownFor(baseline, chosen, declared);
    if (line !== undefined) {
      thrown.push(line);
    }
  }
  return thrown;
}

describe('decodeSnapshot, a Baseline it decodes never makes the Check throw', () => {
  const published = (example: string) => {
    const declared = declaredSnapshotOf(example) as Snapshot;
    const baseline = publishedSnapshotOf(undefined, declared, publishedAt('1.0.0'));
    return { baseline, declared };
  };

  test.each(examples)('every single-place mutation of the Baseline %s publishes', (example) => {
    const { baseline, declared } = published(example);

    const thrown = baselineMutationsOf(baseline).map((mutation) =>
      thrownFor(baseline, [mutation], declared),
    );

    expect(thrown.filter((line) => line !== undefined)).toEqual([]);
  });

  test.each(examples)(
    'seeded mutations of several places of the Baseline %s publishes',
    (example) => {
      const { baseline, declared } = published(example);

      const thrown = seededThrownOf(baseline, declared);

      expect(thrown).toEqual([]);
    },
  );

  test('every single-place mutation of a Baseline with former Inputs, a removed code and an alias def', () => {
    const { baseline, declared } = aHistory();

    const thrown = baselineMutationsOf(baseline).map((mutation) =>
      thrownFor(baseline, [mutation], declared),
    );

    expect(baseline.kind === 'service' && baseline.formerInputs.length).toBeGreaterThan(0);
    expect(thrown.filter((line) => line !== undefined)).toEqual([]);
  });

  test('seeded mutations of several places of a Baseline with former Inputs, a removed code and an alias def', () => {
    const { baseline, declared } = aHistory();

    const thrown = seededThrownOf(baseline, declared);

    expect(thrown).toEqual([]);
  });
});
