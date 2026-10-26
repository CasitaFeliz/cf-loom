import { z } from 'zod';
import { lifecycles } from '../declarations/index.ts';
import type { ExportedSnapshot, ShadowingSnapshot } from '../snapshot/index.ts';
import { exportedEndpoint, exportedEvent } from './elements.ts';
import { byEndpointIdentity, byKey } from './maps.ts';
import { code, def, guard } from './structure.ts';

/** Format 1's entry of a declared Endpoint the package does not export: its lifecycle alone. */
const shadowingEntry: z.ZodType<ShadowingSnapshot> = z.strictObject({
  lifecycle: z.enum(lifecycles),
});

/** Format 1's structure of an exported Snapshot: the cut a Contract Package carries, every key and value closed. */
export const exportedSnapshot: z.ZodType<ExportedSnapshot> = z.strictObject({
  format: z.literal(1),
  defs: byKey(def),
  endpoints: byEndpointIdentity(exportedEndpoint),
  events: byKey(exportedEvent),
  guards: byKey(guard),
  codes: byKey(code),
  shadowing: byEndpointIdentity(shadowingEntry),
});
