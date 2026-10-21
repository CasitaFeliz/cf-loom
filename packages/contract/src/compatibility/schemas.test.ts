import { describe, expect, test } from 'vitest';
import {
  type Change,
  type ChangeSite,
  type CommandSnapshot,
  type ComparedReport,
  compatibilityReportOf,
  type DefinitionsSnapshot,
  type Defs,
  type EndpointSnapshot,
  type EventSnapshot,
  type Field,
  type ObjectNode,
  type Path,
  type Position,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  type SchemaNode,
  type ServiceSnapshot,
  type ShapeDifference,
  type Snapshot,
  type TaggedNode,
} from '../internal/index.ts';

type Class = 'breaking' | 'additive' | 'neutral';
type Value = string | number | boolean;

const breaking = 'breaking';
const additive = 'additive';
const neutral = 'neutral';

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
  guards: {},
  codes: {},
  dependencies: {},
} as const;
const noDefs: Defs = {};
const noBodies = {
  input: { params: null, query: null, headers: null, body: null },
  success: { status: 200, headers: null, body: null },
} as const;

function anEndpoint(fields: Partial<EndpointSnapshot> = {}): EndpointSnapshot {
  return {
    name: 'createOrder',
    group: 'orders',
    visibility: 'public',
    lifecycle: 'active',
    description: 'Places an order',
    params: [],
    guards: [],
    rejections: [],
    ...noBodies,
    ...fields,
  };
}

function anEndpointReading(input: SchemaNode | null, success: SchemaNode | null): EndpointSnapshot {
  return anEndpoint({
    input: { ...noBodies.input, body: input },
    success: { ...noBodies.success, body: success },
  });
}

function anEvent(body: SchemaNode): EventSnapshot {
  return { visibility: 'internal', lifecycle: 'active', description: 'Placed', body };
}

function aCommand(body: SchemaNode): CommandSnapshot {
  return { lifecycle: 'active', description: 'Charge a card', body };
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
    generator: '@cf-loom/cli@2.1.0',
    standardRejections,
    defs: noDefs,
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

const aString: SchemaNode = { type: 'string' };
const aNumber: SchemaNode = { type: 'number' };
const aBoolean: SchemaNode = { type: 'boolean' };

function aLiteral(value: Value): SchemaNode {
  return { type: 'literal', value };
}

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
  return { type: 'object', mode: 'open', fields };
}

function aKeyedRecord(fields: Readonly<Record<string, Field>>): ObjectNode {
  return { type: 'object', mode: 'strict', fields };
}

function aTagged(
  discriminator: string,
  variants: Readonly<Record<string, Readonly<Record<string, Field>>>>,
): TaggedNode {
  const entries = Object.entries(variants).map(([value, fields]) => [
    JSON.stringify(value),
    anObject({ [discriminator]: required(aLiteral(value)), ...fields }),
  ]);
  return { type: 'tagged', discriminator, variants: Object.fromEntries(entries) };
}

function aRef(name: string): SchemaNode {
  return { type: 'ref', name };
}

type Place = {
  readonly name: string;
  readonly position: Position | 'every';
  readonly site: ChangeSite;
  readonly root: Path;
  readonly approval: 'needed' | 'not-needed';
  readonly column: 0 | 1 | 2 | 3;
  readonly baseline: (node: SchemaNode, defs: Defs) => PublishedSnapshot;
  readonly proposed: (node: SchemaNode, defs: Defs) => Snapshot;
};

