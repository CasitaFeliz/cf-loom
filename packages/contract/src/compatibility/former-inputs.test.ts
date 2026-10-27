import { describe, expect, test } from 'vitest';
import { seededNext } from '../../test/random-schemas.ts';
import { publishedAt, schemaExports } from '../../test/snapshots.ts';
import {
  type Change,
  type CodeSnapshot,
  canonicalTextOf,
  compatibilityReportOf,
  type DefinitionsSnapshot,
  decodeSnapshot,
  defScopesOf,
  type EndpointSnapshot,
  type Field,
  type FormerInput,
  hashedTextOf,
  isDeclared,
  type ObjectNode,
  type PublishedServiceSnapshot,
  publishedSnapshotOf,
  type SchemaNode,
  type ServiceSnapshot,
  type Step,
  versionBumpOf,
} from '../internal/index.ts';

const identity = 'POST /orders';
const standardRejections: ServiceSnapshot['standardRejections'] = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};
const emptyObject = { type: 'object', fields: {} } as const;
const aNumber: SchemaNode = { type: 'number' };
const aString: SchemaNode = { type: 'string' };
const aUuid: SchemaNode = { type: 'string', format: 'uuid' };
const id: Field = { required: true, schema: aString };
const unmoved = { baseline: { zod: '^4.1.0' }, proposed: { zod: '^4.1.0' } };

type Fields = Readonly<Record<string, Field>>;
type Defs = Readonly<Record<string, SchemaNode>>;

function required(schema: SchemaNode): Field {
  return { required: true, schema };
}

function optional(schema: SchemaNode): Field {
  return { required: false, schema };
}

function anObject(fields: Fields): ObjectNode {
  return { type: 'object', fields };
}

function ref(name: string): SchemaNode {
  return { type: 'ref', name };
}

function aCode(fields: Partial<CodeSnapshot>): CodeSnapshot {
  return {
    origin: 'standard',
    status: 400,
    message: 'Standard',
    headers: emptyObject,
    body: null,
    ...fields,
  };
}

const standardCodes = {
  [standardRejections.invalidInput]: aCode({ body: emptyObject }),
  [standardRejections.notFound]: aCode({ status: 404 }),
  [standardRejections.notImplemented]: aCode({ status: 501 }),
};

/** What a version of `POST /orders` declares: its body's and query's fields, headers, defs and the rest. */
type Declared = {
  readonly body?: Fields;
  readonly query?: Fields;
  readonly headers?: Fields;
  readonly defs?: Defs;
  readonly endpoint?: Partial<EndpointSnapshot>;
  readonly guards?: ServiceSnapshot['guards'];
};

function anEndpoint({ body = { id }, query = {}, headers = {}, endpoint }: Declared) {
  const declared: EndpointSnapshot = {
    name: 'createOrder',
    group: 'orders',
    visibility: 'public',
    lifecycle: 'active',
    description: 'Places an order',
    params: [],
    guards: [],
    input: {
      params: null,
      query: { type: 'object', fields: query },
      headers: { type: 'object', fields: headers },
      body: anObject(body),
    },
    success: { status: 201, headers: emptyObject, body: null },
    rejections: [],
    ...endpoint,
  };
  return declared;
}

/** The orders Service declaring `POST /orders` as given. */
function aService(declared: Declared = {}): ServiceSnapshot {
  return {
    format: 1,
    kind: 'service',
    name: 'orders-service',
    standardRejections,
    groups: { orders: { description: 'Orders' } },
    defs: declared.defs ?? {},
    endpoints: { [identity]: anEndpoint(declared) },
    events: {},
    commands: {},
    guards: declared.guards ?? {},
    codes: standardCodes,
    subscriptions: {},
    dependencies: {},
  };
}

/** Each declared Snapshot published in turn, as 1.0.0, 1.1.0 and so on, each against the one before. */
function publishedThrough(...versions: readonly ServiceSnapshot[]): PublishedServiceSnapshot {
  let baseline: PublishedServiceSnapshot | undefined;
  for (const [minor, proposed] of versions.entries()) {
    baseline = publishedSnapshotOf(baseline, proposed, publishedAt(`1.${minor}.0`));
  }
  if (baseline === undefined) {
    throw new Error('No version to publish: a bug of the test.');
  }
  return baseline;
}

