import type * as core from 'zod/v4/core';

/** The HTTP methods an Endpoint may declare; any other is a type error. */
export type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

/** The statuses a Success may declare: 205 and 206 carry HTTP semantics cf-loom does not implement. */
export type SuccessStatus = 200 | 201 | 202 | 203 | 204;

type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

type NumberOf<Text> = Text extends `${infer Value extends number}` ? Value : never;

/** The statuses a declared Rejection may have: a business decision is always the Caller's 4xx. */
export type RejectionStatus = NumberOf<`4${Digit}${Digit}`>;

type UpperCaseHeaderNames<Schema> =
  Schema extends core.$ZodObject<infer Shape>
    ? Exclude<keyof Shape & string, Lowercase<keyof Shape & string>>
    : never;

/** What a headers schema must also satisfy: header names have one spelling, lower-case. */
export type LowerCaseHeaderNames<Schema> = [UpperCaseHeaderNames<Schema>] extends [never]
  ? unknown
  : `Header names are lower-case: ${UpperCaseHeaderNames<Schema>}`;
