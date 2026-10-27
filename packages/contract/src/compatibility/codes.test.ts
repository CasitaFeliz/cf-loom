import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { aRootPackage } from '../../test/root-package.ts';
import { publishedBy } from '../../test/snapshots.ts';
import { defineEndpoint, defineGroup, defineService } from '../index.ts';
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
  type PublishedCode,
  type PublishedEndpoint,
  type PublishedServiceSnapshot,
  type RemovedCode,
  type SchemaNode,
  type ServiceSnapshot,
  snapshotOf,
  validateRoot,
  versionBumpOf,
} from '../internal/index.ts';

type Visibility = EndpointSnapshot['visibility'];

const identity = 'GET /orders/{}';
const orderLocked = 'ORDER_LOCKED';
const orderGone = 'ORDER_GONE';
const standardRejections: ServiceSnapshot['standardRejections'] = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};
const heading = {
  format: 1,
  kind: 'service',
  name: 'orders-service',
  standardRejections,
  groups: {},
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
  return { type: 'object', fields };
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
    input: {
      params: null,
      query: { type: 'object', fields: {} },
      headers: { type: 'object', fields: {} },
      body: null,
    },
    success: { status: 200, headers: { type: 'object', fields: {} }, body: null },
    rejections: [],
    ...fields,
  };
}

function aLive(endpoint: EndpointSnapshot): PublishedEndpoint {
  return { ...endpoint, lifecycle: 'active' };
}

function aCode(fields: Partial<PublishedCode> = {}): PublishedCode {
  return {
    origin: 'local',
    status: 409,
    message: 'The order is locked',
    headers: anOpenObject(),
    body: null,
    ...fields,
  };
}

function aRemovedCode(fields: Partial<RemovedCode> = {}): RemovedCode {
  return { ...aCode(), removedIn: '3.2.0', defs: {}, ...fields };
}

function anEvent(): EventSnapshot {
  return {
    group: 'orders',
    visibility: 'internal',
    lifecycle: 'active',
    description: '',
    body: anOpenObject(),
  };
}

function aCommand(): CommandSnapshot {
  return { group: 'orders', lifecycle: 'active', description: '', body: anOpenObject() };
}

function aBaseline(fields: Partial<PublishedServiceSnapshot> = {}): PublishedServiceSnapshot {
  return {
    ...heading,
    version: '3.4.0',
    generator: publishedBy,
    formerInputs: [],
    endpoints: {},
    ...fields,
  };
}

function aProposed(fields: Partial<ServiceSnapshot> = {}): ServiceSnapshot {
  return { ...heading, endpoints: {}, ...fields };
}

function reportOf(baseline: PublishedServiceSnapshot, proposed: ServiceSnapshot) {
  const report = compatibilityReportOf(baseline, proposed);
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
  return { kind: 'endpoint', identity: at, name: 'getOrder', visibility };
}

function placeOf(site: ChangeSite): string {
  switch (site.kind) {
    case 'code':
      return site.code;
    case 'guard':
    case 'group':
    case 'export':
    case 'subscription':
    case 'dependency':
    case 'standard-rejection':
      return site.name;
    case 'endpoint':
    case 'event':
    case 'command':
      return site.identity;
  }
}

function breaking(site: ChangeSite, difference: Difference): Change {
  return { site, difference, class: 'breaking', verdict: 'approval-needed' };
}

function neutral(site: ChangeSite, difference: Difference): Change {
  return { site, difference, class: 'neutral', verdict: 'allowed' };
}

function additive(site: ChangeSite, difference: Difference): Change {
  return { site, difference, class: 'additive', verdict: 'allowed' };
}

function statusChanged(from: number, to: number): Difference {
  return { kind: 'status-changed', from, to };
}

function bodyField(name: string, shape: 'field-added' | 'field-removed', isRequired = false) {
  const kind = shape === 'field-added' ? { kind: shape, required: isRequired } : { kind: shape };
  return {
    kind: 'schema',
    position: 'success',
    at: [
      { kind: 'part', name: 'body' },
      { kind: 'field', name },
    ],
    shape: kind,
  } as const;
}