function placeOf(steps: readonly Step[]): string {
  return steps.map(stepName).join('.');
}

function stepName(step: Step): string {
  switch (step.kind) {
    case 'part':
    case 'field':
      return step.name;
    case 'index':
    case 'option':
      return String(step.index);
    case 'items':
    case 'rest':
    case 'key':
    case 'value':
      return step.kind;
    case 'variant':
      return step.value;
  }
}

/** A Change as one line: its class, its kind or shape, where, and the version a former Input names. */
function lineOf({ class: changeClass, difference }: Change): string {
  if (difference.kind !== 'schema') {
    return `${changeClass} ${difference.kind}`;
  }
  const removedIn = difference.removedIn === undefined ? '' : ` removedIn=${difference.removedIn}`;
  return `${changeClass} ${difference.shape.kind} at ${placeOf(difference.at)}${removedIn}`;
}

function linesOf(baseline: PublishedServiceSnapshot, proposed: ServiceSnapshot): readonly string[] {
  return compatibilityReportOf(baseline, proposed).changes.map(lineOf);
}

function formerInputsAfter(...versions: readonly ServiceSnapshot[]): readonly FormerInput[] {
  return publishedThrough(...versions).formerInputs;
}

describe('compatibilityReportOf: an Endpoint’s former Inputs', () => {
  test('an optional body field removed and declared again with another type is Breaking against the version that removed it', () => {
    const baseline = publishedThrough(
      aService({ body: { id, note: optional(aNumber) } }),
      aService({ body: { id } }),
    );
    const proposed = aService({ body: { id, note: optional(aString) } });

    const { changes } = compatibilityReportOf(baseline, proposed);

    const site = { kind: 'endpoint', identity, name: 'createOrder', visibility: 'public' };
    const at = [
      { kind: 'part', name: 'input' },
      { kind: 'part', name: 'body' },
      { kind: 'field', name: 'note' },
    ];
    expect(changes).toEqual([
      {
        site,
        difference: {
          kind: 'schema',
          at,
          position: 'input',
          shape: { kind: 'field-added', required: false },
        },
        class: 'additive',
        verdict: 'allowed',
      },
      {
        site,
        difference: {
          kind: 'schema',
          at,
          position: 'input',
          shape: { kind: 'type-changed', from: 'number', to: 'string' },
          removedIn: '1.1.0',
        },
        class: 'breaking',
        verdict: 'approval-needed',
      },
    ]);
  });

  test('an optional query param removed and declared again with a format is Breaking against the version that removed it', () => {
    const baseline = publishedThrough(
      aService({ query: { tenant: optional(aString) } }),
      aService({ query: {} }),
    );
    const proposed = aService({ query: { tenant: optional(aUuid) } });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual([
      'additive field-added at input.query.tenant',
      'breaking constraint-tightened at input.query.tenant removedIn=1.1.0',
    ]);
  });

  test('a field declared again with the shape it last had reports only field-added', () => {
    const baseline = publishedThrough(
      aService({ body: { id, note: optional(aNumber) } }),
      aService({ body: { id } }),
    );
    const proposed = aService({ body: { id, note: optional(aNumber) } });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual(['additive field-added at input.body.note']);
  });

  test('a field declared again with a looser bound than it last had reports only field-added', () => {
    const baseline = publishedThrough(
      aService({ body: { id, note: optional({ type: 'number', min: 5 }) } }),
      aService({ body: { id } }),
    );
    const proposed = aService({ body: { id, note: optional({ type: 'number', min: 1 }) } });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual(['additive field-added at input.body.note']);
  });

  test('a field declared again with a tighter bound than it last had is Breaking', () => {
    const baseline = publishedThrough(
      aService({ body: { id, note: optional({ type: 'number', min: 1 }) } }),
      aService({ body: { id } }),
    );
    const proposed = aService({ body: { id, note: optional({ type: 'number', min: 5 }) } });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual([
      'additive field-added at input.body.note',
      'breaking constraint-tightened at input.body.note removedIn=1.1.0',
    ]);
  });

  test('a required field removed and declared again as optional with another type is Breaking', () => {
    const baseline = publishedThrough(
      aService({ body: { id, note: required(aNumber) } }),
      aService({ body: { id } }),
    );
    const proposed = aService({ body: { id, note: optional(aString) } });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual([
      'additive field-added at input.body.note',
      'breaking type-changed at input.body.note removedIn=1.1.0',
    ]);
  });

  test('a field removed inside an array’s items and declared again with another type is Breaking', () => {
    const lines = (quantity: SchemaNode | undefined): Field => {
      const fields: Fields = quantity === undefined ? { id } : { id, quantity: optional(quantity) };
      return required({ type: 'array', items: anObject(fields) });
    };
    const baseline = publishedThrough(
      aService({ body: { id, lines: lines(aNumber) } }),
      aService({ body: { id, lines: lines(undefined) } }),
    );
    const proposed = aService({ body: { id, lines: lines(aString) } });

    const changes = linesOf(baseline, proposed);

    expect(changes).toEqual([
      'additive field-added at input.body.lines.items.quantity',
      'breaking type-changed at input.body.lines.items.quantity removedIn=1.1.0',
    ]);
  });

  test('a field removed inside a shared recursive def and declared again inside a split def is Breaking', () => {
    const tree = (name: string, label: SchemaNode | undefined): SchemaNode =>
      anObject({
        ...(label === undefined ? {} : { label: optional(label) }),
        child: optional(ref(name)),
      });
    const baseline = publishedThrough(
      aService({
        body: { id, left: optional(ref('tree')), right: optional(ref('tree')) },
        defs: { tree: tree('tree', aNumber) },
      }),
      aService({
        body: { id, left: optional(ref('tree')), right: optional(ref('tree')) },
        defs: { tree: tree('tree', undefined) },
      }),
    );
    const proposed = aService({
      body: { id, left: optional(ref('tree')), right: optional(ref('labelled')) },
      defs: { tree: tree('tree', undefined), labelled: tree('labelled', aString) },
    });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual([
      'neutral annotation-changed at input.body.right',
      'additive field-added at input.body.right.label',
      'breaking type-changed at input.body.right.label removedIn=1.1.0',
    ]);
  });

  test('a field removed with its whole parent object and declared again inside the parent with another type is Breaking', () => {
    const address = (zip: SchemaNode): Field => optional(anObject({ zip: optional(zip) }));
    const baseline = publishedThrough(
      aService({ body: { id, address: address(aNumber) } }),
      aService({ body: { id } }),
    );
    const proposed = aService({ body: { id, address: address(aString) } });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual([
      'additive field-added at input.body.address',
      'breaking type-changed at input.body.address.zip removedIn=1.1.0',
    ]);
  });

  test('a query param removed by detaching a Guard and demanded again with another shape is Breaking', () => {
    const tenant = (schema: SchemaNode) => ({
      origin: 'local',
      description: 'The tenant the Caller acts for',
      guards: [],
      qualifier: null,
      demands: { headers: emptyObject, query: anObject({ tenant: optional(schema) }) },
      context: null,
      rejections: [],
    });
    const attached = { guards: [{ guard: 'tenant', qualifier: null }] };
    const baseline = publishedThrough(
      aService({
        query: { tenant: optional(aNumber) },
        endpoint: attached,
        guards: { tenant: tenant(aNumber) },
      }),
      aService({ guards: { tenant: tenant(aNumber) } }),
    );
    const proposed = aService({
      query: { tenant: optional(aUuid) },
      endpoint: attached,
      guards: { tenant: tenant(aUuid) },
    });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual([
      'additive field-added at input.query.tenant',
      'neutral attachments-changed',
      'breaking type-changed at input.query.tenant removedIn=1.1.0',
      'neutral demands-changed',
    ]);
  });

  test('the Breaking Difference names the version that removed the field, and the newest one when several former Inputs find it', () => {
    const baseline = publishedThrough(
      aService({ body: { id, note: optional(aNumber), tag: optional(aNumber) } }),
      aService({ body: { id, note: optional(aNumber) } }),
      aService({ body: { id } }),
    );
    const proposed = aService({ body: { id, note: optional(aString), tag: optional(aString) } });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual([
      'additive field-added at input.body.note',
      'additive field-added at input.body.tag',
      'breaking type-changed at input.body.note removedIn=1.2.0',
      'breaking type-changed at input.body.tag removedIn=1.1.0',
    ]);
  });

  test('a Difference found against the Baseline and a former Input is reported once', () => {
    const baseline = publishedThrough(
      aService({ body: { id, note: optional(aNumber), tag: optional(aNumber) } }),
      aService({ body: { id, note: optional(aNumber) } }),
    );
    const proposed = aService({ body: { id, note: optional(aString), tag: optional(aString) } });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual([
      'breaking type-changed at input.body.note',
      'additive field-added at input.body.tag',
      'breaking type-changed at input.body.tag removedIn=1.1.0',
    ]);
  });

  test('a Difference found against two former Inputs is reported once', () => {
    const baseline = publishedThrough(
      aService({ body: { id, note: optional(aNumber), tag: optional(aString) } }),
      aService({ body: { id, note: optional(aNumber) } }),
      aService({ body: { id } }),
    );
    const proposed = aService({ body: { id, note: optional(aString) } });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual([
      'additive field-added at input.body.note',
      'breaking type-changed at input.body.note removedIn=1.2.0',
    ]);
  });

  test('a field removed, declared again compatibly and removed again is compared with its latest shape', () => {
    const baseline = publishedThrough(
      aService({ body: { id, note: optional({ type: 'number', min: 5 }) } }),
      aService({ body: { id } }),
      aService({ body: { id, note: optional(aNumber) } }),
      aService({ body: { id } }),
    );
    const proposed = aService({ body: { id, note: optional({ type: 'number', min: 5 }) } });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual([
      'additive field-added at input.body.note',
      'breaking constraint-tightened at input.body.note removedIn=1.3.0',
    ]);
  });

  test('an optional header removed and added again still reports only the header rule', () => {
    const baseline = publishedThrough(
      aService({ headers: { 'x-trace': optional(aString) } }),
      aService({ headers: {} }),
    );
    const proposed = aService({ headers: { 'x-trace': optional(aUuid) } });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual(['breaking header-refuses-text']);
  });

  test('a Breaking Difference against a former Input on a Private Endpoint needs an Approval and bumps patch', () => {
    const endpoint = { visibility: 'private' } as const;
    const baseline = publishedThrough(
      aService({ body: { id, note: optional(aNumber) }, endpoint }),
      aService({ body: { id }, endpoint }),
    );
    const proposed = aService({ body: { id, note: optional(aString) }, endpoint });

    const report = compatibilityReportOf(baseline, proposed);

    expect([report.changes.map(lineOf), versionBumpOf(report, unmoved)]).toEqual([
      [
        'additive field-added at input.body.note',
        'breaking type-changed at input.body.note removedIn=1.1.0',
      ],
      'patch',
    ]);
    expect(report.changes[1]?.verdict).toBe('approval-needed');
  });
});

