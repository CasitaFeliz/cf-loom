import { kebabCaseOf } from '@cf-loom/contract/internal';
import {
  camelCaseOf,
  camelCaseOfCode,
  kebabCaseOfCode,
  messageVersionStemOf,
} from '../source-text/index.ts';
import type { Sibling } from './modules.ts';
import { declaredFiles } from './paths.ts';

/**
 * A declaration the package writes a file of its own for: an Endpoint or a Guard by name, a
 * Rejection by code, an Event's Message Version by name and version.
 */
export type PackagedDeclaration =
  | { readonly kind: 'endpoint'; readonly name: string }
  | { readonly kind: 'guard'; readonly name: string }
  | { readonly kind: 'rejection'; readonly code: string }
  | { readonly kind: 'event'; readonly name: string; readonly version: number };

/** The file of a declaration in the package, its name in kebab-case. */
export function fileOf(declared: PackagedDeclaration): string {
  const { folder } = declaredFiles[declared.kind];
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

/** A declaration as another file of the package imports it. */
export function siblingOf(declared: PackagedDeclaration): Sibling {
  return { name: bindingOf(declared), path: fileOf(declared), kind: 'value' };
}
