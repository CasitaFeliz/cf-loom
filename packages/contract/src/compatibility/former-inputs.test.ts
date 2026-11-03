import { isDeepStrictEqual } from 'node:util';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  endpointsNamingAnAliasChainLosingField,
  endpointsNamingChangedAliasDefs,
} from '../../test/alias-shapes.ts';
import { type ChainEnd, endpointsNamingOneChainChangedAt } from '../../test/chain-end-shapes.ts';
import {
  annotationsOf,
  destinationOf,
  isClosureUnchanged,
  problemWithDefsOf,
} from '../../test/graft-defs.ts';
import {
  anObject,
  aRef,
  aString,
  emptyObject,
  graftedIdentity,
  optional,
  publishedFirst,
  required,
  type Shape,
  standardCodes,
  standardRejections,
} from '../../test/graft-fixtures.ts';
import { differenceFromInput } from '../../test/graft-oracle.ts';
import {
  chainLosingFieldAtEnd,
  defsMergedIntoOneWrittenInline,
  defsNamedApartFromOne,
  defsNamingAnAliasChain,
  endpointsHoldingFormerInputEach,
  endpointsLosingFieldBesideUnreachedDefs,
  endpointsNamingAnAliasChain,
  endpointsNamingChain,
  wideBodyLosingField,
} from '../../test/graft-shapes.ts';
import { orderOf, orders } from '../../test/growth.ts';
import { aliasDrawOf } from '../../test/random-alias-draws.ts';
import {
  defGraftDrawOf,
  identityOf,
  reachesLanded,
  servicesOf,
  shuffledIdentities,
} from '../../test/random-def-grafts.ts';
import { doubledGraftDrawOf } from '../../test/random-doubled-grafts.ts';
import { isRef, nodesIn } from '../../test/random-draft.ts';
import { graftDrawOf, removalHistoryOf } from '../../test/random-grafts.ts';
import { inlinedGraftDrawOf } from '../../test/random-inlined-grafts.ts';
import { seededNext } from '../../test/random-schemas.ts';
import { aRootPackage } from '../../test/root-package.ts';
import { publishedAt, schemaExports } from '../../test/snapshots.ts';
import { defineEndpoint, defineGroup, defineService } from '../index.ts';
import {
  type Change,
  canonicalTextOf,
  compatibilityReportOf,
  type DefinitionsSnapshot,
  decodeSnapshot,
  defScopesOf,
  type EndpointFields,
  type EndpointLifecycle,
  type EndpointSnapshot,
  type Field,
  type FormerInput,
  failureLineOf,
  hashedTextOf,
  isDeclared,
  type ObjectNode,
  type PublishedServiceSnapshot,
  publishedSnapshotOf,
  type RefNode,
  type SchemaNode,
  type ServiceSnapshot,
  type ShapeDifference,
  type Step,
  snapshotOf,
  validateRoot,
  versionBumpOf,
} from '../internal/index.ts';

const identity = 'POST /orders';
const aNumber: SchemaNode = { type: 'number' };
const aUuid: SchemaNode = { type: 'string', format: 'uuid' };
const id: Field = { required: true, schema: aString };
const unmoved = { baseline: { zod: '^4.1.0' }, proposed: { zod: '^4.1.0' } };

type Fields = Readonly<Record<string, Field>>;
type Defs = Readonly<Record<string, SchemaNode>>;

/** What a version of `POST /orders` declares: its body's and query's fields, headers, defs and the rest. */
type Declared = {
  readonly body?: Fields;
  readonly query?: Fields;
  readonly headers?: Fields;
  readonly defs?: Defs;
  readonly endpoint?: Partial<EndpointFields>;
  readonly lifecycle?: EndpointLifecycle;
  readonly guards?: ServiceSnapshot['guards'];
};