const input: Place = {
  name: 'Input',
  position: 'input',
  site: { kind: 'endpoint', identity: 'POST /orders', visibility: 'public' },
  root: ['input', 'body'],
  approval: 'needed',
  column: 0,
  baseline: (node, defs) =>
    aBaseline({ defs, endpoints: { 'POST /orders': aLive(anEndpointReading(node, null)) } }),
  proposed: (node, defs) =>
    aProposed({ defs, endpoints: { 'POST /orders': anEndpointReading(node, null) } }),
};
const success: Place = {
  name: 'Success',
  position: 'success',
  site: { kind: 'endpoint', identity: 'POST /orders', visibility: 'public' },
  root: ['success', 'body'],
  approval: 'needed',
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
  approval: 'not-needed',
  column: 2,
  baseline: (node, defs) => aBaseline({ defs, events: { 'OrderPlaced@1': aLive(anEvent(node)) } }),
  proposed: (node, defs) => aProposed({ defs, events: { 'OrderPlaced@1': anEvent(node) } }),
};
const shared: Place = {
  name: 'a shared schema',
  position: 'every',
  site: { kind: 'shared-schema', name: 'money' },
  root: [],
  approval: 'needed',
  column: 3,
  baseline: (node, defs) => aBaselineDefinitions({ defs, schemas: { money: node } }),
  proposed: (node, defs) => aDefinitions({ defs, schemas: { money: node } }),
};
const places = [input, success, message, shared];
const readersOfInput = [input, shared];

/** The classes of one difference in Input, Success, Message and a shared schema, in that order. */
type Classes = readonly [Class, Class, Class, Class];

const acceptsLess: Classes = [breaking, additive, breaking, breaking];
const guaranteesLess: Classes = [additive, breaking, breaking, breaking];
const breaksEverywhere: Classes = [breaking, breaking, breaking, breaking];
const addsOnly: Classes = [additive, additive, additive, additive];
const opensTheEnum: Classes = [neutral, breaking, breaking, breaking];
const closesTheEnum: Classes = [neutral, additive, additive, additive];

type Found = { readonly shape: ShapeDifference; readonly at: Path; readonly classes: Classes };

function found(shape: ShapeDifference, classes: Classes, at: Path = []): Found {
  return { shape, at, classes };
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

function changeAt(place: Place, difference: Found): Change {
  const shapeChange = {
    kind: 'schema',
    position: place.position,
    at: [...place.root, ...difference.at],
    shape: difference.shape,
  } as const;
  const changeClass = difference.classes[place.column];
  return changeClass === 'breaking'
    ? { site: place.site, difference: shapeChange, class: 'breaking', approval: place.approval }
    : { site: place.site, difference: shapeChange, class: changeClass };
}

function comparedOf(baseline: PublishedSnapshot, proposed: Snapshot): ComparedReport {
  const report = compatibilityReportOf(baseline, proposed, []);
  if (report.kind !== 'compared') {
    throw new Error('the Baseline was given, so the report must have compared');
  }
  return report;
}

function reportOf(place: Place, row: Pick<Row, 'from' | 'to' | 'fromDefs' | 'toDefs'>) {
  const baseline = place.baseline(row.from, row.fromDefs ?? noDefs);
  const proposed = place.proposed(row.to, row.toDefs ?? noDefs);
  return comparedOf(baseline, proposed);
}

function casesOf(rows: readonly Row[]) {
  return rows.flatMap((row) =>
    (row.places ?? places).map((place) => ({
      change: row.change,
      place: place.name,
      outcome: row.found.map((difference) => difference.classes[place.column]).join(' and '),
      row,
      where: place,
    })),
  );
}

function expectRow({ row, where }: ReturnType<typeof casesOf>[number]): void {
  const report = reportOf(where, row);

  expect(report.changes).toEqual(row.found.map((difference) => changeAt(where, difference)));
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
    change: 'removing a key from a record keyed by an enum',
    from: aKeyedRecord({ note: required(aString), id: required(aString) }),
    to: aKeyedRecord({ id: required(aString) }),
    found: [found({ kind: 'key-removed' }, breaksEverywhere, noteField)],
    places: readersOfInput,
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
    change: 'turning an object into a record keyed by an enum',
    from: anObject({ id: required(aString) }),
    to: aKeyedRecord({ id: required(aString) }),
    found: [found({ kind: 'mode-changed', from: 'open', to: 'strict' }, breaksEverywhere)],
    places: readersOfInput,
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

  test.each(places)(
    'a change of description, examples or origin alone is no Change in $name',
    (place) => {
      const from: SchemaNode = anObject({
        note: required({ type: 'string', description: 'A note', origin: 'local', examples: ['a'] }),
      });
      const to: SchemaNode = anObject({
        note: required({ type: 'string', description: 'The note', origin: '@org/x@1#note' }),
      });

      const report = reportOf(place, { from, to });

      expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: true });
    },
  );
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
    from: aLiteral('a'),
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
    from: aLiteral(7),
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
    to: aLiteral('a'),
    found: [found({ kind: 'value-removed', value: 'b' }, acceptsLess)],
  },
  {
    change: 'changing a literal, which adds a value and removes one',
    from: aLiteral('a'),
    to: aLiteral('b'),
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
    from: aLiteral(true),
    to: aLiteral('true'),
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

  test.each(places)('changing only an enum’s description is no Change in $name', (place) => {
    const from: SchemaNode = { type: 'enum', values: sizes, open: false, description: 'Sizes' };
    const to: SchemaNode = { type: 'enum', values: sizes, open: false, description: 'The sizes' };

    const report = reportOf(place, { from, to });

    expect(report.changes).toEqual([]);
  });
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
    change: 'adding nullability to a plain union, which is no change of its options',
    from: plainUnion(aString, aNumber),
    to: { type: 'union', options: [aString, aNumber], nullable: true },
    found: [found({ kind: 'nullability-added' }, guaranteesLess)],
  },
];

