import type { z } from 'zod';
import { defineEndpoint, defineGroup, defineService } from '../src/index.ts';
import { validateRoot } from '../src/internal/index.ts';
import { aRootPackage } from './root-package.ts';

const ordinals = ['First', 'Second', 'Third'] as const;

/**
 * The Root of a Service whose Endpoints `getFirst`, `getSecond` and `getThird` answer, in order,
 * each of the schemas given as the body of its Success, validated.
 */
export function validatedAnswering(bodies: readonly z.ZodType[]) {
  if (bodies.length === 0 || bodies.length > ordinals.length) {
    throw new Error(`A Service answers one to ${ordinals.length} schemas.`);
  }
  const [first, ...others] = bodies.map((body, position) =>
    defineEndpoint({
      name: `get${ordinals[position]}`,
      method: 'GET',
      path: `/${ordinals[position]?.toLowerCase()}`,
      visibility: 'public',
      description: 'The tree',
      success: { status: 200, body },
    }),
  );
  if (first === undefined) {
    throw new Error('A Service answers one schema or more.');
  }
  const group = defineGroup({ name: 'trees', description: 'Trees', endpoints: [first, ...others] });
  const service = defineService({ name: 'orders-service', groups: [group] });
  return validateRoot(service, aRootPackage(service));
}
