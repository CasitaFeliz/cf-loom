import {
  byCodePoint,
  codeNameOf,
  type EndpointSnapshot,
  type EventSnapshot,
  nameAndVersionOf,
  type WholeExportedSnapshot,
} from '@cf-loom/contract/internal';

/** An Endpoint the package exports, with the identity the Snapshot keys it by. */
export type ExportedEndpoint = { readonly id: string; readonly endpoint: EndpointSnapshot };

/** The Endpoints of the exported Snapshot by name, as the package's entry lists them. */
export function exportedEndpointsOf(exported: WholeExportedSnapshot): readonly ExportedEndpoint[] {
  return Object.entries(exported.endpoints)
    .map(([id, endpoint]): ExportedEndpoint => ({ id, endpoint }))
    .sort((left, right) => byCodePoint(left.endpoint.name, right.endpoint.name));
}

/** An Event's Message Version the package exports: its name and version, and its entry. */
export type ExportedEvent = {
  readonly name: string;
  readonly version: number;
  readonly event: EventSnapshot;
};

/** The Events of the exported Snapshot in code point order of their names in code, as the entry lists them. */
export function exportedEventsOf(exported: WholeExportedSnapshot): readonly ExportedEvent[] {
  return Object.entries(exported.events)
    .map(([id, event]): ExportedEvent => ({ ...nameAndVersionOf(id), event }))
    .sort((left, right) => byCodePoint(codeNameOf(left), codeNameOf(right)));
}
