import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { orderOf, orderOfGrowth, orders } from '../../test/growth.ts';
import { aliasDrawOf } from '../../test/random-alias-draws.ts';
import {
  type Construct,
  type Leaf,
  type Piece,
  pathTextOf,
  randomNested,
} from '../../test/random-places.ts';
import { seededNext } from '../../test/random-schemas.ts';
import { publishedAt, publishedBy, schemaExports } from '../../test/snapshots.ts';
import {
  anchoredAuthorPathOf,
  anchoredSnapshotPathOf,
  byCodePoint,
  type Change,
  type ChangeSite,
  type CommandSnapshot,
  type ComparedReport,
  compatibilityReportOf,
  type DefinitionsSnapshot,
  type Defs,
  type EndpointFields,
  type EndpointLifecycle,
  type EndpointSnapshot,
  type EventSnapshot,
  type Field,
  hashedTextOf,
  type NumberNode,
  type ObjectNode,
  type Path,
  type Position,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  publishedSnapshotOf,
  type RefNode,
  type SchemaNode,
  type ServiceSnapshot,
  type ShapeDifference,
  type Snapshot,
  type Step,
  type StringNode,
  type TaggedNode,
  walkSchemas,
} from '../internal/index.ts';

type Class = 'breaking' | 'additive' | 'neutral';
type Value = string | number | boolean;

const breaking = 'breaking';
const additive = 'additive';
const neutral = 'neutral';

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
  guards: {},
  codes: {},
  dependencies: {},
} as const;
const noDefs: Defs = {};
const noBodies = {
  input: {
    params: null,
    query: { type: 'object', fields: {} },
    headers: { type: 'object', fields: {} },
    body: null,
  },
  success: { status: 200, headers: { type: 'object', fields: {} }, body: null },
} as const;

function anEndpoint<const Lifecycle extends EndpointLifecycle = { readonly lifecycle: 'active' }>(
  fields: Partial<EndpointFields> = {},
  lifecycle?: Lifecycle,
): EndpointFields & (Lifecycle | { readonly lifecycle: 'active' }) {
  return {
    name: 'createOrder',
    group: 'orders',
    visibility: 'public',
    description: 'Places an order',
    params: [],
    guards: [],
    rejections: [],
    ...noBodies,
    ...fields,
    ...(lifecycle ?? { lifecycle: 'active' }),
  };
}

function anEndpointReading(input: SchemaNode | null, success: SchemaNode | null): EndpointSnapshot {
  return anEndpoint({
    input: { ...noBodies.input, body: input },
    success: { ...noBodies.success, body: success },
  });
}

function anEvent(body: SchemaNode): EventSnapshot {
  return {
    group: 'orders',
    visibility: 'internal',
    lifecycle: 'active',
    description: 'Placed',
    body,
  };
}

function aCommand(body: SchemaNode): CommandSnapshot {
  return { group: 'orders', lifecycle: 'active', description: 'Charge a card', body };
}

function aLive<Element extends { readonly lifecycle: string }>(
  element: Element,
): Element & { readonly lifecycle: 'active' } {
  return { ...element, lifecycle: 'active' };
}

function aBaseline(fields: Partial<PublishedServiceSnapshot> = {}): PublishedServiceSnapshot {
  return {
    ...heading,
    version: '3.4.0',
    generator: publishedBy,
    formerInputs: [],
    defs: noDefs,
    endpoints: {},
    events: {},
    commands: {},
    subscriptions: {},
    ...fields,
  };
}

function aProposed(fields: Partial<ServiceSnapshot> = {}): ServiceSnapshot {
  return {
    ...heading,
    defs: noDefs,
    endpoints: {},
    events: {},
    commands: {},
    subscriptions: {},
    ...fields,
  };
}

function aDefinitions(fields: Partial<DefinitionsSnapshot> = {}): DefinitionsSnapshot {
  return {
    format: 1,
    kind: 'definitions',
    name: '@org/definitions',
    standardRejections,
    defs: noDefs,
    exports: schemaExports({}),
    guards: {},
    codes: {},
    ...fields,
  };
}

function aBaselineDefinitions(
  fields: Partial<PublishedDefinitionsSnapshot> = {},
): PublishedDefinitionsSnapshot {
  return { ...aDefinitions(), version: '4.2.0', generator: publishedBy, ...fields };
}

const aString: StringNode = { type: 'string' };
const aNumber: SchemaNode = { type: 'number' };
const aBoolean: SchemaNode = { type: 'boolean' };

function aClosedEnum(...values: readonly Value[]): SchemaNode {
  return { type: 'enum', values, open: false };
}

function anOpenEnum(...values: readonly Value[]): SchemaNode {
  return { type: 'enum', values, open: true };
}

function required(schema: SchemaNode): Field {
  return { required: true, schema };
}

function optional(schema: SchemaNode): Field {
  return { required: false, schema };
}

function anObject(fields: Readonly<Record<string, Field>> = {}): ObjectNode {
  return { type: 'object', fields };
}

function aTagged(
  discriminator: string,
  variants: Readonly<Record<string, Readonly<Record<string, Field>>>>,
): TaggedNode {
  const entries = Object.entries(variants).map(([value, fields]) => [
    JSON.stringify(value),
    anObject({ [discriminator]: required(aClosedEnum(value)), ...fields }),
  ]);
  return { type: 'tagged', discriminator, variants: Object.fromEntries(entries) };
}

function aRef(name: string): SchemaNode {
  return { type: 'ref', name };
}

/** What a Breaking difference in a place is judged: an Approval, or refused for a Message Version. */
type Breaking = {
  readonly class: 'breaking';
  readonly verdict: 'approval-needed' | 'refused';
};

type Place = {
  readonly name: string;
  readonly position: Position;
  readonly site: ChangeSite;
  readonly root: Path;
  readonly breaking: Breaking;
  readonly column: 0 | 1 | 2 | 3;
  readonly baseline: (node: SchemaNode, defs: Defs) => PublishedSnapshot;
  readonly proposed: (node: SchemaNode, defs: Defs) => Snapshot;
};

const input: Place = {
  name: 'Input',
  position: 'input',
  site: {
    kind: 'endpoint',
    identity: 'POST /orders',
    name: 'createOrder',
    visibility: 'public',
  },
  root: ['input', 'body'],
  breaking: { class: 'breaking', verdict: 'approval-needed' },
  column: 0,
  baseline: (node, defs) =>
    aBaseline({ defs, endpoints: { 'POST /orders': aLive(anEndpointReading(node, null)) } }),
  proposed: (node, defs) =>
    aProposed({ defs, endpoints: { 'POST /orders': anEndpointReading(node, null) } }),
};
const success: Place = {
  name: 'Success',
  position: 'success',
  site: {
    kind: 'endpoint',
    identity: 'POST /orders',
    name: 'createOrder',
    visibility: 'public',
  },
  root: ['success', 'body'],
  breaking: { class: 'breaking', verdict: 'approval-needed' },
  column: 1,
  baseline: (node, defs) =>
    aBaseline({ defs, endpoints: { 'POST /orders': aLive(anEndpointReading(null, node)) } }),
  proposed: (node, defs) =>
    aProposed({ defs, endpoints: { 'POST /orders': anEndpointReading(null, node) } }),
};
const message: Place = {
  name: 'Message',
  position: 'message',
  site: { kind: 'event', identity: 'OrderPlaced@1', visibility: 'internal' },
  root: ['body'],
  breaking: { class: 'breaking', verdict: 'refused' },
  column: 2,
  baseline: (node, defs) => aBaseline({ defs, events: { 'OrderPlaced@1': aLive(anEvent(node)) } }),
  proposed: (node, defs) => aProposed({ defs, events: { 'OrderPlaced@1': anEvent(node) } }),
};
const shared: Place = {
  name: 'a shared schema',
  position: 'message',
  site: { kind: 'export', name: 'money', visibility: 'public' },
  root: [],
  breaking: { class: 'breaking', verdict: 'approval-needed' },
  column: 3,
  baseline: (node, defs) => aBaselineDefinitions({ defs, exports: schemaExports({ money: node }) }),
  proposed: (node, defs) => aDefinitions({ defs, exports: schemaExports({ money: node }) }),
};
const places = [input, success, message, shared];

/** The classes of one difference in Input, Success, Message and a shared schema, in that order. */
type Classes = readonly [Class, Class, Class, Class];

const acceptsLess: Classes = [breaking, additive, breaking, breaking];
const guaranteesLess: Classes = [additive, breaking, breaking, breaking];
const breaksEverywhere: Classes = [breaking, breaking, breaking, breaking];
const addsOnly: Classes = [additive, additive, additive, additive];
const opensTheEnum: Classes = [neutral, breaking, breaking, breaking];
const closesTheEnum: Classes = [neutral, additive, additive, additive];

type Found = {
  readonly shape: ShapeDifference;
  readonly at: Path;
  readonly classes: Classes;
  readonly def?: string;
};

function found(shape: ShapeDifference, classes: Classes, at: Path = []): Found {
  return { shape, at, classes };
}

/** A difference found inside the recursive schema `def`, at `at` below it, whichever place reaches it. */
function inDef(def: string, difference: Found): Found {
  return { ...difference, def };
}

type Row = {
  readonly change: string;
  readonly from: SchemaNode;
  readonly to: SchemaNode;
  readonly found: readonly Found[];
  readonly fromDefs?: Defs;
  readonly toDefs?: Defs;
  readonly places?: readonly Place[];
};

/** A Change with the Snapshot's own path in place of its steps, as the rows below spell their paths. */
type PathChange = Omit<Change, 'difference'> & { readonly difference: unknown };

function snapshotPathsOf(changes: readonly Change[]): readonly PathChange[] {
  return changes.map((change) => {
    const { difference } = change;
    if (!('at' in difference)) {
      return change;
    }
    const rest = Object.entries(difference).filter(([key]) => key !== 'at' && key !== 'def');
    const at = anchoredSnapshotPathOf(difference);
    return { ...change, difference: { ...Object.fromEntries(rest), at } };
  });
}

function changeAt(place: Place, difference: Found): PathChange {
  const shapeChange = {
    kind: 'schema',
    position: place.position,
    at:
      difference.def === undefined
        ? [...place.root, ...difference.at]
        : ['defs', difference.def, ...difference.at],
    shape: difference.shape,
  } as const;
  const changeClass = difference.classes[place.column];
  return changeClass === 'breaking'
    ? { site: place.site, difference: shapeChange, ...place.breaking }
    : { site: place.site, difference: shapeChange, class: changeClass, verdict: 'allowed' };
}

function stepsOf({ difference }: Change): readonly Step[] {
  return 'at' in difference ? difference.at : [];
}

function defOf({ difference }: Change): string | undefined {
  return 'def' in difference ? difference.def : undefined;
}

function pathOf(change: Change): string {
  return 'at' in change.difference ? (anchoredAuthorPathOf(change.difference) ?? '') : '';
}

function comparedOf(baseline: PublishedSnapshot, proposed: Snapshot): ComparedReport {
  const report = compatibilityReportOf(baseline, proposed);
  return report;
}

function reportOf(place: Place, row: Pick<Row, 'from' | 'to' | 'fromDefs' | 'toDefs'>) {
  const baseline = place.baseline(row.from, row.fromDefs ?? noDefs);
  const proposed = place.proposed(row.to, row.toDefs ?? noDefs);
  return comparedOf(baseline, proposed);
}

function outcomeOf(place: Place, difference: Found): string {
  const changeClass = difference.classes[place.column];
  return changeClass === 'breaking' && place.breaking.verdict === 'refused'
    ? 'refused'
    : changeClass;
}

function casesOf(rows: readonly Row[]) {
  return rows.flatMap((row) =>
    (row.places ?? places).map((place) => ({
      change: row.change,
      place: place.name,
      outcome: row.found.map((difference) => outcomeOf(place, difference)).join(' and '),
      row,
      where: place,
    })),
  );
}

function expectRow({ row, where }: ReturnType<typeof casesOf>[number]): void {
  const report = reportOf(where, row);

  expect(snapshotPathsOf(report.changes)).toEqual(
    row.found.map((difference) => changeAt(where, difference)),
  );
}

const noteField = ['fields', 'note'];

const fieldRows: readonly Row[] = [
  {
    change: 'adding a required field',
    from: anObject({ id: required(aString) }),
    to: anObject({ id: required(aString), note: required(aString) }),
    found: [found({ kind: 'field-added', required: true }, acceptsLess, noteField)],
  },
  {
    change: 'adding an optional field',
    from: anObject({ id: required(aString) }),
    to: anObject({ id: required(aString), note: optional(aString) }),
    found: [found({ kind: 'field-added', required: false }, addsOnly, noteField)],
  },
  {
    change: 'making an optional field required',
    from: anObject({ note: optional(aString) }),
    to: anObject({ note: required(aString) }),
    found: [found({ kind: 'field-made-required' }, acceptsLess, noteField)],
  },
  {
    change: 'making a required field optional',
    from: anObject({ note: required(aString) }),
    to: anObject({ note: optional(aString) }),
    found: [found({ kind: 'field-made-optional' }, guaranteesLess, noteField)],
  },
  {
    change: 'removing a field',
    from: anObject({ id: required(aString), note: required(aString) }),
    to: anObject({ id: required(aString) }),
    found: [found({ kind: 'field-removed' }, guaranteesLess, noteField)],
  },
  {
    change: 'changing a field’s type',
    from: anObject({ note: required(aString) }),
    to: anObject({ note: required(aNumber) }),
    found: [
      found({ kind: 'type-changed', from: 'string', to: 'number' }, breaksEverywhere, noteField),
    ],
  },
  {
    change: 'turning an object into a string-keyed record',
    from: anObject({ id: required(aString) }),
    to: { type: 'record', key: aString, value: aString },
    found: [found({ kind: 'type-changed', from: 'object', to: 'record' }, breaksEverywhere)],
  },
  {
    change: 'turning an array into a tuple',
    from: { type: 'array', items: aString },
    to: { type: 'tuple', items: [aString] },
    found: [found({ kind: 'type-changed', from: 'array', to: 'tuple' }, breaksEverywhere)],
  },
  {
    change: 'adding nullability',
    from: aString,
    to: { type: 'string', nullable: true },
    found: [found({ kind: 'nullability-added' }, guaranteesLess)],
  },
  {
    change: 'removing nullability',
    from: { type: 'string', nullable: true },
    to: aString,
    found: [found({ kind: 'nullability-removed' }, acceptsLess)],
  },
  {
    change: 'making a field required and nullable',
    from: anObject({ note: optional(aString) }),
    to: anObject({ note: required({ type: 'string', nullable: true }) }),
    found: [
      found({ kind: 'field-made-required' }, acceptsLess, noteField),
      found({ kind: 'nullability-added' }, guaranteesLess, noteField),
    ],
  },
  {
    change: 'changing a type and adding nullability, which hides neither',
    from: aString,
    to: { type: 'number', nullable: true },
    found: [
      found({ kind: 'nullability-added' }, guaranteesLess),
      found({ kind: 'type-changed', from: 'string', to: 'number' }, breaksEverywhere),
    ],
  },
  {
    change: 'changing a field deep in a body',
    from: anObject({ customer: required(anObject({ name: required(aString) })) }),
    to: anObject({ customer: required(anObject({ name: required(aNumber) })) }),
    found: [
      found({ kind: 'type-changed', from: 'string', to: 'number' }, breaksEverywhere, [
        'fields',
        'customer',
        'fields',
        'name',
      ]),
    ],
  },
  {
    change: 'adding a required field inside an array’s items',
    from: { type: 'array', items: anObject({ id: required(aString) }) },
    to: {
      type: 'array',
      items: anObject({ id: required(aString), note: required(aString) }),
    },
    found: [
      found({ kind: 'field-added', required: true }, acceptsLess, ['items', 'fields', 'note']),
    ],
  },
  {
    change: 'renaming a field, which is an addition and a removal',
    from: anObject({ old: required(aString) }),
    to: anObject({ new: required(aString) }),
    found: [
      found({ kind: 'field-added', required: true }, acceptsLess, ['fields', 'new']),
      found({ kind: 'field-removed' }, guaranteesLess, ['fields', 'old']),
    ],
  },
];

