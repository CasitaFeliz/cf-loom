import type { SchemaNode } from '../walker/index.ts';
import type { CodeSnapshot, EndpointSnapshot, GuardSnapshot } from './types.ts';

/** The schema nodes of an Endpoint's Input and Success. */
export function endpointNodesOf({ input, success }: EndpointSnapshot): readonly SchemaNode[] {
  const { params, query, headers, body } = input;
  return [params, query, headers, body, success.headers, success.body].filter(isNode);
}

/** The schema nodes of a Guard: its demands, its Context and its Qualifier. */
export function guardNodesOf({
  demands,
  context,
  qualifier,
}: GuardSnapshot): readonly SchemaNode[] {
  return [demands.headers, demands.query, context, qualifier].filter(isNode);
}

/** The schema nodes of a code: its headers and its body. */
export function codeNodesOf({ headers, body }: CodeSnapshot): readonly SchemaNode[] {
  return [headers, body].filter(isNode);
}

function isNode(node: SchemaNode | null): node is SchemaNode {
  return node !== null;
}
