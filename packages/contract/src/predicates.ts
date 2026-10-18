import type { Definitions } from './definitions.ts';
import type { Dependencies } from './dependencies.ts';
import type { Endpoint } from './endpoint.ts';
import { isDeclaration } from './freeze-declaration.ts';
import type { Group } from './group.ts';
import type { Guard } from './guard.ts';
import type { Rejection } from './rejection.ts';
import type { Application, Contract } from './roots.ts';
import type { StandardRejection } from './standard-rejections.ts';

/** Whether a value is a declared Contract, from any copy of this package. */
export function isContract(value: unknown): value is Contract {
  return isDeclaration(value) && value.kind === 'contract';
}

/** Whether a value is a declared Application, from any copy of this package. */
export function isApplication(value: unknown): value is Application {
  return isDeclaration(value) && value.kind === 'application';
}

/** Whether a value is a declared Definitions Package, from any copy of this package. */
export function isDefinitions(value: unknown): value is Definitions {
  return isDeclaration(value) && value.kind === 'definitions';
}

/** Whether a value is a declared Group, from any copy of this package. */
export function isGroup(value: unknown): value is Group {
  return isDeclaration(value) && value.kind === 'group';
}

/** Whether a value is a declared Endpoint, from any copy of this package. */
export function isEndpoint(value: unknown): value is Endpoint {
  return isDeclaration(value) && value.kind === 'endpoint';
}

/** Whether a value is a declared Guard, from any copy of this package. */
export function isGuard(value: unknown): value is Guard {
  return isDeclaration(value) && value.kind === 'guard';
}

/** Whether a value is a declared Rejection, from any copy of this package. */
export function isRejection(value: unknown): value is Rejection {
  return isDeclaration(value) && value.kind === 'rejection';
}

/** Whether a value is one of the three Standard Rejections, from any copy of this package. */
export function isStandardRejection(value: unknown): value is StandardRejection {
  return isDeclaration(value) && value.kind === 'standard-rejection';
}

/** Whether a value is a declared Dependency, from any copy of this package. */
export function isDependencies(value: unknown): value is Dependencies {
  return isDeclaration(value) && value.kind === 'dependencies';
}

/**
 * Whether a value is an Event as a Contract Package exports it. A kind check until `defineEvent`
 * brands Events (milestone 2): a Contract Package's Events are plain objects for now.
 */
export function isEvent(value: unknown): value is {
  readonly kind: 'event';
  readonly name: unknown;
  readonly version: unknown;
  readonly visibility: unknown;
} {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'event';
}
