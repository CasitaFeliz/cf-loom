import { z } from 'zod';
import { defineEndpoint, defineEvent, defineGuard } from '../src/index.ts';
import type { Schema } from './fill-rows.ts';

/** What a Root declares: the Endpoints and Events a context puts a schema in. */
export type Declarations = { readonly endpoints: unknown[]; readonly events: unknown[] };

const success = { status: 200, body: z.object({ ok: z.boolean() }) };

function endpoint(fields: Record<string, unknown>): unknown {
  const written = {
    name: 'e',
    method: 'GET',
    path: '/e',
    visibility: 'public',
    description: 'd',
    success,
  };
  return defineEndpoint({ ...written, ...fields } as never);
}

/** Where a schema sits in a Root. */
export type Outer = { readonly name: string; readonly place: (schema: Schema) => Declarations };

const demandingQuery = () =>
  defineGuard({
    name: 'g',
    description: 'g',
    demands: { query: z.object({ q: z.string(), c: z.string() }) },
  });

function anEvent(name: string, body: unknown): unknown {
  return defineEvent({ name, version: 1, visibility: 'internal', description: 'd', body } as never);
}
const demandingHeader = () =>
  defineGuard({
    name: 'g',
    description: 'g',
    demands: { headers: z.object({ 'x-h': z.string() }) },
  });

/** An object on a cycle of its own with a fixed id, so two of them share one. */
function sharingId(id: string, nullable: boolean): Schema {
  const def: Schema = (
    nullable
      ? z.object({ n: z.lazy(() => def).optional() }).nullable()
      : z.object({ n: z.lazy(() => def).optional() })
  ).meta({ id });
  return def;
}

/** Fields a body holds beside the schema, each refused whatever the schema is: they hold the rules apart from it. */
function siblings(): Record<string, Schema> {
  return {
    differing: z.intersection(z.object({ k: z.string() }), z.object({ k: z.number() })),
    duplicate: z.union([sharingId('twin', false), sharingId('twin', false)]),
    nullableDef: sharingId('maybe', true),
  };
}

/** The parts of an Endpoint and the Message body that hold a schema, each beside a rule it breaks whatever the schema is. */
export const outers: readonly Outer[] = [
  {
    name: 'body',
    place: (s) => ({
      endpoints: [endpoint({ success: { status: 200, body: z.object({ s, ...siblings() }) } })],
      events: [],
    }),
  },
  {
    name: 'query',
    place: (s) => ({
      endpoints: [endpoint({ input: { query: z.object({ q: s, n: z.string().nullable() }) } })],
      events: [],
    }),
  },
  {
    name: 'header',
    place: (s) => ({
      endpoints: [endpoint({ input: { headers: z.object({ 'x-h': s }) } })],
      events: [],
    }),
  },
  {
    name: 'param',
    place: (s) => ({
      endpoints: [
        endpoint({ path: '/e/:id', input: { params: z.object({ id: s, extra: z.string() }) } }),
      ],
      events: [],
    }),
  },
  {
    name: 'guardQuery',
    place: (s) => ({
      endpoints: [
        endpoint({
          input: { query: z.object({ q: s, c: z.number() }) },
          guards: [demandingQuery()],
        }),
      ],
      events: [],
    }),
  },
  {
    name: 'guardHeader',
    place: (s) => ({
      endpoints: [
        endpoint({ input: { headers: z.object({ 'x-h': s }) }, guards: [demandingHeader()] }),
      ],
      events: [],
    }),
  },
  {
    name: 'message',
    place: (s) => ({
      endpoints: [],
      events: [anEvent('Ev', s), anEvent('Other', z.string())],
    }),
  },
];
