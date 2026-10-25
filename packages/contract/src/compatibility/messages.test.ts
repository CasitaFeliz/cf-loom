import { describe, expect, test } from 'vitest';
import {
  type Change,
  type ChangeSite,
  compatibilityReportOf,
  type EventSnapshot,
  type Field,
  firstPublishChangesOf,
  type ObjectNode,
  type PublishedServiceSnapshot,
  type SchemaNode,
  type ServiceSnapshot,
  type Step,
  type Verdict,
} from '../internal/index.ts';

type Lifecycle = EventSnapshot['lifecycle'];
type Visibility = EventSnapshot['visibility'];

/** What the Baseline holds of a Message Version: it declared, or only its tombstone. */
type Held = Lifecycle | 'tombstone';

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
  dependencies: {},
} as const;

function required(schema: SchemaNode): Field {
  return { required: true, schema };
}

function optional(schema: SchemaNode): Field {
  return { required: false, schema };
}

function anObject(fields: Readonly<Record<string, Field>>): ObjectNode {
  return { type: 'object', fields };
}

const plain = anObject({ id: required({ type: 'string' }) });
const withRequiredNote = anObject({
  id: required({ type: 'string' }),
  note: required({ type: 'string' }),
});
const withOptionalNote = anObject({
  id: required({ type: 'string' }),
  note: optional({ type: 'string' }),
});

function anEvent(lifecycle: Lifecycle, body: ObjectNode, visibility: Visibility = 'internal') {
  return { group: 'orders', visibility, lifecycle, description: 'An order was placed', body };
}

function aCommand(lifecycle: Lifecycle, body: ObjectNode) {
  return { group: 'orders', lifecycle, description: 'Charge a card', body };
}

function publishedEvent(held: Held, body: ObjectNode, visibility: Visibility = 'internal') {
  if (held === 'tombstone') {
    return { lifecycle: 'retired', retiredIn: '3.0.0' } as const;
  }
  return held === 'retired'
    ? ({ ...anEvent(held, body, visibility), lifecycle: 'retired', retiredIn: '3.0.0' } as const)
    : ({ ...anEvent(held, body, visibility), lifecycle: held } as const);
}

function publishedCommand(held: Held, body: ObjectNode) {
  if (held === 'tombstone') {
    return { lifecycle: 'retired', retiredIn: '3.0.0' } as const;
  }
  return held === 'retired'
    ? ({ ...aCommand(held, body), lifecycle: 'retired', retiredIn: '3.0.0' } as const)
    : ({ ...aCommand(held, body), lifecycle: held } as const);
}

function aBaseline(fields: Partial<PublishedServiceSnapshot> = {}): PublishedServiceSnapshot {
  return {
    ...heading,
    version: '3.4.0',
    endpoints: {},
    events: {},
    commands: {},
    subscriptions: {},
    ...fields,
  };
}

function aProposed(fields: Partial<ServiceSnapshot> = {}): ServiceSnapshot {
  return { ...heading, endpoints: {}, events: {}, commands: {}, subscriptions: {}, ...fields };
}

function byIdentity<Entry, Value>(
  entries: Readonly<Record<string, Entry>>,
  make: (entry: Entry) => Value,
): Readonly<Record<string, Value>> {
  const made = Object.entries(entries).map(([identity, entry]) => [identity, make(entry)]);
  return Object.fromEntries(made);
}

type Entries<Entry> = Readonly<Record<string, Entry>>;

/** One kind of Message, and the parts of a Snapshot that hold its Message Versions. */
type Kind = {
  readonly name: string;
  readonly site: (identity: string) => ChangeSite;
  readonly held: (entries: Entries<Held>, body?: ObjectNode) => Partial<PublishedServiceSnapshot>;
  readonly declared: (entries: Entries<Lifecycle>, body?: ObjectNode) => Partial<ServiceSnapshot>;
  readonly named: 'event' | 'command';
  readonly retiring: Verdict;
};

const event: Kind = {
  name: 'Event',
  named: 'event',
  retiring: 'approval-needed',
  site: (identity) => ({ kind: 'event', identity, visibility: 'internal' }),
  held: (entries, body = plain) => ({
    events: byIdentity(entries, (held) => publishedEvent(held, body)),
  }),
  declared: (entries, body = plain) => ({
    events: byIdentity(entries, (lifecycle) => anEvent(lifecycle, body)),
  }),
};
const command: Kind = {
  name: 'Command',
  named: 'command',
  retiring: 'allowed',
  site: (identity) => ({ kind: 'command', identity, visibility: 'private' }),
  held: (entries, body = plain) => ({
    commands: byIdentity(entries, (held) => publishedCommand(held, body)),
  }),
  declared: (entries, body = plain) => ({
    commands: byIdentity(entries, (lifecycle) => aCommand(lifecycle, body)),
  }),
};
const kinds = [event, command];

function changesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly Change[] {
  const report = compatibilityReportOf(baseline, proposed);
  return report.changes;
}

function added(site: ChangeSite): Change {
  return { site, difference: { kind: 'added' }, class: 'additive', verdict: 'allowed' };
}

function bodyChange(isRequired: boolean) {
  const shape = { kind: 'field-added', required: isRequired } as const;
  const at: readonly Step[] = [
    { kind: 'part', name: 'body' },
    { kind: 'field', name: 'note' },
  ];
  return { kind: 'schema', position: 'message', at, shape } as const;
}

describe('compatibilityReportOf, a Message Version takes no Breaking Change', () => {
  test.each(kinds)('a Breaking change to a $name’s body is refused', (kind) => {
    const baseline = aBaseline(kind.held({ 'OrderPlaced@1': 'active' }, plain));
    const proposed = aProposed(kind.declared({ 'OrderPlaced@1': 'active' }, withRequiredNote));

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      {
        site: kind.site('OrderPlaced@1'),
        difference: bodyChange(true),
        class: 'breaking',
        verdict: 'refused',
      },
    ]);
  });

  test.each(kinds)('an Additive change to a $name’s body stays Additive', (kind) => {
    const baseline = aBaseline(kind.held({ 'OrderPlaced@1': 'active' }, plain));
    const proposed = aProposed(kind.declared({ 'OrderPlaced@1': 'active' }, withOptionalNote));

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      {
        site: kind.site('OrderPlaced@1'),
        difference: bodyChange(false),
        class: 'additive',
        verdict: 'allowed',
      },
    ]);
  });

  test.each(kinds)(
    'retiring a $name Deprecated in the Baseline is Breaking; its Approval is $retiring',
    (kind) => {
      const baseline = aBaseline(kind.held({ 'OrderPlaced@1': 'deprecated' }));
      const proposed = aProposed(kind.declared({ 'OrderPlaced@1': 'retired' }));

      const changes = changesOf(baseline, proposed);

      expect(changes).toEqual([
        {
          site: kind.site('OrderPlaced@1'),
          difference: { kind: 'retired' },
          class: 'breaking',
          verdict: kind.retiring,
        },
      ]);
    },
  );

  test('narrowing an Event’s Visibility is Breaking and needs an Approval', () => {
    const baseline = aBaseline({
      events: { 'OrderPlaced@1': publishedEvent('active', plain, 'internal') },
    });
    const proposed = aProposed({
      events: { 'OrderPlaced@1': anEvent('active', plain, 'private') },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      {
        site: event.site('OrderPlaced@1'),
        difference: { kind: 'visibility-narrowed', from: 'internal', to: 'private' },
        class: 'breaking',
        verdict: 'approval-needed',
      },
    ]);
  });

  test('narrowing an Event and making a Breaking change to its body gives a Breaking narrowing that needs an Approval, and a body change that is refused', () => {
    const baseline = aBaseline({
      events: { 'OrderPlaced@1': publishedEvent('active', plain, 'internal') },
    });
    const proposed = aProposed({
      events: { 'OrderPlaced@1': anEvent('active', withRequiredNote, 'private') },
    });

    const changes = changesOf(baseline, proposed);

    const site = event.site('OrderPlaced@1');
    expect(changes).toEqual([
      {
        site,
        difference: { kind: 'visibility-narrowed', from: 'internal', to: 'private' },
        class: 'breaking',
        verdict: 'approval-needed',
      },
      { site, difference: bodyChange(true), class: 'breaking', verdict: 'refused' },
    ]);
  });
});

describe('compatibilityReportOf, a Message Version’s Group', () => {
  test('moving an Event’s Message Version to another Group gives no Change, only a changed hash', () => {
    const baseline = aBaseline(event.held({ 'OrderPlaced@1': 'active' }));
    const moved = { ...anEvent('active', plain), group: 'billing' };
    const proposed = aProposed({ events: { 'OrderPlaced@1': moved } });

    const report = compatibilityReportOf(baseline, proposed);

    expect(report).toEqual({ changes: [], hashChanged: true });
  });

  test('moving a Command’s Message Version to another Group gives no Change, only a changed hash', () => {
    const baseline = aBaseline(command.held({ 'ChargeCard@1': 'active' }));
    const moved = { ...aCommand('active', plain), group: 'billing' };
    const proposed = aProposed({ commands: { 'ChargeCard@1': moved } });

    const report = compatibilityReportOf(baseline, proposed);

    expect(report).toEqual({ changes: [], hashChanged: true });
  });
});

