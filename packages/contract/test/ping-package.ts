import { z } from 'zod';
import { defineGuard, providedEndpoint, providedEvent } from '../src/index.ts';
import { aProvider } from './providers.ts';

/** A Guard the ping-service's `ping` attaches, named as a Guard of the Contract that depends on it may be. */
export const pingKey = defineGuard({ name: 'apiKey', description: 'The ping-service’s API key' });

/** An Endpoint as the ping-service's Contract Package exports it. */
export const ping = providedEndpoint(
  aProvider('ping-service'),
  {
    name: 'ping',
    method: 'GET',
    path: '/ping',
    visibility: 'public',
    description: 'Whether the ping-service is up',
    guards: [pingKey],
    success: { status: 200, body: z.object({ at: z.iso.datetime() }) },
  },
  undefined,
);

/** An Event's Message Version as the ping-service's Contract Package exports it. */
export const pingedV1 = providedEvent('ping-service', {
  name: 'Pinged',
  version: 1,
  visibility: 'internal',
  description: 'The ping-service was pinged',
  body: z.object({ at: z.iso.datetime() }),
});
