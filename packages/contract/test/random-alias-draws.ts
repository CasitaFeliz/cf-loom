import type { Defs, Field, SchemaNode, ServiceSnapshot } from '../src/internal/index.ts';
import { anObject, aRef, aString, aVersionOf } from './graft-fixtures.ts';
import type { Next } from './random-draft.ts';
import { seededNext } from './random-schemas.ts';

/**
 * Two versions of a Service whose defs are one chain of alias defs ending at an object def, which
 * the next version leaves a field short. The Endpoint's body names every def of the chain, and
 * some more fields each name a point of it, directly, in a union's option or in an array, the
 * `ref`s nullable now and then, the fields in a random order; the next version removes some.
 */
export type AliasDraw = {
  readonly baseline: ServiceSnapshot;
  readonly proposed: ServiceSnapshot;
  /** How many alias defs the chain holds. */
  readonly aliases: number;
  /** How many `ref`s the body asks nullable. */
  readonly nullableAsked: number;
  /** Whether the object def is named `constructor`. */
  readonly isConstructor: boolean;
};

function shuffled<Item>(items: readonly Item[], next: Next): readonly Item[] {
  const rest = [...items];
  const taken: Item[] = [];
  while (rest.length > 0) {
    const [one] = rest.splice(Math.floor(next() * rest.length), 1);
    taken.push(one as Item);
  }
  return taken;
}

/** A chain of `aliases` alias defs `a0`, `a1`… ending at the object def, each sometimes described. */
function aliasDefsOf(objectName: string, aliases: number, next: Next): [string, SchemaNode][] {
  return Array.from({ length: aliases }, (_, index): [string, SchemaNode] => {
    const lower = index === 0 ? objectName : `a${index - 1}`;
    return [`a${index}`, { ...aRef(lower), ...(next() < 0.3 ? { description: 'an alias' } : {}) }];
  });
}

/** The fields of a body that name points of the chain, and how many `ref`s they ask nullable. */
function fieldsNamingPointsOf(points: readonly string[], next: Next) {
  let nullableAsked = 0;
  const pointRef = (): SchemaNode => {
    const name = points[Math.floor(next() * points.length)] as string;
    if (next() >= 0.3) {
      return aRef(name);
    }
    nullableAsked += 1;
    return { type: 'ref', name, nullable: true };
  };
  const shapes: readonly (() => SchemaNode)[] = [
    pointRef,
    () => ({ type: 'union', options: [pointRef(), aString] }),
    () => ({ type: 'array', items: pointRef() }),
  ];
  const drawn = (name: string): [string, Field] => {
    const shape = shapes[Math.floor(next() * shapes.length)] as () => SchemaNode;
    return [name, { required: next() < 0.5, schema: shape() }];
  };
  const named = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => drawn(`${prefix}${index}`));
  const kept = named('k', 1 + Math.floor(next() * 3));
  const gone = named('g', 2 + Math.floor(next() * 4));
  return { kept, gone, nullableAsked };
}

/** The pair of versions a seed draws, the same every run. */
export function aliasDrawOf(seed: number): AliasDraw {
  const next = seededNext(seed * 3571 + 17);
  const aliases = 1 + Math.floor(next() * 5);
  const objectName = next() < 0.15 ? 'constructor' : 'o';
  const aliasDefs = aliasDefsOf(objectName, aliases, next);
  const points = [objectName, ...aliasDefs.map(([name]) => name)];
  const { kept, gone, nullableAsked } = fieldsNamingPointsOf(points, next);
  const named = points.map((name): [string, Field] => [
    `r_${name}`,
    { required: true, schema: aRef(name) },
  ]);
  const objectOf = (fields: readonly string[]) =>
    anObject(Object.fromEntries(fields.map((name) => [name, { required: true, schema: aString }])));
  const defsOf = (fields: readonly string[]): Defs => ({
    [objectName]: objectOf(fields),
    ...Object.fromEntries(aliasDefs),
  });
  const bodyOf = (...fields: readonly [string, Field][][]) =>
    anObject(Object.fromEntries(shuffled(fields.flat(), next)));
  return {
    baseline: aVersionOf(bodyOf(named, kept, gone), defsOf(['p', 'q'])),
    proposed: aVersionOf(bodyOf(named, kept), defsOf(['p'])),
    aliases,
    nullableAsked,
    isConstructor: objectName === 'constructor',
  };
}
