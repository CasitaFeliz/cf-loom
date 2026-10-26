import type { ServiceContract } from '../declarations/index.ts';
import { declarationsOf } from '../written/index.ts';
import { deprecationFailures } from './endpoints.ts';
import type { DeclarationFailure } from './failures.ts';

/**
 * The `deprecated-at` failures of a Contract's Endpoints, so the runtime reads only the instants
 * `generate` accepts.
 */
export function deprecationFailuresOf(contract: ServiceContract): readonly DeclarationFailure[] {
  return declarationsOf(contract, {}).endpoints.flatMap(deprecationFailures);
}