function headerField(name: string, shape: Extract<Difference, { kind: 'schema' }>['shape']) {
  return {
    kind: 'schema',
    position: 'success',
    at: [
      { kind: 'part', name: 'headers' },
      { kind: 'field', name },
    ],
    shape,
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

  const realm = required(aString);
  const retryAfter = required({ type: 'number', int: true });
  const headers = [
    {
      name: 'removing a required header is Breaking',
      from: anOpenObject({ 'www-authenticate': realm, 'retry-after': retryAfter }),
      to: anOpenObject({ 'retry-after': retryAfter }),
      change: breaking(site, headerField('www-authenticate', { kind: 'field-removed' })),
    },
    {
      name: 'adding a required header is Additive',
      from: anOpenObject({ 'retry-after': retryAfter }),
      to: anOpenObject({ 'www-authenticate': realm, 'retry-after': retryAfter }),
      change: additive(
        site,
        headerField('www-authenticate', { kind: 'field-added', required: true }),
      ),
    },
    {
      name: 'a header’s description changed is Neutral',
      from: anOpenObject({ 'www-authenticate': realm }),
      to: anOpenObject({
        'www-authenticate': required({ type: 'string', description: 'The scheme' }),
      }),
      change: neutral(
        site,
        headerField('www-authenticate', { kind: 'annotation-changed', annotation: 'description' }),
      ),
    },
  ];

  test.each(headers)('a code’s headers follow the Success rules: $name', ({ from, to, change }) => {
    const baseline = aBaseline({
      ...publishedAnswering(orderLocked),
      codes: { [orderLocked]: aCode({ headers: from }) },
    });
    const proposed = aProposed({
      ...answering(orderLocked),
      codes: { [orderLocked]: aCode({ headers: to }) },
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
      breaking(codeSite(orderLocked, 'public'), {
        kind,
        at: [{ kind: 'part', name: 'body' }],
        position: 'success',
      }),
    ]);
  });

  test.each([
    ['message', { message: 'Frozen' }, { kind: 'message-changed' }],
    [
      'origin',
      { origin: '@org/definitions@2.0.0#orderLocked' },
      { kind: 'origin-changed', from: 'local', to: '@org/definitions@2.0.0#orderLocked' },
    ],
  ] as const)('a Rejection’s %s changed is one Neutral Change', (_name, fields, difference) => {
    const baseline = aBaseline({
      ...publishedAnswering(orderLocked),
      codes: { [orderLocked]: aCode() },
    });
    const proposed = aProposed({
      ...answering(orderLocked),
      codes: { [orderLocked]: aCode(fields) },
    });

    const report = reportOf(baseline, proposed);

    expect(report.changes).toEqual([neutral(codeSite(orderLocked, 'public'), difference)]);
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
    const baseline = aBaseline({ codes: { [orderLocked]: aRemovedCode() } });
    const proposed = aProposed();

    const report = reportOf(baseline, proposed);

    expect(report).toEqual({ changes: [] });
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
  const removed = aRemovedCode({ body: removedBody });

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

describe('compatibilityReportOf, a removed code declared again, whose body reaches a recursive def', () => {
  const ref: SchemaNode = { type: 'ref', name: 'tree' };
  const body = anOpenObject({ tree: required(ref) });
  const treeWith = (...labels: string[]): ObjectNode =>
    anOpenObject({
      children: required({ type: 'array', items: ref }),
      ...Object.fromEntries(labels.map((label) => [label, required(aString)])),
    });
  const orderPaid = 'ORDER_PAID';

  function declaredAgain(held: { removedWith: ObjectNode; since: ObjectNode; now: ObjectNode }) {
    const baseline = aBaseline({
      defs: { tree: held.since },
      codes: {
        [orderLocked]: aRemovedCode({ body, defs: { tree: held.removedWith } }),
        [orderPaid]: aCode({ body }),
      },
    });
    const proposed = aProposed({
      ...answering(orderLocked),
      defs: { tree: held.now },
      codes: { [orderLocked]: aCode({ body }), [orderPaid]: aCode({ body }) },
    });
    return codeChangesOf(baseline, proposed).filter(
      ({ site }) => site.kind === 'code' && site.code === orderLocked,
    );
  }

  const labelRemoved = {
    kind: 'schema',
    position: 'success',
    at: [
      { kind: 'part', name: 'body' },
      { kind: 'field', name: 'tree' },
      { kind: 'field', name: 'label' },
    ],
    shape: { kind: 'field-removed' },
  } as const;

  test('whose def lost a field since it was removed is Breaking, as against the version that removed it', () => {
    const changes = declaredAgain({
      removedWith: treeWith('label'),
      since: treeWith(),
      now: treeWith(),
    });

    expect(changes).toEqual([breaking(codeSite(orderLocked, 'public'), labelRemoved)]);
  });

  test('with the def it was removed with gives no Change, though the Snapshot’s def of that name has since grown a field', () => {
    const changes = declaredAgain({
      removedWith: treeWith('label'),
      since: treeWith('label', 'note'),
      now: treeWith('label'),
    });

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
      codes: { [notFound]: aCode({ origin: 'standard', status: 410 }) },
    });

    const changes = reportOf(baseline, proposed).changes;

    expect(changes).toEqual([breaking(codeSite(notFound, 'public'), statusChanged(404, 410))]);
  });

  test('a Standard Rejection resolving to another code removes one code and adds another on every Endpoint, both Additive, beside one Neutral code-changed', () => {
    const baseline = aBaseline({
      ...publishedAnswering(notFound),
      codes: { [notFound]: aCode({ origin: 'standard', status: 404 }) },
    });
    const proposed = aProposed({
      ...answering(orderGone),
      standardRejections: { ...standardRejections, notFound: orderGone },
      codes: { [orderGone]: aCode({ origin: 'standard', status: 404 }) },
    });

    const changes = reportOf(baseline, proposed).changes;

    expect(changes).toEqual([
      additive(endpointSite('public'), { kind: 'rejection-removed', code: notFound }),
      additive(endpointSite('public'), { kind: 'rejection-added', code: orderGone }),
      neutral(
        { kind: 'standard-rejection', name: 'notFound', visibility: 'public' },
        { kind: 'code-changed', from: notFound, to: orderGone },
      ),
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
        [orderGone]: aRemovedCode({ status: 409 }),
      },
    });
    const proposed = aProposed({
      ...answering(orderGone),
      standardRejections: { ...standardRejections, notFound: orderGone },
      codes: { [orderGone]: aCode({ origin: 'standard', status: 404 }) },
    });

    const changes = codeChangesOf(baseline, proposed);

    expect(changes).toEqual([
      breaking(codeSite(orderGone, 'public'), statusChanged(409, 404)),
      neutral(codeSite(orderGone, 'public'), {
        kind: 'origin-changed',
        from: 'local',
        to: 'standard',
      }),
    ]);
  });
});

describe('compatibilityReportOf, the invalid-input body a Service generates', () => {
  test('a later cf-loom adding an issue code to it is Additive: Callers read the code as an Open Enum', () => {
    const invalidInput = 'INVALID_INPUT';
    const generated = generatedCodeOf(invalidInput);
    const baseline = aBaseline({
      ...publishedAnswering(invalidInput),
      codes: { [invalidInput]: generated },
    });
    const proposed = aProposed({
      ...answering(invalidInput),
      codes: { [invalidInput]: withIssueCode(generated, 'too_deep') },
    });

    const changes = reportOf(baseline, proposed).changes;

    expect(changes).toEqual([
      expect.objectContaining({
        site: codeSite(invalidInput, 'public'),
        difference: expect.objectContaining({
          shape: { kind: 'value-added', value: 'too_deep', enum: 'open' },
        }),
        class: 'additive',
        verdict: 'allowed',
      }),
    ]);
  });
});

function generatedCodeOf(code: string): CodeSnapshot {
  const ping = defineEndpoint({
    name: 'ping',
    method: 'GET',
    path: '/ping',
    visibility: 'public',
    description: 'Ping',
    success: { status: 200, body: z.object({ ok: z.boolean() }) },
  });
  const group = defineGroup({ name: 'ping', description: 'Ping', endpoints: [ping] });
  const root = defineService({ name: 'ping-service', groups: [group] });
  const validated = validateRoot(root, aRootPackage(root, { packageName: 'ping-service' }));
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  const generated = snapshot.kind === 'service' ? snapshot.codes[code] : undefined;
  if (generated === undefined) {
    throw new Error(`The fixture holds no ${code}`);
  }
  return generated;
}

function withIssueCode(code: CodeSnapshot, added: string): CodeSnapshot {
  const holdsIssueCodes = (value: unknown) =>
    Array.isArray(value) && value.includes('unrecognized_key');
  return JSON.parse(JSON.stringify(code), (key, value) =>
    key === 'values' && holdsIssueCodes(value) ? [...value, added].sort() : value,
  );
}

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