describe('publishedSnapshotOf: an Endpoint’s former Inputs', () => {
  test('publishing a version that removes a body field keeps the Baseline’s query and body with the defs they reached and removedIn', () => {
    const query = { page: optional(aNumber) };
    const defs = { note: anObject({ text: required(aString) }), unused: aString };
    const before = aService({ query, body: { id, note: optional(ref('note')) }, defs });

    const formerInputs = formerInputsAfter(before, aService({ query, body: { id } }));

    expect(formerInputs).toEqual([
      {
        endpoint: identity,
        removedIn: '1.1.0',
        input: {
          query: anObject(query),
          body: anObject({ id, note: optional(ref('note')) }),
        },
        defs: { note: defs.note },
      },
    ]);
  });

  test('publishing a version that removes a query param keeps the Baseline’s query and body', () => {
    const body = { id, note: optional(aString) };
    const before = aService({ query: { page: optional(aNumber) }, body });

    const formerInputs = formerInputsAfter(before, aService({ body }));

    expect(formerInputs).toEqual([
      {
        endpoint: identity,
        removedIn: '1.1.0',
        input: { query: anObject({ page: optional(aNumber) }), body: anObject(body) },
        defs: {},
      },
    ]);
  });

  test('a former Input is kept unchanged by a publish that removes nothing more', () => {
    const removed = publishedThrough(
      aService({ body: { id, note: optional(aNumber) } }),
      aService({ body: { id } }),
    );

    const published = publishedSnapshotOf(
      removed,
      aService({ body: { id, tag: optional(aString) } }),
      publishedAt('1.2.0'),
    );

    expect(published.formerInputs).toEqual(removed.formerInputs);
  });

  test('a former Input is forgotten once the Endpoint declares every field it had again', () => {
    const formerInputs = formerInputsAfter(
      aService({ body: { id, note: optional({ type: 'number', min: 5 }) } }),
      aService({ body: { id } }),
      aService({ body: { id, note: optional(aNumber) } }),
    );

    expect(formerInputs).toEqual([]);
  });

  test('a former Input against which a publish is Breaking is forgotten, and the next check reports nothing against it', () => {
    const broken = publishedThrough(
      aService({ body: { id, note: optional(aNumber), tag: optional(aNumber) } }),
      aService({ body: { id, tag: optional(aNumber) } }),
      aService({ body: { id, note: optional(aString), tag: optional(aNumber) } }),
    );
    const proposed = aService({ body: { id, tag: optional(aNumber) } });

    const lines = linesOf(broken, proposed);

    expect([broken.formerInputs, lines]).toEqual([
      [],
      ['additive field-removed at input.body.note'],
    ]);
  });

  test('a publish that removes a field and is Breaking against the Baseline’s Input keeps no new former Input', () => {
    const formerInputs = formerInputsAfter(
      aService({ body: { id, note: optional(aNumber), tag: optional(aNumber) } }),
      aService({ body: { id, tag: optional(aString) } }),
    );

    expect(formerInputs).toEqual([]);
  });

  test('a former Input is kept across a Breaking Change to the Endpoint’s Success status', () => {
    const removed = publishedThrough(
      aService({ body: { id, note: optional(aNumber) } }),
      aService({ body: { id } }),
    );
    const success = { status: 200, headers: emptyObject, body: null };

    const published = publishedSnapshotOf(
      removed,
      aService({ body: { id }, endpoint: { success } }),
      publishedAt('2.0.0'),
    );

    expect(published.formerInputs).toEqual(removed.formerInputs);
  });

  test('a former Input is kept across a Breaking Change to a field it lacks', () => {
    const removed = publishedThrough(
      aService({ body: { id, note: optional(aNumber), tag: optional(aNumber) } }),
      aService({ body: { id, tag: optional(aNumber), size: optional(aNumber) } }),
    );
    const tighter = optional({ type: 'number', min: 1 });

    const published = publishedSnapshotOf(
      removed,
      aService({ body: { id, tag: optional(aNumber), size: tighter } }),
      publishedAt('2.0.0'),
    );

    expect(published.formerInputs).toEqual(removed.formerInputs);
  });

  test('a former Input is forgotten once its Endpoint is Retired', () => {
    const deprecated = {
      lifecycle: 'deprecated',
      deprecatedAt: '2026-01-01T00:00:00.000Z',
    } as const;

    const formerInputs = formerInputsAfter(
      aService({ body: { id, note: optional(aNumber) } }),
      aService({ body: { id }, endpoint: deprecated }),
      aService({ body: { id }, endpoint: { lifecycle: 'retired' } }),
    );

    expect(formerInputs).toEqual([]);
  });

  test('a Service whose Endpoints never lost a field publishes formerInputs empty', () => {
    const formerInputs = formerInputsAfter(
      aService({ body: { id } }),
      aService({ body: { id, note: optional(aNumber) } }),
    );

    expect(formerInputs).toEqual([]);
  });

  test('a Definitions Package and an Application publish no formerInputs', () => {
    const definitions: DefinitionsSnapshot = {
      format: 1,
      kind: 'definitions',
      name: '@org/definitions',
      standardRejections,
      defs: {},
      exports: schemaExports({}),
      guards: {},
      codes: {},
    };
    const application = { format: 1, kind: 'application', name: 'web', dependencies: {} } as const;

    const published = [
      publishedSnapshotOf(undefined, definitions, publishedAt('1.0.0')),
      publishedSnapshotOf(undefined, application, publishedAt('1.0.0')),
    ];

    expect(published.map((snapshot) => Object.hasOwn(snapshot, 'formerInputs'))).toEqual([
      false,
      false,
    ]);
  });
});

