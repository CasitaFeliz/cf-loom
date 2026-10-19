import { byCodePoint } from '@casitafeliz/loom-contract/internal';
import { camelCaseOf, kebabCaseOf, kebabCaseOfCode } from '../source-text/index.ts';
import type { Sibling } from './modules.ts';

/** The file of an exported Endpoint in the package. */
export function endpointFileOf(name: string): string {
  return `src/endpoints/${kebabCaseOf(name)}.ts`;
}

/** The file of a Guard the package's Endpoints attach. */
export function guardFileOf(name: string): string {
  return `src/guards/${kebabCaseOf(name)}.ts`;
}

/** The file of a Rejection the package's Endpoints or Guards answer, by its code. */
export function rejectionFileOf(code: string): string {
  return `src/rejections/${kebabCaseOfCode(code)}.ts`;
}

/**
 * The name an Endpoint is exported under in the package, suffixed by its kind as every
 * generated name is, so names of different kinds never meet.
 */
export function endpointBindingOf(name: string): string {
  return `${name}Endpoint`;
}

/** The name a Guard is exported under in the package. */
export function guardBindingOf(name: string): string {
  return `${name}Guard`;
}

/** The name a Rejection is exported under, from its code: `ORDER_LOCKED` is `orderLockedRejection`. */
export function rejectionBindingOf(code: string): string {
  return `${camelCaseOf(kebabCaseOfCode(code))}Rejection`;
}

/** The first two codes, in code point order, whose names in the package are one. */
export function collidingCodesOf(codes: readonly string[]): readonly [string, string] | undefined {
  const codeByBinding = new Map<string, string>();
  for (const code of [...codes].sort(byCodePoint)) {
    const binding = rejectionBindingOf(code);
    const earlier = codeByBinding.get(binding);
    if (earlier !== undefined) {
      return [earlier, code];
    }
    codeByBinding.set(binding, code);
  }
  return undefined;
}

/** A Guard as another file of the package imports it. */
export function guardSiblingOf(name: string): Sibling {
  return { name: guardBindingOf(name), path: guardFileOf(name), kind: 'value' };
}

/** A Rejection as another file of the package imports it. */
export function rejectionSiblingOf(code: string): Sibling {
  return { name: rejectionBindingOf(code), path: rejectionFileOf(code), kind: 'value' };
}
