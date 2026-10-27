import { codeNameOf, kebabCaseOf } from '@cf-loom/contract/internal';
import { camelCaseOfCode, kebabCaseOfCode, messageVersionStemOf } from '../source-text/index.ts';
import type { Sibling } from './modules.ts';
import { declaredFolders, packagePaths } from './paths.ts';

/** An Element the package exports, which its Provider's name marks: an Endpoint by name, an Event's Message Version by name and version. */
export type ProvidedDeclaration =
  | { readonly kind: 'endpoint'; readonly name: string }
  | { readonly kind: 'event'; readonly name: string; readonly version: number };

/**
 * A declaration the package writes a file of its own for: an Element it exports, a Guard by name,
 * a Rejection by code.
 */
export type PackagedDeclaration =
  | ProvidedDeclaration
  | { readonly kind: 'guard'; readonly name: string }
  | { readonly kind: 'rejection'; readonly code: string };

/** The file of a declaration in the package, its name in kebab-case. */
export function fileOf(declared: PackagedDeclaration): string {
  const folder = declaredFolders[declared.kind];
  switch (declared.kind) {
    case 'endpoint':
    case 'guard':
      return `${folder}/${kebabCaseOf(declared.name)}.ts`;
    case 'rejection':
      return `${folder}/${kebabCaseOfCode(declared.code)}.ts`;
    case 'event':
      return `${folder}/${messageVersionStemOf(declared)}.ts`;
  }
}

/**
 * The name a declaration is exported under, suffixed by its kind as every generated name is,
 * so names of different kinds never meet: `ORDER_LOCKED` is `orderLockedRejection`.
 */
export function bindingOf(declared: PackagedDeclaration): string {
  switch (declared.kind) {
    case 'endpoint':
      return `${declared.name}Endpoint`;
    case 'guard':
      return `${declared.name}Guard`;
    case 'rejection':
      return `${camelCaseOfCode(declared.code)}Rejection`;
    case 'event':
      return codeNameOf(declared, 'Event');
  }
}

/** The Provider's Standard Rejections, which their module declares and each Endpoint module imports to carry them. */
export const standardRejectionsSibling: Sibling = {
  name: 'standardRejections',
  path: packagePaths.standardRejections,
  kind: 'value',
};

function constructorOf(declared: ProvidedDeclaration): string {
  switch (declared.kind) {
    case 'endpoint':
      return 'providedEndpoint';
    case 'event':
      return 'providedEvent';
  }
}

/**
 * The line a package opens an Element's declaration with: its constructor, given `markedBy`, the
 * text of the Provider it marks the Element with.
 */
export function providedOpeningOf(declared: ProvidedDeclaration, markedBy: string): string {
  return `export const ${bindingOf(declared)} = loom.${constructorOf(declared)}(${markedBy}, {`;
}

/** A declaration as another file of the package imports it. */
export function siblingOf(declared: PackagedDeclaration): Sibling {
  return { name: bindingOf(declared), path: fileOf(declared), kind: 'value' };
}