/** The fields a generated body may hold besides `id`. */
const generatedBodyFields = ['note', 'tag', 'size'] as const;

/** The query param a generated Input may hold. */
const generatedParam = 'page';

const generatedLeaves: readonly SchemaNode[] = [
  aNumber,
  { type: 'number', min: 5 },
  aString,
  aUuid,
];

function aGeneratedLeaf(next: () => number): SchemaNode | undefined {
  return generatedLeaves[Math.floor(next() * (generatedLeaves.length + 1))];
}

/** A schema a generated body field may have: plain, constrained, nested, in items, or a shared recursive def. */
function aGeneratedSchema(next: () => number): SchemaNode {
  const leaf = aGeneratedLeaf(next);
  const inner: Fields = leaf === undefined ? {} : { inner: optional(leaf) };
  switch (Math.floor(next() * 4)) {
    case 0:
      return leaf ?? aNumber;
    case 1:
      return anObject(inner);
    case 2:
      return { type: 'array', items: anObject({ id, ...inner }) };
    default:
      return ref('tree');
  }
}

/** A generated field's state: absent, or optional or required with a drawn schema. */
function aGeneratedField(next: () => number, name: string): Field | undefined {
  const drawn = next();
  if (drawn < 0.3) {
    return undefined;
  }
  const schema =
    name === generatedParam ? (aGeneratedLeaf(next) ?? aString) : aGeneratedSchema(next);
  return { required: drawn > 0.85, schema };
}

