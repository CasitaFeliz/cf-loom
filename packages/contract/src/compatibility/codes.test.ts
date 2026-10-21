import { describe, expect, test } from 'vitest';
import {
  type Change,
  type ChangeSite,
  type CodeSnapshot,
  type CommandSnapshot,
  compatibilityReportOf,
  type Difference,
  type EndpointSnapshot,
  type EventSnapshot,
  type Field,
  type ObjectNode,
  type PeerMove,
  type PublishedEndpoint,
  type PublishedServiceSnapshot,
  type SchemaNode,
  type ServiceSnapshot,
  versionBumpOf,
} from '../internal/index.ts';

type Visibility = EndpointSnapshot['visibility'];

const identity = 'GET /orders/{}';
const orderLocked = 'ORDER_LOCKED';
const orderGone = 'ORDER_GONE';
const standardRejections: ServiceSnapshot['standardRejections'] = {
  invalidInput: { origin: 'standard', code: 'INVALID_INPUT', status: 400, message: 'Invalid' },
  notFound: { origin: 'standard', code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { origin: 'standard', code: 'NOT_IMPLEMENTED', status: 501, message: 'No' },
};
const heading = {
  format: 1,
  kind: 'service',
  name: 'orders-service',
  generator: '@cf-loom/cli@2.1.0',
  definitions: {},
  standardRejections,
  defs: {},
  guards: {},
  codes: {},
  events: {},
  commands: {},
  subscriptions: {},
  dependencies: {},
} as const;
const unmoved: PeerMove = { baseline: { zod: '^4.1.0' }, proposed: { zod: '^4.1.0' } };

const aString: SchemaNode = { type: 'string' };

function required(schema: SchemaNode): Field {
  return { required: true, schema };
}

function optional(schema: SchemaNode): Field {
  return { required: false, schema };
}

function anOpenObject(fields: Readonly<Record<string, Field>> = {}): ObjectNode {
  return { type: 'object', mode: 'open', fields };
}

function anEndpoint(fields: Partial<EndpointSnapshot> = {}): EndpointSnapshot {
  return {
    name: 'getOrder',
    group: 'orders',
    visibility: 'public',
    lifecycle: 'active',
    description: 'One order',
    params: [],
    guards: [],
    input: { params: null, query: null, headers: null, body: null },
    success: { status: 200, headers: null, body: null },
    rejections: [],
    ...fields,
  };
}

function aLive(endpoint: EndpointSnapshot): PublishedEndpoint {
  return { ...endpoint, lifecycle: 'active' };
}

function aCode(fields: Partial<CodeSnapshot> = {}): CodeSnapshot {
  return {
    origin: 'local',
    status: 409,
    message: 'The order is locked',
    body: null,
    removed: false,
    ...fields,
  };
}

function anEvent(): EventSnapshot {
  return { visibility: 'internal', lifecycle: 'active', description: '', body: anOpenObject() };
}

function aCommand(): CommandSnapshot {
  return { lifecycle: 'active', description: '', body: anOpenObject() };
}

function aBaseline(fields: Partial<PublishedServiceSnapshot> = {}): PublishedServiceSnapshot {
  return { ...heading, version: '3.4.0', endpoints: {}, ...fields };
}

function aProposed(fields: Partial<ServiceSnapshot> = {}): ServiceSnapshot {
  return { ...heading, endpoints: {}, ...fields };
}

function reportOf(baseline: PublishedServiceSnapshot, proposed: ServiceSnapshot) {
  const report = compatibilityReportOf(baseline, proposed, []);
  if (report.kind !== 'compared') {
    throw new Error('the Baseline was given, so the report must have compared');
  }
  return report;
}

function isAtCode(change: Change): boolean {
  return change.site.kind === 'code';
}

function codeChangesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly Change[] {
  return reportOf(baseline, proposed).changes.filter(isAtCode);
}

function codeSite(code: string, visibility: Visibility): ChangeSite {
  return { kind: 'code', code, visibility };
}

function endpointSite(visibility: Visibility, at = identity): ChangeSite {
  return { kind: 'endpoint', identity: at, visibility };
}

function placeOf(site: ChangeSite): string {
  switch (site.kind) {
    case 'code':
      return site.code;
    case 'guard':
    case 'shared-schema':
    case 'subscription':
      return site.name;
    case 'endpoint':
    case 'event':
    case 'command':
      return site.identity;
  }
}

function breaking(site: ChangeSite, difference: Difference): Change {
  return { site, difference, class: 'breaking', approval: 'needed' };
}

function additive(site: ChangeSite, difference: Difference): Change {
  return { site, difference, class: 'additive' };
}

function statusChanged(from: number, to: number): Difference {
  return { kind: 'status-changed', from, to };
}

function bodyField(name: string, shape: 'field-added' | 'field-removed', isRequired = false) {
  const kind = shape === 'field-added' ? { kind: shape, required: isRequired } : { kind: shape };
  return {
    kind: 'schema',
    position: 'success',
    at: ['body', 'fields', name],
    shape: kind,
  } as const;
}

function lockedStatus(status: number): CodeSnapshot {
  return aCode({ status });
}

function answering(code: string): Partial<ServiceSnapshot> {
  return { endpoints: { [identity]: anEndpoint({ rejections: [code] }) } };
}

function publishedAnswering(code: string): Partial<PublishedServiceSnapshot> {
  return { endpoints: { [identity]: aLive(anEndpoint({ rejections: [code] })) } };
}

describe('compatibilityReportOf, a Service’s codes', () => {
  test('changing a code’s status is Breaking on its code and needs an Approval', () => {
    const baseline = aBaseline({
      ...publishedAnswering(orderLocked),
      codes: { [orderLocked]: lockedStatus(409) },
    });
    const proposed = aProposed({
      ...answering(orderLocked),
      codes: { [orderLocked]: lockedStatus(422) },
    });

    const changes = reportOf(baseline, proposed).changes;

    expect(changes).toEqual([breaking(codeSite(orderLocked, 'public'), statusChanged(409, 422))]);
  });

  const site = codeSite(orderLocked, 'public');
  const bodies = [
    {
      name: 'removing a field is Breaking',
      from: anOpenObject({ id: required(aString), note: required(aString) }),
      to: anOpenObject({ id: required(aString) }),
      change: breaking(site, bodyField('note', 'field-removed')),
    },
    {
      name: 'adding a required field is Additive',
      from: anOpenObject({ id: required(aString) }),
      to: anOpenObject({ id: required(aString), note: required(aString) }),
      change: additive(site, bodyField('note', 'field-added', true)),
    },
    {
      name: 'adding an optional field is Additive',
      from: anOpenObject({ id: required(aString) }),
      to: anOpenObject({ id: required(aString), note: optional(aString) }),
      change: additive(site, bodyField('note', 'field-added', false)),
    },
  ];

  test.each(bodies)('a code’s body follows the Success rules: $name', ({ from, to, change }) => {
    const baseline = aBaseline({
      ...publishedAnswering(orderLocked),
      codes: { [orderLocked]: aCode({ body: from }) },
    });
    const proposed = aProposed({
      ...answering(orderLocked),
      codes: { [orderLocked]: aCode({ body: to }) },
    });

    const changes = codeChangesOf(baseline, proposed);

    expect(changes).toEqual([change]);
  });

  test.each([
    { name: 'added', from: null, to: anOpenObject(), kind: 'body-added' },
    { name: 'removed', from: anOpenObject(), to: null, kind: 'body-removed' },
  ] as const)('a code’s body $name is Breaking', ({ from, to, kind }) => {
    const baseline = aBaseline({
      ...publishedAnswering(orderLocked),
      codes: { [orderLocked]: aCode({ body: from }) },
    });
    const proposed = aProposed({
      ...answering(orderLocked),
      codes: { [orderLocked]: aCode({ body: to }) },
    });

    const changes = codeChangesOf(baseline, proposed);

    expect(changes).toEqual([
      breaking(codeSite(orderLocked, 'public'), { kind, at: ['body'], position: 'success' }),
    ]);
  });

  test.each([
    ['message', { message: 'Frozen' }],
    ['origin', { origin: '@org/definitions@2.0.0#orderLocked' }],
  ] as const)('a Rejection’s %s changed gives no Change, only a changed hash', (_name, fields) => {
    const baseline = aBaseline({
      ...publishedAnswering(orderLocked),
      codes: { [orderLocked]: aCode() },
    });
    const proposed = aProposed({
      ...answering(orderLocked),
      codes: { [orderLocked]: aCode(fields) },
    });

    const report = reportOf(baseline, proposed);

    expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: true });
  });

  test('a code answered for the first time gives no Change at its code, only rejection-added on its Endpoints', () => {
    const baseline = aBaseline({ endpoints: { [identity]: aLive(anEndpoint()) } });
    const proposed = aProposed({ ...answering(orderLocked), codes: { [orderLocked]: aCode() } });

    const changes = reportOf(baseline, proposed).changes;

    expect(changes).toEqual([
      additive(endpointSite('public'), { kind: 'rejection-added', code: orderLocked }),
    ]);
  });

  test('a code no Endpoint answers any more gives no Change at its code', () => {
    const baseline = aBaseline({
      ...publishedAnswering(orderLocked),
      codes: { [orderLocked]: aCode() },
    });
    const proposed = aProposed({ endpoints: { [identity]: anEndpoint() } });

    const changes = reportOf(baseline, proposed).changes;

    expect(changes).toEqual([
      additive(endpointSite('public'), { kind: 'rejection-removed', code: orderLocked }),
    ]);
  });

  test('a removed code not declared again is carried with no Change', () => {
    const baseline = aBaseline({ codes: { [orderLocked]: aCode({ removed: true }) } });
    const proposed = aProposed();

    const report = reportOf(baseline, proposed);

    expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: false });
  });

  test.each([
    { name: 'in the Baseline', before: 'public', after: 'private' },
    { name: 'in the proposed Snapshot', before: 'private', after: 'public' },
  ] as const)(
    'a code’s Change carries the Visibility of an Endpoint that answers it $name',
    ({ before, after }) => {
      const baseline = aBaseline({
        endpoints: {
          [identity]: aLive(anEndpoint({ visibility: before, rejections: [orderLocked] })),
        },
        codes: { [orderLocked]: lockedStatus(409) },
      });
      const proposed = aProposed({
        endpoints: { [identity]: anEndpoint({ visibility: after, rejections: [orderLocked] }) },
        codes: { [orderLocked]: lockedStatus(422) },
      });

      const changes = codeChangesOf(baseline, proposed);

      expect(changes).toEqual([breaking(codeSite(orderLocked, 'public'), statusChanged(409, 422))]);
    },
  );

  test('a code’s Change carries the widest Visibility of the Endpoints that answer it', () => {
    const endpoints = {
      'GET /orders/{}': anEndpoint({ visibility: 'private', rejections: [orderLocked] }),
      'GET /orders/audit': anEndpoint({ visibility: 'internal', rejections: [orderLocked] }),
    };
    const baseline = aBaseline({
      endpoints: Object.fromEntries(Object.entries(endpoints).map(([id, e]) => [id, aLive(e)])),
      codes: { [orderLocked]: lockedStatus(409) },
    });
    const proposed = aProposed({ endpoints, codes: { [orderLocked]: lockedStatus(422) } });

    const changes = codeChangesOf(baseline, proposed);

    expect(changes).toEqual([breaking(codeSite(orderLocked, 'internal'), statusChanged(409, 422))]);
  });

  test('a code no Endpoint answers carries Private', () => {
    const baseline = aBaseline({ codes: { [orderLocked]: lockedStatus(409) } });
    const proposed = aProposed({ codes: { [orderLocked]: lockedStatus(422) } });

    const changes = codeChangesOf(baseline, proposed);

    expect(changes).toEqual([breaking(codeSite(orderLocked, 'private'), statusChanged(409, 422))]);
  });

  test('a Retired Endpoint that still lists a code does not count toward its Visibility: it answers only RETIRED', () => {
    const retired = anEndpoint({ lifecycle: 'retired', rejections: [orderLocked] });
    const baseline = aBaseline({
      endpoints: { [identity]: { ...retired, retiredIn: '3.0.0' } },
      codes: { [orderLocked]: lockedStatus(409) },
    });
    const proposed = aProposed({
      endpoints: { [identity]: retired },
      codes: { [orderLocked]: lockedStatus(422) },
    });

    const changes = codeChangesOf(baseline, proposed);

    expect(changes).toEqual([breaking(codeSite(orderLocked, 'private'), statusChanged(409, 422))]);
  });

  test('an Endpoint retired in this change counts with its Baseline Visibility', () => {
    const deprecated = anEndpoint({ lifecycle: 'deprecated', rejections: [orderLocked] });
    const baseline = aBaseline({
      endpoints: { [identity]: { ...deprecated, lifecycle: 'deprecated' } },
      codes: { [orderLocked]: lockedStatus(409) },
    });
    const proposed = aProposed({
      endpoints: { [identity]: { ...deprecated, lifecycle: 'retired' } },
      codes: { [orderLocked]: lockedStatus(422) },
    });

    const changes = codeChangesOf(baseline, proposed);

    expect(changes).toEqual([breaking(codeSite(orderLocked, 'public'), statusChanged(409, 422))]);
  });

  test('a code that changes status while some Endpoints stop answering it carries the Baseline’s widest Visibility', () => {
    const stays = anEndpoint({ visibility: 'private', rejections: [orderLocked] });
    const stops = anEndpoint({ visibility: 'public', rejections: [orderLocked] });
    const baseline = aBaseline({
      endpoints: { 'GET /orders/{}': aLive(stops), 'GET /orders/audit': aLive(stays) },
      codes: { [orderLocked]: lockedStatus(409) },
    });
    const proposed = aProposed({
      endpoints: { 'GET /orders/{}': { ...stops, rejections: [] }, 'GET /orders/audit': stays },
      codes: { [orderLocked]: lockedStatus(422) },
    });

    const changes = reportOf(baseline, proposed).changes;

    expect(changes).toEqual([
      additive(endpointSite('public'), { kind: 'rejection-removed', code: orderLocked }),
      breaking(codeSite(orderLocked, 'public'), statusChanged(409, 422)),
    ]);
  });

  test('a code that changes status while every Endpoint stops answering it gives no Change at its code', () => {
    const baseline = aBaseline({
      ...publishedAnswering(orderLocked),
      codes: { [orderLocked]: lockedStatus(409) },
    });
    const proposed = aProposed({ endpoints: { [identity]: anEndpoint() } });

    const changes = reportOf(baseline, proposed).changes;

    expect(changes).toEqual([
      additive(endpointSite('public'), { kind: 'rejection-removed', code: orderLocked }),
    ]);
  });
});

