import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineEndpoint, defineGuard } from '../index.ts';
import { readingOf } from '../internal/index.ts';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string().min(4) }) },
});

const tenant = defineGuard({
  name: 'tenant',
  description: 'The tenant a request acts for',
  demands: { query: z.object({ tenant: z.string() }) },
});

const addNote = defineEndpoint({
  name: 'addNote',
  method: 'POST',
  path: '/notes/:noteId',
  visibility: 'public',
  description: 'Adds a note',
  guards: [apiKey, tenant],
  input: {
    params: z.object({ noteId: z.string().min(3) }),
    body: z.object({ text: z.string() }),
  },
  success: { status: 204 },
});

const getNote = defineEndpoint({
  name: 'getNote',
  method: 'GET',
  path: '/notes/:noteId',
  visibility: 'public',
  description: 'One note',
  guards: [apiKey, tenant],
  input: { params: z.object({ noteId: z.string().min(3) }) },
  success: { status: 204 },
});

const admitted = {
  headers: { 'x-api-key': 'abcd', 'x-other': 'o' },
  query: { tenant: 't', other: 'o' },
};

/** A source whose every party reads the same text, and whose body is a JSON value. */
function sourceOf(text: Readonly<Record<string, unknown>>, body: unknown = { text: 'hi' }) {
  return {
    textOf: () => text,
    body: () => Promise.resolve({ kind: 'value' as const, value: body }),
  };
}

/** A body port that stops the reading, as a reader stops a body too large to read. */
const stoppingBody = () => Promise.resolve({ kind: 'stopped' as const, answer: 'too large' });

/** A body port that counts how often the reading asks for the body. */
function countedBody() {
  let asked = 0;
  const body = () => {
    asked += 1;
    return Promise.resolve({ kind: 'value' as const, value: { text: 'hi' } });
  };
  return { body, asked: () => asked };
}

describe('readingOf', () => {
  test('a request every Guard admits reads as its Input, each part parsed, unknown keys stripped', async () => {
    const text = { ...admitted, params: { noteId: 'n-1', other: 'o' } };

    const reading = await readingOf(addNote, sourceOf(text, { text: 'hi', other: 'o' }));

    expect(reading).toEqual({
      kind: 'input',
      input: { params: { noteId: 'n-1' }, body: { text: 'hi' } },
    });
  });

  test('the first Guard whose demands fail answers alone, in Attachment order', async () => {
    const text = { headers: { 'x-api-key': 'ab' }, query: {}, params: { noteId: 'n' } };

    const reading = await readingOf(addNote, sourceOf(text));

    expect(reading).toEqual({
      kind: 'invalid',
      issues: [
        {
          part: 'demands.headers',
          path: ['x-api-key'],
          code: 'too_small',
          message: expect.any(String),
        },
      ],
    });
  });

  test('a later Guard’s demands are read once the earlier ones are met, every Guard admitting without a run', async () => {
    const text = { headers: { 'x-api-key': 'abcd' }, query: {}, params: { noteId: 'n' } };

    const reading = await readingOf(addNote, sourceOf(text));

    expect(reading).toMatchObject({
      kind: 'invalid',
      issues: [{ part: 'demands.query', path: ['tenant'], code: 'required' }],
    });
  });

  test('a Guard that does not admit answers before a later Guard’s demands are read', async () => {
    const text = { headers: { 'x-api-key': 'abcd' }, query: {}, params: { noteId: 'n-1' } };
    const source = {
      ...sourceOf(text),
      admit: () => Promise.resolve({ kind: 'stopped' as const, answer: 'UNAUTHENTICATED' }),
    };

    const reading = await readingOf(addNote, source);

    expect(reading).toEqual({ kind: 'stopped', answer: 'UNAUTHENTICATED' });
  });

  test('a Guard’s run is given its demands parsed, unknown keys stripped', async () => {
    const runs: unknown[] = [];
    const source = {
      ...sourceOf({ ...admitted, params: { noteId: 'n-1' } }),
      admit: (index: number, demands: unknown) => {
        runs.push({ index, demands });
        return Promise.resolve({ kind: 'admitted' as const });
      },
    };

    await readingOf(addNote, source);

    expect(runs).toEqual([
      { index: 0, demands: { headers: { 'x-api-key': 'abcd' } } },
      { index: 1, demands: { query: { tenant: 't' } } },
    ]);
  });

  test('a body is not asked for when a Guard’s demands fail', async () => {
    const text = { headers: {}, query: { tenant: 't' }, params: { noteId: 'n-1' } };
    const counted = countedBody();

    await readingOf(addNote, { textOf: () => text, body: counted.body });

    expect(counted.asked()).toBe(0);
  });

  test('a body is not asked for when a Guard’s run stops the request', async () => {
    const text = { ...admitted, params: { noteId: 'n-1' } };
    const counted = countedBody();
    const source = {
      textOf: () => text,
      body: counted.body,
      admit: () => Promise.resolve({ kind: 'stopped' as const, answer: 'UNAUTHENTICATED' }),
    };

    await readingOf(addNote, source);

    expect(counted.asked()).toBe(0);
  });

  test('an Endpoint that declares no body reads as its Input without one', async () => {
    const text = { ...admitted, params: { noteId: 'n-1' } };

    const reading = await readingOf(getNote, sourceOf(text));

    expect(reading).toEqual({ kind: 'input', input: { params: { noteId: 'n-1' } } });
  });

  test('a body is not asked for when the Endpoint declares none', async () => {
    const text = { ...admitted, params: { noteId: 'n-1' } };
    const counted = countedBody();

    await readingOf(getNote, { textOf: () => text, body: counted.body });

    expect(counted.asked()).toBe(0);
  });

  test('a malformed body answers alone at the whole of input.body, with its message, though a param fails too', async () => {
    const text = { ...admitted, params: { noteId: 'n' } };
    const malformed = { kind: 'malformed', message: 'The body is not JSON' } as const;
    const source = { textOf: () => text, body: () => Promise.resolve(malformed) };

    const reading = await readingOf(addNote, source);

    expect(reading).toEqual({
      kind: 'invalid',
      issues: [
        { part: 'input.body', path: [], code: 'malformed', message: 'The body is not JSON' },
      ],
    });
  });

  test('a body the reader stops answers alone, before any part is parsed', async () => {
    const text = { ...admitted, params: { noteId: 'n' } };
    const source = { textOf: () => text, body: stoppingBody };

    const reading = await readingOf(addNote, source);

    expect(reading).toEqual({ kind: 'stopped', answer: 'too large' });
  });

  test('every part of the Input that fails gives its Issues together, the body’s included', async () => {
    const text = { ...admitted, params: { noteId: 'n' } };

    const reading = await readingOf(addNote, sourceOf(text, { text: 1 }));

    expect(reading).toMatchObject({
      kind: 'invalid',
      issues: [
        { part: 'input.params', path: ['noteId'], code: 'too_small' },
        { part: 'input.body', path: ['text'], code: 'invalid_type' },
      ],
    });
  });
});