describe('compatibilityReportOf, fields', () => {
  test.each(casesOf(fieldRows))('$change is $outcome in $place', expectRow);
});

const neutralEverywhere: Classes = [neutral, neutral, neutral, neutral];

function annotationChanged(annotation: 'description' | 'examples' | 'origin' | 'id') {
  return { kind: 'annotation-changed', annotation } as const;
}

const annotationRows: readonly Row[] = [
  {
    change: 'changing a field’s description',
    from: anObject({ note: required({ type: 'string', description: 'A note' }) }),
    to: anObject({ note: required({ type: 'string', description: 'The note' }) }),
    found: [found(annotationChanged('description'), neutralEverywhere, noteField)],
  },
  {
    change: 'adding a field’s description',
    from: anObject({ note: required(aString) }),
    to: anObject({ note: required({ type: 'string', description: 'The note' }) }),
    found: [found(annotationChanged('description'), neutralEverywhere, noteField)],
  },
  {
    change: 'changing a field’s examples',
    from: anObject({ note: required({ type: 'string', examples: ['a'] }) }),
    to: anObject({ note: required({ type: 'string', examples: ['a', 'b'] }) }),
    found: [found(annotationChanged('examples'), neutralEverywhere, noteField)],
  },
  {
    change: 'changing a field’s origin',
    from: anObject({ note: required({ type: 'string', origin: 'local' }) }),
    to: anObject({ note: required({ type: 'string', origin: '@org/x@1#note' }) }),
    found: [found(annotationChanged('origin'), neutralEverywhere, noteField)],
  },
  {
    change: 'changing the schema’s own description',
    from: { type: 'number', description: 'A total' },
    to: { type: 'number', description: 'The total' },
    found: [found(annotationChanged('description'), neutralEverywhere)],
  },
  {
    change: 'changing a description, examples and origin at once',
    from: anObject({
      note: required({ type: 'string', description: 'A note', origin: 'local', examples: ['a'] }),
    }),
    to: anObject({
      note: required({ type: 'string', description: 'The note', origin: '@org/x@1#note' }),
    }),
    found: [
      found(annotationChanged('description'), neutralEverywhere, noteField),
      found(annotationChanged('examples'), neutralEverywhere, noteField),
      found(annotationChanged('origin'), neutralEverywhere, noteField),
    ],
  },
  {
    change: 'changing a description beside a removed field',
    from: anObject({
      id: required({ type: 'string', description: 'An id' }),
      note: required(aString),
    }),
    to: anObject({ id: required({ type: 'string', description: 'The id' }) }),
    found: [
      found(annotationChanged('description'), neutralEverywhere, ['fields', 'id']),
      found({ kind: 'field-removed' }, guaranteesLess, noteField),
    ],
  },
  {
    change: 'changing the description of an array’s items',
    from: { type: 'array', items: { type: 'string', description: 'A tag' } },
    to: { type: 'array', items: { type: 'string', description: 'The tag' } },
    found: [found(annotationChanged('description'), neutralEverywhere, ['items'])],
  },
  {
    change: 'changing the description of a discriminated union’s variant field',
    from: aTagged('kind', { card: { last4: required({ type: 'string', description: 'a' }) } }),
    to: aTagged('kind', { card: { last4: required({ type: 'string', description: 'b' }) } }),
    found: [
      found(annotationChanged('description'), neutralEverywhere, [
        'variants',
        '"card"',
        'fields',
        'last4',
      ]),
    ],
  },
];

describe('compatibilityReportOf, a node’s annotations', () => {
  test.each(casesOf(annotationRows))('$change is $outcome in $place', expectRow);
});

const sizes = ['a', 'b'];

const enumRows: readonly Row[] = [
  {
    change: 'adding a value to a closed enum',
    from: aClosedEnum(...sizes),
    to: aClosedEnum(...sizes, 'c'),
    found: [found({ kind: 'value-added', value: 'c', enum: 'closed' }, guaranteesLess)],
  },
  {
    change: 'removing a value from a closed enum',
    from: aClosedEnum(...sizes, 'c'),
    to: aClosedEnum(...sizes),
    found: [found({ kind: 'value-removed', value: 'c' }, acceptsLess)],
  },
  {
    change: 'adding a value to an Open Enum',
    from: anOpenEnum(...sizes),
    to: anOpenEnum(...sizes, 'c'),
    found: [found({ kind: 'value-added', value: 'c', enum: 'open' }, addsOnly)],
  },
  {
    change: 'removing a value from an Open Enum',
    from: anOpenEnum(...sizes, 'c'),
    to: anOpenEnum(...sizes),
    found: [found({ kind: 'value-removed', value: 'c' }, acceptsLess)],
  },
  {
    change: 'opening a closed enum',
    from: aClosedEnum(...sizes),
    to: anOpenEnum(...sizes),
    found: [found({ kind: 'enum-opened' }, opensTheEnum)],
  },
  {
    change: 'closing an Open Enum',
    from: anOpenEnum(...sizes),
    to: aClosedEnum(...sizes),
    found: [found({ kind: 'enum-closed' }, closesTheEnum)],
  },
  {
    change: 'widening a literal to an enum containing it',
    from: aClosedEnum('a'),
    to: aClosedEnum(...sizes),
    found: [found({ kind: 'value-added', value: 'b', enum: 'closed' }, guaranteesLess)],
  },
  {
    change: 'widening an enum to its base type',
    from: aClosedEnum(...sizes),
    to: aString,
    found: [found({ kind: 'enum-widened', to: 'string' }, guaranteesLess)],
  },
  {
    change: 'widening an enum to a nullable base type, which also adds nullability',
    from: aClosedEnum(...sizes),
    to: { type: 'string', nullable: true },
    found: [
      found({ kind: 'nullability-added' }, guaranteesLess),
      found({ kind: 'enum-widened', to: 'string' }, guaranteesLess),
    ],
  },
  {
    change: 'widening a literal to its base type',
    from: aClosedEnum(7),
    to: aNumber,
    found: [found({ kind: 'enum-widened', to: 'number' }, guaranteesLess)],
  },
  {
    change: 'narrowing a base type to an enum',
    from: aString,
    to: aClosedEnum(...sizes),
    found: [found({ kind: 'enum-narrowed', from: 'string' }, acceptsLess)],
  },
  {
    change: 'narrowing an enum to one of its literals',
    from: aClosedEnum(...sizes),
    to: aClosedEnum('a'),
    found: [found({ kind: 'value-removed', value: 'b' }, acceptsLess)],
  },
  {
    change: 'changing a literal, which adds a value and removes one',
    from: aClosedEnum('a'),
    to: aClosedEnum('b'),
    found: [
      found({ kind: 'value-removed', value: 'a' }, acceptsLess),
      found({ kind: 'value-added', value: 'b', enum: 'closed' }, guaranteesLess),
    ],
  },
  {
    change: 'opening an enum while adding a value, judged by the Baseline’s closed enum',
    from: aClosedEnum('a'),
    to: anOpenEnum('a', 'b'),
    found: [
      found({ kind: 'enum-opened' }, opensTheEnum),
      found({ kind: 'value-added', value: 'b', enum: 'closed' }, guaranteesLess),
    ],
  },
  {
    change: 'closing an enum while adding a value, judged by the Baseline’s Open Enum',
    from: anOpenEnum('a'),
    to: aClosedEnum('a', 'b'),
    found: [
      found({ kind: 'enum-closed' }, closesTheEnum),
      found({ kind: 'value-added', value: 'b', enum: 'open' }, addsOnly),
    ],
  },
  {
    change: 'turning an enum into a string with a constraint, which is a type change',
    from: aClosedEnum(...sizes),
    to: { type: 'string', min: 1 },
    found: [found({ kind: 'type-changed', from: 'enum', to: 'string' }, breaksEverywhere)],
  },
  {
    change: 'turning a string with a constraint into an enum, which is a type change',
    from: { type: 'string', format: 'uuid' },
    to: aClosedEnum(...sizes),
    found: [found({ kind: 'type-changed', from: 'string', to: 'enum' }, breaksEverywhere)],
  },
  {
    change: 'turning an enum of strings and numbers into a string, which is a type change',
    from: aClosedEnum('a', 1),
    to: aString,
    found: [found({ kind: 'type-changed', from: 'enum', to: 'string' }, breaksEverywhere)],
  },
  {
    change: 'turning an enum of strings into a number, which is a type change',
    from: aClosedEnum(...sizes),
    to: aNumber,
    found: [found({ kind: 'type-changed', from: 'enum', to: 'number' }, breaksEverywhere)],
  },
  {
    change: 'turning true into "true", which are different values',
    from: aClosedEnum(true),
    to: aClosedEnum('true'),
    found: [
      found({ kind: 'value-added', value: 'true', enum: 'closed' }, guaranteesLess),
      found({ kind: 'value-removed', value: true }, acceptsLess),
    ],
  },
  {
    change: 'widening the booleans to a boolean',
    from: aClosedEnum(false, true),
    to: aBoolean,
    found: [found({ kind: 'enum-widened', to: 'boolean' }, guaranteesLess)],
  },
];

describe('compatibilityReportOf, enums and literals', () => {
  test.each(casesOf(enumRows))('$change is $outcome in $place', expectRow);

  test.each(
    casesOf([
      {
        change: 'changing only an enum’s description',
        from: { type: 'enum', values: sizes, open: false, description: 'Sizes' },
        to: { type: 'enum', values: sizes, open: false, description: 'The sizes' },
        found: [found(annotationChanged('description'), neutralEverywhere)],
      },
    ]),
  )('$change is $outcome in $place', expectRow);
});

const plainUnion = (...options: readonly SchemaNode[]): SchemaNode => ({ type: 'union', options });
const withKinds = { card: { last4: required(aString) }, bank: {} };

const unionRows: readonly Row[] = [
  {
    change: 'adding a variant to a discriminated union',
    from: aTagged('kind', { card: {} }),
    to: aTagged('kind', { bank: {}, card: {} }),
    found: [found({ kind: 'variant-added' }, guaranteesLess, ['variants', '"bank"'])],
  },
  {
    change: 'removing a variant from a discriminated union',
    from: aTagged('kind', { bank: {}, card: {} }),
    to: aTagged('kind', { card: {} }),
    found: [found({ kind: 'variant-removed' }, acceptsLess, ['variants', '"bank"'])],
  },
  {
    change: 'adding a required field inside a variant, matched by discriminator value',
    from: aTagged('kind', { bank: {}, card: {} }),
    to: aTagged('kind', { bank: {}, card: { last4: required(aString) } }),
    found: [
      found({ kind: 'field-added', required: true }, acceptsLess, [
        'variants',
        '"card"',
        'fields',
        'last4',
      ]),
    ],
  },
  {
    change: 'changing a variant’s value, which is a removal and an addition',
    from: aTagged('kind', { card: {} }),
    to: aTagged('kind', { credit: {} }),
    found: [
      found({ kind: 'variant-removed' }, acceptsLess, ['variants', '"card"']),
      found({ kind: 'variant-added' }, guaranteesLess, ['variants', '"credit"']),
    ],
  },
  {
    change: 'renaming the discriminator, with nothing inside compared',
    from: aTagged('kind', withKinds),
    to: aTagged('type', { card: {}, bank: { iban: required(aString) } }),
    found: [found({ kind: 'discriminator-changed', from: 'kind', to: 'type' }, breaksEverywhere)],
  },
  {
    change: 'turning a discriminated union into a plain union',
    from: aTagged('kind', { card: {} }),
    to: plainUnion(aString, aNumber),
    found: [found({ kind: 'type-changed', from: 'tagged', to: 'union' }, breaksEverywhere)],
  },
  {
    change: 'turning a plain union into a discriminated union',
    from: plainUnion(aString, aNumber),
    to: aTagged('kind', { card: {} }),
    found: [found({ kind: 'type-changed', from: 'union', to: 'tagged' }, breaksEverywhere)],
  },
  {
    change: 'changing a plain union’s options',
    from: plainUnion(aString, aNumber),
    to: plainUnion(aString, aBoolean),
    found: [found({ kind: 'union-changed' }, breaksEverywhere)],
  },
  {
    change: 'reordering a plain union’s options, since the first option that parses wins',
    from: plainUnion(aString, aNumber),
    to: plainUnion(aNumber, aString),
    found: [found({ kind: 'union-changed' }, breaksEverywhere)],
  },
  {
    change: 'adding nullability to a plain union, which is no change of its options',
    from: plainUnion(aString, aNumber),
    to: { type: 'union', options: [aString, aNumber], nullable: true },
    found: [found({ kind: 'nullability-added' }, guaranteesLess)],
  },
];

describe('compatibilityReportOf, unions', () => {
  test.each(casesOf(unionRows))('$change is $outcome in $place', expectRow);

  test.each(
    casesOf([
      {
        change: 'a plain union whose options differ only in descriptions',
        from: plainUnion(
          { type: 'string', description: 'a' },
          { type: 'number', description: 'z' },
        ),
        to: plainUnion({ type: 'string', description: 'z' }, { type: 'number', description: 'a' }),
        found: [found(annotationChanged('description'), neutralEverywhere)],
      },
      {
        change: 'a plain union whose options differ only in examples and origin',
        from: plainUnion({ type: 'string', examples: ['a'], origin: 'local' }, { type: 'number' }),
        to: plainUnion(
          { type: 'string', examples: ['b'], origin: '@org/x@1#id' },
          { type: 'number' },
        ),
        found: [
          found(annotationChanged('examples'), neutralEverywhere),
          found(annotationChanged('origin'), neutralEverywhere),
        ],
      },
    ]),
  )('$change is $outcome in $place', expectRow);

  test.each(
    casesOf([
      {
        change: 'an intersection whose items differ only in descriptions',
        from: {
          type: 'allOf',
          items: [
            { type: 'number', description: 'a' },
            { type: 'string', description: 'z' },
          ],
        },
        to: {
          type: 'allOf',
          items: [
            { type: 'number', description: 'z' },
            { type: 'string', description: 'a' },
          ],
        },
        found: [found(annotationChanged('description'), neutralEverywhere)],
      },
    ]),
  )('$change is $outcome in $place', expectRow);
});