describe('compatibilityReportOf, gaps', () => {
  test.each(kinds)('adding the next $name version after a declared one is Additive', (kind) => {
    const baseline = aBaseline(kind.held({ 'OrderPlaced@1': 'active' }));
    const proposed = aProposed(
      kind.declared({ 'OrderPlaced@1': 'active', 'OrderPlaced@2': 'active' }),
    );

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([added(kind.site('OrderPlaced@2'))]);
  });

  test.each(kinds)('adding the next $name version after a tombstone is Additive', (kind) => {
    const baseline = aBaseline(kind.held({ 'OrderPlaced@1': 'tombstone' }));
    const proposed = aProposed(kind.declared({ 'OrderPlaced@2': 'active' }));

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([added(kind.site('OrderPlaced@2'))]);
  });

  test.each(kinds)('adding version 1 of a new $name is Additive', (kind) => {
    const baseline = aBaseline();
    const proposed = aProposed(kind.declared({ 'OrderPlaced@1': 'active' }));

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([added(kind.site('OrderPlaced@1'))]);
  });

  test.each(kinds)(
    'adding a $name version whose previous one neither side holds is refused, naming the missing version',
    (kind) => {
      const baseline = aBaseline(kind.held({ 'OrderPlaced@1': 'active' }));
      const proposed = aProposed(
        kind.declared({ 'OrderPlaced@1': 'active', 'OrderPlaced@3': 'active' }),
      );

      const changes = changesOf(baseline, proposed);

      const site = kind.site('OrderPlaced@3');
      expect(changes).toEqual([
        added(site),
        {
          site,
          difference: { kind: 'version-gap', missing: 'OrderPlaced@2' },
          class: 'additive',
          verdict: 'refused',
        },
      ]);
    },
  );

  test.each(kinds)('a new $name starting past version 1 is refused', (kind) => {
    const baseline = aBaseline();
    const proposed = aProposed(kind.declared({ 'OrderPlaced@2': 'active' }));

    const changes = changesOf(baseline, proposed);

    const site = kind.site('OrderPlaced@2');
    expect(changes).toEqual([
      added(site),
      {
        site,
        difference: { kind: 'version-gap', missing: 'OrderPlaced@1' },
        class: 'additive',
        verdict: 'refused',
      },
    ]);
  });

  test.each(kinds)('two consecutive $name versions added together leave no gap', (kind) => {
    const baseline = aBaseline(kind.held({ 'OrderPlaced@1': 'active' }));
    const proposed = aProposed(
      kind.declared({
        'OrderPlaced@1': 'active',
        'OrderPlaced@2': 'active',
        'OrderPlaced@3': 'active',
      }),
    );

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([added(kind.site('OrderPlaced@2')), added(kind.site('OrderPlaced@3'))]);
  });

  test.each(kinds)(
    'versions 2 and 3 of a $name added with no version 1 give one gap, on 2',
    (kind) => {
      const baseline = aBaseline();
      const proposed = aProposed(
        kind.declared({ 'OrderPlaced@2': 'active', 'OrderPlaced@3': 'active' }),
      );

      const changes = changesOf(baseline, proposed);

      const second = kind.site('OrderPlaced@2');
      expect(changes).toEqual([
        added(second),
        {
          site: second,
          difference: { kind: 'version-gap', missing: 'OrderPlaced@1' },
          class: 'additive',
          verdict: 'refused',
        },
        added(kind.site('OrderPlaced@3')),
      ]);
    },
  );

  test.each(kinds)('a gap the Baseline already holds in a $name is not judged again', (kind) => {
    const baseline = aBaseline(kind.held({ 'OrderPlaced@1': 'active', 'OrderPlaced@3': 'active' }));
    const proposed = aProposed(
      kind.declared({
        'OrderPlaced@1': 'active',
        'OrderPlaced@3': 'active',
        'OrderPlaced@4': 'active',
      }),
    );

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([added(kind.site('OrderPlaced@4'))]);
  });

  test.each(kinds)('a $name first published at version 3 is not judged again', (kind) => {
    const baseline = aBaseline(kind.held({ 'OrderPlaced@3': 'active' }));
    const proposed = aProposed(kind.declared({ 'OrderPlaced@3': 'active' }));

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([]);
  });

  test.each(kinds)('filling a $name version the Baseline skipped is Additive', (kind) => {
    const baseline = aBaseline(kind.held({ 'OrderPlaced@1': 'active', 'OrderPlaced@3': 'active' }));
    const proposed = aProposed(
      kind.declared({
        'OrderPlaced@1': 'active',
        'OrderPlaced@2': 'active',
        'OrderPlaced@3': 'active',
      }),
    );

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([added(kind.site('OrderPlaced@2'))]);
  });
});

