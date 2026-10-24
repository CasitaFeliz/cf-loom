import type { ServiceSnapshot } from '@cf-loom/contract/internal';

/** An OpenAPI 3.1 document as `cf-loom openapi` prints it: a JSON value. */
export type OpenApiDocument = {
  readonly openapi: '3.1.1';
  readonly info: { readonly title: string; readonly version: string };
  readonly tags: readonly { readonly name: string }[];
  readonly paths: Readonly<Record<string, unknown>>;
  readonly components: { readonly schemas: Readonly<Record<string, unknown>> };
};

/** The document of a Service's Endpoints, or the line saying what of its Snapshot OpenAPI cannot name. */
export type OpenApiWritten =
  | { readonly kind: 'written'; readonly document: OpenApiDocument }
  | { readonly kind: 'unnamed'; readonly line: string };

/** The version a document carries, as the Contract Package `package` writes: only `publish` derives one. */
const localVersion = '0.0.0';

/** The OpenAPI document of a Service's Endpoints, as `serve` answers them. */
export function openApiDocumentOf(snapshot: ServiceSnapshot): OpenApiWritten {
  const document: OpenApiDocument = {
    openapi: '3.1.1',
    info: { title: snapshot.name, version: localVersion },
    tags: [],
    paths: {},
    components: { schemas: {} },
  };
  return { kind: 'written', document };
}