/** The fields of a generated version: one field of the one before drawn again, or every one on the first. */
function generatedFieldsOf(next: () => number, before: Fields | undefined): Fields {
  const all = [...generatedBodyFields, generatedParam];
  const drawn =
    before === undefined ? all : [all[Math.floor(next() * all.length)] ?? generatedParam];
  const fields: Record<string, Field> = { ...before };
  for (const name of drawn) {
    const field = aGeneratedField(next, name);
    if (field === undefined) {
      delete fields[name];
    } else {
      fields[name] = field;
    }
  }
  return fields;
}

/** A generated version of `POST /orders`, its `tree` def drawn with or without a label. */
function aGeneratedService(next: () => number, fields: Fields): ServiceSnapshot {
  const { [generatedParam]: page, ...body } = fields;
  const label = next() < 0.5 ? { label: optional(next() < 0.5 ? aNumber : aString) } : {};
  const tree = anObject({ ...label, child: optional(ref('tree')) });
  const usesTree = JSON.stringify(body).includes('"tree"');
  return aService({
    body: { id, ...body },
    query: page === undefined ? {} : { [generatedParam]: page },
    defs: usesTree ? { tree } : {},
  });
}

/** One generated publish: what was declared, what was published, and the Baseline it was checked against. */
type Published = {
  readonly label: string;
  readonly proposed: ServiceSnapshot;
  readonly published: PublishedServiceSnapshot;
  readonly baseline: PublishedServiceSnapshot | undefined;
};

