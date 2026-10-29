import { providerOf, type Root } from '../declarations/index.ts';
import { textOf } from './written.ts';

/**
 * Whether an Element is one of the Service's own Contract Package, its Provider being the Service
 * itself. A Provider is another Service, so a Service's Dependencies and Subscriptions take no such
 * Element; a Root that is no Service's Contract has no Contract Package of its own.
 */
export function isOwnProvided(root: Root, element: unknown): boolean {
  return root.kind === 'service' && providerOf(element) === textOf(root.name);
}
