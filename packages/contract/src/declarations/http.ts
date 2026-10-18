import type * as core from 'zod/v4/core';
import type { JoinedNames, LiteralNames } from './rules.ts';

/** The HTTP methods an Endpoint may declare, as values, so the runtime repeats the type's rule. */
export const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

/** The HTTP methods an Endpoint may declare; any other is a type error. */
export type Method = (typeof methods)[number];

/** The statuses a Success may declare, as values, so the runtime repeats the type's rule. */
export const successStatuses = [200, 201, 202, 203, 204] as const;

/** The statuses a Success may declare: 205 and 206 carry semantics cf-loom does not implement. */
export type SuccessStatus = (typeof successStatuses)[number];

type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

type NumberOf<Text> = Text extends `${infer Value extends number}` ? Value : never;

/** The statuses a declared Rejection may have: a business decision is always the Caller's 4xx. */
export type RejectionStatus = NumberOf<`4${Digit}${Digit}`>;

/** Whether a value is a status a declared Rejection may have, as the runtime repeats the type. */
export function isRejectionStatus(status: unknown): status is RejectionStatus {
  return Number.isInteger(status) && typeof status === 'number' && status >= 400 && status <= 499;
}

type UpperCaseHeaderNames<Schema> =
  Schema extends core.$ZodObject<infer Shape>
    ? Exclude<LiteralNames<keyof Shape>, Lowercase<keyof Shape & string>>
    : never;

/** What a headers schema must also satisfy: header names have one spelling, lower-case. */
export type HeaderNamesRule<Schema> = [UpperCaseHeaderNames<Schema>] extends [never]
  ? unknown
  : `Header names are lower-case: ${JoinedNames<UpperCaseHeaderNames<Schema>>}`;