describe('compatibilityReportOf, unions', () => {
  test.each(casesOf(unionRows))('$change is $outcome in $place', expectRow);

  test.each(places)(
    'a plain union whose options differ only in descriptions is no Change in $name, whatever order they sort in',
    (place) => {
      const withNumberFirst = plainUnion(
        { type: 'number', description: 'a' },
        { type: 'string', description: 'z' },
      );
      const withStringFirst = plainUnion(
        { type: 'string', description: 'a' },
        { type: 'number', description: 'z' },
      );

      const report = reportOf(place, { from: withNumberFirst, to: withStringFirst });

      expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: true });
    },
  );
});

const unprovenRows: readonly Row[] = [
  {
    change: 'adding a constraint to a string',
    from: aString,
    to: { type: 'string', min: 1 },
    found: [found({ kind: 'unproven', node: 'string' }, breaksEverywhere)],
  },
  {
    change: 'changing a number’s constraint',
    from: { type: 'number', min: 0 },
    to: { type: 'number', min: 1 },
    found: [found({ kind: 'unproven', node: 'number' }, breaksEverywhere)],
  },
  {
    change: 'changing an array’s item counts, apart from its items',
    from: { type: 'array', items: aString, max: 3 },
    to: { type: 'array', items: aNumber, max: 4 },
    found: [
      found({ kind: 'unproven', node: 'array' }, breaksEverywhere),
      found({ kind: 'type-changed', from: 'string', to: 'number' }, breaksEverywhere, ['items']),
    ],
  },
  {
    change: 'changing a record’s value',
    from: { type: 'record', key: aString, value: aString },
    to: { type: 'record', key: aString, value: aNumber },
    found: [found({ kind: 'unproven', node: 'record' }, breaksEverywhere)],
  },
  {
    change: 'changing a tuple’s items',
    from: { type: 'tuple', items: [aString] },
    to: { type: 'tuple', items: [aString, aNumber] },
    found: [found({ kind: 'unproven', node: 'tuple' }, breaksEverywhere)],
  },
  {
    change: 'changing an intersection’s items',
    from: { type: 'allOf', items: [aString, { type: 'string', min: 1 }] },
    to: { type: 'allOf', items: [aString, { type: 'string', min: 2 }] },
    found: [found({ kind: 'unproven', node: 'allOf' }, breaksEverywhere)],
  },
  {
    change: 'turning an opaque JSON value into a string',
    from: { type: 'json' },
    to: aString,
    found: [found({ kind: 'type-changed', from: 'json', to: 'string' }, breaksEverywhere)],
  },
];

describe('compatibilityReportOf, what no rule here compares yet', () => {
  test.each(casesOf(unprovenRows))('$change is $outcome in $place', expectRow);

  test.each(places)('an opaque JSON value left as it is is no Change in $name', (place) => {
    const report = reportOf(place, { from: { type: 'json' }, to: { type: 'json' } });

    expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: false });
  });
});

