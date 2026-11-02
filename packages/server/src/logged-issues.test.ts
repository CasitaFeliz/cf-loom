import {
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
} from '@cf-loom/contract';
import { admit, handle, success } from '@cf-loom/handlers';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { type ServedFault, serve } from './index.ts';

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
});

const tagged = defineGuard({
  name: 'tagged',
  description: 'Tags the Caller',
  context: z.object({ tags: z.array(z.string().min(5)) }),
  rejections: [unauthenticated],
});

const listTags = defineEndpoint({
  name: 'listTags',
  method: 'GET',
  path: '/tags',
  visibility: 'public',
  description: 'Every tag',
  success: { status: 200, body: z.object({ tags: z.array(z.string().min(5)) }) },
});

const listGuardedTags = defineEndpoint({
  name: 'listGuardedTags',
  method: 'GET',
  path: '/guarded-tags',
  visibility: 'public',
  description: 'Every tag, to a tagged Caller',
  guards: [tagged],
  success: { status: 204 },
});

const contract = defineService({
  name: 'tags-service',
  groups: [
    defineGroup({
      name: 'tags',
      description: 'Tags',
      endpoints: [listTags, listGuardedTags],
    }),
  ],
});

const tooShort = Array(1_000).fill('abc');

const handlers = {
  endpoints: {
    listTags: handle(listTags, () => success(listTags, { tags: tooShort })),
    listGuardedTags: handle(listGuardedTags, () => success(listGuardedTags)),
  },
  guards: { tagged: handle(tagged, () => admit(tagged, { tags: tooShort })) },
};

afterEach(() => {
  vi.restoreAllMocks();
});

function get(path: string): Request {
  return new Request(`http://test${path}`);
}

/** The lines the console gets for the first `count` Issues of 1,000 tags, each too short, after `source`. */
function firstTagIssues(source: string, part: string, count: number): unknown[][] {
  return Array.from({ length: count }, (_, index) => [
    expect.stringContaining(`${source}: ${part}.tags.${index} too_small: `),
  ]);
}

describe('serve: the console lists a Fault’s Issues', () => {
  test('a Success of 1,000 invalid items logs its first 100 Issues and one line counting the other 900', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await serve(contract, handlers, {})(get('/tags'));

    expect(response.status).toBe(500);
    expect(logged.mock.calls).toEqual([
      ...firstTagIssues('listTags', 'success.body', 100),
      ['listTags: 900 more Issues'],
    ]);
  });

  test('a Guard’s Context of 1,000 invalid items logs its first 100 Issues and one line counting the other 900', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await serve(contract, handlers, {})(get('/guarded-tags'));

    expect(response.status).toBe(500);
    expect(logged.mock.calls).toEqual([
      ...firstTagIssues('listGuardedTags tagged', 'context', 100),
      ['listGuardedTags tagged: 900 more Issues'],
    ]);
  });

  test('with onServiceFault, the hook receives every Issue and the console nothing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const faults: ServedFault[] = [];
    const onServiceFault = (served: ServedFault) => void faults.push(served);

    await serve(contract, handlers, { onServiceFault })(get('/tags'));

    expect(faults).toMatchObject([{ kind: 'invalid-outcome' }]);
    expect(faults[0]?.kind === 'invalid-outcome' && faults[0].issues).toHaveLength(1_000);
    expect(logged).not.toHaveBeenCalled();
  });
});
