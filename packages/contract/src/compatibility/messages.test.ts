import { describe, expect, test } from 'vitest';
import {
  type Change,
  type ChangeSite,
  compatibilityReportOf,
  type EventSnapshot,
  type Field,
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
  dependencies: {},
} as const;

function required(schema: SchemaNode): Field {
  return { required: true, schema };
}

function optional(schema: SchemaNode): Field {
  return { required: false, schema };
}

function anObject(fields: Readonly<Record<string, Field>>): ObjectNode {
  return { type: 'object', mode: 'open', fields };
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
  return { visibility, lifecycle, description: 'An order was placed', body };
}

function aCommand(lifecycle: Lifecycle, body: ObjectNode) {
  return { lifecycle, description: 'Charge a card', body };
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
  if (report.kind !== 'compared') {
    throw new Error('the Baseline was given, so the report must have compared');
  }
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
    'changing a $name’s body while retiring it is refused beside a Breaking retirement',
    (kind) => {
      const baseline = aBaseline(kind.held({ 'OrderPlaced@1': 'deprecated' }, plain));
      const proposed = aProposed(kind.declared({ 'OrderPlaced@1': 'retired' }, withRequiredNote));

      const changes = changesOf(baseline, proposed);

      const site = kind.site('OrderPlaced@1');
      expect(changes).toEqual([
        {
          site,
          difference: { kind: 'retired' },
          class: 'breaking',
          verdict: kind.retiring,
        },
        { site, difference: bodyChange(true), class: 'breaking', verdict: 'refused' },
      ]);
    },
  );

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
