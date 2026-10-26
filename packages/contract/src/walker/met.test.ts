import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { walkMeetingSchemas } from './index.ts';

function placeAt(name: string) {
  return { site: { kind: 'export', name }, declaration: undefined, steps: [] } as const;
}

describe('walkMeetingSchemas: where each schema is met', () => {
  test('a schema is met where the walk first reaches it', () => {
    const shared = z.string();
    const schemas = [
      { at: placeAt('first'), schema: z.object({ a: shared, b: z.array(shared) }) },
      { at: placeAt('second'), schema: shared },
    ];

    const { met } = walkMeetingSchemas(schemas, () => undefined);

    const place = met.get(shared);
    expect([place?.site, place?.steps.length]).toEqual([{ kind: 'export', name: 'first' }, 1]);
  });

  test('a def is met where the walk first enters it', () => {
    const tree: z.ZodType = z
      .object({
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const schemas = [
      { at: placeAt('second'), schema: z.array(tree) },
      { at: placeAt('first'), schema: tree },
    ];

    const { met } = walkMeetingSchemas(schemas, () => undefined);

    expect(met.get(tree)?.site).toEqual({ kind: 'export', name: 'second' });
  });
});