/** Seeded publishes of generated versions one after another, each against the one before. */
function generatedHistories(): readonly (readonly Published[])[] {
  return Array.from({ length: 150 }, (_, seed) => {
    const next = seededNext(seed + 1);
    const steps: Published[] = [];
    let baseline: PublishedServiceSnapshot | undefined;
    let fields: Fields | undefined;
    for (let minor = 0; minor < 6; minor++) {
      fields = generatedFieldsOf(next, fields);
      const proposed = aGeneratedService(next, fields);
      const published = publishedSnapshotOf(baseline, proposed, publishedAt(`1.${minor}.0`));
      steps.push({ label: `seed ${seed}: 1.${minor}.0`, proposed, published, baseline });
      baseline = published;
    }
    return steps;
  });
}

function isBreaking(change: Change): boolean {
  return change.class === 'breaking';
}

function isBreakingPublish({ baseline, proposed }: Published): boolean {
  return (
    baseline !== undefined && compatibilityReportOf(baseline, proposed).changes.some(isBreaking)
  );
}

/** A Baseline that knows nothing before a version: the version alone, published first. */
function firstPublishOf(proposed: ServiceSnapshot): PublishedServiceSnapshot {
  return publishedSnapshotOf(undefined, proposed, publishedAt('1.0.0'));
}

/** Each run of publishes none of which is Breaking, from a version to a later one, by its two ends. */
function allowedChainsOf(
  steps: readonly Published[],
): readonly (readonly [Published, Published])[] {
  const chains: (readonly [Published, Published])[] = [];
  for (const [first, from] of steps.entries()) {
    const later = steps.slice(first + 1);
    const breaking = later.findIndex(isBreakingPublish);
    const allowed = breaking === -1 ? later : later.slice(0, breaking);
    chains.push(...allowed.map((to) => [from, to] as const));
  }
  return chains;
}

