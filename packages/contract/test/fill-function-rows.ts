import { z } from 'zod';
import {
  asRow,
  checked,
  cyclic,
  freshId,
  rows as namedRows,
  type Reason,
  type Row,
  type Schema,
} from './fill-rows.ts';

/** The refusals `not-allowed.ts` builds by function, which an author writes as a call or a name. */
export type FunctionRefusal =
  | 'objectNameField'
  | 'nonCamelCaseId'
  | 'droppedId'
  | 'wrapperId'
  | 'acyclicId'
  | 'nullableDef'
  | 'checkOnNullable'
  | 'checkOnOptional'
  | 'duplicateId'
  | 'example'
  | 'zodType'
  | 'repeatedCheck'
  | 'stringFormat'
  | 'metaKey'
  | 'examples'
  | 'check'
  | 'regexBuiltFormat';

/** Every construct the walk refuses through a function that words it, by that function. */
export const functionRows = {
  objectNameField: asRow(() => z.object({ constructor: z.string() })),
  nonCamelCaseId: asRow(
    () => cyclic('Bad'),
    () => cyclic(freshId('b')),
  ),
  droppedId: asRow(() => {
    const loop: Schema = z
      .object({
        get next() {
          return loop.optional();
        },
      })
      .meta({ id: freshId('x') })
      .describe('d');
    return loop;
  }),
  wrapperId: asRow(
    () =>
      z
        .string()
        .optional()
        .meta({ id: freshId('w') }),
    () => z.string().optional(),
  ),
  acyclicId: asRow(
    () => z.string().meta({ id: freshId('a') }),
    () => z.string(),
  ),
  nullableDef: asRow(
    () => cyclic(freshId('d'), (object) => object.nullable()),
    () => cyclic(freshId('e')),
  ),
  checkOnNullable: asRow(
    () => checked(z.number().nullable(), z.gte(0)),
    () => z.number().nullable(),
  ),
  checkOnOptional: asRow(
    () => checked(z.number().optional(), z.gte(0)),
    () => z.number().optional(),
  ),
  duplicateId: asRow(
    () => z.union([cyclic('dup'), cyclic('dup')]),
    () => z.union([cyclic(freshId('f')), cyclic(freshId('g'))]),
  ),
  example: asRow(
    () => z.string().meta({ examples: [1] as never }),
    () => z.string(),
  ),
  zodType: asRow(() => {
    const novel = z.string();
    Object.assign(novel._zod.def, { type: 'novel' });
    return novel;
  }),
  repeatedCheck: asRow(
    () => z.string().min(1).min(2),
    () => z.string().min(1),
  ),
  stringFormat: asRow(
    () => z.stringFormat('nope', /a/),
    () => z.string(),
  ),
  metaKey: asRow(
    () => z.string().meta({ unit: 'x' }),
    () => z.string(),
  ),
  examples: asRow(
    () => z.string().meta({ examples: 'a' as never }),
    () => z.string(),
  ),
  check: asRow(
    () => z.string().refine(() => true),
    () => z.string(),
  ),
  regexBuiltFormat: asRow(
    () => z.hex(),
    () => z.string().regex(z.regexes.hex),
  ),
} as const satisfies Record<FunctionRefusal, Row | Reason>;

/** Every row that builds a construct, each with its name. */
export function constructRows(): readonly (readonly [string, Row])[] {
  const entries: [string, Row | Reason][] = Object.entries({ ...namedRows, ...functionRows });
  return entries.filter((entry): entry is [string, Row] => 'make' in entry[1]);
}
