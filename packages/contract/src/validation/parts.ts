import { $ZodType } from 'zod/v4/core';
import type { Endpoint, Guard, IssueCode, Rejection } from '../declarations/index.ts';
import type { Path } from '../walker/index.ts';
import { partOf } from './written.ts';

/** A slot of a declaration that holds a schema, as the Snapshot names it. */
export type Part =
  | 'input.params'
  | 'input.query'
  | 'input.headers'
  | 'input.body'
  | 'success.headers'
  | 'success.body'
  | 'demands.headers'
  | 'demands.query'
  | 'context'
  | 'qualifier'
  | 'body'
  | 'schema';

/** The parts that travel as text and are objects of their fields in a valid root. */
export const objectParts = [
  'input.params',
  'input.query',
  'input.headers',
  'success.headers',
  'demands.headers',
  'demands.query',
] as const satisfies readonly Part[];

/** A part a valid root declares as an object of its fields. */
export type ObjectPart = (typeof objectParts)[number];

/** The parts of an Endpoint's Input, in the order the Snapshot lists them. */
export const inputParts = [
  'input.params',
  'input.query',
  'input.headers',
  'input.body',
] as const satisfies readonly Part[];

/** The parts of an Endpoint's Success. */
export const successParts = ['success.headers', 'success.body'] as const satisfies readonly Part[];

/** The bodies of Read shapes; a Success's headers are judged as headers. */
export const readShapeParts = ['success.body', 'body'] as const satisfies readonly Part[];

/** Whether a part is the body of a Read shape. */
export function isReadShapePart(part: Part): boolean {
  const parts: readonly Part[] = readShapeParts;
  return parts.includes(part);
}

/** Whether a part is a query or headers object: a text part whose keys a request does not fix. */
export function isQueryOrHeadersPart(part: Part): boolean {
  return isObjectPart(part) && part !== 'input.params';
}

/** The parts of the request a Guard may demand. */
export const demandParts = ['demands.headers', 'demands.query'] as const satisfies readonly Part[];

/** Every part an Endpoint may declare a schema in. */
export const endpointParts = [...inputParts, ...successParts] as const;

/** Every part a Guard may declare a schema in. */
export const guardParts = [...demandParts, 'context', 'qualifier'] as const;

/** A part an Endpoint may declare a schema in. */
export type EndpointPart = (typeof endpointParts)[number];

/** A part a Guard may declare a schema in. */
export type GuardPart = (typeof guardParts)[number];

/** The fields a part names, outermost first: `input.params` is `input`, then `params`. */
type FieldsOf<Named extends string> = Named extends `${infer Outer}.${infer Inner}`
  ? readonly [Outer, Inner]
  : readonly [Named];

/** The fields a part names, outermost first: the one place that reads a part's name. */
export function fieldsOf<Named extends Exclude<Part, 'schema'>>(part: Named): FieldsOf<Named> {
  return part.split('.') as readonly string[] as FieldsOf<Named>;
}

/** The field a part's value sits under: `input.params` is `params`, `context` is `context`. */
type FieldOf<Named extends string> = Named extends `${string}.${infer Inner}` ? Inner : Named;

/** The field a part's value sits under, where a Handler reads it: its innermost field. */
export function partFieldOf<Named extends Exclude<Part, 'schema'>>(part: Named): FieldOf<Named> {
  const fields: readonly string[] = fieldsOf(part);
  return fields[fields.length - 1] as FieldOf<Named>;
}

/** A part of what a request carries: the Endpoint's Input, or what a Guard demands. */
export type InputPart = (typeof inputParts)[number] | (typeof demandParts)[number];

/** The slot an Issue sits in: a part of an Endpoint, a Guard or a Rejection, or the Rejections. */
export type IssuePart = Exclude<Part, 'schema'> | 'rejections';

/** One way a value broke its part of the Contract: the part and path, cf-loom's code and a message; never the value. */
export type Issue = {
  readonly part: IssuePart;
  readonly path: readonly (string | number)[];
  readonly code: IssueCode;
  readonly message: string;
};

/** Whether an Issue's part is one the Caller sent, so the runtime answers it as invalid input. */
export function isInputPart(part: IssuePart): part is InputPart {
  const sent: readonly string[] = [...inputParts, ...demandParts];
  return sent.includes(part);
}

/** Where an invalid-input issue says it sits, `in`: the part of the request it read. */
export function inOf(part: InputPart): 'params' | 'query' | 'headers' | 'body' {
  return partFieldOf(part);
}

/** Whether a part travels as text and is an object of its fields in a valid root. */
export function isObjectPart(part: Part): part is ObjectPart {
  const textParts: readonly Part[] = objectParts;
  return textParts.includes(part);
}

/** Where a part of a declaration sits: the one place that spells a schema's location. */
export function slotAt(owner: Path, part: Exclude<Part, 'schema'>): Path {
  return [...owner, ...fieldsOf(part)];
}

/** What a declaration holds at a part, as written, whatever the types said. */
export function writtenAt(declaration: unknown, part: Exclude<Part, 'schema'>): unknown {
  const [field, inner]: readonly string[] = fieldsOf(part);
  const written = partOf<string>(declaration)[field ?? ''];
  return inner === undefined ? written : partOf<string>(written)[inner];
}

/** The schema an Endpoint, a Guard or a Rejection declares at a part; nothing when it declares none. */
export function schemaOf(endpoint: Endpoint, part: EndpointPart): $ZodType | undefined;
export function schemaOf(guard: Guard, part: GuardPart): $ZodType | undefined;
export function schemaOf(rejection: Rejection, part: 'body'): $ZodType | undefined;
export function schemaOf(
  declaration: Endpoint | Guard | Rejection,
  part: Exclude<Part, 'schema'>,
): $ZodType | undefined {
  const written = writtenAt(declaration, part);
  return isSchema(written) ? written : undefined;
}

/**
 * Whether a value is a zod schema, by zod's own `instanceof`: it reads the traits in `_zod`, which
 * zod, `zod/mini` and any copy of either set and a hand-built `_zod` object lacks, so an impostor
 * never reaches the walker, which reads `_zod.def`.
 */
export function isSchema(value: unknown): value is $ZodType {
  return value instanceof $ZodType;
}
