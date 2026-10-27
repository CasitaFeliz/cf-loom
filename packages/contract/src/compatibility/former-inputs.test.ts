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

/** The former Input of `POST /orders` removed in a version, its query empty, with the body and defs given. */
function anEntry(removedIn: string, body: Fields, defs: Defs = {}): FormerInput {
  return {
    endpoint: identity,
    removedIn,
    input: { query: anObject({}), body: anObject(body) },
    defs,
  };
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

  test('a former Input is rewritten onto an Input that adds a field, and holds the field', () => {
    const removed = publishedThrough(
      aService({ body: { id, note: optional(aNumber) } }),
      aService({ body: { id } }),
    );

    const published = publishedSnapshotOf(
      removed,
      aService({ body: { id, tag: optional(aString) } }),
      publishedAt('1.2.0'),
    );

    expect(published.formerInputs).toEqual([
      anEntry('1.1.0', { id, tag: optional(aString), note: optional(aNumber) }),
    ]);
  });

  test('a former Input is forgotten once the Endpoint declares every field it had again', () => {
    const formerInputs = formerInputsAfter(
      aService({ body: { id, note: optional({ type: 'number', min: 5 }) } }),
      aService({ body: { id } }),
      aService({ body: { id, note: optional(aNumber) } }),
    );

    expect(formerInputs).toEqual([]);
  });

  test('a former Input is kept across a Breaking Change to a field it has, with that field as the Endpoint now declares it, and the break is not reported again', () => {
    const broken = publishedThrough(
      aService({ body: { id, note: optional(aNumber), tag: optional(aNumber) } }),
      aService({ body: { id, note: optional(aNumber) } }),
      aService({ body: { id, note: optional(aString) } }),
    );
    const proposed = aService({ body: { id, note: optional(aString) } });

    const lines = linesOf(broken, proposed);

    expect([broken.formerInputs, lines]).toEqual([
      [anEntry('1.1.0', { id, note: optional(aString), tag: optional(aNumber) })],
      [],
    ]);
  });

  test('a publish that removes a field and breaks another keeps the removed field', () => {
    const formerInputs = formerInputsAfter(
      aService({ body: { id, note: optional(aNumber), tag: optional(aNumber) } }),
      aService({ body: { id, tag: optional(aString) } }),
    );

    expect(formerInputs).toEqual([
      anEntry('1.1.0', { id, tag: optional(aString), note: optional(aNumber) }),
    ]);
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

    expect([published.formerInputs, removed.formerInputs.length]).toEqual([
      removed.formerInputs,
      1,
    ]);
  });

  test('a former Input is kept across a Breaking Change to a field it lacks, rewritten with that field as the Endpoint now declares it', () => {
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

    expect(published.formerInputs).toEqual([
      anEntry('1.1.0', { id, tag: optional(aNumber), size: tighter, note: optional(aNumber) }),
    ]);
  });

  test('a former Input is rewritten onto a relaxed Input, and equals it where nothing was removed', () => {
    const relaxed = optional({ type: 'number', min: 1 });

    const formerInputs = formerInputsAfter(
      aService({
        body: { id, note: optional(aNumber), tag: optional({ type: 'number', min: 5 }) },
      }),
      aService({ body: { id, tag: relaxed } }),
    );

    expect(formerInputs).toEqual([anEntry('1.1.0', { id, tag: relaxed, note: optional(aNumber) })]);
  });

  test('an unchanged Contract leaves every former Input byte-identical and reports nothing', () => {
    const tree = anObject({ label: optional(aNumber), child: optional(ref('tree')) });
    const bare = anObject({ child: optional(ref('tree')) });
    const proposed = aService({ body: { id, root: optional(ref('tree')) }, defs: { tree: bare } });
    const published = publishedThrough(
      aService({
        body: { id, root: optional(ref('tree')), note: optional(aNumber) },
        defs: { tree },
      }),
      aService({ body: { id, root: optional(ref('tree')) }, defs: { tree } }),
      proposed,
    );

    const again = publishedSnapshotOf(published, proposed, publishedAt('1.3.0'));

    expect([
      canonicalTextOf(again.formerInputs as never),
      linesOf(published, proposed),
      published.formerInputs.length,
    ]).toEqual([canonicalTextOf(published.formerInputs as never), [], 2]);
  });

  test('a field removed inside a def the Endpoint keeps is grafted into a copy of the def named apart, which the def’s own refs name', () => {
    const tree = (label: boolean) =>
      anObject({ ...(label ? { label: optional(aNumber) } : {}), child: optional(ref('tree')) });

    const published = publishedThrough(
      aService({ body: { id, root: optional(ref('tree')) }, defs: { tree: tree(true) } }),
      aService({ body: { id, root: optional(ref('tree')) }, defs: { tree: tree(false) } }),
    );

    const grafted = anObject({ label: optional(aNumber), child: optional(ref('tree~1')) });
    expect([published.formerInputs, decodeSnapshot(canonicalTextOf(published)).kind]).toEqual([
      [anEntry('1.1.0', { id, root: optional(ref('tree~1')) }, { 'tree~1': grafted })],
      'decoded',
    ]);
  });

  test('a field removed inside a def two fields share is grafted once, and declaring it again is reported once', () => {
    const tree = (label: SchemaNode | undefined) =>
      anObject({ ...(label ? { label: optional(label) } : {}), child: optional(ref('tree')) });
    const body = { id, left: optional(ref('tree')), right: optional(ref('tree')) };
    const published = publishedThrough(
      aService({ body, defs: { tree: tree(aNumber) } }),
      aService({ body, defs: { tree: tree(undefined) } }),
    );

    const lines = linesOf(published, aService({ body, defs: { tree: tree(aString) } }));

    const entry = published.formerInputs[0];
    expect([Object.keys(entry?.defs ?? {}), lines]).toEqual([
      ['tree~1'],
      [
        'additive field-added at input.body.left.label',
        'breaking type-changed at input.body.left.label removedIn=1.1.0',
      ],
    ]);
  });

  test('two former defs the Endpoint merged into one are grafted apart, and a field declared again with one’s shape is Breaking for the other’s Callers', () => {
    const before = { p: anObject({ c: optional(aNumber) }), q: anObject({ c: optional(aString) }) };
    const published = publishedThrough(
      aService({ body: { id, x: optional(ref('p')), y: optional(ref('q')) }, defs: before }),
      aService({
        body: { id, x: optional(ref('p')), y: optional(ref('p')) },
        defs: { p: anObject({}) },
      }),
    );
    const proposed = aService({
      body: { id, x: optional(ref('p')), y: optional(ref('p')) },
      defs: { p: anObject({ c: optional(aNumber) }) },
    });

    const lines = linesOf(published, proposed);

    expect([Object.keys(published.formerInputs[0]?.defs ?? {}), lines]).toEqual([
      ['p~1', 'p~2'],
      [
        'additive field-added at input.body.x.c',
        'breaking type-changed at input.body.y.c removedIn=1.1.0',
      ],
    ]);
  });

  test('a removed field whose def the Endpoint still declares with another shape keeps a copy named apart, and the kept field names the Endpoint’s def', () => {
    const note = anObject({ text: required(aString) });
    const changed = anObject({ text: required(aString), size: optional(aNumber) });

    const formerInputs = formerInputsAfter(
      aService({
        body: { id, note: optional(ref('note')), remark: optional(ref('note')) },
        defs: { note },
      }),
      aService({ body: { id, remark: optional(ref('note')) }, defs: { note: changed } }),
    );

    expect(formerInputs).toEqual([
      anEntry(
        '1.1.0',
        { id, remark: optional(ref('note')), note: optional(ref('note~1')) },
        { note: changed, 'note~1': note },
      ),
    ]);
  });

  test('a def the former Input reaches both at a field and inside a plain union is held as declared for the union and grafted apart for the field, and the unchanged Input reports nothing', () => {
    const union = optional({ type: 'union', options: [aString, ref('n')] });
    const before = anObject({ c: optional(aNumber), d: optional(aString) });
    const after = anObject({ d: optional(aString) });
    const proposed = aService({
      body: { id, a: optional(ref('n')), u: union },
      defs: { n: after },
    });
    const published = publishedThrough(
      aService({ body: { id, a: optional(ref('n')), u: union }, defs: { n: before } }),
      proposed,
    );

    const lines = linesOf(published, proposed);

    const grafted = anObject({ c: optional(aNumber), d: optional(aString) });
    expect([published.formerInputs, lines]).toEqual([
      [anEntry('1.1.0', { id, a: optional(ref('n~1')), u: union }, { n: after, 'n~1': grafted })],
      [],
    ]);
  });

  test('a field removed inside a tuple’s items keeps no former Input', () => {
    const tuple = (fields: Fields) => optional({ type: 'tuple', items: [anObject(fields)] });

    const formerInputs = formerInputsAfter(
      aService({ body: { id, pair: tuple({ c: optional(aNumber) }) } }),
      aService({ body: { id, pair: tuple({}) } }),
    );

    expect(formerInputs).toEqual([]);
  });

  test.each<[string, (fields: Fields) => SchemaNode, string]>([
    [
      'a record’s value',
      (fields) => ({ type: 'record', key: aString, value: anObject(fields) }),
      'value',
    ],
    ['a tuple’s rest', (fields) => ({ type: 'tuple', items: [], rest: anObject(fields) }), 'rest'],
    [
      'a tagged union’s kept variant',
      (fields) => ({
        type: 'tagged',
        discriminator: 'kind',
        variants: {
          '"a"': anObject({
            kind: required({ type: 'enum', values: ['a'], open: false }),
            ...fields,
          }),
        },
      }),
      '"a"',
    ],
  ])(
    'a field removed inside %s is grafted, and declaring it again with another type is Breaking',
    (_name, holding, step) => {
      const published = publishedThrough(
        aService({ body: { id, held: optional(holding({ c: optional(aNumber) })) } }),
        aService({ body: { id, held: optional(holding({})) } }),
      );

      const lines = linesOf(
        published,
        aService({ body: { id, held: optional(holding({ c: optional(aString) })) } }),
      );

      expect(lines).toEqual([
        `additive field-added at input.body.held.${step}.c`,
        `breaking type-changed at input.body.held.${step}.c removedIn=1.1.0`,
      ]);
    },
  );

  test('a publish that adds a body and removes a query param keeps the param', () => {
    const page = { page: optional(aNumber) };

    const formerInputs = formerInputsAfter(
      aService({
        query: page,
        endpoint: { input: { ...anEndpoint({ query: page }).input, body: null } },
      }),
      aService({ body: { id } }),
    );

    expect(formerInputs).toEqual([
      {
        endpoint: identity,
        removedIn: '1.1.0',
        input: { query: anObject(page), body: anObject({ id }) },
        defs: {},
      },
    ]);
  });

  test('a def first met at one field and reached again through another def keeps the removed field after a break at the first', () => {
    const shared = (d: SchemaNode | undefined) =>
      anObject({ c: optional(aNumber), ...(d === undefined ? {} : { d: optional(d) }) });
    const holder = anObject({ y: optional(ref('y')) });
    const body = (a: SchemaNode) => ({ id, a: optional(a), b: optional(ref('x')) });
    const published = publishedThrough(
      aService({ body: body(ref('y')), defs: { x: holder, y: shared(aNumber) } }),
      aService({ body: body(ref('y')), defs: { x: holder, y: shared(undefined) } }),
      aService({ body: body(aString), defs: { x: holder, y: shared(undefined) } }),
    );

    const lines = linesOf(
      published,
      aService({ body: body(aString), defs: { x: holder, y: shared(aString) } }),
    );

    expect(lines).toEqual([
      'additive field-added at input.body.b.y.d',
      'breaking type-changed at input.body.b.y.d removedIn=1.1.0',
    ]);
  });

  test('a field removed through a nullable alias def, declared again not nullable, is Breaking', () => {
    const target = anObject({ c: optional(aNumber) });
    const alias: SchemaNode = { type: 'ref', name: 'n', nullable: true };
    const published = publishedThrough(
      aService({ body: { id, x: optional(ref('alias')) }, defs: { alias, n: target } }),
      aService({ body: { id } }),
    );

    const lines = linesOf(
      published,
      aService({ body: { id, x: optional(ref('n')) }, defs: { n: target } }),
    );

    expect(lines).toEqual([
      'additive field-added at input.body.x',
      'breaking nullability-removed at input.body.x removedIn=1.1.0',
    ]);
  });

  test('a copied def named apart twice decodes and is its own graft', () => {
    const before = anObject({ c: optional(aNumber), d: optional(aNumber) });
    const after = anObject({ c: optional(aNumber) });
    const proposed = aService({ body: { id, a: optional(ref('n')) }, defs: { n: after } });
    const published = publishedThrough(
      aService({ body: { id, a: optional(ref('n')), b: optional(ref('n')) }, defs: { n: before } }),
      proposed,
    );

    const again = publishedSnapshotOf(published, proposed, publishedAt('1.2.0'));

    expect([
      Object.keys(published.formerInputs[0]?.defs ?? {}),
      decodeSnapshot(canonicalTextOf(published)).kind,
      again.formerInputs,
    ]).toEqual([['n~1', 'n~2'], 'decoded', published.formerInputs]);
  });

  test('a copied def keeps its name apart after the Snapshot frees it, so a plain union naming the def again is Breaking against it', () => {
    const former = anObject({ k: optional(aString) });
    const other = anObject({ z: optional(aNumber) });
    const union = optional({ type: 'union', options: [ref('m'), aNumber] });
    const published = publishedThrough(
      aService({ body: { id, u: union }, defs: { m: former } }),
      aService({ body: { id, w: optional(ref('m')) }, defs: { m: other } }),
      aService({ body: { id, w: optional(ref('q')) }, defs: { q: other } }),
    );

    const lines = linesOf(
      published,
      aService({ body: { id, w: optional(ref('q')), u: union }, defs: { q: other, m: former } }),
    );

    expect(lines).toEqual([
      'additive field-added at input.body.u',
      'breaking union-changed at input.body.u removedIn=1.1.0',
    ]);
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
  switch (Math.floor(next() * 5)) {
    case 0:
      return leaf ?? aNumber;
    case 1:
      return anObject(inner);
    case 2:
      return { type: 'array', items: anObject({ id, ...inner }) };
    case 3:
      return ref('tree');
    default:
      return ref('leaf');
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

/** A generated version of `POST /orders`, its `tree` def drawn with or without a label, and the `leaf` def it reaches with or without `c`. */
function aGeneratedService(next: () => number, fields: Fields): ServiceSnapshot {
  const { [generatedParam]: page, ...body } = fields;
  const label = next() < 0.5 ? { label: optional(next() < 0.5 ? aNumber : aString) } : {};
  const tree = anObject({ ...label, child: optional(ref('tree')), leaf: optional(ref('leaf')) });
  const drawn = next() < 0.5 ? { c: optional(next() < 0.5 ? aNumber : aString) } : {};
  const leaf = anObject({ ...drawn, d: optional(aString) });
  const usesTree = JSON.stringify(body).includes('"tree"');
  const usesLeaf = usesTree || JSON.stringify(body).includes('"leaf"');
  return aService({
    body: { id, ...body },
    query: page === undefined ? {} : { [generatedParam]: page },
    defs: { ...(usesTree ? { tree } : {}), ...(usesLeaf ? { leaf } : {}) },
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
/** Whether a former Input differs from its Endpoint's Input only by fields removed, one at least, and by the names of its defs. */
function isWellFormed(former: FormerInput, { proposed, published }: Published): boolean {
  const lines = linesOf(baselineDeclaring(published, former), proposed);
  const isRemovalOrName = (line: string) =>
    line.startsWith('additive field-removed') || line.startsWith('neutral annotation-changed');
  return (
    lines.some((line) => line.startsWith('additive field-removed')) && lines.every(isRemovalOrName)
  );
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

  test('each former Input differs from its Endpoint’s Input only by fields removed, one at least, and by the names of its defs', () => {
    const held = publishes.flatMap((step) =>
      step.published.formerInputs.map((former) => ({ former, step })),
    );

    const malformed = held.filter(({ former, step }) => !isWellFormed(former, step));

    expect(malformed.map(({ step }) => step.label)).toEqual([]);
    expect(held.length).toBeGreaterThan(100);
  });

  test('no two Changes on an Endpoint report one Difference at one place', () => {
    const repeated = publishes.filter(reportsOneTwice);

    expect(repeated.map(({ label }) => label)).toEqual([]);
  });
});
