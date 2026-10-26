import { z } from 'zod';
import {
  type ContractPackage,
  defineGuard,
  providedEndpoint,
  providedEvent,
} from '../src/index.ts';

/** A Guard the ping-service's `ping` attaches, named as a Guard of the Contract that depends on it may be. */
export const pingKey = defineGuard({ name: 'apiKey', description: 'The ping-service’s API key' });

/** An Endpoint as the ping-service's Contract Package exports it. */
export const ping = providedEndpoint('ping-service', {
  name: 'ping',
  method: 'GET',
  path: '/ping',
  visibility: 'public',
  description: 'Whether the ping-service is up',
  guards: [pingKey],
  success: { status: 200, body: z.object({ at: z.iso.datetime() }) },
});

/** An Event's Message Version as the ping-service's Contract Package exports it. */
export const pingedV1 = providedEvent('ping-service', {
  name: 'Pinged',
  version: 1,
  visibility: 'internal',
  description: 'The ping-service was pinged',
  body: z.object({ at: z.iso.datetime() }),
});

/** The ping-service's Contract Package: what a Consumer imports as `contract`. */
export const pingService = {
  name: 'ping-service',
  version: '1.0.0',
  endpoints: { ping },
  events: { pingedV1 },
  standardRejections: {
    invalidInput: {
      code: 'INVALID_INPUT',
      status: 400,
      message: 'Invalid input',
      body: z.object({ issues: z.array(z.unknown()) }),
    },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;
