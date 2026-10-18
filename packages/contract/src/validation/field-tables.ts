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

/** What a kind of object declares: its fields, the ones it requires, and the strings among them. */
export type Fields<Shape> = {
  readonly declared: Readonly<Record<keyof Shape, true>>;
  readonly required: readonly (keyof Shape & string)[];
  readonly strings: readonly (keyof Shape & string)[];
};

/** The fields of a kind as the rule reads them, whatever the kind. */
export type KnownFields = Fields<Record<string, unknown>>;

const contractFields = {
  declared: { kind: true, name: true, definitions: true, groups: true, dependencies: true },
  required: ['name'],
  strings: ['name'],
} satisfies Fields<Contract>;
const applicationFields = {
  declared: { kind: true, name: true, dependencies: true },
  required: ['name', 'dependencies'],
  strings: ['name'],
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
  required: ['name'],
  strings: ['name'],
} satisfies Fields<Definitions>;
/** The fields of a Group. */
export const groupFields = {
  declared: { kind: true, name: true, description: true, endpoints: true },
  required: ['name', 'description', 'endpoints'],
  strings: ['name', 'description'],
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
  required: ['name', 'method', 'path', 'visibility', 'description', 'success'],
  strings: ['name', 'path', 'description'],
} satisfies Fields<Endpoint>;
/** The parts of an Endpoint's `input`. */
export const inputFields = {
  declared: { params: true, query: true, headers: true, body: true },
  required: [],
  strings: [],
} satisfies Fields<NonNullable<Endpoint['input']>>;
/** The fields of an Endpoint's `success`. */
export const successFields = {
  declared: { status: true, headers: true, body: true },
  required: ['status'],
  strings: [],
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
  required: ['name', 'description'],
  strings: ['name', 'description'],
} satisfies Fields<Guard>;
/** The parts the Guard demands rule judges stay out of this one, so each is reported once. */
export const demandsFields = {
  declared: { headers: true, query: true, params: true, body: true },
  required: [],
  strings: [],
} satisfies Fields<NonNullable<Guard['demands']>>;
/** The fields of a Rejection. */
export const rejectionFields = {
  declared: { kind: true, code: true, status: true, message: true, body: true },
  required: ['code', 'status', 'message'],
  strings: ['code', 'message'],
} satisfies Fields<Rejection>;
/** The fields of a qualified Attachment. */
export const attachmentFields = {
  declared: { guard: true, qualifier: true },
  required: ['guard', 'qualifier'],
  strings: [],
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
  required: ['provider', 'against', 'standardRejections', 'endpoints', 'events', 'exported'],
  strings: ['provider', 'against'],
} satisfies Fields<Dependencies>;
/** The three Standard Rejections a Definitions Package may declare. */
export const standardRejectionsFields = {
  declared: { invalidInput: true, notFound: true, notImplemented: true },
  required: [],
  strings: [],
} satisfies Fields<StandardRejectionDeclarations>;
/** The fields of one declared Standard Rejection. */
export const standardRejectionFields = {
  declared: { code: true, status: true, message: true },
  required: ['code', 'status', 'message'],
  strings: ['code', 'message'],
} satisfies Fields<StandardRejectionDeclaration>;

/** The fields of each kind of root. */
export const rootFields: Readonly<Record<Declarations['root']['kind'], KnownFields>> = {
  contract: contractFields,
  application: applicationFields,
  definitions: definitionsFields,
};