describe('compatibilityReportOf, a removed code declared again', () => {
  const removedBody = anOpenObject({ id: required(aString), note: required(aString) });
  const removed = aCode({ removed: true, body: removedBody });

  function declaredAgain(code: CodeSnapshot): readonly Change[] {
    const baseline = aBaseline({ codes: { [orderLocked]: removed } });
    const proposed = aProposed({ ...answering(orderLocked), codes: { [orderLocked]: code } });
    return codeChangesOf(baseline, proposed);
  }

  test('with another status it is Breaking', () => {
    const changes = declaredAgain(aCode({ status: 422, body: removedBody }));

    expect(changes).toEqual([breaking(codeSite(orderLocked, 'public'), statusChanged(409, 422))]);
  });

  test('with a field removed from its body it is Breaking', () => {
    const changes = declaredAgain(aCode({ body: anOpenObject({ id: required(aString) }) }));

    expect(changes).toEqual([
      breaking(codeSite(orderLocked, 'public'), bodyField('note', 'field-removed')),
    ]);
  });

  test('with an optional field added to its body it is Additive', () => {
    const grown = anOpenObject({
      id: required(aString),
      note: required(aString),
      hint: optional(aString),
    });

    const changes = declaredAgain(aCode({ body: grown }));

    expect(changes).toEqual([
      additive(codeSite(orderLocked, 'public'), bodyField('hint', 'field-added')),
    ]);
  });

  test('with the status and body it last had it gives no Change at its code', () => {
    const changes = declaredAgain(aCode({ body: removedBody }));

    expect(changes).toEqual([]);
  });
});

