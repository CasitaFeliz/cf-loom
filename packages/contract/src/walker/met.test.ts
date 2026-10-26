import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { walkMeetingSchemas } from './index.ts';

function placeAt(name: string) {
  return { site: { kind: 'export', name }, declaration: undefined, steps: [] } as const;
}

describe('walkMeetingSchemas: where each schema is met', () => {
  test('a schema is met at every place it is reached', () => {
    const shared = z.string();
    const schemas = [
      { at: placeAt('first'), schema: z.object({ a: shared, b: z.array(shared) }) },
      { at: placeAt('second'), schema: shared },
    ];

    const { met } = walkMeetingSchemas(schemas, () => undefined);

    const sites = (met.get(shared) ?? []).map(({ site, steps }) => [site, steps.length]);
    expect(sites).toEqual([
      [{ kind: 'export', name: 'first' }, 1],
      [{ kind: 'export', name: 'first' }, 2],
      [{ kind: 'export', name: 'second' }, 0],
    ]);
  });

  test('a def is met at every place it is reached, those the walk answers from memory included', () => {
    const tree: z.ZodType = z
      .object({
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const schemas = [
      { at: placeAt('first'), schema: tree },
      { at: placeAt('second'), schema: tree },
      { at: placeAt('third'), schema: z.array(tree) },
    ];

    const { met } = walkMeetingSchemas(schemas, () => undefined);

    const names = (met.get(tree) ?? []).map(({ site }) =>
      site.kind === 'export' ? site.name : '',
    );
    expect(names).toEqual(['first', 'first', 'second', 'third']);
  });
});
