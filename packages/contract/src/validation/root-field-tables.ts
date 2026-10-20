import type {
  Application,
  Command,
  Contract,
  Dependencies,
  Event,
  ExportedElements,
  Subscription,
} from '../declarations/index.ts';
import type { Declarations } from '../written/index.ts';
import type { Fields, KnownFields } from './declared-fields.ts';
import { definitionsFields } from './field-tables.ts';

const contractFields = {
  declared: {
    kind: true,
    name: true,
    definitions: true,
    groups: true,
    events: true,
    commands: true,
    subscriptions: true,
    dependencies: true,
  },
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
  objects: {},
} satisfies Fields<Command>;

/** The fields of a Subscription. */
export const subscriptionFields = {
  declared: { kind: true, name: true, event: true },
  required: { kind: true, name: true, event: true },
  strings: { kind: true, name: true },
  objects: {},
} satisfies Fields<Subscription>;

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
    exportedSnapshot: true,
  },
  required: {
    kind: true,
    provider: true,
    against: true,
    standardRejections: true,
    endpoints: true,
    events: true,
    exported: true,
    exportedSnapshot: true,
  },
  strings: { kind: true, provider: true, against: true },
  objects: {
    standardRejections: true,
    endpoints: true,
    events: true,
    exported: true,
    exportedSnapshot: true,
  },
} satisfies Fields<Dependencies>;

/** The Elements a Dependency keeps as its Provider exported them. */
export const exportedFields = {
  declared: { endpoints: true, events: true },
  required: { endpoints: true, events: true },
  strings: {},
  objects: { endpoints: true, events: true },
} satisfies Fields<ExportedElements>;

/** The fields of each kind of root. */
export const rootFields: Readonly<Record<Declarations['root']['kind'], KnownFields>> = {
  contract: contractFields,
  application: applicationFields,
  definitions: definitionsFields,
};
