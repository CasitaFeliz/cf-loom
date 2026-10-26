import { z } from 'zod';
import { successStatuses, visibilities } from '../declarations/index.ts';
import type { PublishedCommand, PublishedEndpoint, PublishedEvent } from '../snapshot/index.ts';
import { type Problem, readWith } from '../validation/index.ts';
import { byCodePoint } from '../walker/index.ts';
import { inCanonicalOrder } from './maps.ts';
import { objectNode, schemaNode } from './nodes.ts';
import { formatDefiner, semanticVersionText, stampText } from './texts.ts';

const retired = { lifecycle: z.literal('retired'), retiredIn: semanticVersionText };

const lifecycles = ['active', 'deprecated', 'retired'] as const;
const withLifecycle = z.looseObject({ lifecycle: z.enum(lifecycles) });

type FormName = (typeof lifecycles)[number] | 'tombstone';

/** A Retired Element keeps its Group while it is still declared, and loses it as a tombstone. */
function formNameOf(element: z.output<typeof withLifecycle>): FormName {
  if (element.lifecycle !== 'retired') {
    return element.lifecycle;
  }
  return Object.hasOwn(element, 'group') ? 'retired' : 'tombstone';
}

/** Hands the problems of a refused read to the schema that asked for it, at the places they have. */
function refusedAs(problems: readonly Problem[], element: unknown, ctx: z.core.$RefinementCtx) {
  for (const problem of problems) {
    ctx.issues.push({
      code: 'custom',
      message: problem.reason,
      path: [...problem.at],
      input: element,
    });
  }
  return z.NEVER;
}

/**
 * A published Element: still declared with its lifecycle, a Deprecated one also with what only
 * Deprecation stamps, a Retired one with the version that first published it so, or its tombstone.
 * Its lifecycle, and for a Retired one its Group, select the one form the Element is read as, as
 * received, so a failure names the key that breaks that form.
 */
function published<
  Fields extends z.core.$ZodShape,
  Deprecation extends z.core.$ZodShape,
  Tombstone extends z.core.$ZodType,
>(fields: Fields, deprecation: Deprecation, tombstone: Tombstone) {
  const forms = {
    active: z.strictObject({ ...fields, lifecycle: z.literal('active') }),
    deprecated: z.strictObject({ ...fields, ...deprecation, lifecycle: z.literal('deprecated') }),
    retired: z.strictObject({ ...fields, ...retired }),
    tombstone,
  };
  return z.unknown().transform((element, ctx) => {
    const heading = readWith(withLifecycle, element, formatDefiner);
    if (heading.kind === 'refused') {
      return refusedAs(heading.problems, element, ctx);
    }
    const read = readWith(forms[formNameOf(heading.value)], element, formatDefiner);
    return read.kind === 'read' ? read.value : refusedAs(read.problems, element, ctx);
  });
}

const messageTombstone = z.strictObject(retired);
const attachment = z.strictObject({ guard: z.string(), qualifier: z.unknown() });
const input = z.strictObject({
  params: objectNode.nullable(),
  query: objectNode,
  headers: objectNode,
  body: schemaNode.nullable(),
});
const success = z.strictObject({
  status: z.literal(successStatuses),
  headers: objectNode,
  body: schemaNode.nullable(),
});

/** Format 1's Endpoint in a published Snapshot: declared, or its tombstone with its name. */
export const publishedEndpoint: z.ZodType<PublishedEndpoint> = published(
  {
    name: z.string(),
    group: z.string(),
    visibility: z.enum(visibilities),
    description: z.string(),
    params: z.array(z.string()),
    guards: z.array(attachment),
    input,
    success,
    rejections: inCanonicalOrder(z.string(), byCodePoint),
  },
  { deprecatedAt: stampText.exactOptional() },
  z.strictObject({ ...retired, name: z.string() }),
);

/** Format 1's Event Message Version in a published Snapshot: declared, or its tombstone. */
export const publishedEvent: z.ZodType<PublishedEvent> = published(
  {
    group: z.string(),
    visibility: z.enum(visibilities),
    description: z.string(),
    body: schemaNode,
  },
  {},
  messageTombstone,
);

/** Format 1's Command Message Version in a published Snapshot: declared, or its tombstone. */
export const publishedCommand: z.ZodType<PublishedCommand> = published(
  { group: z.string(), description: z.string(), body: schemaNode },
  {},
  messageTombstone,
);
