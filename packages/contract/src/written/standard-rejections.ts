import {
  type ServiceContract,
  type StandardRejectionName,
  type StandardRejections,
  standardRejectionDefaults,
  standardRejectionNames,
} from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import { type Declarations, declarationsOf, standardRejectionsDeclarerOf } from './declarations.ts';
import type { LocatedStandardRejection } from './located.ts';
import { textOf } from './written.ts';

/**
 * A Standard Rejection as the Root resolves it: the declaration of the Definitions Package the
 * Root names as `standardRejections`, else cf-loom's, with the declaration it came from when it did.
 */
export type ResolvedStandard = {
  readonly name: StandardRejectionName;
  readonly at: Path;
  readonly code: string;
  readonly status: number;
  readonly message: string;
  readonly declared: LocatedStandardRejection | undefined;
};

/**
 * Each Standard Rejection as the Root resolves it, in the order cf-loom names them; one cf-loom
 * resolves sits where the declaring Definitions Package would have declared it.
 */
export function resolvedStandards(
  declarations: Pick<Declarations, 'root' | 'standardRejectionsSource' | 'standardRejections'>,
): readonly ResolvedStandard[] {
  const { standardRejections } = declarations;
  const declaring =
    standardRejections.length > 0 ? standardRejectionsDeclarerOf(declarations) : undefined;
  return standardRejectionNames.map((name) => {
    const declared = standardRejections.find((located) => located.name === name);
    const defaults = standardRejectionDefaults[name];
    return {
      name,
      at: declared?.at ?? [...(declaring?.at ?? []), 'standardRejections', name],
      code: textOf(declared?.declaration.code ?? defaults.code),
      status: declared?.declaration.status ?? defaults.status,
      message: textOf(declared?.declaration.message ?? defaults.message),
      declared,
    };
  });
}

/**
 * The code, status and message of each Standard Rejection a valid Root resolves, as `serve`
 * answers them; a valid Root's statuses are the ones the type allows.
 */
export function standardRejectionsOf(root: ServiceContract): StandardRejections {
  const resolved = resolvedStandards(declarationsOf(root, {}));
  const entries = resolved.map(({ name, code, status, message }) => [
    name,
    { code, status, message },
  ]);
  return Object.fromEntries(entries) as StandardRejections;
}
