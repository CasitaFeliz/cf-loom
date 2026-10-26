import { describe, expect, test } from 'vitest';
import {
  type ApplicationSnapshot,
  type Change,
  type ChangeSite,
  compatibilityReportOf,
  type DependencySnapshot,
  type Difference,
  type PublishedApplicationSnapshot,
  type PublishedServiceSnapshot,
  type ServiceSnapshot,
  versionBumpOf,
} from '../internal/index.ts';

const standardRejections: ServiceSnapshot['standardRejections'] = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};
const heading = {
  format: 1,
  kind: 'service',
  name: 'orders-service',
  generator: '@cf-loom/cli@2.1.0',
  standardRejections,
  defs: {},
  guards: {},
  codes: {},
  endpoints: {},
  events: {},
  commands: {},
  subscriptions: {},
} as const;
const getPayment = { id: 'GET /payments/{}', name: 'getPayment' };
const listPayments = { id: 'GET /payments', name: 'listPayments' };
const equalPeers = { baseline: { zod: '^4.1.0' }, proposed: { zod: '^4.1.0' } };

function aDependency(fields: Partial<DependencySnapshot> = {}): DependencySnapshot {
  return { against: '5.1.0', endpoints: [getPayment], ...fields };
}

function aBaseline(
  dependencies: Readonly<Record<string, DependencySnapshot>> = {},
): PublishedServiceSnapshot {
  return { ...heading, version: '3.4.0', dependencies };
}

function aProposed(
  dependencies: Readonly<Record<string, DependencySnapshot>> = {},
): ServiceSnapshot {
  return { ...heading, dependencies };
}

const paymentsSite: ChangeSite = {
  kind: 'dependency',
  name: 'payments-service',
  visibility: 'private',
};

function neutral(difference: Difference, site: ChangeSite = paymentsSite): Change {
  return { site, difference, class: 'neutral', verdict: 'allowed' };
}

function changesOf(
  from: Readonly<Record<string, DependencySnapshot>>,
  to: Readonly<Record<string, DependencySnapshot>>,
): readonly Change[] {
  return compatibilityReportOf(aBaseline(from), aProposed(to)).changes;
}

describe('compatibilityReportOf, Dependencies', () => {
  test('adding a Dependency is one Neutral added at its Private site', () => {
    const changes = changesOf({}, { 'payments-service': aDependency() });

    expect(changes).toEqual([neutral({ kind: 'added' })]);
  });

  test('removing a Dependency is one Neutral removed at its Private site', () => {
    const changes = changesOf({ 'payments-service': aDependency() }, {});

    expect(changes).toEqual([neutral({ kind: 'removed' })]);
  });

  test('a Dependency declared against a newer version gives against-changed with both', () => {
    const from = { 'payments-service': aDependency({ against: '5.1.0' }) };
    const to = { 'payments-service': aDependency({ against: '5.2.0' }) };

    const changes = changesOf(from, to);

    expect(changes).toEqual([neutral({ kind: 'against-changed', from: '5.1.0', to: '5.2.0' })]);
  });

  test('selecting another Endpoint of a Dependency gives endpoint-added', () => {
    const from = { 'payments-service': aDependency({ endpoints: [getPayment] }) };
    const to = { 'payments-service': aDependency({ endpoints: [listPayments, getPayment] }) };

    const changes = changesOf(from, to);

    expect(changes).toEqual([neutral({ kind: 'endpoint-added', ...listPayments })]);
  });

  test('dropping an Endpoint of a Dependency gives endpoint-removed', () => {
    const from = { 'payments-service': aDependency({ endpoints: [listPayments, getPayment] }) };
    const to = { 'payments-service': aDependency({ endpoints: [getPayment] }) };

    const changes = changesOf(from, to);

    expect(changes).toEqual([neutral({ kind: 'endpoint-removed', ...listPayments })]);
  });

  test('adopting a Provider version that renamed an Endpoint gives endpoint-renamed', () => {
    const from = { 'payments-service': aDependency({ against: '5.1.0' }) };
    const renamed = { id: getPayment.id, name: 'fetchPayment' };
    const to = { 'payments-service': aDependency({ against: '6.0.0', endpoints: [renamed] }) };

    const changes = changesOf(from, to);

    expect(changes).toEqual([
      neutral({ kind: 'against-changed', from: '5.1.0', to: '6.0.0' }),
      neutral({
        kind: 'endpoint-renamed',
        id: getPayment.id,
        from: 'getPayment',
        to: 'fetchPayment',
      }),
    ]);
  });

  test('a Dependency left as it is gives no Change', () => {
    const dependencies = { 'payments-service': aDependency() };

    const changes = changesOf(dependencies, dependencies);

    expect(changes).toEqual([]);
  });

  test('Dependency Changes come by Provider in code point order, after a Service’s other Changes', () => {
    const from = { 'b-service': aDependency(), 'a-service': aDependency() };
    const to = {
      'b-service': aDependency({ against: '5.2.0' }),
      'a-service': aDependency({ against: '5.2.0' }),
    };

    const changes = changesOf(from, to);

    expect(changes.map(({ site }) => site)).toEqual([
      { kind: 'dependency', name: 'a-service', visibility: 'private' },
      { kind: 'dependency', name: 'b-service', visibility: 'private' },
    ]);
  });
});