const tree = anObject({ children: required({ type: 'array', items: aRef('tree') }) });
const treeWithName = anObject({
  children: required({ type: 'array', items: aRef('tree') }),
  name: required(aString),
});
const unproven: ShapeDifference = { kind: 'unproven', node: 'ref' };

const refRows: readonly Row[] = [
  {
    change: 'changing a def a ref names',
    from: aRef('tree'),
    to: aRef('tree'),
    fromDefs: { tree: tree },
    toDefs: { tree: treeWithName },
    found: [found(unproven, breaksEverywhere)],
  },
  {
    change: 'changing a def a ref reaches through another def',
    from: aRef('forest'),
    to: aRef('forest'),
    fromDefs: {
      forest: anObject({ trees: required({ type: 'array', items: aRef('tree') }) }),
      tree: tree,
    },
    toDefs: {
      forest: anObject({ trees: required({ type: 'array', items: aRef('tree') }) }),
      tree: treeWithName,
    },
    found: [found(unproven, breaksEverywhere)],
  },
  {
    change: 'pointing a ref at another def',
    from: aRef('tree'),
    to: aRef('branch'),
    fromDefs: { tree: tree },
    toDefs: { branch: tree },
    found: [found(unproven, breaksEverywhere)],
  },
  {
    change: 'replacing an inline schema with a ref',
    from: anObject({
      child: required(anObject({ children: required({ type: 'array', items: aString }) })),
    }),
    to: anObject({ child: required(aRef('tree')) }),
    toDefs: { tree: tree },
    found: [found(unproven, breaksEverywhere, ['fields', 'child'])],
  },
  {
    change: 'changing a ref that is a discriminated union’s variant',
    from: aTagged('kind', { card: {} }),
    to: { ...aTagged('kind', {}), variants: { '"card"': aRefVariant('card') } },
    toDefs: { card: anObject({ kind: required(aLiteral('card')) }) },
    found: [found(unproven, breaksEverywhere, ['variants', '"card"'])],
  },
];

function aRefVariant(name: string): { readonly type: 'ref'; readonly name: string } {
  return { type: 'ref', name };
}

describe('compatibilityReportOf, refs', () => {
  test.each(casesOf(refRows))('$change is $outcome in $place', expectRow);

  test.each(places)('a ref whose def is unchanged is no Change in $name', (place) => {
    const describedTree = { ...tree, description: 'A tree' };

    const report = reportOf(place, {
      from: aRef('tree'),
      to: aRef('tree'),
      fromDefs: { tree: tree },
      toDefs: { tree: describedTree },
    });

    expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: true });
  });

  test.each(places)(
    'a variant that is a ref to an unchanged def is no Change in $name',
    (place) => {
      const card = anObject({ kind: required(aLiteral('card')) });
      const variants = { '"card"': aRefVariant('card') };
      const tagged: SchemaNode = { type: 'tagged', discriminator: 'kind', variants };

      const report = reportOf(place, {
        from: tagged,
        to: tagged,
        fromDefs: { card: card },
        toDefs: { card: card },
      });

      expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: false });
    },
  );

  test.each(places)(
    'a change to a def no compared schema reaches is no Change in $name',
    (place) => {
      const report = reportOf(place, {
        from: aString,
        to: aString,
        fromDefs: { tree: tree },
        toDefs: { tree: treeWithName },
      });

      expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: true });
    },
  );
});

function schemaChange(position: Position | 'every', at: Path, shape: ShapeDifference) {
  return { kind: 'schema', position, at, shape } as const;
}

