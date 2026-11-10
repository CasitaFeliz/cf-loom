import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { orderOf, orders } from '../../test/growth.ts';
import { aRootPackage } from '../../test/root-package.ts';
import { defineEndpoint, defineGroup, defineGuard, defineService } from '../index.ts';
import { validateRoot } from '../internal/index.ts';

/** The Root of a Service whose one Endpoint attaches a Guard with this schema and this Qualifier. */
function rootOf(schema: z.ZodType, qualifier: unknown) {
  const guard = defineGuard({ name: 'scope', description: 'A scope', qualifier: schema });
  const endpoint = defineEndpoint({
    name: 'listOrders',
    method: 'GET',
    path: '/orders',
    visibility: 'public',
    description: 'Every order',
    success: { status: 204 },
    guards: [{ guard, qualifier }],
  });
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [endpoint] });
  return defineService({ name: 'orders-service', groups: [orders] });
}

/** The `qualifier-keys` failures of a Root, each as the number of steps it names. */
function strippedStepCountsOf(root: ReturnType<typeof rootOf>): readonly number[] {
  const validated = validateRoot(root, aRootPackage(root));
  if (validated.kind === 'valid') {
    return [];
  }
  return validated.failures
    .filter((failure) => failure.kind === 'declaration' && failure.rule === 'qualifier-keys')
    .map((failure) => failure.steps.length);
}

/** The steps from the Endpoint to the Qualifier: `guards`, `[0]` and `qualifier`. */
const qualifierSteps = 3;

/** A schema of objects, each holding the next under `next`, which a value goes as deep as zod parses. */
const linked: z.ZodType = z
  .object({ next: z.lazy(() => linked).optional() })
  .meta({ id: 'linked' });

/** A Qualifier `levels` objects deep, holding `extra` at the bottom, and at every level above when `every`. */
function nested(levels: number, every: boolean): object {
  let qualifier: object = { extra: true };
  for (let level = 0; level < levels; level++) {
    qualifier = every ? { extra: true, next: qualifier } : { next: qualifier };
  }
  return qualifier;
}

const wide = { small: 2_500, large: 20_000 };
const deep = { small: 64, large: 512 };

describe('validateRoot: the keys a Qualifier holds that its schema strips', () => {
  test('n stripped keys at one level are n failures, in time that grows linearly with n', () => {
    const keysOf = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, index) => [`k${index}`, index]));
    const rootWith = (count: number) => rootOf(z.object({}), keysOf(count));

    const order = orderOf(
      (size) => {
        const root = rootWith(size);
        return () => validateRoot(root, aRootPackage(root));
      },
      wide,
      orders.linear,
    );

    expect(strippedStepCountsOf(rootWith(wide.small))).toEqual(
      Array.from({ length: wide.small }, () => qualifierSteps + 1),
    );
    expect(order).toBeLessThan(orders.linear);
  });

  test('one stripped key n levels deep is one failure of n steps, in time that grows linearly with n', () => {
    const rootWith = (levels: number) => rootOf(linked, nested(levels, false));

    const order = orderOf(
      (size) => {
        const root = rootWith(size);
        return () => validateRoot(root, aRootPackage(root));
      },
      deep,
      orders.linear,
    );

    expect(strippedStepCountsOf(rootWith(deep.small))).toEqual([qualifierSteps + deep.small + 1]);
    expect(order).toBeLessThan(orders.linear);
  });

  test('a stripped key at each of n levels is n failures sharing their steps, in time that grows with the steps they name', () => {
    const rootWith = (levels: number) => rootOf(linked, nested(levels, true));

    const order = orderOf(
      (size) => {
        const root = rootWith(size);
        return () => validateRoot(root, aRootPackage(root));
      },
      deep,
      orders.polynomial,
    );

    expect(strippedStepCountsOf(rootWith(4))).toEqual([
      qualifierSteps + 1,
      qualifierSteps + 2,
      qualifierSteps + 3,
      qualifierSteps + 4,
      qualifierSteps + 5,
    ]);
    expect(order).toBeLessThan(orders.polynomial);
  });
});