describe('compatibilityReportOf, every Dependency Change', () => {
  test('is Neutral and allowed, and bumps patch', () => {
    const from = {
      'a-service': aDependency(),
      'b-service': aDependency({ endpoints: [getPayment, listPayments] }),
      'c-service': aDependency(),
    };
    const renamed = { id: getPayment.id, name: 'fetchPayment' };
    const to = {
      'b-service': aDependency({ against: '6.0.0', endpoints: [renamed] }),
      'c-service': aDependency({ endpoints: [getPayment, listPayments] }),
      'd-service': aDependency(),
    };

    const report = compatibilityReportOf(aBaseline(from), aProposed(to));

    expect(new Set(report.changes.map(({ class: c, verdict }) => `${c} ${verdict}`))).toEqual(
      new Set(['neutral allowed']),
    );
    expect(report.changes.map(({ difference }) => difference.kind)).toEqual([
      'removed',
      'against-changed',
      'endpoint-removed',
      'endpoint-renamed',
      'endpoint-added',
      'added',
    ]);
    expect(versionBumpOf(report, equalPeers)).toBe('patch');
  });
});

describe('compatibilityReportOf, an Application’s Dependencies', () => {
  const application: ApplicationSnapshot = {
    format: 1,
    kind: 'application',
    name: 'web-app',
    generator: '@cf-loom/cli@2.1.0',
    dependencies: {},
  };
  const baseline: PublishedApplicationSnapshot = { ...application, version: '1.0.0' };

  test('a new Dependency is a Neutral Change, and the bump is patch', () => {
    const proposed = { ...application, dependencies: { 'payments-service': aDependency() } };

    const report = compatibilityReportOf(baseline, proposed);

    expect(report.changes).toEqual([neutral({ kind: 'added' })]);
    expect(versionBumpOf(report, equalPeers)).toBe('patch');
  });

  test('every change to its Dependencies stays Neutral and never bumps past patch', () => {
    const before = { ...baseline, dependencies: { 'payments-service': aDependency() } };
    const after = {
      ...application,
      dependencies: {
        'payments-service': aDependency({ against: '6.0.0', endpoints: [listPayments] }),
      },
    };

    const report = compatibilityReportOf(before, after);

    expect(new Set(report.changes.map(({ class: changeClass }) => changeClass))).toEqual(
      new Set(['neutral']),
    );
    expect(versionBumpOf(report, equalPeers)).toBe('patch');
  });
});
