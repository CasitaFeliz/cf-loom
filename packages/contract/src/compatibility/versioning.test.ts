import { describe, expect, expectTypeOf, test } from 'vitest';
import {
  type ApplicationSnapshot,
  type Change,
  type ChangeSite,
  type CodeSnapshot,
  type CommandSnapshot,
  type ComparedReport,
  compatibilityReportOf,
  type DefinitionsSnapshot,
  type EndpointSnapshot,
  type EventSnapshot,
  type GuardSnapshot,
  type PeerMove,
  type PublishedApplicationSnapshot,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type ServiceSnapshot,
  type Verdict,
  versionBumpOf,
} from '../internal/index.ts';

const publicEndpoint: ChangeSite = {
  kind: 'endpoint',
  identity: 'GET /orders/{}',
  name: 'getOrder',
  visibility: 'public',
};
const internalEvent: ChangeSite = {
  kind: 'event',
  identity: 'OrderPlaced@1',
  visibility: 'internal',
};
const privateEndpoint: ChangeSite = {
  kind: 'endpoint',
  identity: 'POST /orders/purge',
  name: 'purgeOrders',
  visibility: 'private',
};
const privateEvent: ChangeSite = {
  kind: 'event',
  identity: 'OrderAudited@1',
  visibility: 'private',
};
const command: ChangeSite = { kind: 'command', identity: 'ChargeCard@1', visibility: 'private' };
const subscription: ChangeSite = {
  kind: 'subscription',
  name: 'notifyOnPlaced',
  visibility: 'private',
};
const sharedSchema: ChangeSite = { kind: 'shared-schema', name: 'money', visibility: 'public' };

function aBreakingChange(site: ChangeSite, verdict: Verdict = 'approval-needed'): Change {
  return { site, difference: { kind: 'retired' }, class: 'breaking', verdict };
}

function anAdditiveChange(site: ChangeSite): Change {
  return { site, difference: { kind: 'added' }, class: 'additive', verdict: 'allowed' };
}

function aNeutralChange(site: ChangeSite): Change {
  return { site, difference: { kind: 'tombstoned' }, class: 'neutral', verdict: 'allowed' };
}

function aRefusedChange(site: ChangeSite): Change {
  return { site, difference: { kind: 'deleted' }, class: 'breaking', verdict: 'refused' };
}

function aReport(changes: readonly Change[], hashChanged = true): ComparedReport {
  return { kind: 'compared', changes, hashChanged };
}

function peersMoving(baseline: string, proposed: string): PeerMove {
  return { baseline: { zod: baseline }, proposed: { zod: proposed } };
}

function anApplication(): ApplicationSnapshot {
  return {
    format: 1,
    kind: 'application',
    name: 'web-app',
    generator: '@cf-loom/cli@2.1.0',
    dependencies: {},
  };
}

function ordersDependency(against: string): ApplicationSnapshot['dependencies'][string] {
  return {
    against,
    endpoints: [{ id: 'GET /orders/{}', name: 'getOrder' }],
    events: [],
  };
}

const unmoved: PeerMove = peersMoving('^4.1.0', '^4.1.0');

