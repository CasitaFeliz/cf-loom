import type { HandlerMapOf, NoResources } from '@cf-loom/handlers';
import type { contract } from './contract/index.ts';

/** Generated, and typed by the Resources the Service's Handlers take, which differ by README. */
declare const handlers: HandlerMapOf<typeof contract, NoResources>;
export default handlers;