/** The Baseline whose Endpoint declares a former Input as its own query and body, and no history. */
function baselineDeclaring(
  published: PublishedServiceSnapshot,
  former: FormerInput,
): PublishedServiceSnapshot {
  const declared = published.endpoints[former.endpoint];
  if (declared === undefined || !isDeclared<EndpointSnapshot>(declared)) {
    throw new Error(`${former.endpoint} is not declared: a bug of the merge.`);
  }
  const held = { ...declared, input: { ...declared.input, ...former.input } };
  return {
    ...published,
    formerInputs: [],
    defs: former.defs,
    endpoints: { ...published.endpoints, [former.endpoint]: held },
  };
}

/** Whether a former Input has a field the Endpoint now lacks and nothing Breaking against it. */
function isWellFormed(former: FormerInput, { proposed, published }: Published): boolean {
  const lines = linesOf(baselineDeclaring(published, former), proposed);
  const removed = lines.some((line) => line.startsWith('additive field-removed'));
  return removed && !lines.some((line) => line.startsWith('breaking'));
}

function holdsOneTwice({ published }: Published): boolean {
  const texts = published.formerInputs.map(({ input, defs }) => JSON.stringify([input, defs]));
  return new Set(texts).size !== texts.length;
}

function shapeKeyOf(change: Change): string | undefined {
  const { difference } = change;
  return difference.kind === 'schema'
    ? JSON.stringify([placeOf(difference.at), difference.shape])
    : undefined;
}

function reportsOneTwice({ baseline, proposed }: Published): boolean {
  const changes = baseline === undefined ? [] : compatibilityReportOf(baseline, proposed).changes;
  const keys = changes.map(shapeKeyOf).filter((key) => key !== undefined);
  return new Set(keys).size !== keys.length;
}

function rootDepthsOf({ published }: Published): readonly number[] {
  return defScopesOf(published).flatMap(({ nodes }) => nodes.map(({ at }) => at.length));
}

describe('publishedSnapshotOf and compatibilityReportOf: former Inputs over generated histories', () => {
  const histories = generatedHistories();
  const publishes = histories.flat();

  test('every chain of publishes none of which is Breaking leaves its first Input compatible with its last', () => {
    const chains = histories.flatMap(allowedChainsOf);

    const breaking = chains.filter(([from, to]) =>
      compatibilityReportOf(firstPublishOf(from.proposed), to.proposed).changes.some(isBreaking),
    );

    expect(breaking.map(([from, to]) => `${from.label} to ${to.label}`)).toEqual([]);
    expect(chains.length).toBeGreaterThan(100);
  });

  test('checking a published Snapshot’s own declared Snapshot against it reports nothing and merges to the same bytes', () => {
    const changed = publishes.filter(({ proposed, published }) => {
      const { changes } = compatibilityReportOf(published, proposed);
      const merged = publishedSnapshotOf(published, proposed, publishedAt(published.version));
      return changes.length > 0 || hashedTextOf(merged) !== hashedTextOf(published);
    });

    expect(changed.map(({ label }) => label)).toEqual([]);
  });

  test('every published Snapshot reads back, each node’s root at most 4 keys deep', () => {
    const unread = publishes.filter(
      ({ published }) => decodeSnapshot(canonicalTextOf(published)).kind !== 'decoded',
    );

    const depths = publishes.flatMap(rootDepthsOf);

    expect([unread.map(({ label }) => label), Math.max(...depths)]).toEqual([[], 4]);
  });

  test('each former Input has a field removed and nothing Breaking against its Endpoint’s Input, and none is held twice', () => {
    const held = publishes.flatMap((step) =>
      step.published.formerInputs.map((former) => ({ former, step })),
    );

    const malformed = held.filter(({ former, step }) => !isWellFormed(former, step));
    const twice = publishes.filter(holdsOneTwice);

    expect([malformed.map(({ step }) => step.label), twice.map(({ label }) => label)]).toEqual([
      [],
      [],
    ]);
    expect(held.length).toBeGreaterThan(100);
  });

  test('no two Changes on an Endpoint report one Difference at one place', () => {
    const repeated = publishes.filter(reportsOneTwice);

    expect(repeated.map(({ label }) => label)).toEqual([]);
  });
});
