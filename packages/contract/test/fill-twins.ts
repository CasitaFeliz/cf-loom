import { z } from 'zod';
import { defineGroup, defineService, openEnum } from '../src/index.ts';
import { failureLineOf, validateRoot } from '../src/internal/index.ts';
import { type Context, declaredIn } from './fill-contexts.ts';
import { constructRows } from './fill-function-rows.ts';
import type { Declarations } from './fill-outers.ts';
import type { Row, Schema } from './fill-rows.ts';
import { aRootPackage } from './root-package.ts';

/** A schema that replaces a refused construct where it sits; `undefined` is the construct removed. */
type Fill = readonly [name: string, make: (() => Schema) | undefined];

let refCount = 0;

/** A fill that is a `ref`: an object on a cycle of its own. */
function aRef(): Schema {
  const def: Schema = z
    .object({
      a: z.string(),
      get next() {
        return def.optional();
      },
    })
    .meta({ id: `f${refCount++}` });
  return def;
}

const tagged = () =>
  z.discriminatedUnion('t', [z.object({ t: z.literal('x') }), z.object({ t: z.literal('y') })]);

/** A fill of every kind a rule over walked nodes tells apart, and the construct removed. */
export const fills: readonly Fill[] = [
  ['string', () => z.string()],
  ['number', () => z.number()],
  ['boolean', () => z.boolean()],
  ['literal', () => z.literal('a')],
  ['enum', () => z.enum(['a', 'b'])],
  ['openEnum', () => openEnum(['a', 'b'])],
  ['emptyObject', () => z.object({})],
  ['openObject', () => z.object({ e: openEnum(['a']) })],
  ['nullableObject', () => z.object({ a: z.string() }).nullable()],
  ['array', () => z.array(z.string())],
  ['tuple', () => z.tuple([z.string()])],
  ['record', () => z.record(z.string(), z.string())],
  ['union', () => z.union([z.object({ a: z.string() }), z.object({ b: z.number() })])],
  ['tagged', tagged],
  [
    'allOf',
    () => z.intersection(z.object({ a: z.string() }), z.union([z.object({}), z.boolean()])),
  ],
  ['nullableString', () => z.string().nullable()],
  ['json', () => z.json()],
  ['ref', aRef],
  ['variantObject', () => z.object({ k: z.literal('c'), w: z.string() })],
  ['removed', undefined],
];

/** The lines `validateRoot` tells of what a context declares: none when it is valid. */
export function linesOf({ endpoints, events }: Declarations): readonly string[] {
  const holding = {
    ...(endpoints.length > 0 && { endpoints }),
    ...(events.length > 0 && { events }),
  };
  const group = defineGroup({ name: 'shapes', description: 'S', ...holding } as never);
  const root = defineService({ name: 'orders-service', groups: [group] });
  const validated = validateRoot(root, aRootPackage(root));
  return validated.kind === 'invalid' ? validated.failures.map(failureLineOf) : [];
}

/** Where a line sits: after the one Endpoint's site, or with the identity of the Message it sits in. */
function locationOf(line: string): string {
  const afterSite = line.replace(/^\S+(?: \S+)? \([^)]*\) /, '');
  if (afterSite !== line) {
    return afterSite.split(' ')[0] ?? '';
  }
  return /^\S+@\d+ \S+/.exec(line)?.[0] ?? '';
}

/** Whether a line sits at the place of the slot or below it. */
function isAtOrBelow(line: string, place: string): boolean {
  const location = locationOf(line);
  return (
    location === place ||
    (location.startsWith(place) && /^[.[<{]/.test(location.slice(place.length)))
  );
}

/** A line by its location and its construct or code, without the wording of what to use instead. */
function keyOf(line: string): string {
  return line.replace(/ \(use [^)]*\)$/, '');
}

/** What each fill leaves in a context, the lines of those that are allowed where they sit. */
function twinsOf(context: Context, place: string): readonly (ReadonlySet<string> | undefined)[] {
  return fills.map(([, fill]) => {
    const declared = declaredIn(context, fill?.());
    return declared === null ? undefined : allowedLinesOf(declared, place);
  });
}

/** The lines of a fill that is allowed where it sits, none when it is itself refused there. */
function allowedLinesOf(declared: Declarations, place: string): ReadonlySet<string> | undefined {
  const lines = linesOf(declared);
  return lines.some((line) => isAtOrBelow(line, place)) ? undefined : new Set(lines.map(keyOf));
}

/** What a run of the twins found: the cases, the validations they cost, and every line that waited on a fix. */
export type Verdict = {
  cases: number;
  runs: number;
  readonly violations: string[];
  readonly rows: Set<string>;
  readonly contexts: Set<string>;
  readonly told: Set<string>;
};

/** One row in one context: its lines beside the construct, and the twins each must hold against. */
type Placed = {
  readonly context: Context;
  readonly name: string;
  readonly row: Row;
  readonly place: string;
};

/** Judges a row in a context against its twins, recording each line that is told for no fill that allows it. */
function judgeRow(placed: Placed, twins: ReturnType<typeof twinsOf>, verdict: Verdict): void {
  const { context, name, row, place } = placed;
  const declared = declaredIn(context, row.make() as Schema);
  if (declared === null) {
    return;
  }
  verdict.runs++;
  const all = linesOf(declared);
  if (!all.some((line) => isAtOrBelow(line, place))) {
    return;
  }
  verdict.cases++;
  verdict.rows.add(name);
  verdict.contexts.add(context.name);
  const bare = row.bare === undefined ? undefined : declaredIn(context, row.bare());
  const against =
    bare === undefined ? twins : [bare === null ? undefined : allowedLinesOf(bare, place)];
  for (const line of all.filter((each) => !isAtOrBelow(each, place)).map(keyOf)) {
    verdict.told.add(line);
    const gone = against.findIndex((twin) => twin !== undefined && !twin.has(line));
    if (gone !== -1) {
      const without = row.bare === undefined ? fills[gone]?.[0] : 'the call removed';
      verdict.violations.push(`${context.name} :: ${name} :: ${line} :: gone with ${without}`);
    }
  }
}

/** Every construct placed in every context: a line told with it must be told for every fill allowed there. */
export function judged(contexts: readonly Context[]): Verdict {
  const verdict: Verdict = {
    cases: 0,
    runs: 0,
    violations: [],
    rows: new Set(),
    contexts: new Set(),
    told: new Set(),
  };
  for (const context of contexts) {
    const sentinel = declaredIn(context, z.date());
    const dateLine =
      sentinel === null ? undefined : linesOf(sentinel).find((line) => line.includes('z.date()'));
    if (dateLine === undefined) {
      continue;
    }
    const place = locationOf(dateLine);
    const twins = twinsOf(context, place);
    verdict.runs += 1 + twins.filter((twin) => twin !== undefined).length;
    for (const [name, row] of constructRows()) {
      if (row.onlyIn === undefined || context.name.endsWith('> variant')) {
        judgeRow({ context, name, row, place }, twins, verdict);
      }
    }
  }
  return verdict;
}