type Constraint = Extract<ShapeDifference, { kind: 'constraint-tightened' }>['constraint'];

function tightened(constraint: Constraint): ShapeDifference {
  return { kind: 'constraint-tightened', constraint };
}

function relaxed(constraint: Constraint): ShapeDifference {
  return { kind: 'constraint-relaxed', constraint };
}

function replaced(constraint: 'format' | 'regex' | 'multipleOf'): ShapeDifference {
  return { kind: 'constraint-replaced', constraint };
}

function aStringWith(constraints: Omit<StringNode, 'type'>): StringNode {
  return { type: 'string', ...constraints };
}

function aNumberWith(constraints: Omit<NumberNode, 'type'>): NumberNode {
  return { type: 'number', ...constraints };
}

function aRow(
  change: string,
  ...nodesAndDifferences: [from: SchemaNode, to: SchemaNode, ...differences: Found[]]
): Row {
  const [from, to, ...differences] = nodesAndDifferences;
  return { change, from, to, found: differences };
}

function shapesOf(report: ComparedReport): readonly (ShapeDifference | string)[] {
  return report.changes.map(({ difference }) =>
    difference.kind === 'schema' ? difference.shape : difference.kind,
  );
}

const startsWithA = { source: '^a', flags: '' };

const stringRows: readonly Row[] = [
  aRow(
    'adding a min length',
    aString,
    aStringWith({ min: 1 }),
    found(tightened('lower-bound'), acceptsLess),
  ),
  aRow(
    'raising a min length',
    aStringWith({ min: 1 }),
    aStringWith({ min: 2 }),
    found(tightened('lower-bound'), acceptsLess),
  ),
  aRow(
    'lowering a min length',
    aStringWith({ min: 2 }),
    aStringWith({ min: 1 }),
    found(relaxed('lower-bound'), guaranteesLess),
  ),
  aRow(
    'removing a max length',
    aStringWith({ max: 5 }),
    aString,
    found(relaxed('upper-bound'), guaranteesLess),
  ),
  aRow(
    'making an exact length a range',
    aStringWith({ min: 3, max: 3 }),
    aStringWith({ min: 3, max: 5 }),
    found(relaxed('upper-bound'), guaranteesLess),
  ),
  aRow(
    'adding a format',
    aString,
    aStringWith({ format: 'email' }),
    found(tightened('format'), acceptsLess),
  ),
  aRow(
    'removing a format',
    aStringWith({ format: 'email' }),
    aString,
    found(relaxed('format'), guaranteesLess),
  ),
  aRow(
    'replacing a format',
    aStringWith({ format: 'email' }),
    aStringWith({ format: 'url' }),
    found(replaced('format'), breaksEverywhere),
  ),
  aRow(
    'changing a format’s options',
    aStringWith({ format: 'datetime', formatOptions: { offset: true } }),
    aStringWith({ format: 'datetime', formatOptions: { precision: 3 } }),
    found(replaced('format'), breaksEverywhere),
  ),
  aRow(
    'adding a regex',
    aString,
    aStringWith({ regex: startsWithA }),
    found(tightened('regex'), acceptsLess),
  ),
  aRow(
    'removing a regex',
    aStringWith({ regex: startsWithA }),
    aString,
    found(relaxed('regex'), guaranteesLess),
  ),
  aRow(
    'changing a regex’s flags only',
    aStringWith({ regex: startsWithA }),
    aStringWith({ regex: { source: '^a', flags: 'i' } }),
    found(replaced('regex'), breaksEverywhere),
  ),
];

const numberRows: readonly Row[] = [
  aRow(
    'making a min an exclusiveMin of the same value',
    aNumberWith({ min: 5 }),
    aNumberWith({ exclusiveMin: 5 }),
    found(tightened('lower-bound'), acceptsLess),
  ),
  aRow(
    'making an exclusiveMin a min of the same value',
    aNumberWith({ exclusiveMin: 5 }),
    aNumberWith({ min: 5 }),
    found(relaxed('lower-bound'), guaranteesLess),
  ),
  aRow(
    'moving a min down to an exclusiveMin below it',
    aNumberWith({ min: 5 }),
    aNumberWith({ exclusiveMin: 4 }),
    found(relaxed('lower-bound'), guaranteesLess),
  ),
  aRow(
    'lowering a max',
    aNumberWith({ max: 10 }),
    aNumberWith({ max: 5 }),
    found(tightened('upper-bound'), acceptsLess),
  ),
  aRow(
    'raising a max',
    aNumberWith({ max: 5 }),
    aNumberWith({ max: 10 }),
    found(relaxed('upper-bound'), guaranteesLess),
  ),
  aRow(
    'making a max an exclusiveMax of the same value',
    aNumberWith({ max: 10 }),
    aNumberWith({ exclusiveMax: 10 }),
    found(tightened('upper-bound'), acceptsLess),
  ),
  aRow('adding int', aNumber, aNumberWith({ int: true }), found(tightened('int'), acceptsLess)),
  aRow('removing int', aNumberWith({ int: true }), aNumber, found(relaxed('int'), guaranteesLess)),
  aRow(
    'adding a multipleOf',
    aNumber,
    aNumberWith({ multipleOf: 2 }),
    found(tightened('multipleOf'), acceptsLess),
  ),
  aRow(
    'removing a multipleOf',
    aNumberWith({ multipleOf: 2 }),
    aNumber,
    found(relaxed('multipleOf'), guaranteesLess),
  ),
  aRow(
    'moving a multipleOf to a multiple of it',
    aNumberWith({ multipleOf: 2 }),
    aNumberWith({ multipleOf: 4 }),
    found(tightened('multipleOf'), acceptsLess),
  ),
  aRow(
    'moving a multipleOf to a divisor of it',
    aNumberWith({ multipleOf: 4 }),
    aNumberWith({ multipleOf: 2 }),
    found(relaxed('multipleOf'), guaranteesLess),
  ),
  aRow(
    'moving a multipleOf to a number that is neither a multiple nor a divisor',
    aNumberWith({ multipleOf: 2 }),
    aNumberWith({ multipleOf: 3 }),
    found(replaced('multipleOf'), breaksEverywhere),
  ),
  aRow(
    'moving a multipleOf from cents to five cents',
    aNumberWith({ multipleOf: 0.01 }),
    aNumberWith({ multipleOf: 0.05 }),
    found(tightened('multipleOf'), acceptsLess),
  ),
  aRow(
    'moving a multipleOf from five cents to cents',
    aNumberWith({ multipleOf: 0.05 }),
    aNumberWith({ multipleOf: 0.01 }),
    found(relaxed('multipleOf'), guaranteesLess),
  ),
  aRow(
    'moving a multipleOf to a multiple of it written in exponent form',
    aNumberWith({ multipleOf: 1e-7 }),
    aNumberWith({ multipleOf: 2e-7 }),
    found(tightened('multipleOf'), acceptsLess),
  ),
  aRow(
    'moving a multipleOf to a multiple that floating point cannot divide exactly',
    aNumberWith({ multipleOf: 0.1 }),
    aNumberWith({ multipleOf: 0.3 }),
    found(tightened('multipleOf'), acceptsLess),
  ),
  aRow(
    'moving a multipleOf from 3 to 0.3, a divisor with a decimal fraction',
    aNumberWith({ multipleOf: 3 }),
    aNumberWith({ multipleOf: 0.3 }),
    found(relaxed('multipleOf'), guaranteesLess),
  ),
  aRow(
    'moving a multipleOf from 0.3 to 3, a multiple with no decimal fraction',
    aNumberWith({ multipleOf: 0.3 }),
    aNumberWith({ multipleOf: 3 }),
    found(tightened('multipleOf'), acceptsLess),
  ),
  aRow(
    'moving a multipleOf from 0.25 to 0.5',
    aNumberWith({ multipleOf: 0.25 }),
    aNumberWith({ multipleOf: 0.5 }),
    found(tightened('multipleOf'), acceptsLess),
  ),
  aRow(
    'moving a multipleOf from 0 to 2, which admits more than 0 alone',
    aNumberWith({ multipleOf: 0 }),
    aNumberWith({ multipleOf: 2 }),
    found(relaxed('multipleOf'), guaranteesLess),
  ),
  aRow(
    'moving a multipleOf from 2 to 0',
    aNumberWith({ multipleOf: 2 }),
    aNumberWith({ multipleOf: 0 }),
    found(tightened('multipleOf'), acceptsLess),
  ),
  aRow(
    'swapping a multipleOf of 1 for int, which mean the same',
    aNumberWith({ multipleOf: 1 }),
    aNumberWith({ int: true }),
    found(tightened('int'), acceptsLess),
    found(relaxed('multipleOf'), guaranteesLess),
  ),
];

const unchangedConstraints: readonly { readonly constraint: string; readonly node: SchemaNode }[] =
  [
    { constraint: 'min', node: aNumberWith({ min: 5 }) },
    { constraint: 'exclusiveMin', node: aNumberWith({ exclusiveMin: 5 }) },
    { constraint: 'max', node: aNumberWith({ max: 5 }) },
    { constraint: 'exclusiveMax', node: aNumberWith({ exclusiveMax: 5 }) },
    { constraint: 'multipleOf', node: aNumberWith({ multipleOf: 5 }) },
    { constraint: 'int', node: aNumberWith({ int: true }) },
    { constraint: 'min length', node: aStringWith({ min: 5 }) },
    {
      constraint: 'format',
      node: aStringWith({ format: 'datetime', formatOptions: { offset: true } }),
    },
    { constraint: 'regex', node: aStringWith({ regex: startsWithA }) },
  ];

describe('compatibilityReportOf, constraints', () => {
  test.each(casesOf([...stringRows, ...numberRows]))('$change is $outcome in $place', expectRow);

  test.each(
    unchangedConstraints.flatMap((unchanged) =>
      places.map((place) => ({ ...unchanged, place: place.name, where: place })),
    ),
  )('an unchanged $constraint is no Change in $place', ({ node, where }) => {
    const report = reportOf(where, { from: node, to: node });

    expect(report).toEqual({ changes: [] });
  });

  test.each(places)(
    'tightening one constraint and relaxing another leaves a Breaking Change in $name',
    (place) => {
      const from = aStringWith({ min: 1, max: 5 });
      const to = aStringWith({ min: 2, max: 9 });

      const report = reportOf(place, { from, to });

      expect(report.changes.map(({ class: changeClass }) => changeClass)).toContain(
        place.breaking.class,
      );
    },
  );

  test('a string’s constraints come in order: format, regex, lower bound, upper bound', () => {
    const to = aStringWith({ format: 'email', regex: startsWithA, min: 1, max: 5 });

    const report = reportOf(input, { from: aString, to });

    expect(shapesOf(report)).toEqual([
      tightened('format'),
      tightened('regex'),
      tightened('lower-bound'),
      tightened('upper-bound'),
    ]);
  });

  test('a number’s constraints come in order: int, lower bound, upper bound, multipleOf', () => {
    const to = aNumberWith({ int: true, min: 0, max: 9, multipleOf: 3 });

    const report = reportOf(input, { from: aNumber, to });

    expect(shapesOf(report)).toEqual([
      tightened('int'),
      tightened('lower-bound'),
      tightened('upper-bound'),
      tightened('multipleOf'),
    ]);
  });

  test('a nullability change comes before the constraints', () => {
    const to: SchemaNode = { ...aStringWith({ min: 1 }), nullable: true };

    const report = reportOf(input, { from: aString, to });

    expect(shapesOf(report)).toEqual([{ kind: 'nullability-added' }, tightened('lower-bound')]);
  });

  test.each(places)(
    'a constraint changed deep in a body is found at its path in $name',
    (place) => {
      const from = anObject({ name: required(aStringWith({ min: 1 })) });
      const to = anObject({ name: required(aStringWith({ min: 2 })) });

      const report = reportOf(place, { from, to });

      expect(snapshotPathsOf(report.changes)).toEqual([
        changeAt(place, found(tightened('lower-bound'), acceptsLess, ['fields', 'name'])),
      ]);
    },
  );
});

type Counts = { readonly min?: number; readonly max?: number };

function anArray(items: SchemaNode, counts: Counts = {}): SchemaNode {
  return { type: 'array', items, ...counts };
}

function aRecord(key: StringNode, value: SchemaNode): SchemaNode {
  return { type: 'record', key, value };
}

function aTuple(items: readonly SchemaNode[], rest?: SchemaNode): SchemaNode {
  return rest === undefined ? { type: 'tuple', items } : { type: 'tuple', items, rest };
}

function aNullable(node: SchemaNode): SchemaNode {
  return { ...node, nullable: true };
}

const tree = anObject({ children: required(anArray(aRef('tree'))) });
const treeWithName = anObject({
  children: required(anArray(aRef('tree'))),
  name: required(aString),
});
const tupleChanged: ShapeDifference = { kind: 'unproven', node: 'tuple' };
const nameAdded: ShapeDifference = { kind: 'field-added', required: true };
const treeNameAdded = inDef('tree', found(nameAdded, acceptsLess, ['fields', 'name']));

