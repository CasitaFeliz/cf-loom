import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { contextsOf, declaredIn } from '../../test/fill-contexts.ts';
import { constructRows, functionRows } from '../../test/fill-function-rows.ts';
import { rows } from '../../test/fill-rows.ts';
import { judged } from '../../test/fill-twins.ts';
import { walkSchemas } from '../internal/index.ts';

/** The rules over walked nodes, each by a word its line carries. */
const rules = [
  ' nullable-text: ',
  ' not-text: ',
  ' input-conflict: ',
  ' exact-params: ',
  ' not-an-object-schema: ',
  'reaching an openEnum()',
  'zod cannot parse',
  'shared keys differ',
  'key that is not a string',
  'nullable z.record() key',
  'two schemas with',
  'admits null',
  'discriminator',
];

describe('a line told beside a refused construct holds for every schema that replaces it', () => {
  const contexts = contextsOf();
  let judgment: ReturnType<typeof judged> | undefined;
  const verdictOf = () => {
    judgment ??= judged(contexts);
    return judgment;
  };

  test('no line waits on a fix, in every context, for every refused construct', () => {
    expect(verdictOf().violations).toEqual([]);
  });

  test('every construct, every context and every rule over walked nodes is exercised', () => {
    const verdict = verdictOf();
    const unmet = (words: readonly string[]) =>
      words.filter((word) => ![...verdict.told].some((line) => line.includes(word)));

    expect({
      rows: constructRows()
        .map(([name]) => name)
        .filter((name) => !verdict.rows.has(name)),
      contexts: contexts
        .filter((context) => declaredIn(context, z.date()) !== null)
        .map(({ name }) => name)
        .filter((name) => !verdict.contexts.has(name)),
      rules: unmet(rules),
    }).toEqual({ rows: [], contexts: [], rules: [] });
  });

  test('a row that has a schema without its call is a call on a schema, read from the walk', () => {
    const at = {
      site: { kind: 'export', name: 'row' },
      declaration: undefined,
      steps: undefined,
    } as const;
    const isCall = ([, row]: ReturnType<typeof constructRows>[number]) => {
      const schema = z.object({ slot: row.make() as z.ZodType });
      const [located] = walkSchemas([{ at, schema }], () => undefined).located;
      const outline = located?.walked.kind === 'not-allowed' ? located.walked.outline : undefined;
      return outline?.type === 'object' && outline.fields['slot']?.schema.type !== undefined;
    };

    const split = constructRows().map((entry) => ({
      name: entry[0],
      isCall: isCall(entry),
      hasBare: entry[1].bare !== undefined,
    }));

    expect(split.filter(({ isCall: call, hasBare }) => call !== hasBare)).toEqual([]);
    expect(Object.keys({ ...rows, ...functionRows }).length).toBeGreaterThan(80);
  });
});