describe('compatibilityReportOf, Standard Rejections', () => {
  const notFound = 'NOT_FOUND';

  test('a Standard Rejection’s status changed by its Definitions Package is Breaking on its code', () => {
    const baseline = aBaseline({
      ...publishedAnswering(notFound),
      codes: { [notFound]: aCode({ origin: 'standard', status: 404 }) },
    });
    const proposed = aProposed({
      ...answering(notFound),
      standardRejections: {
        ...standardRejections,
        notFound: { ...standardRejections.notFound, status: 410 },
      },
      codes: { [notFound]: aCode({ origin: 'standard', status: 410 }) },
    });

    const changes = reportOf(baseline, proposed).changes;

    expect(changes).toEqual([breaking(codeSite(notFound, 'public'), statusChanged(404, 410))]);
  });

  test('a Standard Rejection resolving to another code removes one code and adds another on every Endpoint, both Additive, with no code Change', () => {
    const baseline = aBaseline({
      ...publishedAnswering(notFound),
      codes: { [notFound]: aCode({ origin: 'standard', status: 404 }) },
    });
    const proposed = aProposed({
      ...answering(orderGone),
      standardRejections: {
        ...standardRejections,
        notFound: { ...standardRejections.notFound, code: orderGone },
      },
      codes: { [orderGone]: aCode({ origin: 'standard', status: 404 }) },
    });

    const changes = reportOf(baseline, proposed).changes;

    expect(changes).toEqual([
      additive(endpointSite('public'), { kind: 'rejection-removed', code: notFound }),
      additive(endpointSite('public'), { kind: 'rejection-added', code: orderGone }),
    ]);
  });

  test('cf-loom’s invalid-input body changed is compared as Success on its code', () => {
    const invalidInput = 'INVALID_INPUT';
    const before = anOpenObject({ issues: required(aString), hint: required(aString) });
    const after = anOpenObject({ issues: required(aString) });
    const baseline = aBaseline({
      ...publishedAnswering(invalidInput),
      codes: { [invalidInput]: aCode({ origin: 'standard', status: 400, body: before }) },
    });
    const proposed = aProposed({
      ...answering(invalidInput),
      codes: { [invalidInput]: aCode({ origin: 'standard', status: 400, body: after }) },
    });

    const changes = codeChangesOf(baseline, proposed);

    expect(changes).toEqual([
      breaking(codeSite(invalidInput, 'public'), bodyField('hint', 'field-removed')),
    ]);
  });

  test('a Standard Rejection no Endpoint lists, changed, is Breaking on a Private code and bumps patch', () => {
    const baseline = aBaseline({
      endpoints: { [identity]: aLive(anEndpoint()) },
      codes: { [notFound]: aCode({ origin: 'standard', status: 404 }) },
    });
    const proposed = aProposed({
      endpoints: { [identity]: anEndpoint() },
      codes: { [notFound]: aCode({ origin: 'standard', status: 410 }) },
    });

    const report = reportOf(baseline, proposed);

    expect(report.changes).toEqual([
      breaking(codeSite(notFound, 'private'), statusChanged(404, 410)),
    ]);
    expect(versionBumpOf(report, unmoved)).toBe('patch');
  });

  test('a Standard Rejection resolving to a code a user Rejection once used compares it with what it last had', () => {
    const baseline = aBaseline({
      ...publishedAnswering(notFound),
      codes: {
        [notFound]: aCode({ origin: 'standard', status: 404 }),
        [orderGone]: aCode({ removed: true, status: 409 }),
      },
    });
    const proposed = aProposed({
      ...answering(orderGone),
      standardRejections: {
        ...standardRejections,
        notFound: { ...standardRejections.notFound, code: orderGone },
      },
      codes: { [orderGone]: aCode({ origin: 'standard', status: 404 }) },
    });

    const changes = codeChangesOf(baseline, proposed);

    expect(changes).toEqual([breaking(codeSite(orderGone, 'public'), statusChanged(409, 404))]);
  });
});

