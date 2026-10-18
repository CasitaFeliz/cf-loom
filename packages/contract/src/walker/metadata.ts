import type * as core from 'zod/v4/core';
import { globalRegistry } from 'zod/v4/core';
import { isJsonValue } from './canonical-json.ts';
import type { Annotations, NotAllowed, Path, SchemaNode } from './nodes.ts';
import {
  notAllowed,
  type Refused,
  refused,
  refusedExamples,
  refusedMetaKey,
} from './not-allowed.ts';
import { failed, failuresOf, type Walked, walked } from './walked.ts';

/** What a schema's own `.describe()` and `.meta()` say: its annotations and its recursion id. */
export type Metadata = { readonly annotations: Annotations; readonly id?: string };

const allowedKeys: ReadonlySet<string> = new Set(['description', 'examples', 'id']);

/**
 * The schema's own metadata, as its `.meta()` returns it, so zod and `zod/mini` read alike;
 * any key but `description`, `examples` and `id` fails.
 */
export function metadataOf(schema: core.$ZodType, at: Path): Walked<Metadata> {
  const meta: Readonly<Record<string, unknown>> = globalRegistry.get(schema) ?? {};
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
    return failed(failuresOf([metadata, result]));
  }
  return annotated(result, metadata.value.annotations);
}

/** Whether a node carries anything besides its shape. */
export function hasAnnotations(node: SchemaNode): boolean {
  const { nullable, description, examples, origin } = node;
  return [nullable, description, examples, origin].some((annotation) => annotation !== undefined);
}

function metaFailures(meta: Readonly<Record<string, unknown>>, at: Path): readonly NotAllowed[] {
  const declared = Object.entries(meta).filter(([, value]) => value !== undefined);
  const unknownKeys = declared.map(([key]) => key).filter((key) => !allowedKeys.has(key));
  const keyFailures = unknownKeys.map((key) => notAllowed(at, refusedMetaKey(key)));
  const examplesRefusal = examplesRefusalOf(meta['examples']);
  const examplesFailure = examplesRefusal === undefined ? [] : [notAllowed(at, examplesRefusal)];
  return failuresOf([...keyFailures, ...examplesFailure]);
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
