import { z } from 'zod';
import type { ExportedSnapshot } from '../snapshot/index.ts';
import { exportedEndpoint, exportedEvent } from './elements.ts';
import { byKey } from './maps.ts';
import { code, def, guard } from './structure.ts';

/** Format 1's structure of an exported Snapshot: the cut a Contract Package carries, every key and value closed. */
export const exportedSnapshot: z.ZodType<ExportedSnapshot> = z.strictObject({
  format: z.literal(1),
  defs: byKey(def),
  endpoints: byKey(exportedEndpoint),
  events: byKey(exportedEvent),
  guards: byKey(guard),
  codes: byKey(code),
});
