import type { $ZodType } from 'zod/v4/core';
import type { Endpoint, Guard, IssueCode, inputIns, Rejection } from '../declarations/index.ts';
import { inside, isSchema, type ObjectNode, type Place, partsOf } from '../walker/index.ts';
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
  | 'headers'
  | 'body'
  | 'schema';

/** The parts that travel as text and are objects of their fields in a valid Root. */
export const objectParts = [
  'input.params',
  'input.query',
  'input.headers',
  'success.headers',
  'demands.headers',
  'demands.query',
  'headers',
] as const satisfies readonly Part[];

/** A part a valid Root declares as an object of its fields. */
export type ObjectPart = (typeof objectParts)[number];

/** The walked parts of one Endpoint or Guard that travel as text, each an object of its fields. */
export type TextPartNodes = Readonly<Partial<Record<ObjectPart, ObjectNode>>>;

/** The parts of an Endpoint's Input, in the order the Snapshot lists them. */
export const inputParts = [
  'input.params',
  'input.query',
  'input.headers',
  'input.body',
] as const satisfies readonly Part[];

/** The parts of an Endpoint's Success. */
export const successParts = ['success.headers', 'success.body'] as const satisfies readonly Part[];

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

/** The slot an Issue sits in: a part of an Endpoint, a Guard or a Rejection, the Rejections, or a Fault a Handler built. */
export type IssuePart = Exclude<Part, 'schema'> | 'rejections' | 'fault';

/** One way a value broke its part of the Contract: the part and path, cf-loom's code and a message; never the value. */
export type Issue = {
  readonly part: IssuePart;
  readonly path: readonly (string | number)[];
  readonly code: IssueCode;
  readonly message: string;
};

/** Whether a part is one the Caller sends: the Endpoint's Input or what a Guard demands. */
export function isInputPart(part: IssuePart): part is InputPart {
  const sent: readonly string[] = [...inputParts, ...demandParts];
  return sent.includes(part);
}

/** The part of the request an invalid-input issue says it read: its `in`. */
export type InputIn = (typeof inputIns)[number];

/** The parts of a request that travel as text, by the field a Handler reads them under. */
export type TextIn = Exclude<InputIn, 'body'>;

/** Where an invalid-input issue says it sits, `in`: the part of the request it read. */
export function inOf(part: InputPart): InputIn {
  return partFieldOf(part);
}

/** Whether a part travels as text and is an object of its fields in a valid Root. */
export function isObjectPart(part: Part): part is ObjectPart {
  const textParts: readonly Part[] = objectParts;
  return textParts.includes(part);
}

/** Where a part of a declaration sits: the one place that spells a schema's location. */
export function slotAt(owner: Place, part: Exclude<Part, 'schema'>): Place {
  return inside(owner, ...partsOf(...fieldsOf(part)));
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
export function schemaOf(rejection: Rejection, part: 'headers' | 'body'): $ZodType | undefined;
export function schemaOf(
  declaration: Endpoint | Guard | Rejection,
  part: Exclude<Part, 'schema'>,
): $ZodType | undefined {
  const written = writtenAt(declaration, part);
  return isSchema(written) ? written : undefined;
}
