import type {
  Application,
  Command,
  Contract,
  Definitions,
  Dependency,
  Event,
  Group,
  Subscription,
} from '../declarations/index.ts';
import type { Declarations } from '../written/index.ts';
import type { Fields, KnownFields } from './declared-fields.ts';

const contractFields = {
  declared: {
    kind: true,
    name: true,
    definitions: true,
    groups: true,
    dependencies: true,
  },
  required: { kind: true, name: true },
  strings: { kind: true, name: true },
  texts: {},
  objects: {},
} satisfies Fields<Contract>;

const applicationFields = {
  declared: { kind: true, name: true, dependencies: true },
  required: { kind: true, name: true },
  strings: { kind: true, name: true },
  texts: {},
  objects: {},
} satisfies Fields<Application>;

/** The fields of an Event's Message Version. */
export const eventFields = {
  declared: {
    kind: true,
    name: true,
    version: true,
    visibility: true,
    description: true,
    body: true,
    lifecycle: true,
  },
  required: {
    kind: true,
    name: true,
    version: true,
    visibility: true,
    description: true,
    body: true,
  },
  strings: { kind: true, name: true, visibility: true, description: true, lifecycle: true },
  texts: { description: true },
  objects: {},
} satisfies Fields<Event>;

/** The fields of a Command's Message Version: an Event's but its Visibility. */
export const commandFields = {
  declared: {
    kind: true,
    name: true,
    version: true,
    description: true,
    body: true,
    lifecycle: true,
  },
  required: { kind: true, name: true, version: true, description: true, body: true },
  strings: { kind: true, name: true, description: true, lifecycle: true },
  texts: { description: true },
  objects: {},
} satisfies Fields<Command>;

/** The fields of a Subscription. */
export const subscriptionFields = {
  declared: { kind: true, name: true, description: true, event: true },
  required: { kind: true, name: true, description: true, event: true },
  strings: { kind: true, name: true, description: true },
  texts: { description: true },
  objects: {},
} satisfies Fields<Subscription>;

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
  texts: {},
  objects: { schemas: true, standardRejections: true },
} satisfies Fields<Definitions>;

/** The fields of a Group. */
export const groupFields = {
  declared: {
    kind: true,
    name: true,
    description: true,
    endpoints: true,
    events: true,
    commands: true,
    subscriptions: true,
  },
  required: { kind: true, name: true, description: true },
  strings: { kind: true, name: true, description: true },
  texts: { description: true },
  objects: {},
} satisfies Fields<Group>;

/**
 * A Dependency's fields as the field rules judge them: its provider and its Endpoints are the
 * Dependency rule's, which reports them in its own terms.
 */
type DependencyFields = {
  readonly kind: Dependency['kind'];
  readonly provider?: unknown;
  readonly endpoints?: unknown;
};

/** The fields of a Dependency, as `defineDependency` builds it. */
export const dependencyFields = {
  declared: { kind: true, provider: true, endpoints: true },
  required: { kind: true },
  strings: { kind: true },
  texts: {},
  objects: {},
} satisfies Fields<DependencyFields>;

/** The fields of each kind of root. */
export const rootFields: Readonly<Record<Declarations['root']['kind'], KnownFields>> = {
  contract: contractFields,
  application: applicationFields,
  definitions: definitionsFields,
};
