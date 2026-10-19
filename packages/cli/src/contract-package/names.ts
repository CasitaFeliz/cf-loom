import { byCodePoint } from '@casitafeliz/loom-contract/internal';
import { camelCaseOf, kebabCaseOf, kebabCaseOfCode } from '../source-text/index.ts';
import type { Sibling } from './modules.ts';
import { type DeclaredKind, declaredFolders } from './paths.ts';

/** A declaration the package writes a file of its own for: an Endpoint, a Guard, or a code. */
export type Declared = { readonly kind: DeclaredKind; readonly name: string };

/** The file of a declaration in the package, its name in kebab-case. */
export function fileOf(declared: Declared): string {
  const folder = declaredFolders[declared.kind];
  switch (declared.kind) {
    case 'endpoint':
    case 'guard':
      return `${folder}/${kebabCaseOf(declared.name)}.ts`;
    case 'rejection':
      return `${folder}/${kebabCaseOfCode(declared.name)}.ts`;
  }
}

/**
 * The name a declaration is exported under, suffixed by its kind as every generated name is,
 * so names of different kinds never meet: `ORDER_LOCKED` is `orderLockedRejection`.
 */
export function bindingOf(declared: Declared): string {
  switch (declared.kind) {
    case 'endpoint':
      return `${declared.name}Endpoint`;
    case 'guard':
      return `${declared.name}Guard`;
    case 'rejection':
      return `${camelCaseOf(kebabCaseOfCode(declared.name))}Rejection`;
  }
}

/** A declaration as another file of the package imports it. */
export function siblingOf(declared: Declared): Sibling {
  return { name: bindingOf(declared), path: fileOf(declared), kind: 'value' };
}

/** The first two codes, in code point order, whose names in the package are one. */
export function collidingCodesOf(codes: readonly string[]): readonly [string, string] | undefined {
  const codeByBinding = new Map<string, string>();
  for (const code of [...codes].sort(byCodePoint)) {
    const binding = bindingOf({ kind: 'rejection', name: code });
    const earlier = codeByBinding.get(binding);
    if (earlier !== undefined) {
      return [earlier, code];
    }
    codeByBinding.set(binding, code);
  }
  return undefined;
}