const collectionRows: readonly Row[] = [
  aRow(
    'adding a min item count',
    anArray(aString),
    anArray(aString, { min: 1 }),
    found(tightened('lower-bound'), acceptsLess),
  ),
  aRow(
    'removing a max item count',
    anArray(aString, { max: 3 }),
    anArray(aString),
    found(relaxed('upper-bound'), guaranteesLess),
  ),
  aRow(
    'changing an array’s item counts and its items, counts first',
    anArray(aString, { max: 3 }),
    anArray(aNumber, { max: 4 }),
    found(relaxed('upper-bound'), guaranteesLess),
    found({ kind: 'type-changed', from: 'string', to: 'number' }, breaksEverywhere, ['items']),
  ),
  aRow(
    'adding a required field in a record’s value',
    aRecord(aString, anObject()),
    aRecord(aString, anObject({ note: required(aString) })),
    found(nameAdded, acceptsLess, ['value', 'fields', 'note']),
  ),
  aRow(
    'making a record’s value nullable',
    aRecord(aString, aString),
    aRecord(aString, aNullable(aString)),
    found({ kind: 'nullability-added' }, guaranteesLess, ['value']),
  ),
  aRow(
    'changing a record’s value type',
    aRecord(aString, aString),
    aRecord(aString, aNumber),
    found({ kind: 'type-changed', from: 'string', to: 'number' }, breaksEverywhere, ['value']),
  ),
  aRow(
    'adding a regex to a record’s key',
    aRecord(aString, aString),
    aRecord(aStringWith({ regex: startsWithA }), aString),
    found(tightened('regex'), acceptsLess, ['key']),
  ),
  aRow(
    'removing a regex from a record’s key',
    aRecord(aStringWith({ regex: startsWithA }), aString),
    aRecord(aString, aString),
    found(relaxed('regex'), guaranteesLess, ['key']),
  ),
  aRow(
    'adding rest to a tuple',
    aTuple([aString]),
    aTuple([aString], aNumber),
    found({ kind: 'rest-added' }, breaksEverywhere, ['rest']),
  ),
  aRow(
    'removing rest from a tuple',
    aTuple([aString], aNumber),
    aTuple([aString]),
    found({ kind: 'rest-removed' }, breaksEverywhere, ['rest']),
  ),
  aRow(
    'making a tuple’s rest nullable',
    aTuple([aString], aNumber),
    aTuple([aString], aNullable(aNumber)),
    found({ kind: 'nullability-added' }, guaranteesLess, ['rest']),
  ),
  aRow(
    'tightening a constraint on a tuple’s rest',
    aTuple([], aString),
    aTuple([], aStringWith({ min: 1 })),
    found(tightened('lower-bound'), acceptsLess, ['rest']),
  ),
  aRow(
    'changing a tuple’s items',
    aTuple([aString]),
    aTuple([aString, aNumber]),
    found(tupleChanged, breaksEverywhere),
  ),
  aRow(
    'making a tuple’s item nullable',
    aTuple([aString]),
    aTuple([aNullable(aString)]),
    found(tupleChanged, breaksEverywhere),
  ),
  aRow(
    'changing a tuple’s items and its rest, items first',
    aTuple([aString], aString),
    aTuple([aNumber], aStringWith({ min: 1 })),
    found(tupleChanged, breaksEverywhere),
    found(tightened('lower-bound'), acceptsLess, ['rest']),
  ),
  {
    change: 'changing a def a tuple’s rest names',
    from: aTuple([], aRef('tree')),
    to: aTuple([], aRef('tree')),
    fromDefs: { tree },
    toDefs: { tree: treeWithName },
    found: [inDef('tree', found(nameAdded, acceptsLess, ['fields', 'name']))],
  },
];

describe('compatibilityReportOf, arrays, records and tuples', () => {
  test.each(casesOf(collectionRows))('$change is $outcome in $place', expectRow);
});

function walkedOf(schema: z.ZodType): SchemaNode {
  const { located } = walkSchemas(
    [
      {
        at: { site: { kind: 'export', name: 'body' }, declaration: undefined, steps: undefined },
        schema,
      },
    ],
    () => undefined,
  );
  const [first] = located;
  if (first?.walked.kind !== 'walked') {
    throw new Error('the schema must be allowed in a Contract');
  }
  return first.walked.value;
}

const intersectionOfObjects = z.intersection(
  z.object({ id: z.string() }),
  z.object({ total: z.number() }),
);

const intersectionRows: readonly Row[] = [
  aRow(
    'changing an intersection’s items',
    { type: 'allOf', items: [aString, aStringWith({ min: 1 })] },
    { type: 'allOf', items: [aString, aStringWith({ min: 2 })] },
    found({ kind: 'unproven', node: 'allOf' }, breaksEverywhere),
  ),
  aRow(
    'adding a field to one side of an intersection of objects',
    walkedOf(intersectionOfObjects),
    walkedOf(
      z.intersection(
        z.object({ id: z.string() }),
        z.object({ total: z.number(), note: z.string() }),
      ),
    ),
    found(nameAdded, acceptsLess, ['fields', 'note']),
  ),
  aRow(
    'turning a string into JSON',
    aString,
    { type: 'json' },
    found({ kind: 'type-changed', from: 'string', to: 'json' }, breaksEverywhere),
  ),
  aRow(
    'turning JSON into a string',
    { type: 'json' },
    aString,
    found({ kind: 'type-changed', from: 'json', to: 'string' }, breaksEverywhere),
  ),
  aRow(
    'making JSON nullable, which it already admits',
    { type: 'json' },
    aNullable({ type: 'json' }),
    found({ kind: 'nullability-added' }, guaranteesLess),
  ),
];

describe('compatibilityReportOf, intersections and opaque JSON', () => {
  test.each(casesOf(intersectionRows))('$change is $outcome in $place', expectRow);

  test.each(places)(
    'an intersection of objects and the object it amounts to are no Change in $name',
    (place) => {
      const merged = z.object({ id: z.string(), total: z.number() });

      const report = reportOf(place, {
        from: walkedOf(intersectionOfObjects),
        to: walkedOf(merged),
      });

      expect(report).toEqual({ changes: [] });
    },
  );

  test.each(places)('an opaque JSON value left as it is is no Change in $name', (place) => {
    const report = reportOf(place, { from: { type: 'json' }, to: { type: 'json' } });

    expect(report).toEqual({ changes: [] });
  });
});

const branch = anObject({ children: required(anArray(aRef('branch'))) });
const leaf = anObject({ id: required(aString) });

const mutualDefs: Defs = {
  first: anObject({ next: required(aRef('second')) }),
  second: anObject({ next: required(aRef('first')) }),
};

const treeContainers: readonly {
  readonly container: string;
  readonly node: SchemaNode;
  readonly changed: Found;
  readonly described: Found;
}[] = [
  {
    container: 'a plain union',
    node: { type: 'union', options: [aRef('tree'), aString] },
    changed: found({ kind: 'union-changed' }, breaksEverywhere),
    described: found(annotationChanged('description'), neutralEverywhere),
  },
  {
    container: 'a record',
    node: aRecord(aString, aRef('tree')),
    changed: treeNameAdded,
    described: inDef('tree', found(annotationChanged('description'), neutralEverywhere)),
  },
  {
    container: 'a tuple',
    node: aTuple([aRef('tree')]),
    changed: found(tupleChanged, breaksEverywhere),
    described: found(annotationChanged('description'), neutralEverywhere),
  },
  {
    container: 'an intersection',
    node: { type: 'allOf', items: [aRef('tree'), aString] },
    changed: found({ kind: 'unproven', node: 'allOf' }, breaksEverywhere),
    described: found(annotationChanged('description'), neutralEverywhere),
  },
];

const containedRows: readonly Row[] = treeContainers.map(({ container, node, changed }) => ({
  change: `changing a def a ref reaches inside ${container}`,
  from: node,
  to: node,
  fromDefs: { tree },
  toDefs: { tree: treeWithName },
  found: [changed],
}));

const childItems = ['fields', 'child', 'fields', 'children', 'items'];
const treeChildren = ['fields', 'children', 'items'];
const inlineChild = anObject({
  child: required(anObject({ children: required(anArray(aString)) })),
});

const refRows: readonly Row[] = [
  {
    change: 'adding a field to a def a ref names',
    from: aRef('tree'),
    to: aRef('tree'),
    fromDefs: { tree },
    toDefs: { tree: treeWithName },
    found: [treeNameAdded],
  },
  {
    change: 'changing a def a ref reaches through another def',
    from: aRef('forest'),
    to: aRef('forest'),
    fromDefs: { forest: anObject({ trees: required(anArray(aRef('tree'))) }), tree },
    toDefs: { forest: anObject({ trees: required(anArray(aRef('tree'))) }), tree: treeWithName },
    found: [treeNameAdded],
  },
  ...containedRows,
  {
    change: 'making a ref nullable where its def is not',
    from: aRef('tree'),
    to: aNullable(aRef('tree')),
    fromDefs: { tree },
    toDefs: { tree },
    found: [found({ kind: 'nullability-added' }, guaranteesLess)],
  },
  {
    change: 'making a ref nullable where the cycle closes',
    from: aRef('tree'),
    to: aRef('tree'),
    fromDefs: { tree },
    toDefs: { tree: anObject({ children: required(anArray(aNullable(aRef('tree')))) }) },
    found: [
      inDef(
        'tree',
        found({ kind: 'nullability-added' }, guaranteesLess, ['fields', 'children', 'items']),
      ),
    ],
  },
  {
    change: 'replacing an inline schema with a ref, whose def is compared with it',
    from: inlineChild,
    to: anObject({ child: required(aRef('tree')) }),
    toDefs: { tree },
    found: [
      found(annotationChanged('id'), neutralEverywhere, ['fields', 'child']),
      inDef('tree', found(annotationChanged('id'), neutralEverywhere, treeChildren)),
      inDef(
        'tree',
        found({ kind: 'type-changed', from: 'string', to: 'object' }, breaksEverywhere),
      ),
    ],
  },
  {
    change: 'replacing a ref with an inline schema, whose def is compared with it',
    from: anObject({ child: required(aRef('tree')) }),
    to: inlineChild,
    fromDefs: { tree },
    found: [
      found(annotationChanged('id'), neutralEverywhere, ['fields', 'child']),
      found(annotationChanged('id'), neutralEverywhere, childItems),
      found({ kind: 'type-changed', from: 'object', to: 'string' }, breaksEverywhere, childItems),
    ],
  },
  {
    change: 'changing a def used at two fields is one Change, at the def',
    from: anObject({ first: required(aRef('tree')), second: required(aRef('tree')) }),
    to: anObject({ first: required(aRef('tree')), second: required(aRef('tree')) }),
    fromDefs: { tree },
    toDefs: { tree: treeWithName },
    found: [treeNameAdded],
  },
  {
    change: 'replacing two uses of a def with separate, identical inline copies, at both fields',
    from: anObject({ a: required(aRef('leaf')), b: required(aRef('leaf')) }),
    to: anObject({ a: required(aLeafWithName()), b: required(aLeafWithName()) }),
    fromDefs: { leaf },
    found: [
      found(annotationChanged('id'), neutralEverywhere, ['fields', 'a']),
      found(nameAdded, acceptsLess, ['fields', 'a', 'fields', 'name']),
      found(annotationChanged('id'), neutralEverywhere, ['fields', 'b']),
      found(nameAdded, acceptsLess, ['fields', 'b', 'fields', 'name']),
    ],
  },
  {
    change: 'changing a def that is a discriminated union’s variant',
    from: aTagged('kind', { card: {} }),
    to: { ...aTagged('kind', {}), variants: { '"card"': aRefVariant('card') } },
    toDefs: { card: anObject({ kind: required(aClosedEnum('card')), last4: required(aString) }) },
    found: [
      found(annotationChanged('id'), neutralEverywhere, ['variants', '"card"']),
      inDef('card', found(nameAdded, acceptsLess, ['fields', 'last4'])),
    ],
  },
  {
    change: 'changing a def a discriminated union reaches again through its own variant',
    from: aNodeTagged(),
    to: aNodeTagged(),
    fromDefs: { node: aNodeDef({}) },
    toDefs: { node: aNodeDef({ label: required(aString) }) },
    found: [inDef('node', found(nameAdded, acceptsLess, ['fields', 'label']))],
  },
];

function aLeafWithName(): ObjectNode {
  return anObject({ id: required(aString), name: required(aString) });
}

function aRefVariant(name: string): { readonly type: 'ref'; readonly name: string } {
  return { type: 'ref', name };
}

function aNodeTagged(): SchemaNode {
  return { type: 'tagged', discriminator: 'kind', variants: { '"node"': aRefVariant('node') } };
}

function aNodeDef(extra: Readonly<Record<string, Field>>): ObjectNode {
  const fields = { kind: required(aClosedEnum('node')), child: optional(aNodeTagged()), ...extra };
  return anObject(fields);
}

function denseDefs(size: number, lastFields: Readonly<Record<string, Field>> = {}): Defs {
  const names = Array.from({ length: size }, (_, index) => `def${index}`);
  const fields = Object.fromEntries(names.map((name) => [name, required(aRef(name))]));
  const defs = names.map((name, index) => {
    const own = index === size - 1 ? { ...fields, ...lastFields } : fields;
    return [name, anObject(own)];
  });
  return Object.fromEntries(defs);
}

const sprawl = anObject(
  Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [`child${index}`, required(aRef('sprawl'))]),
  ),
);

const selfReferring = anObject({ f: optional(aString), c: optional(aRef('node')) });
const kField = ['fields', 'k'];
const idChanged = found(annotationChanged('id'), neutralEverywhere, kField);
const idChangedIn = (def: string, at: Path = []) =>
  inDef(def, found(annotationChanged('id'), neutralEverywhere, at));

function aBodyWith(fields: Readonly<Record<string, SchemaNode>>): ObjectNode {
  const entries = Object.entries(fields).map(([name, schema]) => [name, required(schema)]);
  return anObject(Object.fromEntries(entries));
}

type RefAnnotations = Pick<RefNode, 'description' | 'examples' | 'origin'>;

function anAliasOf(name: string, annotations: RefAnnotations): RefNode {
  return { type: 'ref', name, ...annotations };
}

function anAliasAnnotationRow(
  change: string,
  annotation: 'description' | 'examples' | 'origin',
  annotations: { readonly from: RefAnnotations; readonly to: RefAnnotations },
): Row {
  return {
    change,
    from: aBodyWith({ k: aRef('alias') }),
    to: aBodyWith({ k: aRef('alias') }),
    fromDefs: { node: selfReferring, alias: anAliasOf('node', annotations.from) },
    toDefs: { node: selfReferring, alias: anAliasOf('node', annotations.to) },
    found: [inDef('alias', found(annotationChanged(annotation), neutralEverywhere))],
  };
}

const variantCard = anObject({ kind: required(aClosedEnum('a')) });
const plainCard = anObject({ f: optional(aString) });
const aliasVariant: SchemaNode = {
  type: 'tagged',
  discriminator: 'kind',
  variants: { '"a"': aRefVariant('alias') },
};