type Crossing = {
  readonly name: string;
  readonly declared: Kind;
  readonly held: Kind;
};

const crossings: readonly Crossing[] = [
  { name: 'a Command under an Event’s name', declared: command, held: event },
  { name: 'an Event under a Command’s name', declared: event, held: command },
];

function refusedKind(crossing: Crossing, identity: string): Change {
  return {
    site: crossing.declared.site(identity),
    difference: { kind: 'name-kind-changed', from: crossing.held.named },
    class: 'breaking',
    verdict: 'refused',
  };
}

describe('compatibilityReportOf, a name’s kind across history', () => {
  test.each(crossings)('declaring $name the Baseline declares is refused', (crossing) => {
    const baseline = aBaseline(crossing.held.held({ 'OrderPlaced@1': 'active' }));
    const proposed = aProposed({
      ...crossing.held.declared({ 'OrderPlaced@1': 'active' }),
      ...crossing.declared.declared({ 'OrderPlaced@2': 'active' }),
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      added(crossing.declared.site('OrderPlaced@2')),
      refusedKind(crossing, 'OrderPlaced@2'),
    ]);
  });

  test.each(crossings)(
    'declaring $name at an identity the other kind holds only as a tombstone is refused',
    (crossing) => {
      const baseline = aBaseline(crossing.held.held({ 'OrderPlaced@1': 'tombstone' }));
      const proposed = aProposed(crossing.declared.declared({ 'OrderPlaced@1': 'active' }));

      const changes = changesOf(baseline, proposed);

      expect(changes).toEqual([
        added(crossing.declared.site('OrderPlaced@1')),
        refusedKind(crossing, 'OrderPlaced@1'),
      ]);
    },
  );

  test.each(crossings)(
    'declaring $name past a tombstoned version 1 gives the kind alone, not also a gap',
    (crossing) => {
      const baseline = aBaseline(crossing.held.held({ 'OrderPlaced@1': 'tombstone' }));
      const proposed = aProposed(crossing.declared.declared({ 'OrderPlaced@2': 'active' }));

      const changes = changesOf(baseline, proposed);

      expect(changes).toEqual([
        added(crossing.declared.site('OrderPlaced@2')),
        refusedKind(crossing, 'OrderPlaced@2'),
      ]);
    },
  );

  test.each(crossings)(
    'the kind Change of $name added Retired follows the added Change and precedes the lifecycle one',
    (crossing) => {
      const baseline = aBaseline(crossing.held.held({ 'OrderPlaced@1': 'active' }));
      const proposed = aProposed({
        ...crossing.held.declared({ 'OrderPlaced@1': 'active' }),
        ...crossing.declared.declared({ 'OrderPlaced@2': 'retired' }),
      });

      const changes = changesOf(baseline, proposed);

      expect(changes.map(({ difference }) => difference.kind)).toEqual([
        'added',
        'name-kind-changed',
        'retired-before-deprecated',
      ]);
    },
  );

  test.each(crossings)(
    'a name the Baseline holds as the other kind does not touch $name under a different name',
    (crossing) => {
      const baseline = aBaseline(crossing.held.held({ 'OrderShipped@1': 'active' }));
      const proposed = aProposed({
        ...crossing.held.declared({ 'OrderShipped@1': 'active' }),
        ...crossing.declared.declared({ 'OrderPlaced@1': 'active' }),
      });

      const changes = changesOf(baseline, proposed);

      expect(changes).toEqual([added(crossing.declared.site('OrderPlaced@1'))]);
    },
  );

  test.each(kinds)('a name the Baseline holds as the same kind gives no kind Change', (kind) => {
    const baseline = aBaseline(kind.held({ 'OrderPlaced@1': 'tombstone' }));
    const proposed = aProposed(kind.declared({ 'OrderPlaced@2': 'active' }));

    const changes = changesOf(baseline, proposed);

    expect(changes.map(({ difference }) => difference.kind)).toEqual(['added']);
  });
});

