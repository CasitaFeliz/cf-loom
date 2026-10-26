import type { Command } from './command.ts';
import type { Definitions } from './definitions.ts';
import type { Dependency } from './dependency.ts';
import type { Endpoint } from './endpoint.ts';
import type { Event } from './event.ts';
import { isDeclaration } from './freeze-declaration.ts';
import type { Group } from './group.ts';
import type { Guard } from './guard.ts';
import type { Rejection } from './rejection.ts';
import type { ApplicationContract, Root, ServiceContract } from './roots.ts';
import type { StandardRejection } from './standard-rejections.ts';
import type { Subscription } from './subscription.ts';

/** The `kind` every declaration carries, which tells them apart at runtime. */
export type Kind =
  | ServiceContract['kind']
  | ApplicationContract['kind']
  | Definitions['kind']
  | Group['kind']
  | Endpoint['kind']
  | Guard['kind']
  | Rejection['kind']
  | StandardRejection['kind']
  | Dependency['kind']
  | Event['kind']
  | Command['kind']
  | Subscription['kind'];

/** Whether a value is a declared Service's Contract, from any copy of this package. */
export function isServiceContract(value: unknown): value is ServiceContract {
  return isDeclaration(value) && value.kind === 'service';
}

function isApplicationContract(value: unknown): value is ApplicationContract {
  return isDeclaration(value) && value.kind === 'application';
}

/** Whether a value is a declared Definitions Package, from any copy of this package. */
export function isDefinitions(value: unknown): value is Definitions {
  return isDeclaration(value) && value.kind === 'definitions';
}

/** Whether a value is a declared Root of any kind, from any copy of this package. */
export function isRoot(value: unknown): value is Root {
  return isServiceContract(value) || isApplicationContract(value) || isDefinitions(value);
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
export function isDependency(value: unknown): value is Dependency {
  return isDeclaration(value) && value.kind === 'dependency';
}

/** Whether a value is a declared Event's Message Version, from any copy of this package. */
export function isEvent(value: unknown): value is Event {
  return isDeclaration(value) && value.kind === 'event';
}

/** Whether a value is a declared Command's Message Version, from any copy of this package. */
export function isCommand(value: unknown): value is Command {
  return isDeclaration(value) && value.kind === 'command';
}

/** Whether a value is a declared Subscription, from any copy of this package. */
export function isSubscription(value: unknown): value is Subscription {
  return isDeclaration(value) && value.kind === 'subscription';
}