const aliasRows: readonly Row[] = [
  {
    change: 'pointing a ref at the def its alias names, met earlier in the schema',
    from: aBodyWith({ g: aRef('node'), k: aRef('alias') }),
    to: aBodyWith({ g: aRef('node'), k: aRef('node') }),
    fromDefs: { node: selfReferring, alias: aRef('node') },
    toDefs: { node: selfReferring },
    found: [idChanged, idChangedIn('node')],
  },
  {
    change: 'pointing a ref at an alias of the def it named, met earlier in the schema',
    from: aBodyWith({ g: aRef('node'), k: aRef('node') }),
    to: aBodyWith({ g: aRef('node'), k: aRef('alias') }),
    fromDefs: { node: selfReferring },
    toDefs: { node: selfReferring, alias: aRef('node') },
    found: [idChanged, idChangedIn('alias')],
  },
  {
    change: 'pointing an array’s items at the def their alias names, met earlier in the schema',
    from: aBodyWith({ g: aRef('node'), k: anArray(aRef('alias')) }),
    to: aBodyWith({ g: aRef('node'), k: anArray(aRef('node')) }),
    fromDefs: { node: selfReferring, alias: aRef('node') },
    toDefs: { node: selfReferring },
    found: [
      found(annotationChanged('id'), neutralEverywhere, [...kField, 'items']),
      idChangedIn('node'),
    ],
  },
  anAliasAnnotationRow('changing an alias def’s description', 'description', {
    from: { description: 'x' },
    to: { description: 'y' },
  }),
  anAliasAnnotationRow('describing an alias def', 'description', {
    from: {},
    to: { description: 'y' },
  }),
  anAliasAnnotationRow('giving an alias def examples', 'examples', {
    from: {},
    to: { examples: [1] },
  }),
  anAliasAnnotationRow('giving an alias def an origin', 'origin', {
    from: {},
    to: { origin: 'local' },
  }),
  {
    change: 'pointing an alias def at a renamed def of the same shape',
    from: aBodyWith({ k: aRef('alias') }),
    to: aBodyWith({ k: aRef('alias') }),
    fromDefs: { node: selfReferring, alias: aRef('node') },
    toDefs: {
      renamed: anObject({ f: optional(aString), c: optional(aRef('renamed')) }),
      alias: aRef('renamed'),
    },
    found: [idChangedIn('alias'), idChangedIn('renamed', ['fields', 'c'])],
  },
  {
    change: 'shortening a chain of alias defs',
    from: aBodyWith({ k: aRef('outer') }),
    to: aBodyWith({ k: aRef('outer') }),
    fromDefs: { node: selfReferring, outer: aRef('middle'), middle: aRef('node') },
    toDefs: { node: selfReferring, outer: aRef('node') },
    found: [idChangedIn('outer'), idChangedIn('node')],
  },
  {
    change: 'turning a def into an alias of a def of the same shape',
    from: aBodyWith({ k: aRef('alias') }),
    to: aBodyWith({ k: aRef('alias') }),
    fromDefs: { alias: anObject({ f: optional(aString) }) },
    toDefs: { alias: aRef('node'), node: anObject({ f: optional(aString) }) },
    found: [idChangedIn('alias')],
  },
  {
    change: 'describing an alias def a variant names',
    from: aliasVariant,
    to: aliasVariant,
    fromDefs: { card: variantCard, alias: aRef('card') },
    toDefs: { card: variantCard, alias: anAliasOf('card', { description: 'A card' }) },
    found: [inDef('alias', found(annotationChanged('description'), neutralEverywhere))],
  },
  {
    change: 'writing a nullable ref’s def inline, nullable',
    from: aBodyWith({ k: aNullable(aRef('card')) }),
    to: aBodyWith({ k: aNullable(plainCard) }),
    fromDefs: { card: plainCard },
    toDefs: {},
    found: [idChanged],
  },
  {
    change: 'naming a nullable schema written inline as a def',
    from: aBodyWith({ k: aNullable(plainCard) }),
    to: aBodyWith({ k: aNullable(aRef('card')) }),
    fromDefs: {},
    toDefs: { card: plainCard },
    found: [idChanged],
  },
  {
    change: 'writing a nullable ref’s alias chain inline, nullable',
    from: aBodyWith({ k: aNullable(aRef('alias')) }),
    to: aBodyWith({ k: aNullable(plainCard) }),
    fromDefs: { alias: aRef('card'), card: plainCard },
    toDefs: {},
    found: [idChanged],
  },
  {
    change: 'making a ref nullable while its def gains a description',
    from: aBodyWith({ k: aRef('node') }),
    to: aBodyWith({ k: aNullable(aRef('node')) }),
    fromDefs: { node: selfReferring },
    toDefs: { node: { ...selfReferring, description: 'x' } },
    found: [
      found({ kind: 'nullability-added' }, guaranteesLess, kField),
      inDef('node', found(annotationChanged('description'), neutralEverywhere)),
    ],
  },
];

/** A schema as `generate` writes it, with the defs its `ref`s name. */
function walkedWithDefsOf(schema: z.ZodType): { readonly node: SchemaNode; readonly defs: Defs } {
  const walked = walkSchemas(
    [
      {
        at: { site: { kind: 'export', name: 'body' }, declaration: undefined, steps: undefined },
        schema,
      },
    ],
    () => undefined,
  );
  const [first] = walked.located;
  if (first?.walked.kind !== 'walked') {
    throw new Error('the schema must be allowed in a Contract');
  }
  return { node: first.walked.value, defs: walked.defs };
}

function anOuterAlias(annotations: { readonly description?: string }): z.ZodType {
  const inner: z.ZodType = z
    .lazy(() => z.object({ children: z.array(outer) }))
    .meta({ id: 'inner' });
  const outer: z.ZodType = z.lazy(() => inner).meta({ id: 'outer', ...annotations });
  return outer;
}

describe('compatibilityReportOf, refs', () => {
  test.each(casesOf(aliasRows))('$change is $outcome in $place', expectRow);

  test.each(places)(
    'describing an alias def zod declares is one description, in $name',
    (place) => {
      const from = walkedWithDefsOf(anOuterAlias({}));
      const to = walkedWithDefsOf(anOuterAlias({ description: 'x' }));

      const report = reportOf(place, {
        from: from.node,
        to: to.node,
        fromDefs: from.defs,
        toDefs: to.defs,
      });

      const described = found(annotationChanged('description'), neutralEverywhere);
      expect(snapshotPathsOf(report.changes)).toEqual([changeAt(place, inDef('outer', described))]);
    },
  );

  test('a ref made nullable through an alias def is nullability added', () => {
    const defs: Defs = { alias: aRef('target'), target: anObject({ v: required(aString) }) };

    const report = reportOf(input, {
      from: anObject({ x: required(aRef('alias')) }),
      to: anObject({ x: required({ ...aRef('alias'), nullable: true }) }),
      fromDefs: defs,
      toDefs: defs,
    });

    expect(snapshotPathsOf(report.changes)).toEqual([
      changeAt(input, found({ kind: 'nullability-added' }, guaranteesLess, ['fields', 'x'])),
    ]);
  });

  test('a def reached through two alias defs at two paths is one Change, at the def', () => {
    const aliases: Defs = { first: aRef('target'), second: aRef('target') };
    const body = anObject({ x: required(aRef('first')), y: required(aRef('second')) });

    const report = reportOf(input, {
      from: body,
      to: body,
      fromDefs: { ...aliases, target: anObject({ v: required(aBoolean) }) },
      toDefs: { ...aliases, target: anObject({ v: required(aString) }) },
    });

    const changed = { kind: 'type-changed', from: 'boolean', to: 'string' } as const;
    expect(snapshotPathsOf(report.changes)).toEqual([
      changeAt(input, inDef('target', found(changed, breaksEverywhere, ['fields', 'v']))),
    ]);
  });

  test.each(casesOf(refRows))('$change is $outcome in $place', expectRow);

  test.each(places)('a change in a recursive def is found once, at the def, in $name', (place) => {
    const report = reportOf(place, {
      from: aRef('tree'),
      to: aRef('tree'),
      fromDefs: { tree },
      toDefs: { tree: treeWithName },
    });

    expect(snapshotPathsOf(report.changes)).toEqual([changeAt(place, treeNameAdded)]);
  });

  test.each(places)(
    'a field added before the one that reaches a recursive def moves none of the def’s Changes, in $name',
    (place) => {
      const alone = anObject({ b: required(aRef('tree')) });
      const reachedSooner = anObject({ a: required(aRef('tree')), b: required(aRef('tree')) });
      const defs = { from: { tree }, to: { tree: treeWithName } };

      const before = reportOf(place, {
        from: alone,
        to: alone,
        fromDefs: defs.from,
        toDefs: defs.to,
      });
      const after = reportOf(place, {
        from: reachedSooner,
        to: reachedSooner,
        fromDefs: defs.from,
        toDefs: defs.to,
      });

      expect(snapshotPathsOf(after.changes)).toEqual(snapshotPathsOf(before.changes));
      expect(snapshotPathsOf(after.changes)).toEqual([changeAt(place, treeNameAdded)]);
    },
  );

  test('a def that an Endpoint’s Input and Success both reach, changed, is one Change in each Position', () => {
    const body = anObject({ node: required(aRef('tree')) });
    const endpoint = anEndpointReading(body, body);
    const baseline = aBaseline({ defs: { tree }, endpoints: { 'POST /orders': aLive(endpoint) } });
    const proposed = aProposed({
      defs: { tree: treeWithName },
      endpoints: { 'POST /orders': endpoint },
    });

    const report = compatibilityReportOf(baseline, proposed);

    expect(snapshotPathsOf(report.changes)).toEqual([
      changeAt(input, treeNameAdded),
      changeAt(success, treeNameAdded),
    ]);
    expect(report.changes.map(({ class: changeClass }) => changeClass)).toEqual([
      'breaking',
      'additive',
    ]);
  });

  test.each(places)(
    'a ref’s own description is at the ref and its def’s own description at the def, in $name',
    (place) => {
      const described = (description: string): SchemaNode => ({ ...aRef('tree'), description });

      const report = reportOf(place, {
        from: anObject({ k: required(described('a')) }),
        to: anObject({ k: required(described('b')) }),
        fromDefs: { tree },
        toDefs: { tree: { ...tree, description: 'A tree' } },
      });

      const description = found(annotationChanged('description'), neutralEverywhere);
      expect(snapshotPathsOf(report.changes)).toEqual([
        changeAt(place, { ...description, at: ['fields', 'k'] }),
        changeAt(place, inDef('tree', description)),
      ]);
    },
  );

  test.each(places)(
    'a def named like a member every object has is told from defs.constructor, in $name',
    (place) => {
      const recursive = (fields: Readonly<Record<string, Field>>): Defs =>
        Object.fromEntries([
          ['constructor', anObject({ ...fields, next: optional(aRef('constructor')) })],
        ]);

      const report = reportOf(place, {
        from: aRef('constructor'),
        to: aRef('constructor'),
        fromDefs: recursive({}),
        toDefs: recursive({ name: required(aString) }),
      });

      const [change] = report.changes;
      const added = inDef('constructor', found(nameAdded, acceptsLess, ['fields', 'name']));
      expect(snapshotPathsOf(report.changes)).toEqual([changeAt(place, added)]);
      expect(change?.difference).toMatchObject({ def: 'constructor' });
      expect(change === undefined ? null : pathOf(change)).toBe('defs.constructor.name');
    },
  );

  test.each(places)(
    'two inline schemas moved into one recursive def report a Difference they share once, in $name',
    (place) => {
      const inline = (type: SchemaNode) => anObject({ x: required(type) });
      const moved = anObject({ a: required(aRef('shared')), b: required(aRef('shared')) });
      const sharedDef: Defs = {
        shared: anObject({ x: required(aBoolean), self: optional(aRef('shared')) }),
      };

      const report = reportOf(place, {
        from: anObject({ a: required(inline(aString)), b: required(inline(aNumber)) }),
        to: moved,
        toDefs: sharedDef,
      });

      const retyped = (from: 'string' | 'number') =>
        inDef(
          'shared',
          found({ kind: 'type-changed', from, to: 'boolean' }, breaksEverywhere, ['fields', 'x']),
        );
      const selfAdded = inDef(
        'shared',
        found({ kind: 'field-added', required: false }, addsOnly, ['fields', 'self']),
      );
      expect(snapshotPathsOf(report.changes)).toEqual([
        changeAt(place, {
          ...found(annotationChanged('id'), neutralEverywhere),
          at: ['fields', 'a'],
        }),
        changeAt(place, selfAdded),
        changeAt(place, retyped('string')),
        changeAt(place, {
          ...found(annotationChanged('id'), neutralEverywhere),
          at: ['fields', 'b'],
        }),
        changeAt(place, retyped('number')),
      ]);
    },
  );

  test('a cycle whose refs fall at different depths on each side ends and finds only the defs’ ids', () => {
    const shallow: Defs = { shallow: anObject({ x: required(aRef('shallow')) }) };
    const deep: Defs = {
      deep: anObject({ x: required(anObject({ x: required(aRef('deep')) })) }),
    };

    const report = reportOf(input, {
      from: aRef('shallow'),
      to: anObject({ x: required(aRef('deep')) }),
      fromDefs: shallow,
      toDefs: deep,
    });

    expect(snapshotPathsOf(report.changes)).toEqual([
      changeAt(input, found(annotationChanged('id'), neutralEverywhere)),
      changeAt(input, found(annotationChanged('id'), neutralEverywhere, ['fields', 'x'])),
      changeAt(input, idChangedIn('deep', ['fields', 'x'])),
      changeAt(input, idChangedIn('deep', ['fields', 'x', 'fields', 'x'])),
    ]);
  });

  test('a def with twenty refs to itself is compared in one visit of each', () => {
    const report = reportOf(input, {
      from: aRef('sprawl'),
      to: aRef('sprawl'),
      fromDefs: { sprawl },
      toDefs: { sprawl: anObject({ ...sprawl.fields, name: required(aString) }) },
    });

    const nameAddedToSprawl = inDef('sprawl', found(nameAdded, acceptsLess, ['fields', 'name']));
    expect(snapshotPathsOf(report.changes)).toEqual([changeAt(input, nameAddedToSprawl)]);
  });

  test('a dense set of mutually recursive defs, unchanged, is compared fast', () => {
    const defs = denseDefs(12);

    const report = reportOf(input, {
      from: aRef('def0'),
      to: aRef('def0'),
      fromDefs: defs,
      toDefs: defs,
    });

    expect(report).toEqual({ changes: [] });
  });

  test('a dense set of mutually recursive defs with one change gives that one Change', () => {
    const report = reportOf(input, {
      from: aRef('def0'),
      to: aRef('def0'),
      fromDefs: denseDefs(12),
      toDefs: denseDefs(12, { name: required(aString) }),
    });

    expect(snapshotPathsOf(report.changes)).toEqual([
      changeAt(input, inDef('def11', found(nameAdded, acceptsLess, ['fields', 'name']))),
    ]);
  });

  test.each(
    casesOf([
      {
        change: 'pointing a ref at another def of the same shape',
        from: aRef('tree'),
        to: aRef('branch'),
        fromDefs: { tree, branch },
        toDefs: { tree, branch },
        found: [
          found(annotationChanged('id'), neutralEverywhere),
          idChangedIn('branch', ['fields', 'children', 'items']),
        ],
      },
      {
        change: 'renaming a recursive def’s id',
        from: aRef('tree'),
        to: aRef('branch'),
        fromDefs: { tree },
        toDefs: { branch },
        found: [
          found(annotationChanged('id'), neutralEverywhere),
          idChangedIn('branch', ['fields', 'children', 'items']),
        ],
      },
      {
        change: 'pointing a ref at the other def of a mutual recursion of the same shape',
        from: aRef('first'),
        to: aRef('second'),
        fromDefs: mutualDefs,
        toDefs: mutualDefs,
        found: [
          found(annotationChanged('id'), neutralEverywhere),
          idChangedIn('second', ['fields', 'next']),
          idChangedIn('first', ['fields', 'next']),
        ],
      },
      {
        change: 'an alias def on one side only',
        from: aRef('tree'),
        to: aRef('alias'),
        fromDefs: { tree },
        toDefs: { alias: aRef('tree'), tree },
        found: [found(annotationChanged('id'), neutralEverywhere), idChangedIn('alias')],
      },
      {
        change: 'describing a recursive def a ref names',
        from: aRef('tree'),
        to: aRef('tree'),
        fromDefs: { tree },
        toDefs: { tree: { ...tree, description: 'A tree' } },
        found: [inDef('tree', found(annotationChanged('description'), neutralEverywhere))],
      },
    ]),
  )('$change is $outcome in $place', expectRow);

  test.each(
    casesOf(
      treeContainers.map(({ container, node, described }) => ({
        change: `describing a def a ref reaches inside ${container}`,
        from: node,
        to: node,
        fromDefs: { tree },
        toDefs: { tree: { ...tree, description: 'A tree' } },
        found: [described],
      })),
    ),
  )('$change is $outcome in $place', expectRow);

  test.each(places)(
    'renaming a def under a plain union is Breaking in every Position, as in $name',
    (place) => {
      const union = (name: string): SchemaNode => ({
        type: 'union',
        options: [aRef(name), aString],
      });

      const report = reportOf(place, {
        from: union('leaf'),
        to: union('person'),
        fromDefs: { leaf },
        toDefs: { person: leaf },
      });

      expect(snapshotPathsOf(report.changes)).toEqual([
        changeAt(place, found({ kind: 'union-changed' }, breaksEverywhere)),
      ]);
    },
  );

  test.each(places)(
    'a variant that is a ref follows the field rules inside its def in $name',
    (place) => {
      const card = anObject({ kind: required(aClosedEnum('card')) });
      const variants = { '"card"': aRefVariant('card') };
      const tagged: SchemaNode = { type: 'tagged', discriminator: 'kind', variants };

      const report = reportOf(place, {
        from: tagged,
        to: tagged,
        fromDefs: { card },
        toDefs: { card: anObject({ ...card.fields, last4: required(aString) }) },
      });

      expect(snapshotPathsOf(report.changes)).toEqual([
        changeAt(place, inDef('card', found(nameAdded, acceptsLess, ['fields', 'last4']))),
      ]);
    },
  );

  test.each(
    casesOf([
      {
        change: 'a variant that turns from inline to a ref of the same shape',
        from: {
          type: 'tagged',
          discriminator: 'kind',
          variants: { '"card"': anObject({ kind: required(aClosedEnum('card')) }) },
        },
        to: {
          type: 'tagged',
          discriminator: 'kind',
          variants: { '"card"': aRefVariant('card') },
        },
        toDefs: { card: anObject({ kind: required(aClosedEnum('card')) }) },
        found: [found(annotationChanged('id'), neutralEverywhere, ['variants', '"card"'])],
      },
      {
        change: 'a ref written inline as the shape of its def',
        from: aRef('tree'),
        to: anObject({ children: required(anArray(aRef('tree'))) }),
        fromDefs: { tree },
        toDefs: { tree },
        found: [found(annotationChanged('id'), neutralEverywhere)],
      },
    ]),
  )('$change is $outcome in $place', expectRow);

  test.each(places)(
    'a variant that is a ref to an unchanged def is no Change in $name',
    (place) => {
      const card = anObject({ kind: required(aClosedEnum('card')) });
      const variants = { '"card"': aRefVariant('card') };
      const tagged: SchemaNode = { type: 'tagged', discriminator: 'kind', variants };

      const report = reportOf(place, {
        from: tagged,
        to: tagged,
        fromDefs: { card: card },
        toDefs: { card: card },
      });

      expect(report).toEqual({ changes: [] });
    },
  );

  test.each(places)('a change to a def no schema reaches is a bug in $name', (place) => {
    const check = () =>
      reportOf(place, {
        from: aString,
        to: aString,
        fromDefs: { tree: tree },
        toDefs: { tree: treeWithName },
      });

    expect(check).toThrow('The Snapshot changed but no Change was found: a bug.');
  });
});

