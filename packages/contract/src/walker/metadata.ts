import type * as core from 'zod/v4/core';
import { globalRegistry, safeParse } from 'zod/v4/core';
import { camelCase, follows } from '../declarations/index.ts';
import { isJsonValue } from './canonical-json.ts';
import type { Annotations, SchemaNode } from './nodes.ts';
import {
  notAllowed,
  type Refused,
  refused,
  refusedExample,
  refusedExamples,
  refusedMetaKey,
  refusedNonCamelCaseId,
} from './not-allowed.ts';
import {
  type FailureTree,
  failed,
  failuresOf,
  type Reached,
  refusedBeside,
  type Walked,
  walked,
} from './walked.ts';
import { withinStack } from './within-stack.ts';

/** What a schema's own `.describe()` and `.meta()` say: its annotations and its recursion id. */
export type Metadata = { readonly annotations: Annotations; readonly id?: string };

const allowedKeys: ReadonlySet<string> = new Set(['description', 'examples', 'id']);

/**
 * The schema's own metadata, as its `.meta()` returns it, so zod and `zod/mini` read alike;
 * any key but `description`, `examples` and `id` fails.
 */
export function metadataOf(schema: core.$ZodType, at: Reached): Walked<Metadata> {
  const meta = ownMetaOf(schema);
  const failures = metaFailures(meta, at);
  if (failures.length > 0) {
    return failed(failures);
  }
  const { description, examples, id } = meta;
  return walked({
    annotations: {
      ...(typeof description === 'string' && { description }),
      ...(Array.isArray(examples) && { examples }),
    },
    ...(typeof id === 'string' && { id }),
  });
}

/** Whether the schema's own `.meta()` holds an id, which names a schema on a cycle. */
export function hasOwnId(schema: core.$ZodType): boolean {
  return ownMetaOf(schema)['id'] !== undefined;
}

/**
 * A node with annotations laid over it, so the outer schema's say wins over the inner one's; a
 * failed walk keeps them on the node it was building, so `.nullable()` stays known.
 */
export function annotated(result: Walked, annotations: Annotations): Walked {
  if (result.kind === 'not-allowed') {
    return failed(result.tree, { ...result.outline, ...annotations });
  }
  const node: SchemaNode = { ...result.value, ...annotations };
  return walked(node);
}

/** A node with what its schema's own metadata says, or the failures of either. */
export function annotatedBy(result: Walked, metadata: Walked<Metadata>): Walked {
  if (metadata.kind === 'not-allowed') {
    return refusedBeside(metadata, result);
  }
  return annotated(result, metadata.value.annotations);
}

/**
 * A walked node whose examples its own schema accepts, each parsed by that schema; a schema that
 * failed to walk is never parsed, so no function of the author's runs. An example zod cannot parse
 * within the call stack is one its schema refuses.
 */
export function withExamplesParsed(schema: core.$ZodType, result: Walked, at: Reached): Walked {
  if (result.kind === 'not-allowed') {
    return result;
  }
  const examples = result.value.examples ?? [];
  const refusals = examples
    .map((example, index) => ({ example, index }))
    .filter(({ example }) => withinStack(() => safeParse(schema, example))?.success !== true)
    .map(({ index }) => notAllowed(at, refusedExample(index)));
  return refusals.length === 0 ? result : failed(failuresOf(refusals), result.value);
}

function ownMetaOf(schema: core.$ZodType): Readonly<Record<string, unknown>> {
  return globalRegistry.get(schema) ?? {};
}

function metaFailures(meta: Readonly<Record<string, unknown>>, at: Reached): FailureTree {
  const declared = Object.entries(meta).filter(([, value]) => value !== undefined);
  const unknownKeys = declared.map(([key]) => key).filter((key) => !allowedKeys.has(key));
  const keyRefusals = unknownKeys.map(refusedMetaKey);
  const valueRefusals = [
    examplesRefusalOf(meta['examples']),
    idRefusalOf(meta['id']),
    descriptionRefusalOf(meta['description']),
  ].filter(isRefusal);
  return failuresOf([...keyRefusals, ...valueRefusals].map((refusal) => notAllowed(at, refusal)));
}

function isRefusal(refusal: Refused | undefined): refusal is Refused {
  return refusal !== undefined;
}

function idRefusalOf(id: unknown): Refused | undefined {
  if (id === undefined) {
    return undefined;
  }
  if (typeof id !== 'string') {
    return refused.nonStringId;
  }
  return follows(camelCase, id) ? undefined : refusedNonCamelCaseId(id);
}

function descriptionRefusalOf(description: unknown): Refused | undefined {
  if (description === undefined || typeof description === 'string') {
    return undefined;
  }
  return refused.nonStringDescription;
}

function examplesRefusalOf(examples: unknown): Refused | undefined {
  if (examples === undefined) {
    return undefined;
  }
  if (!Array.isArray(examples)) {
    return refusedExamples;
  }
  return isJsonValue(examples) ? undefined : refused.nonJsonExamples;
}