describe('compatibilityReportOf, Elements’ bodies', () => {
  test('a Command’s body is read as Message', () => {
    const baseline = aBaseline({ commands: { 'ChargeCard@1': aLive(aCommand(anObject())) } });
    const proposed = aProposed({
      commands: { 'ChargeCard@1': aCommand(anObject({ amount: required(aNumber) })) },
    });

    const report = comparedOf(baseline, proposed);

    const site: ChangeSite = { kind: 'command', identity: 'ChargeCard@1' };
    expect(report).toEqual({
      kind: 'compared',
      hashChanged: true,
      changes: [
        {
          site,
          difference: schemaChange('message', ['body', 'fields', 'amount'], {
            kind: 'field-added',
            required: true,
          }),
          class: 'breaking',
          approval: 'not-needed',
        },
      ],
    });
  });

  test('a Breaking Change to an Endpoint’s body needs an Approval', () => {
    const changes = reportOf(input, {
      from: anObject(),
      to: anObject({ amount: required(aNumber) }),
    }).changes;

    expect(changes.map((change) => change.class === 'breaking' && change.approval)).toEqual([
      'needed',
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
  | { readonly class: 'additive' }
  | { readonly class: 'breaking'; readonly approval: 'needed' };

function sharedChange(name: string, difference: Change['difference'], rest: SharedClass): Change {
  return { site: { kind: 'shared-schema', name }, difference, ...rest };
}

describe('compatibilityReportOf, shared schemas', () => {
  test('a Breaking Change to a shared schema needs an Approval', () => {
    const baseline = aBaselineDefinitions({ schemas: { money: anObject() } });
    const proposed = aDefinitions({ schemas: { money: anObject({ cents: required(aNumber) }) } });

    const report = comparedOf(baseline, proposed);

    expect(report).toEqual({
      kind: 'compared',
      hashChanged: true,
      changes: [
        sharedChange(
          'money',
          schemaChange('every', ['fields', 'cents'], { kind: 'field-added', required: true }),
          { class: 'breaking', approval: 'needed' },
        ),
      ],
    });
  });

  test('adding a shared schema is Additive', () => {
    const baseline = aBaselineDefinitions({ schemas: { money: anObject() } });
    const proposed = aDefinitions({ schemas: { money: anObject(), page: anObject() } });

    const report = comparedOf(baseline, proposed);

    expect(report.changes).toEqual([
      sharedChange('page', { kind: 'added' }, { class: 'additive' }),
    ]);
  });

  test('removing a shared schema is Breaking and needs an Approval', () => {
    const baseline = aBaselineDefinitions({ schemas: { money: anObject(), page: anObject() } });
    const proposed = aDefinitions({ schemas: { money: anObject() } });

    const report = comparedOf(baseline, proposed);

    expect(report.changes).toEqual([
      sharedChange('page', { kind: 'removed' }, { class: 'breaking', approval: 'needed' }),
    ]);
  });

  test('renaming a shared schema is a removal plus an addition', () => {
    const baseline = aBaselineDefinitions({ schemas: { money: anObject() } });
    const proposed = aDefinitions({ schemas: { amount: anObject() } });

    const report = comparedOf(baseline, proposed);

    expect(report.changes).toEqual([
      sharedChange('amount', { kind: 'added' }, { class: 'additive' }),
      sharedChange('money', { kind: 'removed' }, { class: 'breaking', approval: 'needed' }),
    ]);
  });

  test('shared schemas’ Changes come by name in code point order', () => {
    const baseline = aBaselineDefinitions({
      schemas: { page: anObject(), money: anObject(), zone: anObject(), amount: anObject() },
    });
    const proposed = aDefinitions({
      schemas: { page: aString, money: aString, zone: aString, amount: aString },
    });

    const report = comparedOf(baseline, proposed);

    expect(report.changes.map(({ site }) => site.kind === 'shared-schema' && site.name)).toEqual([
      'amount',
      'money',
      'page',
      'zone',
    ]);
  });

  test('a shared schema is compared with the defs of its own Definitions Package', () => {
    const baseline = aBaselineDefinitions({
      schemas: { forest: aRef('tree') },
      defs: { tree: tree },
    });
    const proposed = aDefinitions({
      schemas: { forest: aRef('tree') },
      defs: { tree: treeWithName },
    });

    const report = comparedOf(baseline, proposed);

    expect(report.changes.map(({ class: changeClass }) => changeClass)).toEqual(['breaking']);
  });
});
