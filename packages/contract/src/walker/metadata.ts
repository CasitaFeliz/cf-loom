import type * as core from 'zod/v4/core';
import { globalRegistry } from 'zod/v4/core';
import { camelCase, follows } from '../declarations/index.ts';
import { isJsonValue } from './canonical-json.ts';
import type { Annotations, NotAllowed, Path, SchemaNode } from './nodes.ts';
import {
  notAllowed,
  type Refused,
  refused,
  refusedExamples,
  refusedMetaKey,
  refusedNonCamelCaseId,
} from './not-allowed.ts';
import { failed, failuresOf, refusedBeside, type Walked, walked } from './walked.ts';

/** What a schema's own `.describe()` and `.meta()` say: its annotations and its recursion id. */
export type Metadata = { readonly annotations: Annotations; readonly id?: string };

const allowedKeys: ReadonlySet<string> = new Set(['description', 'examples', 'id']);

/**
 * The schema's own metadata, as its `.meta()` returns it, so zod and `zod/mini` read alike;
 * any key but `description`, `examples` and `id` fails.
 */
export function metadataOf(schema: core.$ZodType, at: Path): Walked<Metadata> {
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

/** A node with annotations laid over it, so the outer schema's say wins over the inner one's. */
export function annotated(result: Walked, annotations: Annotations): Walked {
  if (result.kind === 'not-allowed') {
    return result;
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

function ownMetaOf(schema: core.$ZodType): Readonly<Record<string, unknown>> {
  return globalRegistry.get(schema) ?? {};
}

function metaFailures(meta: Readonly<Record<string, unknown>>, at: Path): readonly NotAllowed[] {
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
