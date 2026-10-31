import { type GraftTarget, graftedInputOf, readDefsOf } from '../compatibility/index.ts';
import { unbrokenLineOf } from '../lines/index.ts';
import {
  declaredEndpointsOf,
  type FormerInput,
  heldFormerInputsOf,
  type PublishedSnapshot,
} from '../snapshot/index.ts';
import type { Problem } from '../validation/index.ts';
import { canonicalJson } from '../walker/index.ts';

/**
 * Each former Input that is not its own graft onto its Endpoint's query and body, as `publish`
 * writes it, or that grafts no field; to be judged once every name the Snapshot uses is held.
 */
export function formerInputProblemsOf(snapshot: PublishedSnapshot): readonly Problem[] {
  if (snapshot.kind !== 'service') {
    return [];
  }
  const inputs = new Map(
    declaredEndpointsOf(snapshot).map(([identity, { input }]) => [identity, input]),
  );
  const problems: Problem[] = [];
  const onto = readDefsOf(snapshot.defs);
  for (const [index, former] of heldFormerInputsOf(snapshot).entries()) {
    const input = inputs.get(former.endpoint);
    if (input === undefined) {
      throw new Error(
        unbrokenLineOf(`A former Input of ${former.endpoint}, which is not declared: a bug.`),
      );
    }
    const reason = graftProblemOf(former, { ...onto, input });
    if (reason !== undefined) {
      problems.push({ at: ['formerInputs', index], reason });
    }
  }
  return problems;
}

function graftProblemOf(former: FormerInput, onto: GraftTarget): string | undefined {
  const grafted = graftedInputOf({ input: former.input, ...readDefsOf(former.defs) }, onto);
  if (grafted === undefined) {
    return 'grafts no field onto its Endpoint’s query and body';
  }
  const held = { input: former.input, defs: former.defs };
  if (canonicalJson(grafted) !== canonicalJson(held)) {
    return 'is not its own graft onto its Endpoint’s query and body';
  }
  return undefined;
}