function schemaChange(position: Position, at: Path, shape: ShapeDifference) {
  return { kind: 'schema', position, at, shape } as const;
}

describe('compatibilityReportOf, Elements’ bodies', () => {
  test('a difference inside a variant is at a step that names the discriminator and the variant', () => {
    const from = aTagged('kind', { card: { last4: required(aString) } });
    const to = aTagged('kind', { card: {} });

    const report = reportOf(input, { from, to });

    const [change] = report.changes;
    expect(change?.difference).toMatchObject({
      at: [
        { kind: 'part', name: 'input' },
        { kind: 'part', name: 'body' },
        { kind: 'variant', discriminator: 'kind', value: '"card"' },
        { kind: 'field', name: 'last4' },
      ],
    });
  });

  test('a Command’s body is read as Message', () => {
    const baseline = aBaseline({ commands: { 'ChargeCard@1': aLive(aCommand(anObject())) } });
    const proposed = aProposed({
      commands: { 'ChargeCard@1': aCommand(anObject({ amount: required(aNumber) })) },
    });

    const report = comparedOf(baseline, proposed);

    const site: ChangeSite = { kind: 'command', identity: 'ChargeCard@1', visibility: 'private' };
    expect(snapshotPathsOf(report.changes)).toEqual([
      {
        site,
        difference: schemaChange('message', ['body', 'fields', 'amount'], {
          kind: 'field-added',
          required: true,
        }),
        class: 'breaking',
        verdict: 'refused',
      },
    ]);
  });

  test('a Breaking Change to an Endpoint’s body needs an Approval', () => {
    const changes = reportOf(input, {
      from: anObject(),
      to: anObject({ amount: required(aNumber) }),
    }).changes;

    expect(changes.map(({ class: changeClass, verdict }) => [changeClass, verdict])).toEqual([
      ['breaking', 'approval-needed'],
    ]);
  });

  test('an Element added has no schema Change', () => {
    const proposed = aProposed({
      endpoints: { 'POST /orders': anEndpointReading(anObject(), null) },
    });

    const report = comparedOf(aBaseline(), proposed);

    expect(report.changes.map(({ difference }) => difference.kind)).toEqual(['added']);
  });

  test('an Element deleted has no schema Change', () => {
    const baseline = aBaseline({
      endpoints: { 'POST /orders': aLive(anEndpointReading(anObject(), null)) },
    });

    const report = comparedOf(baseline, aProposed());

    expect(report.changes.map(({ difference }) => difference.kind)).toEqual(['deleted']);
  });

  test('an Element reusing a Retired identity has no schema Change', () => {
    const baseline = aBaseline({
      events: { 'OrderPlaced@1': { lifecycle: 'retired', retiredIn: '3.0.0' } },
    });
    const proposed = aProposed({ events: { 'OrderPlaced@1': anEvent(anObject()) } });

    const report = comparedOf(baseline, proposed);

    expect(report.changes.map(({ difference }) => difference.kind)).toEqual(['identity-reused']);
  });

  test('an Element’s schema Changes follow its other Changes, the Input body before the Success body', () => {
    const baseline = aBaseline({
      endpoints: { 'POST /orders': aLive(anEndpointReading(anObject(), anObject())) },
    });
    const renamed = anEndpointReading(
      anObject({ amount: required(aNumber) }),
      anObject({ total: required(aNumber) }),
    );
    const proposed = aProposed({
      endpoints: { 'POST /orders': { ...renamed, name: 'placeOrder' } },
    });

    const report = comparedOf(baseline, proposed);

    expect(
      report.changes.map(({ difference }) =>
        difference.kind === 'schema' ? difference.position : difference.kind,
      ),
    ).toEqual(['renamed', 'input', 'success']);
  });
});

type SharedClass =
  | { readonly class: 'additive'; verdict: 'allowed' }
  | { readonly class: 'breaking'; readonly verdict: 'approval-needed' };

function sharedChange(name: string, difference: unknown, rest: SharedClass): PathChange {
  return { site: { kind: 'export', name, visibility: 'public' }, difference, ...rest };
}

describe('compatibilityReportOf, shared schemas', () => {
  test('a shared schema is judged as a Message: a value added to its closed enum is Breaking', () => {
    const baseline = aBaselineDefinitions({
      exports: schemaExports({ currency: aClosedEnum('CLP') }),
    });
    const proposed = aDefinitions({
      exports: schemaExports({ currency: aClosedEnum('CLP', 'USD') }),
    });

    const report = comparedOf(baseline, proposed);

    expect(snapshotPathsOf(report.changes)).toEqual([
      sharedChange(
        'currency',
        schemaChange('message', [], { kind: 'value-added', value: 'USD', enum: 'closed' }),
        { class: 'breaking', verdict: 'approval-needed' },
      ),
    ]);
  });

  test('a Breaking Change to a shared schema needs an Approval', () => {
    const baseline = aBaselineDefinitions({ exports: schemaExports({ money: anObject() }) });
    const proposed = aDefinitions({
      exports: schemaExports({ money: anObject({ cents: required(aNumber) }) }),
    });

    const report = comparedOf(baseline, proposed);

    expect(snapshotPathsOf(report.changes)).toEqual([
      sharedChange(
        'money',
        schemaChange('message', ['fields', 'cents'], { kind: 'field-added', required: true }),
        { class: 'breaking', verdict: 'approval-needed' },
      ),
    ]);
  });

  test('adding a shared schema is Additive', () => {
    const baseline = aBaselineDefinitions({ exports: schemaExports({ money: anObject() }) });
    const proposed = aDefinitions({
      exports: schemaExports({ money: anObject(), page: anObject() }),
    });

    const report = comparedOf(baseline, proposed);

    expect(report.changes).toEqual([
      sharedChange('page', { kind: 'added' }, { class: 'additive', verdict: 'allowed' }),
    ]);
  });

  test('removing a shared schema is Breaking and needs an Approval', () => {
    const baseline = aBaselineDefinitions({
      exports: schemaExports({ money: anObject(), page: anObject() }),
    });
    const proposed = aDefinitions({ exports: schemaExports({ money: anObject() }) });

    const report = comparedOf(baseline, proposed);

    expect(report.changes).toEqual([
      sharedChange('page', { kind: 'removed' }, { class: 'breaking', verdict: 'approval-needed' }),
    ]);
  });

  test('renaming a shared schema is a removal plus an addition', () => {
    const baseline = aBaselineDefinitions({ exports: schemaExports({ money: anObject() }) });
    const proposed = aDefinitions({ exports: schemaExports({ amount: anObject() }) });

    const report = comparedOf(baseline, proposed);

    expect(report.changes).toEqual([
      sharedChange('amount', { kind: 'added' }, { class: 'additive', verdict: 'allowed' }),
      sharedChange('money', { kind: 'removed' }, { class: 'breaking', verdict: 'approval-needed' }),
    ]);
  });

  test('shared schemas’ Changes come by name in code point order', () => {
    const baseline = aBaselineDefinitions({
      exports: schemaExports({
        page: anObject(),
        money: anObject(),
        zone: anObject(),
        amount: anObject(),
      }),
    });
    const proposed = aDefinitions({
      exports: schemaExports({ page: aString, money: aString, zone: aString, amount: aString }),
    });

    const report = comparedOf(baseline, proposed);

    expect(report.changes.map(({ site }) => site.kind === 'export' && site.name)).toEqual([
      'amount',
      'money',
      'page',
      'zone',
    ]);
  });

  test('a shared schema is compared with the defs of its own Definitions Package', () => {
    const baseline = aBaselineDefinitions({
      exports: schemaExports({ forest: aRef('tree') }),
      defs: { tree: tree },
    });
    const proposed = aDefinitions({
      exports: schemaExports({ forest: aRef('tree') }),
      defs: { tree: treeWithName },
    });

    const report = comparedOf(baseline, proposed);

    expect(report.changes.map(({ class: changeClass }) => changeClass)).toEqual(['breaking']);
  });
});

describe('compatibilityReportOf, depth', () => {
  /** `count` defs, each an object holding the next by `next`, the innermost holding `innermost` by `v`. */
  function aDefChainOf(count: number, innermost: SchemaNode): Defs {
    const entries: [string, SchemaNode][] = [];
    for (let index = 0; index < count - 1; index++) {
      entries.push([`def${index}`, anObject({ next: required(aRef(`def${index + 1}`)) })]);
    }
    entries.push([`def${count - 1}`, anObject({ v: required(innermost) })]);
    return Object.fromEntries(entries);
  }

  test('an unchanged Snapshot of 5,000 nested defs has no Change', () => {
    const defs = aDefChainOf(5_000, aBoolean);

    const report = reportOf(input, {
      from: aRef('def0'),
      to: aRef('def0'),
      fromDefs: defs,
      toDefs: defs,
    });

    expect(report).toEqual({ changes: [] });
  });

  test.for([1, 600, 5_000])(
    'a field changed in the innermost of %i nested defs is one Change, at its path',
    (count) => {
      const report = reportOf(input, {
        from: aRef('def0'),
        to: aRef('def0'),
        fromDefs: aDefChainOf(count, aBoolean),
        toDefs: aDefChainOf(count, aString),
      });

      const changed = { kind: 'type-changed', from: 'boolean', to: 'string' } as const;
      const innermost = inDef(`def${count - 1}`, found(changed, breaksEverywhere, ['fields', 'v']));
      expect(snapshotPathsOf(report.changes)).toEqual([changeAt(input, innermost)]);
    },
  );

  test('a ref through 20,000 alias defs is compared as the def it reaches', () => {
    const count = 20_000;
    const aliasesOf = (target: SchemaNode): Defs => {
      const entries: [string, SchemaNode][] = [['target', target]];
      for (let index = 0; index < count; index++) {
        entries.push([`alias${index}`, aRef(index === count - 1 ? 'target' : `alias${index + 1}`)]);
      }
      return Object.fromEntries(entries);
    };

    const report = reportOf(input, {
      from: aRef('alias0'),
      to: aRef('alias0'),
      fromDefs: aliasesOf(anObject({ v: required(aBoolean) })),
      toDefs: aliasesOf(anObject({ v: required(aString) })),
    });

    const changed = { kind: 'type-changed', from: 'boolean', to: 'string' } as const;
    expect(snapshotPathsOf(report.changes)).toEqual([
      changeAt(input, inDef('target', found(changed, breaksEverywhere, ['fields', 'v']))),
    ]);
  });
});