describe('compatibilityReportOf, the order of a Service’s Changes', () => {
  test('codes come after Endpoints, Events and Commands, by code in code point order, status before body', () => {
    const wide = anOpenObject({ id: required(aString), note: required(aString) });
    const narrow = anOpenObject({ id: required(aString) });
    const baseline = aBaseline({
      codes: {
        [orderLocked]: aCode({ status: 409, body: wide }),
        [orderGone]: aCode({ status: 410, body: wide }),
      },
    });
    const proposed = aProposed({
      endpoints: { [identity]: anEndpoint() },
      events: { 'OrderPlaced@1': anEvent() },
      commands: { 'ChargeCard@1': aCommand() },
      codes: {
        [orderLocked]: aCode({ status: 422, body: narrow }),
        [orderGone]: aCode({ status: 404, body: narrow }),
      },
    });

    const changes = reportOf(baseline, proposed).changes;

    expect(
      changes.map(({ site, difference }) => [site.kind, placeOf(site), difference.kind]),
    ).toEqual([
      ['endpoint', identity, 'added'],
      ['event', 'OrderPlaced@1', 'added'],
      ['command', 'ChargeCard@1', 'added'],
      ['code', orderGone, 'status-changed'],
      ['code', orderGone, 'schema'],
      ['code', orderLocked, 'status-changed'],
      ['code', orderLocked, 'schema'],
    ]);
  });
});
