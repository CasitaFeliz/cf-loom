import type { Guard } from '../guard.ts';
import { canonicalJson } from '../walker/canonical-json.ts';
import type { ObjectNode, Path, SchemaNode } from '../walker/nodes.ts';
import type { Declarations, LocatedEndpoint, LocatedGuard } from './declarations.ts';
import { attachedGuardOf, isGuard, listOf } from './declarations.ts';
import { type DeclarationFailure, failure } from './failures.ts';
import type { Nodes } from './schemas.ts';

/** The parts of a request that travel as text, and a Success's headers with them. */
type Part = 'params' | 'query' | 'headers';

/** One text part, where it sits and whose it is. */
type TextPart = { readonly at: Path; readonly part: Part };

/** What one Endpoint or Guard declares for a header or query name. */
type Declared = { readonly owner: string; readonly schema: string };

const textTypes: readonly SchemaNode['type'][] = ['string', 'number', 'boolean', 'literal', 'enum'];

const nouns: Readonly<Record<Part, string>> = {
  params: 'A path param',
  query: 'A query param',
  headers: 'A header',
};

/** Every text part holds text fields with lower-case header names, judged on the walked nodes. */
export function textFailures(
  declarations: Declarations,
  nodes: Nodes,
): readonly DeclarationFailure[] {
  const parts = [
    ...declarations.endpoints.flatMap(endpointParts),
    ...declarations.guards.flatMap(guardParts),
  ];
  return parts.flatMap((textPart) => partFailures(textPart, nodes));
}

/** Across an Endpoint and its Guards, one header or query name has one schema. */
export function conflictFailures(
  { at, endpoint }: LocatedEndpoint,
  nodes: Nodes,
): readonly DeclarationFailure[] {
  const guards = [...new Set(listOf(endpoint.guards).map(attachedGuardOf).filter(isGuard))];
  return (['headers', 'query'] as const).flatMap((part) => {
    const own = { owner: endpoint.name, node: nodes.nodeAt([...at, 'input', part]) };
    const demanded = guards.map((guard) => ({
      owner: guard.name,
      node: demandOf(guard, part, nodes),
    }));
    return partConflicts([own, ...demanded], { at: [...at, 'input', part], part });
  });
}

function endpointParts({ at, endpoint: _ }: LocatedEndpoint): readonly TextPart[] {
  return [
    { at: [...at, 'input', 'params'], part: 'params' },
    { at: [...at, 'input', 'query'], part: 'query' },
    { at: [...at, 'input', 'headers'], part: 'headers' },
    { at: [...at, 'success', 'headers'], part: 'headers' },
  ];
}

function guardParts({ at }: LocatedGuard): readonly TextPart[] {
  return [
    { at: [...at, 'demands', 'headers'], part: 'headers' },
    { at: [...at, 'demands', 'query'], part: 'query' },
  ];
}

function partFailures({ at, part }: TextPart, nodes: Nodes): readonly DeclarationFailure[] {
  const node = nodes.nodeAt(at);
  if (node === undefined) {
    return [];
  }
  if (node.type !== 'object') {
    const message = `${String(at.at(-1))} is an object of its fields`;
    return [failure(at, 'text-only', message)];
  }
  return Object.entries(node.fields).flatMap(([name, field]) => [
    ...headerNameFailures({ at, part }, name),
    ...fieldFailures({ at, part }, name, field.schema),
  ]);
}

function headerNameFailures({ at, part }: TextPart, name: string): readonly DeclarationFailure[] {
  if (part !== 'headers' || name === name.toLowerCase()) {
    return [];
  }
  const message = `Header names are lower-case: ${name}`;
  return [failure([...at, 'fields', name], 'header-names', message)];
}

function fieldFailures(
  { at, part }: TextPart,
  name: string,
  schema: SchemaNode,
): readonly DeclarationFailure[] {
  const fieldAt = [...at, 'fields', name];
  const items = part === 'query' && schema.type === 'array' ? schema.items : schema;
  if (schema.nullable === true || items.nullable === true) {
    return [failure(fieldAt, 'text-only', `${nouns[part]} is never nullable: ${name}`)];
  }
  if (textTypes.includes(items.type)) {
    return [];
  }
  const lists = part === 'query' ? ', or a list of those' : '';
  const message = `${nouns[part]} travels as text: a string, number, boolean, literal or enum${lists}: ${name}`;
  return [failure(fieldAt, 'text-only', message)];
}

function demandOf(guard: Guard, part: 'headers' | 'query', nodes: Nodes): SchemaNode | undefined {
  return nodes.nodeAt(['guards', guard.name, 'demands', part]);
}

function partConflicts(
  sources: readonly { readonly owner: string; readonly node: SchemaNode | undefined }[],
  { at, part }: TextPart,
): readonly DeclarationFailure[] {
  const declaredByName = new Map<string, Declared>();
  const failures: DeclarationFailure[] = [];
  for (const { owner, node } of sources.filter(hasObject)) {
    for (const [name, field] of Object.entries(node.fields)) {
      const key = part === 'headers' ? name.toLowerCase() : name;
      const schema = canonicalJson(field.schema);
      const first = declaredByName.get(key);
      if (first !== undefined && first.schema !== schema) {
        const message = `${nouns[part]} has one schema across an Endpoint and its Guards: ${name} differs between ${first.owner} and ${owner}`;
        failures.push(failure(at, 'input-conflict', message));
      }
      declaredByName.set(key, first ?? { owner, schema });
    }
  }
  return failures;
}

function hasObject(source: {
  readonly owner: string;
  readonly node: SchemaNode | undefined;
}): source is { readonly owner: string; readonly node: ObjectNode } {
  return source.node?.type === 'object';
}