describe('firstPublishChangesOf, gaps with no Baseline', () => {
  function noBaselineChangesOf(proposed: ServiceSnapshot): readonly Change[] {
    return firstPublishChangesOf(proposed);
  }

  function gap(site: ChangeSite, missing: string): Change {
    return {
      site,
      difference: { kind: 'version-gap', missing },
      class: 'additive',
      verdict: 'refused',
    };
  }

  test.each(kinds)('a first publish of $name versions 1 and 3 refuses the gap on 3', (kind) => {
    const proposed = aProposed(
      kind.declared({ 'OrderPlaced@1': 'active', 'OrderPlaced@3': 'active' }),
    );

    const changes = noBaselineChangesOf(proposed);

    expect(changes).toEqual([gap(kind.site('OrderPlaced@3'), 'OrderPlaced@2')]);
  });

  test.each(kinds)('a first publish of $name version 2 alone refuses the gap on 2', (kind) => {
    const proposed = aProposed(kind.declared({ 'OrderPlaced@2': 'active' }));

    const changes = noBaselineChangesOf(proposed);

    expect(changes).toEqual([gap(kind.site('OrderPlaced@2'), 'OrderPlaced@1')]);
  });

  test.each(kinds)('a first publish of $name versions without a gap has no Change', (kind) => {
    const proposed = aProposed(
      kind.declared({ 'OrderPlaced@1': 'active', 'OrderPlaced@2': 'deprecated' }),
    );

    const changes = noBaselineChangesOf(proposed);

    expect(changes).toEqual([]);
  });
});

describe('compatibilityReportOf, a gap is refused with or without a Baseline', () => {
  test('a version-gap is reported exactly when a version added follows none either side holds', () => {
    let state = 223;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    for (let draw = 0; draw < 300; draw += 1) {
      const versions = [1, 2, 3, 4, 5].filter(() => next() < 0.6);
      const withBaseline = next() < 0.7;
      const held = withBaseline ? versions.filter(() => next() < 0.5) : [];
      const declared = versions.filter((version) => !held.includes(version) || next() < 0.5);
      const heldAs: Held = next() < 0.5 ? 'active' : 'tombstone';
      const baseline = aBaseline(event.held(entriesOf(held, heldAs)));
      const proposed = aProposed(event.declared(entriesOf(declared, 'active')));

      const changes = withBaseline
        ? compatibilityReportOf(baseline, proposed).changes
        : firstPublishChangesOf(proposed);

      const all = [...held, ...declared];
      const added = declared.filter((version) => !held.includes(version));
      const gaps = changes.filter(({ difference }) => difference.kind === 'version-gap');
      const label = `draw ${draw}: held ${held} declared ${declared}`;
      expect(gaps.length > 0, label).toBe(!isGaplessAfter(all, added));
    }
  });

  function entriesOf<Value>(versions: readonly number[], value: Value): Entries<Value> {
    return Object.fromEntries(versions.map((version) => [`OrderPlaced@${version}`, value]));
  }

  /** Whether every version added follows one held or declared: what the Check judges of a history. */
  function isGaplessAfter(all: readonly number[], added: readonly number[]): boolean {
    return added.every((version) => version === 1 || all.includes(version - 1));
  }
});

describe('compatibilityReportOf, retiring a Message Version compares nothing it declares', () => {
  const bodies: readonly [string, ObjectNode][] = [
    ['a field removed', anObject({})],
    ['a required field added', withRequiredNote],
    ['an optional field added', withOptionalNote],
    ['a field whose type changed', anObject({ id: required({ type: 'number' }) })],
  ];

  const cases = kinds.flatMap((kind) => bodies.map(([change, body]) => ({ kind, change, body })));
  test.each(cases)(
    'retiring a Deprecated $kind.name with $change reports only the retirement',
    ({ kind, body }) => {
      const baseline = aBaseline(kind.held({ 'OrderPlaced@1': 'deprecated' }));
      const proposed = aProposed(kind.declared({ 'OrderPlaced@1': 'retired' }, body));

      const changes = changesOf(baseline, proposed);

      expect(changes).toEqual([
        {
          site: kind.site('OrderPlaced@1'),
          difference: { kind: 'retired' },
          class: 'breaking',
          verdict: kind.retiring,
        },
      ]);
    },
  );

  test('a still-Active Event whose body lost a field is still refused', () => {
    const baseline = aBaseline(event.held({ 'OrderPlaced@1': 'active' }));
    const proposed = aProposed(event.declared({ 'OrderPlaced@1': 'active' }, anObject({})));

    const changes = changesOf(baseline, proposed);

    expect(changes.map(({ difference, verdict }) => [difference.kind, verdict])).toEqual([
      ['schema', 'refused'],
    ]);
  });
});