describe('compatibilityReportOf, a long chain of ids', () => {
  const sizes = { small: 2_000, large: 16_000 };

  /** A growth test builds and times its shape up to nine times over, which a CI runner that several runs share stretches several times over. */
  const growthTimeout = 240_000;

  /**
   * `count` defs, each an object on a cycle of its own that holds the one before it by `next`, and
   * the first holds a string; with `holdingOf`, each also holds the one before it by `u`, inside what
   * `holdingOf` makes of it.
   */
  function aChainOf(
    count: number,
    descriptionOf: (index: number) => string,
    holdingOf?: (previous: SchemaNode) => SchemaNode,
  ): Defs {
    const entries: [string, SchemaNode][] = [];
    for (let index = 0; index < count; index++) {
      const next = index === 0 ? aString : aRef(`link${index - 1}`);
      const previous = index === 0 ? aNumber : aRef(`link${index - 1}`);
      const link = anObject({
        self: optional(aRef(`link${index}`)),
        next: required(next),
        ...(holdingOf === undefined ? {} : { u: required(holdingOf(previous)) }),
      });
      entries.push([`link${index}`, { ...link, description: descriptionOf(index) }]);
    }
    return Object.fromEntries(entries);
  }

  /** The check of a chain of `count` defs, as an organization's Definitions Package declares it, against its Baseline. */
  function checkOfChain(
    proposedDescriptionOf: (index: number) => string,
    holdingOf?: (previous: SchemaNode) => SchemaNode,
  ) {
    return (count: number) => {
      const top = aRef(`link${count - 1}`);
      const baseline = shared.baseline(
        top,
        aChainOf(count, () => 'a', holdingOf),
      );
      const proposed = shared.proposed(top, aChainOf(count, proposedDescriptionOf, holdingOf));
      return () => compatibilityReportOf(baseline, proposed);
    };
  }

  test('a chain of ids, each on a cycle of its own, is checked in time that grows with its length', {
    timeout: growthTimeout,
  }, () => {
    const checkChain = checkOfChain(() => 'a');

    const report = checkChain(sizes.large)();
    const order = orderOf(checkChain, sizes, orders.linear);

    expect(report).toEqual({ changes: [] });
    expect(order).toBeLessThan(orders.linear);
  });

  test('a description changed in the innermost def of a chain is one Change, at that def, in time that grows with the chain', {
    timeout: growthTimeout,
  }, () => {
    const checkChain = checkOfChain((index) => (index === 0 ? 'b' : 'a'));

    const report = checkChain(sizes.large)();
    const order = orderOf(checkChain, sizes, orders.linear);

    const described = found(annotationChanged('description'), neutralEverywhere);
    expect(snapshotPathsOf(report.changes)).toEqual([changeAt(shared, inDef('link0', described))]);
    expect(order).toBeLessThan(orders.linear);
  });

  test('an object of many fields, each changed, is checked in time that grows with their number', {
    timeout: growthTimeout,
  }, () => {
    const checkFields = (count: number) => {
      const fieldsOf = (description: string) =>
        anObject(
          Object.fromEntries(
            Array.from({ length: count }, (_, index) => [
              `field${index}`,
              required({ type: 'string', description }),
            ]),
          ),
        );
      const baseline = shared.baseline(fieldsOf('a'), noDefs);
      const proposed = shared.proposed(fieldsOf('b'), noDefs);
      return () => compatibilityReportOf(baseline, proposed);
    };

    const report = checkFields(sizes.large)();
    const order = orderOf(checkFields, sizes, orders.linear);

    expect(report.changes).toHaveLength(sizes.large);
    expect(order).toBeLessThan(orders.linear);
  });

  test('a def that many fields reach, changed, is one Change, at the def, in time that grows with their number', {
    timeout: growthTimeout,
  }, () => {
    const checkFields = (count: number) => {
      const fields = Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`field${index}`, required(aRef('money'))]),
      );
      const defsOf = (description: string): Defs => ({ money: { type: 'string', description } });
      const baseline = shared.baseline(anObject(fields), defsOf('a'));
      const proposed = shared.proposed(anObject(fields), defsOf('b'));
      return () => compatibilityReportOf(baseline, proposed);
    };

    const report = checkFields(sizes.large)();
    const order = orderOf(checkFields, sizes, orders.linear);

    const described = found(annotationChanged('description'), neutralEverywhere);
    expect(snapshotPathsOf(report.changes)).toEqual([changeAt(shared, inDef('money', described))]);
    expect(order).toBeLessThan(orders.linear);
  });
  /** A node that holds another in what the plain-union rule judges: a union's option, a tuple's item or an `allOf`'s item. */
  type Holding = {
    readonly holder: string;
    readonly holdingOf: (held: SchemaNode) => SchemaNode;
    readonly difference: ShapeDifference;
  };

  const holdings: readonly Holding[] = [
    {
      holder: "a plain union's option",
      holdingOf: (held) => ({ type: 'union', options: [held, aBoolean] }),
      difference: { kind: 'union-changed' },
    },
    {
      holder: "a tuple's item",
      holdingOf: (held) => ({ type: 'tuple', items: [held, aBoolean] }),
      difference: { kind: 'unproven', node: 'tuple' },
    },
    {
      holder: 'an intersection with a string',
      holdingOf: (held) => ({ type: 'allOf', items: [held, aString] }),
      difference: { kind: 'unproven', node: 'allOf' },
    },
  ];

  test.each(holdings)(
    'a chain of ids, each reached through $holder, is checked in time that grows with its length',
    {
      timeout: growthTimeout,
    },
    ({ holdingOf }) => {
      const checkChain = checkOfChain(() => 'a', holdingOf);

      const report = checkChain(sizes.large)();
      const order = orderOf(checkChain, sizes, orders.linear);

      expect(report).toEqual({ changes: [] });
      expect(order).toBeLessThan(orders.linear);
    },
  );

  /** The steps of the longest path among a report's Changes, from the site, or from the def that holds them. */
  function longestPathOf(report: ComparedReport): number {
    let longest = 0;
    for (const { difference } of report.changes) {
      longest = Math.max(longest, 'at' in difference ? difference.at.length : 0);
    }
    return longest;
  }

  /** The order of the growth of a report's length as text, from a chain of `sizes.small` defs to one of `sizes.large`. */
  function lengthOrderOf(checkChain: (count: number) => () => ComparedReport): number {
    const lengthOf = (count: number) => JSON.stringify(checkChain(count)()).length;
    return orderOfGrowth(lengthOf(sizes.large) / lengthOf(sizes.small), sizes);
  }

  const described = found(annotationChanged('description'), neutralEverywhere);

  test.each(holdings)(
    'a description changed in the first def of a chain, each def holding the one before it by a field and through $holder, is reported at each def that holds it, from that def, in time and length that grow with the chain',
    {
      timeout: growthTimeout,
    },
    ({ holdingOf }) => {
      const checkChain = checkOfChain((index) => (index === 0 ? 'b' : 'a'), holdingOf);

      const small = checkChain(sizes.small)();
      expect(longestPathOf(small)).toBeLessThanOrEqual(2);
      const report = checkChain(sizes.large)();
      const order = orderOf(checkChain, sizes, orders.linear);
      const lengthOrder = lengthOrderOf(checkChain);

      const heldBy = Array.from({ length: sizes.large - 1 }, (_, index) =>
        inDef(`link${index + 1}`, { ...described, at: ['fields', 'u'] }),
      );
      const expected = [inDef('link0', described), ...heldBy];
      expect(snapshotPathsOf(report.changes)).toEqual(
        expected.map((change) => changeAt(shared, change)),
      );
      expect(order).toBeLessThan(orders.linear);
      expect(lengthOrder).toBeLessThan(orders.linear);
    },
  );

  test('a description changed in every def of a chain is reported at each def, from that def, in time and length that grow with the chain', {
    timeout: growthTimeout,
  }, () => {
    const checkChain = checkOfChain(() => 'b');

    const small = checkChain(sizes.small)();
    expect(longestPathOf(small)).toBeLessThanOrEqual(2);
    const report = checkChain(sizes.large)();
    const order = orderOf(checkChain, sizes, orders.linear);
    const lengthOrder = lengthOrderOf(checkChain);

    const everyDef = Array.from({ length: sizes.large }, (_, index) =>
      changeAt(shared, inDef(`link${sizes.large - 1 - index}`, described)),
    );
    expect(snapshotPathsOf(report.changes)).toEqual(everyDef);
    expect(order).toBeLessThan(orders.linear);
    expect(lengthOrder).toBeLessThan(orders.linear);
  });

  test('many fields of one def that each hold a changed def in a union report one Change each, from that def, in time and length that grow with their number', {
    timeout: growthTimeout,
  }, () => {
    const checkFields = (count: number) => {
      const fields = Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `f${index}`,
          required({ type: 'union', options: [aRef('held'), aBoolean] } as SchemaNode),
        ]),
      );
      const defsOf = (description: string): Defs => ({
        holder: anObject({ ...fields, self: optional(aRef('holder')) }),
        held: { ...anObject({ x: required(aString), self: optional(aRef('held')) }), description },
      });
      const baseline = shared.baseline(aRef('holder'), defsOf('a'));
      const proposed = shared.proposed(aRef('holder'), defsOf('b'));
      return () => compatibilityReportOf(baseline, proposed);
    };

    const small = checkFields(sizes.small)();
    expect(longestPathOf(small)).toBeLessThanOrEqual(2);
    const report = checkFields(sizes.large)();
    const order = orderOf(checkFields, sizes, orders.linear);
    const lengthOrder = lengthOrderOf(checkFields);

    const names = Array.from({ length: sizes.large }, (_, index) => `f${index}`).sort(byCodePoint);
    const atFields = names.map((name) =>
      changeAt(shared, inDef('holder', { ...described, at: ['fields', name] })),
    );
    expect(snapshotPathsOf(report.changes)).toEqual(atFields);
    expect(order).toBeLessThan(orders.linear);
    expect(lengthOrder).toBeLessThan(orders.linear);
  });

  /** `count` objects `c0`, `c1`…, each holding the one before it by `next`, the first a `leaf` and a description. */
  function aFanChainOf(count: number, innermost: { description: string; leaf: SchemaNode }): Defs {
    const entries: [string, SchemaNode][] = [];
    for (let index = 0; index < count; index++) {
      const next = index === 0 ? innermost.leaf : aRef(`c${index - 1}`);
      const link = anObject({ next: required(next) });
      const described = index === 0 ? { ...link, description: innermost.description } : link;
      entries.push([`c${index}`, described]);
    }
    return Object.fromEntries(entries);
  }

  /** The check of an object of `count` fields, each holding the head of a chain of `count` objects, against its Baseline. */
  function checkOfFan(
    holdingOf: Holding['holdingOf'],
    proposedInnermost: { description: string; leaf: SchemaNode },
  ) {
    return (count: number) => {
      const fields = Array.from({ length: count }, (_, index) => [
        `field${index}`,
        required(holdingOf(aRef(`c${count - 1}`))),
      ]);
      const top = anObject(Object.fromEntries(fields));
      const innermost = { description: 'a', leaf: aString };
      const baseline = shared.baseline(top, aFanChainOf(count, innermost));
      const proposed = shared.proposed(top, aFanChainOf(count, proposedInnermost));
      return () => compatibilityReportOf(baseline, proposed);
    };
  }

  /** The Changes of a fan of `count` fields that each report `difference`, at their field. */
  function fanChangesOf(count: number, difference: Found) {
    const names = Array.from({ length: count }, (_, index) => `field${index}`);
    return names
      .sort(byCodePoint)
      .map((name) => changeAt(shared, { ...difference, at: ['fields', name] }));
  }

  test.each(holdings)(
    'many fields that each hold the head of a long chain in $holder, its innermost def’s description changed, report one Neutral Change each, at their field, in time that grows with their number and the chain’s length',
    {
      timeout: growthTimeout,
    },
    ({ holdingOf }) => {
      const checkFan = checkOfFan(holdingOf, { description: 'b', leaf: aString });

      const report = checkFan(sizes.large)();
      const order = orderOf(checkFan, sizes, orders.linear);

      const neutralAtField = found(annotationChanged('description'), neutralEverywhere);
      expect(snapshotPathsOf(report.changes)).toEqual(fanChangesOf(sizes.large, neutralAtField));
      expect(order).toBeLessThan(orders.linear);
    },
  );

  test.each(holdings)(
    'many fields that each hold the head of a long chain in $holder, its innermost def’s shape changed, report one Breaking Change each, at their field, in time that grows with their number and the chain’s length',
    {
      timeout: growthTimeout,
    },
    ({ holdingOf, difference }) => {
      const checkFan = checkOfFan(holdingOf, { description: 'a', leaf: aNumber });

      const report = checkFan(sizes.large)();
      const order = orderOf(checkFan, sizes, orders.linear);

      const breakingAtField = found(difference, breaksEverywhere);
      expect(snapshotPathsOf(report.changes)).toEqual(fanChangesOf(sizes.large, breakingAtField));
      expect(order).toBeLessThan(orders.linear);
    },
  );

  /**
   * The sizes of a shape of `count` roots over a closure of `count` defs: a check that reads the
   * closure again at each root costs their product, so eight times as large costs about 64 times
   * as much. At `sizes` that takes minutes a run.
   */
  const rootSizes = { small: 125, large: 1_000 };

  const unchangedInnermost = { description: 'a', leaf: aString };

  /** `count` exports named `top0`, `top1`…, each holding `held`. */
  function exportsOfCount(count: number, held: SchemaNode) {
    const entries = Array.from({ length: count }, (_, index) => [`top${index}`, held]);
    return schemaExports(Object.fromEntries(entries));
  }

  /** The check of `count` exports that each name the head of a chain of `count` defs, against its Baseline. */
  function checkOfExports(proposedInnermost: { description: string; leaf: SchemaNode }) {
    return (count: number) => {
      const exported = exportsOfCount(count, aRef(`c${count - 1}`));
      const baseline = aBaselineDefinitions({
        defs: aFanChainOf(count, unchangedInnermost),
        exports: exported,
      });
      const proposed = aDefinitions({
        defs: aFanChainOf(count, proposedInnermost),
        exports: exported,
      });
      return () => compatibilityReportOf(baseline, proposed);
    };
  }

  /** The Changes of `count` exports that each report `difference`, in the order a report lists them. */
  function exportChangesOf(count: number, difference: Found) {
    const names = Array.from({ length: count }, (_, index) => `top${index}`).sort(byCodePoint);
    return names.map((name) =>
      changeAt({ ...shared, site: { kind: 'export', name, visibility: 'public' } }, difference),
    );
  }

  test('many exports, each naming the head of one unchanged chain of ids, are checked in time that grows with their number and the chain’s length', {
    timeout: growthTimeout,
  }, () => {
    const checkExports = checkOfExports(unchangedInnermost);

    const report = checkExports(rootSizes.large)();
    const order = orderOf(checkExports, rootSizes, orders.linear);

    expect(report).toEqual({ changes: [] });
    expect(order).toBeLessThan(orders.linear);
  });

  test('many exports, each naming one unchanged def of many fields that each name a def of their own, are checked in time that grows with their number and the def’s width', {
    timeout: growthTimeout,
  }, () => {
    const checkWideExports = (count: number) => {
      const defsOf = (): Defs => {
        const parts = Array.from({ length: count }, (_, index) => [
          `part${index}`,
          anObject({ value: required(aString) }),
        ]);
        const fields = parts.map(([name]) => [name, required(aRef(String(name)))]);
        return { ...Object.fromEntries(parts), wide: anObject(Object.fromEntries(fields)) };
      };
      const exported = exportsOfCount(count, aRef('wide'));
      const baseline = aBaselineDefinitions({ defs: defsOf(), exports: exported });
      const proposed = aDefinitions({ defs: defsOf(), exports: exported });
      return () => compatibilityReportOf(baseline, proposed);
    };

    const report = checkWideExports(rootSizes.large)();
    const order = orderOf(checkWideExports, rootSizes, orders.linear);

    expect(report).toEqual({ changes: [] });
    expect(order).toBeLessThan(orders.linear);
  });

  test('a change at the end of a chain many exports name is reported at each export, at its def', () => {
    const count = 3;
    const checkExports = checkOfExports({ description: 'a', leaf: aNumber });

    const report = checkExports(count)();

    const typeChanged = { kind: 'type-changed', from: 'string', to: 'number' } as const;
    const atEnd = inDef('c0', found(typeChanged, breaksEverywhere, ['fields', 'next']));
    expect(snapshotPathsOf(report.changes)).toEqual(exportChangesOf(count, atEnd));
  });

  test('a change to a Neutral annotation at the end of a chain many exports name is reported at each export', () => {
    const count = 3;
    const checkExports = checkOfExports({ description: 'b', leaf: aString });

    const report = checkExports(count)();

    const described = inDef('c0', found(annotationChanged('description'), neutralEverywhere));
    expect(snapshotPathsOf(report.changes)).toEqual(exportChangesOf(count, described));
  });

  test('a `ref` to an unchanged def still reports its own description and a use’s added nullability', () => {
    const exported = (held: SchemaNode) => schemaExports({ money: held });
    const baseline = aBaselineDefinitions({
      defs: aFanChainOf(2, unchangedInnermost),
      exports: exported(aRef('c1')),
    });
    const proposed = aDefinitions({
      defs: aFanChainOf(2, unchangedInnermost),
      exports: exported({ type: 'ref', name: 'c1', description: 'Money', nullable: true }),
    });

    const report = compatibilityReportOf(baseline, proposed);

    expect(snapshotPathsOf(report.changes)).toEqual([
      changeAt(shared, found(annotationChanged('description'), neutralEverywhere)),
      changeAt(shared, found({ kind: 'nullability-added' }, guaranteesLess)),
    ]);
  });

  test('a `ref` pointed at another def of the same text reports the def name it carries', () => {
    const defs = (): Defs => ({
      first: anObject({ value: required(aString) }),
      second: anObject({ value: required(aString) }),
    });
    const baseline = aBaselineDefinitions({
      defs: defs(),
      exports: schemaExports({ money: aRef('first') }),
    });
    const proposed = aDefinitions({
      defs: defs(),
      exports: schemaExports({ money: aRef('second') }),
    });

    const report = compatibilityReportOf(baseline, proposed);

    expect(snapshotPathsOf(report.changes)).toEqual([
      changeAt(shared, found(annotationChanged('id'), neutralEverywhere)),
    ]);
  });

  test('a `ref` pointed at a def of another shape reports the def name it carries and what differs between the two defs', () => {
    const baseline = aBaselineDefinitions({
      defs: {
        first: anObject({ value: required(aString) }),
        second: anObject({ value: required(aNumber) }),
      },
      exports: schemaExports({ money: aRef('first') }),
    });
    const proposed = aDefinitions({
      defs: {
        first: anObject({ value: required(aString) }),
        second: anObject({ value: required(aNumber) }),
      },
      exports: schemaExports({ money: aRef('second') }),
    });

    const report = compatibilityReportOf(baseline, proposed);

    const typeChanged = { kind: 'type-changed', from: 'string', to: 'number' } as const;
    expect(snapshotPathsOf(report.changes)).toEqual([
      changeAt(shared, found(annotationChanged('id'), neutralEverywhere)),
      changeAt(shared, inDef('second', found(typeChanged, breaksEverywhere, ['fields', 'value']))),
    ]);
  });
});

