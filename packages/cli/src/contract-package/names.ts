import { kebabCaseOf } from '@cf-loom/contract/internal';
import {
  camelCaseOf,
  camelCaseOfCode,
  kebabCaseOfCode,
  messageVersionStemOf,
  stringLiteralOf,
} from '../source-text/index.ts';
import type { Sibling } from './modules.ts';
import { declaredFolders } from './paths.ts';

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
      return `${camelCaseOf(declared.name)}EventV${declared.version}`;
  }
}

/**
 * The constructor of an Element and the Provider it is marked with: an Endpoint's carries its
 * Provider's Standard Rejections, which the module imports, an Event's only its name.
 */
function constructorOf(declared: ProvidedDeclaration, provider: string): string {
  const name = stringLiteralOf(provider);
  switch (declared.kind) {
    case 'endpoint':
      return `providedEndpoint({ name: ${name}, standardRejections }`;
    case 'event':
      return `providedEvent(${name}`;
  }
}

/** The line a package opens an Element's declaration with: its constructor, which marks it as `provider`'s. */
export function providedOpeningOf(declared: ProvidedDeclaration, provider: string): string {
  return `export const ${bindingOf(declared)} = loom.${constructorOf(declared, provider)}, {`;
}

/** A declaration as another file of the package imports it. */
export function siblingOf(declared: PackagedDeclaration): Sibling {
  return { name: bindingOf(declared), path: fileOf(declared), kind: 'value' };
}
