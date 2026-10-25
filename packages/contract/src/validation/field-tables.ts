import type {
  Endpoint,
  Guard,
  QualifiedAttachment,
  Rejection,
  StandardRejectionDeclaration,
  StandardRejectionDeclarations,
} from '../declarations/index.ts';
import type { Fields } from './declared-fields.ts';

/** The parts of a Guard's `demands` the Guard demands rule leaves to this one. */
type Demanded = Pick<NonNullable<Guard['demands']>, 'headers' | 'query'>;

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
  texts: { description: true },
  objects: { input: true, success: true },
} satisfies Fields<Endpoint>;

/** The parts of an Endpoint's `input`. */
export const inputFields = {
  declared: { params: true, query: true, headers: true, body: true },
  required: {},
  strings: {},
  texts: {},
  objects: {},
} satisfies Fields<NonNullable<Endpoint['input']>>;

/** The fields of an Endpoint's `success`. */
export const successFields = {
  declared: { status: true, headers: true, body: true },
  required: { status: true },
  strings: {},
  texts: {},
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
  texts: { description: true },
  objects: { demands: true },
} satisfies Fields<Guard>;

/** The parts of a Guard's `demands`; `params` and `body` are the Guard demands rule's. */
export const demandsFields = {
  declared: { headers: true, query: true, params: true, body: true },
  required: {},
  strings: {},
  texts: {},
  objects: {},
} satisfies Fields<Demanded> & {
  readonly declared: Record<keyof NonNullable<Guard['demands']>, true>;
};

/** The fields of a Rejection. */
export const rejectionFields = {
  declared: { kind: true, code: true, status: true, message: true, body: true },
  required: { kind: true, code: true, status: true, message: true },
  strings: { kind: true, code: true, message: true },
  texts: { message: true },
  objects: {},
} satisfies Fields<Rejection>;

/** The fields of a qualified Attachment. */
export const attachmentFields = {
  declared: { guard: true, qualifier: true },
  required: { guard: true, qualifier: true },
  strings: {},
  texts: {},
  objects: {},
} satisfies Fields<QualifiedAttachment>;

/** The three Standard Rejections a Definitions Package may declare. */
export const standardRejectionsFields = {
  declared: { invalidInput: true, notFound: true, notImplemented: true },
  required: {},
  strings: {},
  texts: {},
  objects: { invalidInput: true, notFound: true, notImplemented: true },
} satisfies Fields<StandardRejectionDeclarations>;

/** The fields of one declared Standard Rejection. */
export const standardRejectionFields = {
  declared: { code: true, status: true, message: true },
  required: { code: true, status: true, message: true },
  strings: { code: true, message: true },
  texts: { message: true },
  objects: {},
} satisfies Fields<StandardRejectionDeclaration>;
