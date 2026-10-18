import type { QualifiedAttachment } from '../attachment.ts';
import type { Definitions } from '../definitions.ts';
import type { Dependencies } from '../dependencies.ts';
import type { Endpoint } from '../endpoint.ts';
import type { Group } from '../group.ts';
import type { Guard } from '../guard.ts';
import type { Rejection } from '../rejection.ts';
import type { Application, Contract } from '../roots.ts';
import type {
  StandardRejectionDeclaration,
  StandardRejectionDeclarations,
} from '../standard-rejections.ts';
import type { Declarations } from './declarations.ts';

/** The keys a shape requires: the ones an empty object lacks. */
type RequiredKeys<Shape> = {
  [Key in keyof Shape]-?: Record<never, never> extends Pick<Shape, Key> ? never : Key;
}[keyof Shape];

/** The keys a shape types as strings, literals included. */
type StringKeys<Shape> = {
  [Key in keyof Shape]-?: NonNullable<Shape[Key]> extends string ? Key : never;
}[keyof Shape];

/** What is no written object part: a list, a zod schema or a declaration. */
type NonPart = readonly unknown[] | Readonly<Record<'_zod', unknown>> | { readonly kind: string };

/** Whether a type is a map of values by name, as `schemas` or a Dependency's `endpoints` are. */
type IsMap<Value> = string extends keyof Value ? true : false;

/** The keys a shape types as objects an author writes part by part; a key typed `unknown` is none. */
type ObjectKeys<Shape> = {
  [Key in keyof Shape]-?: unknown extends Shape[Key]
    ? never
    : IsMap<NonNullable<Shape[Key]>> extends true
      ? Key
      : NonNullable<Shape[Key]> extends NonPart
        ? never
        : NonNullable<Shape[Key]> extends object
          ? Key
          : never;
}[keyof Shape];

/**
 * What a kind of object declares, as maps so `satisfies` demands exactly the type's fields, the
 * ones it requires, the strings among them, and the parts written as objects.
 */
export type Fields<Shape> = {
  readonly declared: Readonly<Record<keyof Shape, true>>;
  readonly required: Readonly<Record<RequiredKeys<Shape>, true>>;
  readonly strings: Readonly<Record<StringKeys<Shape>, true>>;
  readonly objects: Readonly<Record<ObjectKeys<Shape>, true>>;
};

/** The fields of a kind as the rule reads them, whatever the kind. */
export type KnownFields = Fields<Record<string, unknown>>;

/** The parts of a Guard's `demands` the Guard demands rule leaves to this one. */
type Demanded = Pick<NonNullable<Guard['demands']>, 'headers' | 'query'>;

const contractFields = {
  declared: { kind: true, name: true, definitions: true, groups: true, dependencies: true },
  required: { kind: true, name: true },
  strings: { kind: true, name: true },
  objects: {},
} satisfies Fields<Contract>;

const applicationFields = {
  declared: { kind: true, name: true, dependencies: true },
  required: { kind: true, name: true, dependencies: true },
  strings: { kind: true, name: true },
  objects: {},
} satisfies Fields<Application>;

/** The fields of a Definitions Package. */
export const definitionsFields = {
  declared: {
    kind: true,
    name: true,
    guards: true,
    schemas: true,
    rejections: true,
    standardRejections: true,
  },
  required: { kind: true, name: true },
  strings: { kind: true, name: true },
  objects: { schemas: true, standardRejections: true },
} satisfies Fields<Definitions>;

/** The fields of a Group. */
export const groupFields = {
  declared: { kind: true, name: true, description: true, endpoints: true },
  required: { kind: true, name: true, description: true, endpoints: true },
  strings: { kind: true, name: true, description: true },
  objects: {},
} satisfies Fields<Group>;

/** The fields of an Endpoint. */
export const endpointFields = {
  declared: {
    kind: true,
    name: true,
    method: true,
    path: true,
    visibility: true,
    description: true,
    input: true,
    success: true,
    guards: true,
    rejections: true,
    lifecycle: true,
  },
  required: {
    kind: true,
    name: true,
    method: true,
    path: true,
    visibility: true,
    description: true,
    success: true,
  },
  strings: {
    kind: true,
    name: true,
    method: true,
    path: true,
    visibility: true,
    description: true,
    lifecycle: true,
  },
  objects: { input: true, success: true },
} satisfies Fields<Endpoint>;

/** The parts of an Endpoint's `input`. */
export const inputFields = {
  declared: { params: true, query: true, headers: true, body: true },
  required: {},
  strings: {},
  objects: {},
} satisfies Fields<NonNullable<Endpoint['input']>>;

/** The fields of an Endpoint's `success`. */
export const successFields = {
  declared: { status: true, headers: true, body: true },
  required: { status: true },
  strings: {},
  objects: {},
} satisfies Fields<Endpoint['success']>;

/** The fields of a Guard. */
export const guardFields = {
  declared: {
    kind: true,
    name: true,
    description: true,
    demands: true,
    guards: true,
    context: true,
    qualifier: true,
    rejections: true,
  },
  required: { kind: true, name: true, description: true },
  strings: { kind: true, name: true, description: true },
  objects: { demands: true },
} satisfies Fields<Guard>;

/** The parts of a Guard's `demands`; `params` and `body` are the Guard demands rule's. */
export const demandsFields = {
  declared: { headers: true, query: true, params: true, body: true },
  required: {},
  strings: {},
  objects: {},
} satisfies Fields<Demanded> & {
  readonly declared: Record<keyof NonNullable<Guard['demands']>, true>;
};

/** The fields of a Rejection. */
export const rejectionFields = {
  declared: { kind: true, code: true, status: true, message: true, body: true },
  required: { kind: true, code: true, status: true, message: true },
  strings: { kind: true, code: true, message: true },
  objects: {},
} satisfies Fields<Rejection>;

/** The fields of a qualified Attachment. */
export const attachmentFields = {
  declared: { guard: true, qualifier: true },
  required: { guard: true, qualifier: true },
  strings: {},
  objects: {},
} satisfies Fields<QualifiedAttachment>;

/** The fields of a Dependency, as `defineDependencies` builds it. */
export const dependenciesFields = {
  declared: {
    kind: true,
    provider: true,
    against: true,
    standardRejections: true,
    endpoints: true,
    events: true,
    exported: true,
  },
  required: {
    kind: true,
    provider: true,
    against: true,
    standardRejections: true,
    endpoints: true,
    events: true,
    exported: true,
  },
  strings: { kind: true, provider: true, against: true },
  objects: { standardRejections: true, endpoints: true, events: true, exported: true },
} satisfies Fields<Dependencies>;

/** The three Standard Rejections a Definitions Package may declare. */
export const standardRejectionsFields = {
  declared: { invalidInput: true, notFound: true, notImplemented: true },
  required: {},
  strings: {},
  objects: { invalidInput: true, notFound: true, notImplemented: true },
} satisfies Fields<StandardRejectionDeclarations>;

/** The fields of one declared Standard Rejection. */
export const standardRejectionFields = {
  declared: { code: true, status: true, message: true },
  required: { code: true, status: true, message: true },
  strings: { code: true, message: true },
  objects: {},
} satisfies Fields<StandardRejectionDeclaration>;

/** The fields of each kind of root. */
export const rootFields: Readonly<Record<Declarations['root']['kind'], KnownFields>> = {
  contract: contractFields,
  application: applicationFields,
  definitions: definitionsFields,
};