const orderById = 'GET /orders/{}';
const latestOrder = 'GET /orders/latest';
const serviceHeading = {
  format: 1,
  kind: 'service',
  name: 'orders-service',
  generator: '@cf-loom/cli@2.1.0',
  definitions: {},
  standardRejections: {
    invalidInput: { origin: 'standard', code: 'INVALID_INPUT', status: 400, message: 'Invalid' },
    notFound: { origin: 'standard', code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { origin: 'standard', code: 'NOT_IMPLEMENTED', status: 501, message: 'No' },
  },
  defs: {},
  guards: {},
  codes: {},
  events: {},
  commands: {},
  subscriptions: {},
  dependencies: {},
} as const;

const idParams: EndpointSnapshot['input']['params'] = {
  type: 'object',
  mode: 'strict',
  fields: { id: { required: true, schema: { type: 'string' } } },
};

function anEndpointOf(
  visibility: EndpointSnapshot['visibility'],
  fields: Partial<EndpointSnapshot> = {},
): EndpointSnapshot {
  return {
    name: 'latestOrder',
    group: 'orders',
    visibility,
    lifecycle: 'active',
    description: 'An Endpoint',
    params: [],
    guards: [],
    input: { params: null, query: null, headers: null, body: null },
    success: { status: 200, headers: null, body: null },
    rejections: [],
    ...fields,
  };
}

function reportOfShadowing(visibility: EndpointSnapshot['visibility']): ComparedReport {
  const getOrder = anEndpointOf(visibility, {
    name: 'getOrder',
    params: ['id'],
    input: { params: idParams, query: null, headers: null, body: null },
  });
  const baseline: PublishedServiceSnapshot = {
    ...serviceHeading,
    version: '3.4.0',
    endpoints: { [orderById]: { ...getOrder, lifecycle: 'active' } },
  };
  const proposed: ServiceSnapshot = {
    ...serviceHeading,
    endpoints: { [orderById]: getOrder, [latestOrder]: anEndpointOf(visibility) },
  };
  const report = compatibilityReportOf(baseline, proposed);
  if (report.kind !== 'compared') {
    throw new Error('the Baseline was given, so the report must have compared');
  }
  return report;
}

const orderLocked = 'ORDER_LOCKED';

function aCode(status: number): CodeSnapshot {
  return { origin: 'local', status, message: 'The order is locked', body: null, removed: false };
}

function aGuard(): GuardSnapshot {
  return {
    origin: 'local',
    description: 'Authenticates the Caller',
    guards: [],
    qualifier: null,
    demands: { headers: null, query: null },
    context: null,
    rejections: [],
  };
}

function reportOfCodeStatusChange(visibility: EndpointSnapshot['visibility']): ComparedReport {
  const endpoint = anEndpointOf(visibility, { rejections: [orderLocked] });
  const baseline: PublishedServiceSnapshot = {
    ...serviceHeading,
    version: '3.4.0',
    endpoints: { [latestOrder]: { ...endpoint, lifecycle: 'active' } },
    codes: { [orderLocked]: aCode(409) },
  };
  const proposed: ServiceSnapshot = {
    ...serviceHeading,
    endpoints: { [latestOrder]: endpoint },
    codes: { [orderLocked]: aCode(422) },
  };
  return comparedReportOf(baseline, proposed);
}

function aDefinitions(fields: Partial<DefinitionsSnapshot> = {}): DefinitionsSnapshot {
  return {
    format: 1,
    kind: 'definitions',
    name: '@org/definitions',
    generator: '@cf-loom/cli@2.1.0',
    standardRejections: serviceHeading.standardRejections,
    defs: {},
    schemas: {},
    guards: {},
    codes: {},
    ...fields,
  };
}

function aBaselineDefinitions(
  fields: Partial<PublishedDefinitionsSnapshot> = {},
): PublishedDefinitionsSnapshot {
  return { ...aDefinitions(), version: '4.2.0', ...fields };
}

function comparedReportOf(
  baseline: PublishedServiceSnapshot | PublishedDefinitionsSnapshot,
  proposed: ServiceSnapshot | DefinitionsSnapshot,
): ComparedReport {
  const report = compatibilityReportOf(baseline, proposed);
  if (report.kind !== 'compared') {
    throw new Error('the Baseline was given, so the report must have compared');
  }
  return report;
}

describe('versionBumpOf', () => {
  test('a Breaking Change on a Public or Internal Element bumps major', () => {
    const publicBreaking = aReport([aBreakingChange(publicEndpoint)]);
    const internalBreaking = aReport([aBreakingChange(internalEvent)]);

    const bumps = [publicBreaking, internalBreaking].map((report) =>
      versionBumpOf(report, unmoved),
    );

    expect(bumps).toEqual(['major', 'major']);
  });

  test('an Additive Change on a Public or Internal Element bumps minor', () => {
    const publicAdditive = aReport([anAdditiveChange(publicEndpoint)]);
    const internalAdditive = aReport([anAdditiveChange(internalEvent)]);

    const bumps = [publicAdditive, internalAdditive].map((report) =>
      versionBumpOf(report, unmoved),
    );

    expect(bumps).toEqual(['minor', 'minor']);
  });

  test('a changed hash with Neutral Changes only, or none classified, bumps patch', () => {
    const neutral = aReport([aNeutralChange(publicEndpoint)]);
    const unclassified = aReport([]);

    const bumps = [neutral, unclassified].map((report) => versionBumpOf(report, unmoved));

    expect(bumps).toEqual(['patch', 'patch']);
  });

  test('Changes on Private Elements only bump patch, however Breaking', () => {
    const report = aReport([
      aBreakingChange(privateEndpoint),
      anAdditiveChange(privateEvent),
      aBreakingChange(privateEvent),
    ]);

    const bump = versionBumpOf(report, unmoved);

    expect(bump).toBe('patch');
  });

  test('a Command’s Breaking Change bumps patch: a Command is always Private', () => {
    const report = aReport([aBreakingChange(command, 'allowed'), anAdditiveChange(command)]);

    const bump = versionBumpOf(report, unmoved);

    expect(bump).toBe('patch');
  });

  test('adding a Command bumps patch: no Consumer reads a Command', () => {
    const added: CommandSnapshot = {
      lifecycle: 'active',
      description: 'Charge a card',
      body: { type: 'object', mode: 'strict', fields: {} },
    };
    const baseline: PublishedServiceSnapshot = {
      ...serviceHeading,
      version: '3.4.0',
      endpoints: {},
    };
    const proposed: ServiceSnapshot = {
      ...serviceHeading,
      endpoints: {},
      commands: { 'ChargeCard@1': added },
    };

    const report = comparedReportOf(baseline, proposed);

    expect(versionBumpOf(report, unmoved)).toBe('patch');
  });

  test('a Breaking change to a Public Event’s body is refused, so it bumps patch', () => {
    const event = (fields: Record<string, { required: boolean; schema: { type: 'string' } }>) =>
      ({
        visibility: 'public',
        lifecycle: 'active',
        description: 'An order was placed',
        body: { type: 'object', mode: 'strict', fields },
      }) as const;
    const baseline: PublishedServiceSnapshot = {
      ...serviceHeading,
      version: '3.4.0',
      endpoints: {},
      events: { 'OrderPlaced@1': event({}) },
    };
    const proposed: ServiceSnapshot = {
      ...serviceHeading,
      endpoints: {},
      events: { 'OrderPlaced@1': event({ note: { required: true, schema: { type: 'string' } } }) },
    };

    const report = comparedReportOf(baseline, proposed);

    expect(report.changes.map(({ class: changeClass, verdict }) => [changeClass, verdict])).toEqual(
      [['breaking', 'refused']],
    );
    expect(versionBumpOf(report, unmoved)).toBe('patch');
  });

  test('a Change on a Subscription never bumps past patch: a Subscription is the Service’s own', () => {
    const report = aReport([aBreakingChange(subscription), anAdditiveChange(subscription)]);

    const bump = versionBumpOf(report, unmoved);

    expect(bump).toBe('patch');
  });

  test('a change only to a Public Endpoint Retired on both sides bumps patch', () => {
    const retired = anEndpointOf('public', { lifecycle: 'retired' });
    const baseline: PublishedServiceSnapshot = {
      ...serviceHeading,
      version: '3.4.0',
      endpoints: { [orderById]: { ...retired, lifecycle: 'retired', retiredIn: '3.0.0' } },
    };
    const proposed: ServiceSnapshot = {
      ...serviceHeading,
      endpoints: { [orderById]: { ...retired, success: { ...retired.success, status: 201 } } },
    };

    const report = comparedReportOf(baseline, proposed);

    expect(versionBumpOf(report, unmoved)).toBe('patch');
  });

  test('a Breaking Change to a shared schema bumps a Definitions Package’s major', () => {
    const removed: Change = {
      site: sharedSchema,
      difference: { kind: 'removed' },
      class: 'breaking',
      verdict: 'approval-needed',
    };

    const bump = versionBumpOf(aReport([removed]), unmoved);

    expect(bump).toBe('major');
  });

  test('an Additive Change to a shared schema bumps its minor', () => {
    const bump = versionBumpOf(aReport([anAdditiveChange(sharedSchema)]), unmoved);

    expect(bump).toBe('minor');
  });

  test('a Breaking Change on a code only Private Endpoints answer bumps patch', () => {
    const report = reportOfCodeStatusChange('private');

    const bump = versionBumpOf(report, unmoved);

    expect(bump).toBe('patch');
  });

  test('a Breaking Change on a code a Public or Internal Endpoint answers bumps major', () => {
    const publicReport = reportOfCodeStatusChange('public');
    const internalReport = reportOfCodeStatusChange('internal');

    const bumps = [publicReport, internalReport].map((report) => versionBumpOf(report, unmoved));

    expect(bumps).toEqual(['major', 'major']);
  });

  test('a Breaking Change on a Definitions Package’s Guard bumps major', () => {
    const baseline = aBaselineDefinitions({ guards: { authenticated: aGuard() } });

    const report = comparedReportOf(baseline, aDefinitions());

    expect(versionBumpOf(report, unmoved)).toBe('major');
  });

  test('an Additive Change on a Definitions Package’s code bumps minor', () => {
    const proposed = aDefinitions({ codes: { [orderLocked]: aCode(409) } });

    const report = comparedReportOf(aBaselineDefinitions(), proposed);

    expect(versionBumpOf(report, unmoved)).toBe('minor');
  });

  test('a Breaking body Change on a Private Endpoint bumps patch', () => {
    const bodyChange: Change = {
      site: privateEndpoint,
      difference: {
        kind: 'schema',
        position: 'input',
        at: [
          { kind: 'part', name: 'input' },
          { kind: 'part', name: 'body' },
          { kind: 'field', name: 'amount' },
        ],
        shape: { kind: 'field-added', required: true },
      },
      class: 'breaking',
      verdict: 'approval-needed',
    };

    const bump = versionBumpOf(aReport([bodyChange]), unmoved);

    expect(bump).toBe('patch');
  });

  test('shadowing between Private Endpoints bumps patch', () => {
    const report = reportOfShadowing('private');

    const bump = versionBumpOf(report, unmoved);

    expect(bump).toBe('patch');
  });

  test('narrowing an Internal Event bumps major', () => {
    const event: EventSnapshot = {
      visibility: 'internal',
      lifecycle: 'active',
      description: 'An order was placed',
      body: { type: 'object', mode: 'strict', fields: {} },
    };
    const baseline: PublishedServiceSnapshot = {
      ...serviceHeading,
      version: '3.4.0',
      endpoints: {},
      events: { 'OrderPlaced@1': { ...event, lifecycle: 'active' } },
    };
    const proposed: ServiceSnapshot = {
      ...serviceHeading,
      endpoints: {},
      events: { 'OrderPlaced@1': { ...event, visibility: 'private' } },
    };

    const report = comparedReportOf(baseline, proposed);

    expect(versionBumpOf(report, unmoved)).toBe('major');
  });

  test('a shadowed Public Endpoint bumps major', () => {
    const report = reportOfShadowing('public');

    const bump = versionBumpOf(report, unmoved);

    expect(bump).toBe('major');
  });

  test('narrowing Public to Private bumps major: the wider Visibility decides', () => {
    const narrowed: Change = {
      site: publicEndpoint,
      difference: { kind: 'visibility-narrowed', from: 'public', to: 'private' },
      class: 'breaking',
      verdict: 'approval-needed',
    };

    const bump = versionBumpOf(aReport([narrowed]), unmoved);

    expect(bump).toBe('major');
  });

  test('the highest Change decides among many', () => {
    const report = aReport([
      aNeutralChange(publicEndpoint),
      anAdditiveChange(internalEvent),
      aBreakingChange(privateEndpoint),
    ]);

    const bump = versionBumpOf(report, unmoved);

    expect(bump).toBe('minor');
  });

  test('an Application’s changed Dependencies bump patch', () => {
    const baseline: PublishedApplicationSnapshot = {
      ...anApplication(),
      version: '1.0.0',
      dependencies: { 'orders-service': ordersDependency('3.4.0') },
    };
    const proposed: ApplicationSnapshot = {
      ...anApplication(),
      dependencies: { 'orders-service': ordersDependency('4.0.0') },
    };
    const report = compatibilityReportOf(baseline, proposed);

    const bump = report.kind === 'compared' ? versionBumpOf(report, unmoved) : 'no-baseline';

    expect(bump).toBe('patch');
  });

  test('an unchanged hash with unchanged peers is unchanged, so publish does nothing', () => {
    const report = aReport([], false);

    const bump = versionBumpOf(report, unmoved);

    expect(bump).toBe('unchanged');
  });

  test('a refused Additive Change on a Public Endpoint bumps patch, not minor', () => {
    const broughtBack: Change = {
      site: publicEndpoint,
      difference: { kind: 'retired-brought-back', lifecycle: 'active' },
      class: 'additive',
      verdict: 'refused',
    };

    const bump = versionBumpOf(aReport([broughtBack]), unmoved);

    expect(bump).toBe('patch');
  });

  test('a refused Change on a Public Endpoint does not bump past patch', () => {
    const report = aReport([aRefusedChange(publicEndpoint)]);

    const bump = versionBumpOf(report, unmoved);

    expect(bump).toBe('patch');
  });

  test('a changed peer range bumps even when the hash is unchanged', () => {
    const report = aReport([], false);

    const bump = versionBumpOf(report, peersMoving('^4.1.0', '^4.6.7'));

    expect(bump).toBe('minor');
  });
});

describe('versionBumpOf, the peer rule', () => {
  test('a peer moving to a new major bumps major with an unchanged Snapshot', () => {
    const bump = versionBumpOf(aReport([], false), peersMoving('^4.1.0', '^5.0.0'));

    expect(bump).toBe('major');
  });

  test('any other change to a peer range bumps minor', () => {
    const bump = versionBumpOf(aReport([], false), peersMoving('^4.1.0', '^4.6.7'));

    expect(bump).toBe('minor');
  });

  test('^0.1.0 to ^0.2.0 is a new major, as a caret reads it', () => {
    const bump = versionBumpOf(aReport([], false), peersMoving('^0.1.0', '^0.2.0'));

    expect(bump).toBe('major');
  });

  test('^0.1.0 to ^0.1.5 is not a new major', () => {
    const bump = versionBumpOf(aReport([], false), peersMoving('^0.1.0', '^0.1.5'));

    expect(bump).toBe('minor');
  });

  test('^0.0.3 to ^0.0.4 is a new major', () => {
    const bump = versionBumpOf(aReport([], false), peersMoving('^0.0.3', '^0.0.4'));

    expect(bump).toBe('major');
  });

  test('a prerelease range keeps its line: ^1.0.0-rc.1 to ^1.2.0 bumps minor', () => {
    const bump = versionBumpOf(aReport([], false), peersMoving('^1.0.0-rc.1', '^1.2.0'));

    expect(bump).toBe('minor');
  });

  test.each([
    ['a range that is not a caret', '^4.1.0', '~4.1.0'],
    ['a caret on a partial version', '^4.1', '^4.2.0'],
    ['a comparator range', '>=4.1.0', '>=4.2.0'],
  ])('%s counts as a new major, since no overlap can be proven', (_name, baseline, proposed) => {
    const bump = versionBumpOf(aReport([], false), peersMoving(baseline, proposed));

    expect(bump).toBe('major');
  });

  test('a peer added or dropped is a minor bump', () => {
    const added: PeerMove = { baseline: {}, proposed: { zod: '^4.1.0' } };
    const dropped: PeerMove = { baseline: { zod: '^4.1.0' }, proposed: {} };

    const bumps = [added, dropped].map((peers) => versionBumpOf(aReport([], false), peers));

    expect(bumps).toEqual(['minor', 'minor']);
  });

  test('a range that is not a caret and stays the same is no change', () => {
    const bump = versionBumpOf(aReport([], false), peersMoving('>=4.1.0', '>=4.1.0'));

    expect(bump).toBe('unchanged');
  });

  test('the highest peer decides when several move', () => {
    const peers: PeerMove = {
      baseline: { zod: '^4.1.0', '@cf-loom/contract': '^1.2.0' },
      proposed: { zod: '^4.6.7', '@cf-loom/contract': '^2.0.0' },
    };

    const bump = versionBumpOf(aReport([], false), peers);

    expect(bump).toBe('major');
  });

  test.each([
    ['Breaking', aBreakingChange(publicEndpoint), 'major'],
    ['Additive', anAdditiveChange(publicEndpoint), 'minor'],
  ] as const)('the bump is the highest of a %s Change and a peer minor', (_class, change, bump) => {
    const report = aReport([change]);

    const bumped = versionBumpOf(report, peersMoving('^4.1.0', '^4.6.7'));

    expect(bumped).toBe(bump);
  });

  test('a peer major outranks an Additive Change', () => {
    const report = aReport([anAdditiveChange(publicEndpoint)]);

    const bump = versionBumpOf(report, peersMoving('^4.1.0', '^5.0.0'));

    expect(bump).toBe('major');
  });
});

describe('versionBumpOf, its types', () => {
  test('it takes no report without a Baseline', () => {
    expectTypeOf(versionBumpOf).parameter(0).toEqualTypeOf<ComparedReport>();
    expect(typeof versionBumpOf).toBe('function');
  });
});