describe('compatibilityReportOf, the steps of a Change in random nested schemas', () => {
  const seedCount = 1_000;

  /** What a plain union's options and a tuple's items are reported at: the node, not a step in it. */
  const reportedWhole: readonly Construct[] = ['index', 'option'];

  /** An object that gains an optional `y` when proposed, on a cycle of its own when it has an id. */
  function anObjectGainingY(proposed: boolean, id: string | undefined): z.ZodType {
    const fields = proposed ? { x: z.string(), y: z.string().optional() } : { x: z.string() };
    if (id === undefined) {
      return z.object(fields);
    }
    const cycle: z.ZodType = z
      .object({
        ...fields,
        get again() {
          return cycle.optional();
        },
      })
      .meta({ id });
    return cycle;
  }

  /**
   * One random schema drawn twice from a seed, whose every leaf is an object that gains `y`, and a
   * string whose description changes where it is a record's key, with the id of each leaf in the
   * order the generator recorded them: none for a key, and for all when the draw has no ids.
   */
  function aRandomPair(seed: number, hasIds: boolean) {
    const draw = (proposed: boolean) => {
      let leafCount = 0;
      const ids: (string | undefined)[] = [];
      const leaf = (crossing: readonly Construct[]) => {
        if (crossing.at(-1) === 'key') {
          ids.push(undefined);
          return z.string().describe(proposed ? 'b' : 'a');
        }
        const id = hasIds ? `leaf${leafCount++}` : undefined;
        ids.push(id);
        return anObjectGainingY(proposed, id);
      };
      const drawn = randomNested({ next: seededNext(seed), leaf, keysHoldLeaves: true }, 5);
      return { ...drawn, ids };
    };
    return { baseline: draw(false), proposed: draw(true) };
  }

  /**
   * Where the Change of a leaf is reported, from the steps the generator recorded for it: after the
   * place's own, at `y` for an object that gains one, without an intersection's `[i]` since its
   * objects are one, and, across a plain union's option or a tuple's item, at the node before it.
   * An object with an id that gains `y` is reported from its def, `defs.<id>.y`, whatever the steps
   * that reach it.
   */
  function reportedAtOf(place: Place, leaf: Leaf, id: string | undefined) {
    const crossed = leaf.crossing.filter((construct) => construct !== 'optional');
    const constructs = crossed.map((construct, index) => ({ construct, piece: leaf.steps[index] }));
    const wholeAt = constructs.findIndex(({ construct }) => reportedWhole.includes(construct));
    const isWhole = wholeAt !== -1;
    const above = isWhole ? constructs.slice(0, wholeAt) : constructs;
    const written = above.filter(({ construct }) => construct !== 'intersection');
    const placeSteps = place.root.map(
      (segment): Piece => ({ text: String(segment), isField: true }),
    );
    const gainsY = !isWhole && leaf.crossing.at(-1) !== 'key';
    const added: readonly Piece[] = gainsY ? [{ text: 'y', isField: true }] : [];
    const pieces = [...placeSteps, ...written.flatMap(({ piece }) => piece ?? []), ...added];
    const isInDef = gainsY && id !== undefined;
    const path = isInDef ? `defs.${id}.y` : pathTextOf(pieces);
    return { path, isWhole, gainsY };
  }

  /** A random pair compared at one of the places, hopping through a `ref` at each leaf in half of the draws. */
  function aDraw(seed: number) {
    const place = places[seed % places.length] ?? input;
    const hasIds = Math.floor(seed / places.length) % 2 === 0;
    const { baseline, proposed } = aRandomPair(seed, hasIds);
    const from = walkedWithDefsOf(baseline.schema);
    const to = walkedWithDefsOf(proposed.schema);
    const report = comparedOf(
      place.baseline(from.node, from.defs),
      place.proposed(to.node, to.defs),
    );
    const drawn = baseline.leaves.map((leaf, index) =>
      reportedAtOf(place, leaf, baseline.ids[index]),
    );
    const walkedDefs = Object.keys(from.defs).length > 0;
    return { place, walkedDefs, report, drawn, from, to };
  }

  test('every Change sits at the steps its leaf was drawn at, after the place’s own', () => {
    const wrong: string[] = [];
    const kinds = new Set<string>();
    let deepestOwnSteps = 0;
    let changesAtNodes = 0;
    let changesThroughRefs = 0;

    for (let seed = 1; seed <= seedCount; seed++) {
      const { place, walkedDefs, report, drawn } = aDraw(seed);

      const expected = [...new Set(drawn.map(({ path }) => path))].sort();
      const reported = report.changes.map(pathOf).sort();
      if (JSON.stringify(reported) !== JSON.stringify(expected)) {
        wrong.push(
          `seed ${seed} in ${place.name}: ${reported.join(' ')} not ${expected.join(' ')}`,
        );
      }
      for (const { kind } of report.changes.flatMap(stepsOf)) {
        kinds.add(kind);
      }
      for (const change of report.changes) {
        deepestOwnSteps = Math.max(deepestOwnSteps, stepsOf(change).length - place.root.length);
      }
      changesAtNodes += drawn.filter(({ isWhole }) => isWhole).length;
      changesThroughRefs += walkedDefs ? drawn.filter(({ gainsY }) => gainsY).length : 0;
    }

    expect(wrong).toEqual([]);
    expect([...kinds].sort()).toEqual([
      'field',
      'items',
      'key',
      'part',
      'rest',
      'value',
      'variant',
    ]);
    expect(deepestOwnSteps).toBeGreaterThanOrEqual(2);
    expect(changesAtNodes).toBeGreaterThan(0);
    expect(changesThroughRefs).toBeGreaterThan(0);
  });

  /** A body holding `first` by `a`, which comes before `top` in code point order, then `node` by `top`. */
  function enteringFirst(first: string, node: SchemaNode): SchemaNode {
    return anObject({ a: required(aRef(first)), top: required(node) });
  }

  test('a Change inside a recursive schema is the same whichever path reaches the schema first', () => {
    const moved: string[] = [];
    let compared = 0;

    for (let seed = 1; seed <= seedCount; seed++) {
      const { place, report, from, to } = aDraw(seed);
      const insideDefs = report.changes.filter((change) => defOf(change) !== undefined);
      const first = insideDefs.map(defOf)[0];
      if (first === undefined) {
        continue;
      }

      const sooner = comparedOf(
        place.baseline(enteringFirst(first, from.node), from.defs),
        place.proposed(enteringFirst(first, to.node), to.defs),
      );

      const soonerInsideDefs = sooner.changes.filter((change) => defOf(change) !== undefined);
      compared++;
      if (
        JSON.stringify(soonerInsideDefs.map(pathOf).sort()) !==
        JSON.stringify(insideDefs.map(pathOf).sort())
      ) {
        moved.push(`seed ${seed} in ${place.name} when ${first} is reached first`);
      }
    }

    expect(moved).toEqual([]);
    expect(compared).toBeGreaterThan(seedCount / 10);
  });
});

describe('compatibilityReportOf, a Change inside a chain of alias defs in seeded draws', () => {
  const seedCount = 1_000;

  test('a field lost by the object def at the end of a chain of alias defs is one Change, from that def, however many refs name the chain', () => {
    const wrong: string[] = [];
    let named = 0;

    for (let seed = 0; seed < seedCount; seed++) {
      const draw = aliasDrawOf(seed);
      const baseline = publishedSnapshotOf(undefined, draw.baseline, publishedAt('1.0.0'));

      const report = compatibilityReportOf(baseline, draw.proposed);

      const inDefs = report.changes.filter((change) => defOf(change) !== undefined);
      const paths = inDefs.map(pathOf);
      const objectName = draw.isConstructor ? 'constructor' : 'o';
      if (paths.join() !== `defs.${objectName}.q`) {
        wrong.push(`seed ${seed}: ${paths.join(' ')}`);
      }
      named += draw.isConstructor ? 1 : 0;
    }

    expect(wrong).toEqual([]);
    expect(named).toBeGreaterThan(0);
  });
});

describe('compatibilityReportOf, an inner annotation moved between nodes of one shape', () => {
  const described: StringNode = { type: 'string', description: 'a' };
  const describedChanged = [found(annotationChanged('description'), neutralEverywhere)];
  const fieldsAndY = (x: SchemaNode, y: SchemaNode) => anObject({ x: required(x), y: required(y) });

  test.each(
    casesOf([
      {
        change: 'a description moved between two string items of a tuple',
        from: aTuple([described, aString]),
        to: aTuple([aString, described]),
        found: describedChanged,
      },
      {
        change: 'a description moved between two string options of a plain union',
        from: plainUnion(described, aString),
        to: plainUnion(aString, described),
        found: describedChanged,
      },
      {
        change: 'a description moved from inside an array in a tuple’s first item to its second',
        from: aTuple([anArray(described), aString]),
        to: aTuple([anArray(aString), described]),
        found: describedChanged,
      },
      {
        change: 'a description moved between two fields of a def that two union options reach',
        from: plainUnion(aRef('d'), anArray(aRef('d'))),
        to: plainUnion(aRef('d'), anArray(aRef('d'))),
        fromDefs: { d: fieldsAndY(described, aString) },
        toDefs: { d: fieldsAndY(aString, described) },
        found: describedChanged,
      },
      {
        change: 'a description moved between two fields of a def that one union option reaches',
        from: plainUnion(aRef('d'), aNumber),
        to: plainUnion(aRef('d'), aNumber),
        fromDefs: { d: fieldsAndY(described, aString) },
        toDefs: { d: fieldsAndY(aString, described) },
        found: describedChanged,
      },
    ]),
  )('$change is $outcome in $place', expectRow);

  test.each(places)(
    'an intersection of two described strings and one of a string with itself are no Change in $name',
    (place) => {
      const from = walkedOf(z.string().describe('a').and(z.string().describe('b')));
      const to = walkedOf(z.string().describe('a').and(z.string().describe('a')));

      const report = reportOf(place, { from, to });

      expect(report).toEqual({ changes: [] });
      expect(hashedTextOf(place.proposed(to, noDefs))).toBe(
        hashedTextOf(place.proposed(from, noDefs)),
      );
    },
  );
});