function anEndpoint({ body = { id }, query = {}, headers = {}, endpoint, lifecycle }: Declared) {
  const declared: EndpointSnapshot = {
    name: 'createOrder',
    group: 'orders',
    visibility: 'public',
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
    ...(lifecycle ?? { lifecycle: 'active' }),
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

/** Every version published in turn, as 1.0.0, 1.1.0 and so on, each against the one before. */
function publishedEach(versions: readonly ServiceSnapshot[]): readonly PublishedServiceSnapshot[] {
  const publishes: PublishedServiceSnapshot[] = [];
  for (const [minor, version] of versions.entries()) {
    publishes.push(publishedSnapshotOf(publishes.at(-1), version, publishedAt(`1.${minor}.0`)));
  }
  return publishes;
}

function publishedThrough(...versions: readonly ServiceSnapshot[]): PublishedServiceSnapshot {
  const published = publishedEach(versions).at(-1);
  if (published === undefined) {
    throw new Error('No version to publish: a bug of the test.');
  }
  return published;
}

function placeOf(steps: readonly Step[], def?: string): string {
  const names = steps.map(stepName);
  return (def === undefined ? names : ['defs', def, ...names]).join('.');
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
  return `${changeClass} ${difference.shape.kind} at ${placeOf(difference.at, difference.def)}${removedIn}`;
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

/** The schema a field has in the first former Input's body. */
function removedFieldOf(published: PublishedServiceSnapshot, name: string): SchemaNode | undefined {
  const body = published.formerInputs[0]?.input.body;
  return body?.type === 'object' ? body.fields[name]?.schema : undefined;
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
        child: optional(aRef(name)),
      });
    const baseline = publishedThrough(
      aService({
        body: { id, left: optional(aRef('tree')), right: optional(aRef('tree')) },
        defs: { tree: tree('tree', aNumber) },
      }),
      aService({
        body: { id, left: optional(aRef('tree')), right: optional(aRef('tree')) },
        defs: { tree: tree('tree', undefined) },
      }),
    );
    const proposed = aService({
      body: { id, left: optional(aRef('tree')), right: optional(aRef('labelled')) },
      defs: { tree: tree('tree', undefined), labelled: tree('labelled', aString) },
    });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual([
      'neutral annotation-changed at input.body.right',
      'neutral annotation-changed at defs.labelled.child',
      'additive field-added at defs.labelled.label',
      'breaking type-changed at defs.labelled.label removedIn=1.1.0',
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

  test('a def changed that the Baseline and a former Input reach by different routes is reported once', () => {
    const held = (x: SchemaNode) => ({ shape: anObject({ x: optional(x) }) });
    const nested = (hasD: boolean) =>
      optional(anObject(hasD ? { d: optional(aRef('shape')) } : {}));
    const baseline = publishedThrough(
      aService({ body: { id, a: nested(true), z: optional(aRef('shape')) }, defs: held(aNumber) }),
      aService({ body: { id, a: nested(false), z: optional(aRef('shape')) }, defs: held(aNumber) }),
    );
    const proposed = aService({
      body: { id, a: nested(true), z: optional(aRef('shape')) },
      defs: held(aString),
    });

    const lines = linesOf(baseline, proposed);

    expect(lines).toEqual([
      'additive field-added at input.body.a.d',
      'breaking type-changed at defs.shape.x',
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
    const before = aService({ query, body: { id, note: optional(aRef('note')) }, defs });

    const formerInputs = formerInputsAfter(before, aService({ query, body: { id } }));

    expect(formerInputs).toEqual([
      {
        endpoint: identity,
        removedIn: '1.1.0',
        input: {
          query: anObject(query),
          body: anObject({ id, note: optional(aRef('note')) }),
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
    const tree = anObject({ label: optional(aNumber), child: optional(aRef('tree')) });
    const bare = anObject({ child: optional(aRef('tree')) });
    const proposed = aService({ body: { id, root: optional(aRef('tree')) }, defs: { tree: bare } });
    const published = publishedThrough(
      aService({
        body: { id, root: optional(aRef('tree')), note: optional(aNumber) },
        defs: { tree },
      }),
      aService({ body: { id, root: optional(aRef('tree')) }, defs: { tree } }),
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
      anObject({ ...(label ? { label: optional(aNumber) } : {}), child: optional(aRef('tree')) });

    const published = publishedThrough(
      aService({ body: { id, root: optional(aRef('tree')) }, defs: { tree: tree(true) } }),
      aService({ body: { id, root: optional(aRef('tree')) }, defs: { tree: tree(false) } }),
    );

    const grafted = anObject({ label: optional(aNumber), child: optional(aRef('tree~1')) });
    expect([published.formerInputs, decodeSnapshot(canonicalTextOf(published)).kind]).toEqual([
      [anEntry('1.1.0', { id, root: optional(aRef('tree~1')) }, { 'tree~1': grafted })],
      'decoded',
    ]);
  });

  test('a field removed inside a def two fields share is grafted once, and declaring it again is reported once', () => {
    const tree = (label: SchemaNode | undefined) =>
      anObject({ ...(label ? { label: optional(label) } : {}), child: optional(aRef('tree')) });
    const body = { id, left: optional(aRef('tree')), right: optional(aRef('tree')) };
    const published = publishedThrough(
      aService({ body, defs: { tree: tree(aNumber) } }),
      aService({ body, defs: { tree: tree(undefined) } }),
    );

    const lines = linesOf(published, aService({ body, defs: { tree: tree(aString) } }));

    const entry = published.formerInputs[0];
    expect([Object.keys(entry?.defs ?? {}), lines]).toEqual([
      ['tree~1'],
      [
        'additive field-added at defs.tree.label',
        'breaking type-changed at defs.tree.label removedIn=1.1.0',
      ],
    ]);
  });

  test('two former defs the Endpoint merged into one are grafted apart, and a field declared again with one’s shape is Breaking for the other’s Callers', () => {
    const before = { p: anObject({ c: optional(aNumber) }), q: anObject({ c: optional(aString) }) };
    const published = publishedThrough(
      aService({ body: { id, x: optional(aRef('p')), y: optional(aRef('q')) }, defs: before }),
      aService({
        body: { id, x: optional(aRef('p')), y: optional(aRef('p')) },
        defs: { p: anObject({}) },
      }),
    );
    const proposed = aService({
      body: { id, x: optional(aRef('p')), y: optional(aRef('p')) },
      defs: { p: anObject({ c: optional(aNumber) }) },
    });

    const lines = linesOf(published, proposed);

    expect([Object.keys(published.formerInputs[0]?.defs ?? {}), lines]).toEqual([
      ['p~1', 'p~2'],
      ['additive field-added at defs.p.c', 'breaking type-changed at defs.p.c removedIn=1.1.0'],
    ]);
  });

  test('a removed field whose def the Endpoint still declares with another shape keeps a copy named apart, and the kept field names the Endpoint’s def', () => {
    const note = anObject({ text: required(aString) });
    const changed = anObject({ text: required(aString), size: optional(aNumber) });

    const formerInputs = formerInputsAfter(
      aService({
        body: { id, note: optional(aRef('note')), remark: optional(aRef('note')) },
        defs: { note },
      }),
      aService({ body: { id, remark: optional(aRef('note')) }, defs: { note: changed } }),
    );

    expect(formerInputs).toEqual([
      anEntry(
        '1.1.0',
        { id, remark: optional(aRef('note')), note: optional(aRef('note~1')) },
        { note: changed, 'note~1': note },
      ),
    ]);
  });

  test('a def the former Input reaches both at a field and inside a plain union is held as declared for the union and grafted apart for the field, and the unchanged Input reports nothing', () => {
    const union = optional({ type: 'union', options: [aString, aRef('n')] });
    const before = anObject({ c: optional(aNumber), d: optional(aString) });
    const after = anObject({ d: optional(aString) });
    const proposed = aService({
      body: { id, a: optional(aRef('n')), u: union },
      defs: { n: after },
    });
    const published = publishedThrough(
      aService({ body: { id, a: optional(aRef('n')), u: union }, defs: { n: before } }),
      proposed,
    );

    const lines = linesOf(published, proposed);

    const grafted = anObject({ c: optional(aNumber), d: optional(aString) });
    expect([published.formerInputs, lines]).toEqual([
      [anEntry('1.1.0', { id, a: optional(aRef('n~1')), u: union }, { n: after, 'n~1': grafted })],
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
    const holder = anObject({ y: optional(aRef('y')) });
    const body = (a: SchemaNode) => ({ id, a: optional(a), b: optional(aRef('x')) });
    const published = publishedThrough(
      aService({ body: body(aRef('y')), defs: { x: holder, y: shared(aNumber) } }),
      aService({ body: body(aRef('y')), defs: { x: holder, y: shared(undefined) } }),
      aService({ body: body(aString), defs: { x: holder, y: shared(undefined) } }),
    );

    const lines = linesOf(
      published,
      aService({ body: body(aString), defs: { x: holder, y: shared(aString) } }),
    );

    expect(lines).toEqual([
      'additive field-added at defs.y.d',
      'breaking type-changed at defs.y.d removedIn=1.1.0',
    ]);
  });

  test('a field removed through a nullable alias def, declared again not nullable, is Breaking', () => {
    const target = anObject({ c: optional(aNumber) });
    const alias = aRef('n');
    const nullableAlias: SchemaNode = { type: 'ref', name: 'alias', nullable: true };
    const published = publishedThrough(
      aService({ body: { id, x: optional(nullableAlias) }, defs: { alias, n: target } }),
      aService({ body: { id } }),
    );

    const lines = linesOf(
      published,
      aService({ body: { id, x: optional(aRef('n')) }, defs: { n: target } }),
    );

    expect(lines).toEqual([
      'additive field-added at input.body.x',
      'breaking nullability-removed at input.body.x removedIn=1.1.0',
    ]);
  });

  test('a copied def named apart twice decodes and is its own graft', () => {
    const before = anObject({ c: optional(aNumber), d: optional(aNumber) });
    const after = anObject({ c: optional(aNumber) });
    const proposed = aService({ body: { id, a: optional(aRef('n')) }, defs: { n: after } });
    const published = publishedThrough(
      aService({
        body: { id, a: optional(aRef('n')), b: optional(aRef('n')) },
        defs: { n: before },
      }),
      proposed,
    );

    const again = publishedSnapshotOf(published, proposed, publishedAt('1.2.0'));

    expect([
      Object.keys(published.formerInputs[0]?.defs ?? {}),
      decodeSnapshot(canonicalTextOf(published)).kind,
      again.formerInputs,
    ]).toEqual([['n~1', 'n~2'], 'decoded', published.formerInputs]);
  });

  test('a removed field whose allOf names a def the publish names apart keeps the items in shape order, and the Snapshot decodes', () => {
    const intersection: SchemaNode = { type: 'allOf', items: [aRef('a'), aRef('ab')] };
    const baseline = aService({
      body: { id, f: required(intersection) },
      defs: { a: anObject({ x: optional(aRef('a')) }), ab: anObject({ y: optional(aRef('ab')) }) },
    });
    const proposed = aService({
      body: { id, g: optional(aRef('a')) },
      defs: { a: anObject({ z: optional(aRef('a')) }) },
    });

    const published = publishedThrough(baseline, proposed);

    expect([
      removedFieldOf(published, 'f'),
      decodeSnapshot(canonicalTextOf(published)).kind,
    ]).toEqual([{ type: 'allOf', items: [aRef('ab'), aRef('a~1')] }, 'decoded']);
  });

  test('a removed field whose allOf names two alias defs of one def holds that def once, and the Snapshot decodes', () => {
    const intersection: SchemaNode = { type: 'allOf', items: [aRef('p'), aRef('q')] };
    const baseline = aService({
      body: { id, f: required(intersection) },
      defs: { n: anObject({ v: optional(aRef('n')) }), p: aRef('n'), q: aRef('n') },
    });

    const published = publishedThrough(baseline, aService({ body: { id } }));

    expect([
      removedFieldOf(published, 'f'),
      decodeSnapshot(canonicalTextOf(published)).kind,
    ]).toEqual([{ type: 'allOf', items: [aRef('n')] }, 'decoded']);
  });

  test('a removed field whose allOf names defs the publish does not declare keeps the items as declared, and the Snapshot decodes', () => {
    const intersection: SchemaNode = { type: 'allOf', items: [aRef('a'), aRef('ab')] };
    const defs = {
      a: anObject({ x: optional(aRef('a')) }),
      ab: anObject({ y: optional(aRef('ab')) }),
    };
    const baseline = aService({ body: { id, f: required(intersection) }, defs });

    const published = publishedThrough(baseline, aService({ body: { id } }));

    expect([
      removedFieldOf(published, 'f'),
      decodeSnapshot(canonicalTextOf(published)).kind,
    ]).toEqual([intersection, 'decoded']);
  });

  test('a copied def keeps its name apart after the Snapshot frees it, so a plain union naming the def again is Breaking against it', () => {
    const former = anObject({ k: optional(aString) });
    const other = anObject({ z: optional(aNumber) });
    const union = optional({ type: 'union', options: [aRef('m'), aNumber] });
    const published = publishedThrough(
      aService({ body: { id, u: union }, defs: { m: former } }),
      aService({ body: { id, w: optional(aRef('m')) }, defs: { m: other } }),
      aService({ body: { id, w: optional(aRef('q')) }, defs: { q: other } }),
    );

    const lines = linesOf(
      published,
      aService({ body: { id, w: optional(aRef('q')), u: union }, defs: { q: other, m: former } }),
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
      aService({ body: { id }, lifecycle: deprecated }),
      aService({ body: { id }, lifecycle: { lifecycle: 'retired' } }),
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

    expect(published.map((snapshot) => Object.keys(snapshot).sort())).toEqual([
      [
        'codes',
        'defs',
        'exports',
        'format',
        'generator',
        'guards',
        'kind',
        'name',
        'standardRejections',
        'version',
      ],
      ['dependencies', 'format', 'generator', 'kind', 'name', 'version'],
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
  switch (Math.floor(next() * 6)) {
    case 0:
      return leaf ?? aNumber;
    case 1:
      return anObject(inner);
    case 2:
      return { type: 'array', items: anObject({ id, ...inner }) };
    case 3:
      return aRef('tree');
    case 4:
      return aGeneratedAllOf(next);
    default:
      return aRef('leaf');
  }
}

function nullableRef(name: string): SchemaNode {
  return { type: 'ref', name, nullable: true };
}

/** Items an `allOf` may hold, listed in shape order, so any of its subsequences is held as a Snapshot holds it. */
const allOfItems: readonly SchemaNode[] = [
  anObject({ inner: optional(aRef('leaf')) }),
  { type: 'array', items: aRef('sprig') },
  { type: 'array', items: aRef('tree') },
  aRef('leaf'),
  nullableRef('leafy'),
  aRef('leafy'),
  aRef('sprig'),
  nullableRef('tree'),
  aRef('tree'),
  aRef('twig'),
  { type: 'union', options: [aRef('twig'), aNumber] },
];

/** An `allOf` of two or more of `allOfItems`; `leaf` is a prefix of `leafy`, so naming `leaf` apart as `leaf~1` reorders them. */
function aGeneratedAllOf(next: () => number): SchemaNode {
  const drawn = allOfItems.filter(() => next() < 0.35);
  const items = drawn.length >= 2 ? drawn : [aRef('leaf'), aRef('leafy')];
  return { type: 'allOf', items };
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

/** The `tree` def drawn with or without a label, and the `leaf` def it reaches with or without `c`. */
function aGeneratedTreeAndLeaf(next: () => number): { tree: SchemaNode; leaf: SchemaNode } {
  const label = next() < 0.5 ? { label: optional(next() < 0.5 ? aNumber : aString) } : {};
  const tree = anObject({ ...label, child: optional(aRef('tree')), leaf: optional(aRef('leaf')) });
  const drawn = next() < 0.5 ? { c: optional(next() < 0.5 ? aNumber : aString) } : {};
  return { tree, leaf: anObject({ ...drawn, d: optional(aString) }) };
}

/** The defs a generated body reaches, with the alias `sprig` leading to `tree` or to the alias `twig`. */
function aGeneratedDefs(next: () => number, body: Fields): Defs {
  const { tree, leaf } = aGeneratedTreeAndLeaf(next);
  const sprigLeadsTo = next() < 0.5 ? 'tree' : 'twig';
  const text = JSON.stringify(body);
  const reaches = (name: string) => text.includes(`"${name}"`);
  const usesSprig = reaches('sprig');
  const usesTwig = reaches('twig') || (usesSprig && sprigLeadsTo === 'twig');
  const usesTree = usesTwig || usesSprig || reaches('tree');
  const usesLeafy = reaches('leafy');
  const usesLeaf = usesTree || usesLeafy || reaches('leaf');
  return {
    ...(usesTree ? { tree } : {}),
    ...(usesLeaf ? { leaf } : {}),
    ...(usesLeafy ? { leafy: anObject({ e: optional(aRef('leaf')) }) } : {}),
    ...(usesTwig ? { twig: aRef('tree') } : {}),
    ...(usesSprig ? { sprig: aRef(sprigLeadsTo) } : {}),
  };
}

/** A generated version of `POST /orders`, with the defs its body reaches. */
function aGeneratedService(next: () => number, fields: Fields): ServiceSnapshot {
  const { [generatedParam]: page, ...body } = fields;
  return aService({
    body: { id, ...body },
    query: page === undefined ? {} : { [generatedParam]: page },
    defs: aGeneratedDefs(next, body),
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
    for (const to of allowed) {
      chains.push([from, to]);
    }
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

/** Whether a former Input differs from its Endpoint's Input only by fields removed, one at least, and by the names of its defs. */
function isWellFormed(former: FormerInput, { proposed, published }: Published): boolean {
  const { changes } = compatibilityReportOf(baselineDeclaring(published, former), proposed);
  const shapes = changes.map(({ difference }) =>
    difference.kind === 'schema' ? difference.shape : undefined,
  );
  const isRemoval = (shape: ShapeDifference | undefined) => shape?.kind === 'field-removed';
  const isRemovalOrName = (shape: ShapeDifference | undefined) =>
    isRemoval(shape) || (shape?.kind === 'annotation-changed' && shape.annotation === 'id');
  return shapes.some(isRemoval) && shapes.every(isRemovalOrName);
}

function shapeKeyOf(change: Change): string | undefined {
  const { difference } = change;
  return difference.kind === 'schema'
    ? JSON.stringify([placeOf(difference.at, difference.def), difference.shape])
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

const gone = optional(aNumber);

describe('publishedSnapshotOf: the defs a former Input holds', () => {
  const shared = anObject({ p: required(aString) });

  test('a removed field beside a field naming an unchanged def keeps the `ref` to the Snapshot’s def', () => {
    const kept = required(aRef('shared'));
    const before = aService({ body: { id, gone, kept }, defs: { shared } });
    const after = aService({ body: { id, kept }, defs: { shared } });

    const formerInputs = formerInputsAfter(before, after);

    expect(formerInputs).toEqual([anEntry('1.1.0', { id, gone, kept }, { shared })]);
  });

  test('a removed field beside a field naming a def that changed only its description holds that def as declared', () => {
    const kept = required(aRef('shared'));
    const described = (description: string) => ({ ...shared, description });
    const before = aService({ body: { id, gone, kept }, defs: { shared: described('old') } });
    const after = aService({ body: { id, kept }, defs: { shared: described('new') } });

    const formerInputs = formerInputsAfter(before, after);

    expect(formerInputs).toEqual([
      anEntry('1.1.0', { id, gone, kept }, { shared: described('new') }),
    ]);
  });

  test('a removed field beside a field naming a def that changed its description and lost a field names that def apart', () => {
    const described = (description: string, fields: Fields) => ({
      ...anObject(fields),
      description,
    });
    const old = described('old', { p: required(aString), q: optional(aString) });
    const before = aService({
      body: { id, gone, kept: required(aRef('shared')) },
      defs: { shared: old },
    });
    const after = aService({
      body: { id, kept: required(aRef('shared')) },
      defs: { shared: described('new', { p: required(aString) }) },
    });

    const formerInputs = formerInputsAfter(before, after);

    const apart = described('new', { p: required(aString), q: optional(aString) });
    expect(formerInputs).toEqual([
      anEntry('1.1.0', { id, gone, kept: required(aRef('shared~1')) }, { 'shared~1': apart }),
    ]);
  });

  test('a `ref` pair naming one unchanged def through an alias def is held as the Endpoint writes it', () => {
    const kept = required(aRef('alias'));
    const defs = { alias: aRef('shared'), shared };
    const before = aService({ body: { id, gone, kept }, defs });
    const after = aService({ body: { id, kept }, defs });

    const formerInputs = formerInputsAfter(before, after);

    expect(formerInputs).toEqual([anEntry('1.1.0', { id, gone, kept }, defs)]);
  });

  test('a field named `constructor` is grafted back as an own field', () => {
    const before = aService({ body: { id, constructor: gone } });
    const after = aService({ body: { id } });

    const [former] = formerInputsAfter(before, after);

    const fields = former?.input.body?.type === 'object' ? former.input.body.fields : {};
    expect(Object.hasOwn(fields, 'constructor')).toBe(true);
    expect(fields['constructor']).toEqual(gone);
  });

  test('a kept field naming an unchanged def is written as the Endpoint writes its `ref`, whatever the Baseline wrote', () => {
    const written = { type: 'ref', name: 'shared', nullable: true, description: 'new' } as const;
    const before = aService({
      body: { id, gone, kept: required({ type: 'ref', name: 'shared', description: 'old' }) },
      defs: { shared },
    });
    const after = aService({ body: { id, kept: required(written) }, defs: { shared } });

    const formerInputs = formerInputsAfter(before, after);

    expect(formerInputs).toEqual([
      anEntry('1.1.0', { id, gone, kept: required(written) }, { shared }),
    ]);
  });

  test.each(['toString', 'constructor', 'valueOf', 'hasOwnProperty'])(
    'a removed field naming a def %s that the proposed Snapshot no longer holds is kept as a Former Input, and its Snapshot decodes',
    (name) => {
      const dropped = anObject({ p: required(aString) });
      const before = aService({
        body: { id, gone: required(aRef(name)) },
        defs: { [name]: dropped },
      });
      const after = aService({ body: { id } });

      const published = publishedThrough(before, after);

      expect([published.formerInputs, decodeSnapshot(canonicalTextOf(published)).kind]).toEqual([
        [anEntry('1.1.0', { id, gone: required(aRef(name)) }, { [name]: dropped })],
        'decoded',
      ]);
    },
  );

  test('two pairs whose former defs share a name are named `~1` and `~2` as before', () => {
    const both = anObject({ p: required(aString), q: optional(aString) });
    const before = aService({
      body: { first: required(aRef('b1')), second: required(aRef('b2')) },
      defs: { b1: both, b2: both },
    });
    const after = aService({
      body: { first: required(aRef('x')), second: required(aRef('x')) },
      defs: { x: shared },
    });

    const formerInputs = formerInputsAfter(before, after);

    expect(formerInputs).toEqual([
      anEntry(
        '1.1.0',
        { first: required(aRef('x~1')), second: required(aRef('x~2')) },
        { 'x~1': both, 'x~2': both },
      ),
    ]);
  });
});

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

describe('compatibilityReportOf and publishedSnapshotOf: the graft’s time', () => {
  /** A growth test times its shape many times over, which a CI runner that several runs share stretches several times over. */
  const growthTimeout = 240_000;

  const sizes = { small: 2_000, large: 16_000 };

  /** The Endpoints are as many as the chain is long, so a check that reads the chain per Endpoint costs their product. */
  const endpointSizes = { small: 1_000, large: 8_000 };

  /** The Former Inputs are as many as the Endpoints, and a Check that scans them per Endpoint costs their product, which only sizes this large let outgrow the rest of the Check. */
  const formerSizes = { small: 4_000, large: 32_000 };

  const mergedAt = publishedAt('1.1.0');

  function bodyFieldNamesOf(former: FormerInput): readonly string[] {
    return former.input.body?.type === 'object' ? Object.keys(former.input.body.fields) : [];
  }

  function checked(shapeOf: (count: number) => Shape) {
    return (count: number) => {
      const { baseline, proposed } = shapeOf(count);
      return () => compatibilityReportOf(baseline, proposed);
    };
  }

  function checkedAndMerged(shapeOf: (count: number) => Shape) {
    return (count: number) => {
      const { baseline, proposed } = shapeOf(count);
      return () => [
        compatibilityReportOf(baseline, proposed),
        publishedSnapshotOf(baseline, proposed, mergedAt),
      ];
    };
  }

  function merged(shapeOf: (count: number) => Shape) {
    return (count: number) => {
      const { baseline, proposed } = shapeOf(count);
      return () => publishedSnapshotOf(baseline, proposed, mergedAt);
    };
  }

  test.each([{ naming: 'bare' }, { naming: 'in a field' }] as const)(
    'many Endpoints whose Input body names the head of one unchanged chain of ids, $naming, are checked in time that grows with their number and the chain’s length',
    {
      timeout: growthTimeout,
    },
    ({ naming }) => {
      const shapeOf = (count: number) => endpointsNamingChain(count, naming);
      const { baseline, proposed } = shapeOf(3);

      const report = compatibilityReportOf(baseline, proposed);
      const order = orderOf(checked(shapeOf), endpointSizes, orders.linear);

      expect(report).toEqual({ changes: [] });
      expect(order).toBeLessThan(orders.linear);
    },
  );

  test('a body of many fields losing one is checked and merged in time that grows with its fields', {
    timeout: growthTimeout,
  }, () => {
    const { baseline, proposed } = wideBodyLosingField(3);

    const published = publishedSnapshotOf(baseline, proposed, mergedAt);
    const order = orderOf(checkedAndMerged(wideBodyLosingField), sizes, orders.linear);

    expect(published.formerInputs.map(bodyFieldNamesOf)).toEqual([['f0', 'f1', 'f2']]);
    expect(order).toBeLessThan(orders.linear);
  });

  test('a chain of ids whose end lost a field is checked and merged in time that grows with its length', {
    timeout: growthTimeout,
  }, () => {
    const { baseline, proposed } = chainLosingFieldAtEnd(3);

    const published = publishedSnapshotOf(baseline, proposed, mergedAt);
    const order = orderOf(checkedAndMerged(chainLosingFieldAtEnd), sizes, orders.linear);

    expect(published.formerInputs.map(({ defs }) => Object.keys(defs))).toEqual([
      ['c0~1', 'c1~1', 'c2~1'],
    ]);
    expect(order).toBeLessThan(orders.linear);
  });

  test('many defs naming the top of a long chain of alias defs whose end changed are grafted in time that grows with them', {
    timeout: growthTimeout,
  }, () => {
    const { baseline, proposed } = defsNamingAnAliasChain(3);

    const published = publishedSnapshotOf(baseline, proposed, mergedAt);
    const order = orderOf(checkedAndMerged(defsNamingAnAliasChain), sizes, orders.linear);

    expect(published.formerInputs.map(bodyFieldNamesOf)).toEqual([['f0', 'f1']]);
    expect(order).toBeLessThan(orders.linear);
  });

  test('many Endpoints each losing a field beside many defs they do not reach are checked in time that grows with both', {
    timeout: growthTimeout,
  }, () => {
    const { baseline, proposed } = endpointsLosingFieldBesideUnreachedDefs(3);

    const published = publishedSnapshotOf(baseline, proposed, mergedAt);
    const order = orderOf(
      checkedAndMerged(endpointsLosingFieldBesideUnreachedDefs),
      sizes,
      orders.linear,
    );

    expect(published.formerInputs.map(({ endpoint, defs }) => [endpoint, defs])).toEqual([
      ['PUT /e0', {}],
      ['PUT /e1', {}],
      ['PUT /e2', {}],
    ]);
    expect(order).toBeLessThan(orders.linear);
  });

  test('a Baseline holding a Former Input for each of many Endpoints is checked in time that grows with them', {
    timeout: growthTimeout,
  }, () => {
    const { baseline, proposed } = endpointsHoldingFormerInputEach(3);

    const report = compatibilityReportOf(baseline, proposed);
    const order = orderOf(checked(endpointsHoldingFormerInputEach), formerSizes, orders.linear);

    expect(report).toEqual({ changes: [] });
    expect(order).toBeLessThan(orders.linear);
  });

  test('many Endpoints naming the top of one long chain of alias defs whose end changed are merged in time that grows with them', {
    timeout: growthTimeout,
  }, () => {
    const { baseline, proposed } = endpointsNamingAnAliasChain(3);

    const published = publishedSnapshotOf(baseline, proposed, mergedAt);
    const order = orderOf(merged(endpointsNamingAnAliasChain), sizes, orders.linear);

    expect(published.formerInputs).toEqual([]);
    expect(order).toBeLessThan(orders.linear);
  });

  test('many defs named apart from one def’s name are merged in time that grows with them', {
    timeout: growthTimeout,
  }, () => {
    const { baseline, proposed } = defsNamedApartFromOne(3);

    const published = publishedSnapshotOf(baseline, proposed, mergedAt);
    const order = orderOf(merged(defsNamedApartFromOne), endpointSizes, orders.linear);

    expect(published.formerInputs.map(({ defs }) => Object.keys(defs))).toEqual([
      ['x~1', 'x~2', 'x~3'],
    ]);
    expect(order).toBeLessThan(orders.linear);
  });

  test('many former defs merged into one proposed def whose field writes in place what they all name are merged in time that grows with them', {
    timeout: growthTimeout,
  }, () => {
    const { baseline, proposed } = defsMergedIntoOneWrittenInline(3);

    const published = publishedSnapshotOf(baseline, proposed, mergedAt);
    const order = orderOf(merged(defsMergedIntoOneWrittenInline), endpointSizes, orders.linear);

    expect(published.formerInputs.map(({ defs }) => Object.keys(defs))).toEqual([
      ['p~1', 'p~2', 'p~3'],
    ]);
    expect(order).toBeLessThan(orders.linear);
  });

  test('many Endpoints naming the top of one long chain of alias defs whose end lost a field are merged in time that grows with them', {
    timeout: growthTimeout,
  }, () => {
    const { baseline, proposed } = endpointsNamingAnAliasChainLosingField(3);

    const published = publishedSnapshotOf(baseline, proposed, mergedAt);
    const order = orderOf(merged(endpointsNamingAnAliasChainLosingField), sizes, orders.linear);

    expect(published.formerInputs.map(({ defs }) => Object.keys(defs))).toEqual([
      ['a0~1'],
      ['a0~1'],
      ['a0~1'],
    ]);
    expect(order).toBeLessThan(orders.linear);
  });

  test('many Endpoints naming the top of one long chain of alias defs, each alias def’s description changed, are merged in time that grows with them', {
    timeout: growthTimeout,
  }, () => {
    const { baseline, proposed } = endpointsNamingChangedAliasDefs(3);

    const published = publishedSnapshotOf(baseline, proposed, mergedAt);
    const order = orderOf(merged(endpointsNamingChangedAliasDefs), sizes, orders.linear);

    expect(published.formerInputs).toEqual([]);
    expect(order).toBeLessThan(orders.linear);
  });

  test.each([
    'description',
    'gained field',
    'retyped field',
    'union option',
    'retargeted refs',
  ] as const satisfies readonly ChainEnd[])(
    'many Endpoints naming the top of one long chain of object defs whose end changed (%s) with no field to put back are merged in time that grows with them, and keep no Former Input',
    { timeout: growthTimeout },
    (change) => {
      const shapeOf = (count: number) => endpointsNamingOneChainChangedAt(count, change);
      const { baseline, proposed } = shapeOf(3);

      const published = publishedSnapshotOf(baseline, proposed, mergedAt);
      const order = orderOf(merged(shapeOf), endpointSizes, orders.linear);

      expect(published.formerInputs).toEqual([]);
      expect(order).toBeLessThan(orders.linear);
    },
  );
});

describe('publishedSnapshotOf: former Inputs over a seeded def graph', () => {
  const count = 3_000;
  const draws = Array.from({ length: count }, (_, seed) => graftDrawOf(seed));
  const isDecoded = (published: PublishedServiceSnapshot) =>
    decodeSnapshot(canonicalTextOf(published)).kind === 'decoded';

  function countOf(kind: string): number {
    return draws.filter(({ kinds }) => kinds.has(kind)).length;
  }

  test('the generator draws removals under every kind of node the graft enters, and removed fields naming defs through every kind it copies and defs the proposed Snapshot drops', () => {
    const wanted = [
      'graft: field',
      'graft: items',
      'graft: value',
      'graft: rest',
      'graft: variant',
      'copy: union',
      'copy: record key',
      'copy: tuple rest',
      'copy: tuple',
      'copy: tagged',
      'copy: allOf',
      'copy: array',
      'copy: object',
      'copy: nullable ref',
      'copy: ref to an alias',
      'dropped: toString',
      'dropped: constructor',
      'dropped: valueOf',
      'dropped: hasOwnProperty',
    ];

    const scarce = wanted.filter((kind) => countOf(kind) < 50);

    expect(scarce).toEqual([]);
  });

  test('the generator draws defs named apart beside defs held as declared, and closures that changed and did not', () => {
    const published = draws.map((draw) => publishedEach([draw.baseline, draw.proposed]).at(-1));
    const formers = published.map((publish) => publish?.formerInputs[0]);

    const apart = formers.filter((former) =>
      Object.keys(former?.defs ?? {}).some((name) => name.includes('~')),
    );
    const besideHeld = apart.filter((former) =>
      Object.keys(former?.defs ?? {}).some((name) => !name.includes('~')),
    );
    const unchanged = draws.filter(({ baseline, proposed }) =>
      Object.keys(baseline.defs).some((name) =>
        isClosureUnchanged(name, baseline.defs, proposed.defs),
      ),
    );

    expect([apart.length, besideHeld.length, unchanged.length]).toEqual([
      expect.toSatisfy((value: number) => value >= 500),
      expect.toSatisfy((value: number) => value >= 50),
      expect.toSatisfy((value: number) => value >= 500),
    ]);
  });

  test('a kept former Input of an Input that only lost fields, under every kind of node, is the Input as it was', () => {
    const problems = draws.flatMap((draw, seed) => {
      const [, published] = publishedEach([draw.baseline, draw.proposed]);
      const input = draw.baseline.endpoints[graftedIdentity]?.input;
      const formers = published?.formerInputs ?? [];
      const found = formers.flatMap((former) => [
        differenceFromInput(former, {
          input: input as Pick<FormerInput, 'input'>['input'],
          defs: draw.baseline.defs,
        }),
        problemWithDefsOf(former),
      ]);
      return found
        .filter((problem) => problem !== undefined)
        .map((problem) => `${seed}: ${problem}`);
    });

    expect(problems).toEqual([]);
  });

  test('every Former Input the merge writes over a seeded def graph that only loses fields decodes', () => {
    const undecoded = draws.flatMap((draw, seed) => {
      const publishes = publishedEach([draw.baseline, draw.proposed]);
      return publishes.every(isDecoded) ? [] : [seed];
    });

    expect(undecoded).toEqual([]);
  });
});

describe('publishedSnapshotOf: former Inputs over a seeded def graph with edits', () => {
  const histories = Array.from({ length: 3_000 }, (_, seed) => removalHistoryOf(seed));

  const published = histories.map(publishedEach);

  const namesOf = (former: FormerInput) => Object.keys(former.defs);

  const heldNamesOf = (publishes: readonly PublishedServiceSnapshot[]) =>
    publishes.flatMap(({ formerInputs }) => formerInputs.flatMap(namesOf));

  test('the histories remove fields naming defs while some defs are named apart beside others held as declared, and some closures changed and some did not', () => {
    const apart = published.filter((publishes) =>
      heldNamesOf(publishes).some((name) => name.includes('~')),
    );
    const besideUnchanged = histories.filter(([first, second], seed) => {
      const unchanged = Object.keys(first?.defs ?? {}).filter((name) =>
        isClosureUnchanged(name, first?.defs ?? {}, second?.defs ?? {}),
      );
      const names = heldNamesOf(published[seed] ?? []);
      return (
        names.some((name) => name.includes('~')) && unchanged.some((name) => names.includes(name))
      );
    });
    const changed = histories.filter(([first, second]) =>
      Object.keys(first?.defs ?? {}).some(
        (name) => !isClosureUnchanged(name, first?.defs ?? {}, second?.defs ?? {}),
      ),
    );

    expect([apart.length, besideUnchanged.length, changed.length]).toEqual([
      expect.toSatisfy((count: number) => count >= 50),
      expect.toSatisfy((count: number) => count >= 100),
      expect.toSatisfy((count: number) => count >= 100),
    ]);
  });

  test('every Former Input the merge writes over a seeded def graph with edits decodes, and every def it holds is named for a def of the graph', () => {
    const problems = histories.flatMap((versions, seed) => {
      const bases = new Set(versions.flatMap(({ defs }) => Object.keys(defs)));
      const publishes = published[seed] ?? [];
      const undecoded = publishes.filter(
        (publish) => decodeSnapshot(canonicalTextOf(publish)).kind !== 'decoded',
      );
      const unnamed = heldNamesOf(publishes).filter((name) => {
        const [base = '', ...suffixes] = name.split('~');
        return !bases.has(base) || !suffixes.every((suffix) => /^[1-9]\d*$/.test(suffix));
      });
      return [
        ...undecoded.map(() => `${seed}: does not decode`),
        ...unnamed.map((name) => `${seed}: ${name}`),
      ];
    });

    expect(problems).toEqual([]);
  });

  test('a former Input whose defs copy the Endpoint’s and whose body names every def grafts no field', () => {
    const kept = histories.flatMap((versions, seed) => {
      const proposed = versions[2] as ServiceSnapshot;
      const endpoint = proposed.endpoints[graftedIdentity] as EndpointSnapshot;
      const former: FormerInput = {
        endpoint: graftedIdentity,
        removedIn: '1.1.0',
        input: {
          query: endpoint.input.query as ObjectNode,
          body: endpoint.input.body as ObjectNode,
        },
        defs: structuredClone(proposed.defs),
      };
      const baseline = {
        ...(published[seed]?.[2] as PublishedServiceSnapshot),
        formerInputs: [former],
      };

      const merged = publishedSnapshotOf(baseline, structuredClone(proposed), publishedAt('1.3.0'));

      return merged.formerInputs.map(() => seed);
    });

    expect(kept).toEqual([]);
  });
});

describe('publishedSnapshotOf: former Inputs over seeded alias graphs and nodes', () => {
  const draws = Array.from({ length: 3_000 }, (_, seed) => aliasDrawOf(seed));

  /** The `ref`s a field's schema holds, which these draws write as a `ref`, in a union or in an array. */
  const refsIn = (schema: SchemaNode | undefined) =>
    schema === undefined ? [] : nodesIn(schema).filter(isRef);

  function writtenRefsDifferFrom(draw: ReturnType<typeof aliasDrawOf>): readonly string[] {
    const published = publishedThrough(draw.baseline, draw.proposed);
    const body = draw.baseline.endpoints[graftedIdentity]?.input.body;
    const former = published.formerInputs[0];
    const written = former?.input.body;
    if (body?.type !== 'object' || former === undefined || written?.type !== 'object') {
      return ['no former Input'];
    }
    return Object.entries(body.fields).flatMap(([field, { schema }]) => {
      const asked = refsIn(schema);
      const grafted = refsIn(written.fields[field]?.schema);
      const isHeld = field.startsWith('k') && schema.type === 'union';
      return asked.flatMap((ask, index) => {
        const ref = grafted[index] as RefNode | undefined;
        const expected = destinationOf(ask as RefNode, draw.baseline.defs);
        const isRight = isHeld
          ? isDeepStrictEqual(ref, ask)
          : ref !== undefined &&
            expected !== undefined &&
            ref.name.split('~')[0] === expected.name &&
            (ref.nullable === true) === expected.nullable &&
            isDeepStrictEqual(annotationsOf(ref), annotationsOf(ask as RefNode)) &&
            isDeepStrictEqual(former.defs[ref.name], expected.def);
        return isRight ? [] : [`${field} ${JSON.stringify(ask)} against ${JSON.stringify(ref)}`];
      });
    });
  }

  test('the generator draws chains of three or more alias defs, nullable asking `ref`s and a def named `constructor`', () => {
    const counts = [
      draws.filter(({ aliases }) => aliases >= 3).length,
      draws.filter(({ nullableAsked }) => nullableAsked > 0).length,
      draws.filter(({ isConstructor }) => isConstructor).length,
    ];

    expect(counts).toEqual([
      expect.toSatisfy((count: number) => count >= 100),
      expect.toSatisfy((count: number) => count >= 100),
      expect.toSatisfy((count: number) => count >= 50),
    ]);
  });

  test('every `ref` a kept Former Input writes to a def only it reaches names where its alias defs lead, nullable when one on the way is', () => {
    const problems = draws.flatMap((draw, seed) =>
      writtenRefsDifferFrom(draw).map((problem) => `${seed}: ${problem}`),
    );

    expect(problems).toEqual([]);
  });

  test('a field named `constructor` and a def named `constructor` reached through an alias are grafted as declared', () => {
    const both = anObject({ p: required(aString), q: optional(aString) });
    const before = aService({
      body: { id, constructor: gone, kept: required(aRef('link')) },
      defs: { constructor: both, link: aRef('constructor') },
    });
    const after = aService({
      body: { id, kept: required(aRef('link')) },
      defs: { constructor: anObject({ p: required(aString) }), link: aRef('constructor') },
    });

    const formerInputs = formerInputsAfter(before, after);

    expect(formerInputs).toEqual([
      anEntry(
        '1.1.0',
        { id, constructor: gone, kept: required(aRef('constructor~1')) },
        { 'constructor~1': both },
      ),
    ]);
  });
});

/** The defs of a Former Input named apart from one name, `x~1`, `x~2`…, for each name with two or more. */
function apartGroupsOf(former: FormerInput): readonly (readonly string[])[] {
  const byBase = new Map<string, string[]>();
  for (const name of Object.keys(former.defs).filter((held) => held.includes('~'))) {
    const base = name.split('~')[0] as string;
    byBase.set(base, [...(byBase.get(base) ?? []), name]);
  }
  return [...byBase.values()].filter((names) => names.length >= 2);
}

function hasTwoDefsApartFromOne(former: FormerInput): boolean {
  return apartGroupsOf(former).length > 0;
}

/** The defs named apart that a def of a Former Input names. */
function defsApartNamedBy(former: FormerInput, name: string): readonly string[] {
  const names = nodesIn(former.defs[name])
    .filter(isRef)
    .map((ref) => String(ref.name));
  return names.filter((held) => held.includes('~'));
}

/** Whether two defs named apart from one name both name a def named apart. */
function hasTwoApartNamingOne(former: FormerInput): boolean {
  return apartGroupsOf(former).some((group) =>
    group.some((name, index) =>
      group.slice(index + 1).some((other) => {
        const named = defsApartNamedBy(former, other);
        return defsApartNamedBy(former, name).some((held) => named.includes(held));
      }),
    ),
  );
}

function fieldsOfDef(node: SchemaNode | undefined): Readonly<Record<string, Field>> {
  return node?.type === 'object' ? node.fields : {};
}

/** Whether a node holds, in place, an object of exactly the fields given. */
function holdsObjectOf(node: SchemaNode | undefined, fieldNames: readonly string[]): boolean {
  const wanted = fieldNames.toSorted().join();
  return nodesIn(node).some(
    (inner) =>
      inner.type === 'object' &&
      Object.keys(inner.fields as object)
        .sort()
        .join() === wanted,
  );
}

describe('publishedSnapshotOf: a pair the graft meets again', () => {
  const written = anObject({ k: required(aString) });

  test('a field removed inside an object that two former defs the Endpoint merged into one each name is grafted under both copies, and the Check reports it once', () => {
    const named = anObject({ k: required(aString), gone: optional(aString) });
    const before = aService({
      body: { x: required(aRef('left')), y: required(aRef('right')) },
      defs: {
        left: anObject({ a: required(aRef('shared')), xa: optional(aString) }),
        right: anObject({ a: required(aRef('shared')) }),
        shared: named,
      },
    });
    const after = aService({
      body: { x: required(aRef('merged')), y: required(aRef('merged')) },
      defs: { merged: anObject({ a: required(written) }) },
    });

    const published = publishedThrough(before, after);

    expect([
      linesOf(publishedThrough(before), after),
      published.formerInputs,
      decodeSnapshot(canonicalTextOf(published)).kind,
    ]).toEqual([
      [
        'neutral annotation-changed at input.body.x',
        'neutral annotation-changed at defs.merged.a',
        'additive field-removed at defs.merged.a.gone',
        'additive field-removed at defs.merged.xa',
        'neutral annotation-changed at input.body.y',
      ],
      [
        anEntry(
          '1.1.0',
          { x: required(aRef('merged~1')), y: required(aRef('merged~2')) },
          {
            'merged~1': anObject({ a: required(named), xa: optional(aString) }),
            'merged~2': anObject({ a: required(named) }),
          },
        ),
      ],
      'decoded',
    ]);
  });

  test('a former def reached again inside the object it is grafted into keeps both defs named apart, each grafted', () => {
    const inner = anObject({ gone: optional(aString), y: optional(aRef('merged~2')) });
    const before = aService({
      body: { x: required(aRef('outer')) },
      defs: {
        outer: anObject({ x: required(aRef('shared')) }),
        again: anObject({ x: required(aRef('shared')), z: optional(aString) }),
        shared: anObject({ gone: optional(aString), y: optional(aRef('again')) }),
      },
    });
    const after = aService({
      body: { x: required(aRef('merged')) },
      defs: {
        merged: anObject({ x: required(anObject({ y: optional(aRef('merged')) })) }),
      },
    });

    const published = publishedThrough(before, after);

    expect([published.formerInputs, decodeSnapshot(canonicalTextOf(published)).kind]).toEqual([
      [
        anEntry(
          '1.1.0',
          { x: required(aRef('merged~1')) },
          {
            'merged~1': anObject({ x: required(inner) }),
            'merged~2': anObject({ x: required(inner), z: optional(aString) }),
          },
        ),
      ],
      'decoded',
    ]);
  });

  test.each([
    {
      order: 'the kept field first',
      before: { a: required(aRef('n')), b: optional(aRef('n')) },
      after: { a: required(aRef('n')) },
      names: { a: 'n~1', b: 'n~2' },
    },
    {
      order: 'the removed field first',
      before: { a: optional(aRef('n')), b: required(aRef('n')) },
      after: { b: required(aRef('n')) },
      names: { a: 'n~1', b: 'n~2' },
    },
  ])(
    'a def a kept field reaches and a def a removed field copies, of one name, are named apart in the order the body reaches them, $order',
    ({ before, after, names }) => {
      const both = anObject({ q: optional(aString), r: required(aString) });
      const defsBefore = { n: both };
      const defsAfter = { n: anObject({ r: required(aString) }) };

      const formerInputs = formerInputsAfter(
        aService({ body: before, defs: defsBefore }),
        aService({ body: after, defs: defsAfter }),
      );

      const body = Object.fromEntries(
        Object.entries(before).map(([name, field]) => [
          name,
          { ...field, schema: aRef(names[name as 'a' | 'b']) },
        ]),
      );
      expect(formerInputs).toEqual([anEntry('1.1.0', body, { 'n~1': both, 'n~2': both })]);
    },
  );

  test('two ids of one zod shape, as generate declares them, are grafted apart under their own names', () => {
    const declared = (isLost: boolean) => {
      const shape: z.ZodType = z.object({
        get x() {
          return first.optional();
        },
        get y() {
          return second.optional();
        },
        ...(isLost ? { lost: z.string().optional() } : {}),
      });
      const first: z.ZodType = z.lazy(() => shape).meta({ id: 'a' });
      const second: z.ZodType = z.lazy(() => shape).meta({ id: 'b' });
      const endpoint = defineEndpoint({
        name: 'echo',
        method: 'POST',
        path: '/echo',
        visibility: 'public',
        description: 'Echo',
        input: { body: z.object({ a: first, b: second }) },
        success: { status: 204 },
      });
      const group = defineGroup({ name: 'shapes', description: 'Shapes', endpoints: [endpoint] });
      const root = defineService({ name: 'shapes-service', groups: [group] });
      const validated = validateRoot(root, aRootPackage(root));
      if (validated.kind !== 'valid') {
        throw new Error(validated.failures.slice(0, 1).map(failureLineOf).join(''));
      }
      return snapshotOf(validated) as ServiceSnapshot;
    };

    const published = publishedThrough(declared(true), declared(false));

    const apart = anObject({
      lost: optional(aString),
      x: optional(aRef('a~1')),
      y: optional(aRef('b~1')),
    });
    expect(published.formerInputs).toEqual([
      {
        endpoint: 'POST /echo',
        removedIn: '1.1.0',
        input: {
          query: anObject({}),
          body: anObject({ a: required(aRef('a~1')), b: required(aRef('b~1')) }),
        },
        defs: { 'a~1': apart, 'b~1': apart },
      },
    ]);
  });

  test('two refs naming different alias defs of one unchanged def are held as the Endpoint writes them', () => {
    const held = anObject({ s: required(aString), t: optional(aRef('target')) });
    const before = aService({
      body: { id, gone, kept: required(aRef('oldAlias')) },
      defs: { oldAlias: aRef('target'), target: held },
    });
    const after = aService({
      body: { id, kept: required(aRef('newAlias')) },
      defs: { newAlias: aRef('target'), target: held },
    });

    const published = publishedThrough(before, after);

    expect([linesOf(publishedThrough(before), after), published.formerInputs]).toEqual([
      [
        'additive field-removed at input.body.gone',
        'neutral annotation-changed at input.body.kept',
      ],
      [
        anEntry(
          '1.1.0',
          { id, gone, kept: required(aRef('newAlias')) },
          { target: held, newAlias: aRef('target') },
        ),
      ],
    ]);
  });
});

describe('publishedSnapshotOf: former Inputs over seeded draws whose Baseline holds a def twice', () => {
  const draws = Array.from({ length: 3_000 }, (_, seed) => doubledGraftDrawOf(seed));
  const published = draws.map((draw) => publishedThrough(draw.baseline, draw.proposed));

  test('the draws hold Former Inputs with two defs named apart from one proposed def, and both naming one def named apart', () => {
    const counts = [
      published.filter(({ formerInputs }) => formerInputs.some(hasTwoDefsApartFromOne)).length,
      published.filter(({ formerInputs }) => formerInputs.some(hasTwoApartNamingOne)).length,
    ];

    expect(counts).toEqual([
      expect.toSatisfy((count: number) => count >= 100),
      expect.toSatisfy((count: number) => count >= 50),
    ]);
  });

  test('a kept former Input of a draw whose Baseline holds a def twice is the Input as it was, and decodes', () => {
    const problems = draws.flatMap((draw, seed) => {
      const input = draw.baseline.endpoints[graftedIdentity]?.input;
      const found = (published[seed] as PublishedServiceSnapshot).formerInputs.flatMap((former) => [
        differenceFromInput(former, {
          input: input as Pick<FormerInput, 'input'>['input'],
          defs: draw.baseline.defs,
        }),
        problemWithDefsOf(former),
      ]);
      const undecoded = decodeSnapshot(
        canonicalTextOf(published[seed] as PublishedServiceSnapshot),
      );
      return [...found, undecoded.kind === 'decoded' ? undefined : 'does not decode']
        .filter((problem) => problem !== undefined)
        .map((problem) => `${seed}: ${problem}`);
    });

    expect(problems).toEqual([]);
  });
});

describe('publishedSnapshotOf: former Inputs over seeded draws whose proposed version writes a def inline', () => {
  const draws = Array.from({ length: 3_000 }, (_, seed) => inlinedGraftDrawOf(seed));
  const published = draws.map((draw) => publishedThrough(draw.baseline, draw.proposed));

  /** Whether the draw's Input names, where its proposed version writes a def in place, an object a Former Input holds in two defs named apart from one proposed def. */
  function holdsWrittenTwice(draw: ReturnType<typeof inlinedGraftDrawOf>, seed: number): boolean {
    const name = [...draw.kinds].find((kind) => kind.startsWith('inlined: '))?.slice(9);
    const fieldNames = Object.keys(fieldsOfDef(draw.baseline.defs[name ?? '']));
    return (published[seed] as PublishedServiceSnapshot).formerInputs.some((former) =>
      apartGroupsOf(former).some(
        (group) => group.filter((def) => holdsObjectOf(former.defs[def], fieldNames)).length >= 2,
      ),
    );
  }

  test('the draws hold a pair written inline on the proposed side reached twice, and grafted under both', () => {
    const inlined = draws.filter(({ kinds }) =>
      [...kinds].some((kind) => kind.startsWith('inlined: ')),
    );
    const twice = draws.filter(holdsWrittenTwice);
    const grafted = twice.filter(({ kinds }) => kinds.has('inlined: lost a field'));

    expect([inlined.length, twice.length, grafted.length]).toEqual([
      expect.toSatisfy((count: number) => count >= 500),
      expect.toSatisfy((count: number) => count >= 100),
      expect.toSatisfy((count: number) => count >= 50),
    ]);
  });

  test('a kept former Input of a draw whose proposed version writes a def inline is the Input as it was, and decodes', () => {
    const problems = draws.flatMap((draw, seed) => {
      const input = draw.baseline.endpoints[graftedIdentity]?.input;
      const found = (published[seed] as PublishedServiceSnapshot).formerInputs.flatMap((former) => [
        differenceFromInput(former, {
          input: input as Pick<FormerInput, 'input'>['input'],
          defs: draw.baseline.defs,
        }),
        problemWithDefsOf(former),
      ]);
      const undecoded = decodeSnapshot(
        canonicalTextOf(published[seed] as PublishedServiceSnapshot),
      );
      return [...found, undecoded.kind === 'decoded' ? undefined : 'does not decode']
        .filter((problem) => problem !== undefined)
        .map((problem) => `${seed}: ${problem}`);
    });

    expect(problems).toEqual([]);
  });
});

describe('publishedSnapshotOf: former Inputs of Endpoints over seeded draws that remove fields only inside defs', () => {
  const draws = Array.from({ length: 3_000 }, (_, seed) => defGraftDrawOf(seed));
  const identitiesOf = (count: number) =>
    Array.from({ length: count }, (_, index) => identityOf(index));

  function publishedUnder(draw: ReturnType<typeof defGraftDrawOf>, identities: readonly string[]) {
    const { baseline, proposed } = servicesOf(draw, identities);
    return publishedSnapshotOf(publishedFirst(baseline), proposed, publishedAt('1.1.0'));
  }

  const published = draws.map((draw) => publishedUnder(draw, identitiesOf(draw.bodies.length)));

  /** Whether the draw's Endpoints differ in whether they keep a Former Input. */
  const isMixed = (seed: number) => {
    const kept = identitiesOf((draws[seed] as (typeof draws)[number]).bodies.length).map(
      (identity) =>
        (published[seed] as PublishedServiceSnapshot).formerInputs.some(
          (former) => former.endpoint === identity,
        ),
    );
    return kept.includes(true) && kept.includes(false);
  };

  test('the draws hold removals that landed, edits that put no field back, and neither', () => {
    const landed = draws.filter(({ landed: owners }) => owners.length > 0);
    const steps = ['field', 'items', 'value', 'rest', 'variant'].map(
      (step) => landed.filter(({ kinds }) => kinds.has(`graft: ${step}`)).length,
    );
    const counts = [
      draws.filter((draw) => draw.landed.length === 0 && draw.edited.length > 0).length,
      draws.filter((draw) => draw.landed.length === 0 && draw.edited.length === 0).length,
      landed.length,
      draws.filter((_, seed) => isMixed(seed)).length,
    ];

    expect([counts, steps.map((count) => count >= 50)]).toEqual([
      [
        expect.toSatisfy((count: number) => count >= 100),
        expect.toSatisfy((count: number) => count >= 100),
        expect.toSatisfy((count: number) => count >= 1_000),
        expect.toSatisfy((count: number) => count >= 100),
      ],
      [true, true, true, true, true],
    ]);
  });

  test('an Endpoint keeps a Former Input exactly when its body reaches a def a removal landed in', () => {
    const wrong = draws.flatMap((draw, seed) => {
      const formers = (published[seed] as PublishedServiceSnapshot).formerInputs;
      return draw.bodies.flatMap((body, index) => {
        const isKept = formers.some((former) => former.endpoint === identityOf(index));
        return isKept === reachesLanded(draw, body) ? [] : [`${seed}: Endpoint ${index}`];
      });
    });

    expect(wrong).toEqual([]);
  });

  test('the Former Inputs kept are the same whatever order the Endpoints’ identities put them in', () => {
    const different = draws.flatMap((draw, seed) => {
      const identities = identitiesOf(draw.bodies.length);
      const next = seededNext(seed + 7);
      const permuted = shuffledIdentities(identities, next);
      const again = publishedUnder(draw, permuted).formerInputs;
      const formersOf = (identity: string, formers: readonly FormerInput[]) =>
        formers.find((former) => former.endpoint === identity);
      return identities.flatMap((identity, index) => {
        const was = formersOf(identity, (published[seed] as PublishedServiceSnapshot).formerInputs);
        const now = formersOf(permuted[index] as string, again);
        const bare = (former: FormerInput | undefined) =>
          former === undefined ? undefined : { ...former, endpoint: '' };
        return isDeepStrictEqual(bare(was), bare(now)) ? [] : [`${seed}: Endpoint ${index}`];
      });
    });

    expect(different).toEqual([]);
  });
});
