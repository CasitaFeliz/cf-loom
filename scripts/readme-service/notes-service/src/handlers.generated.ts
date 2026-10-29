import { type HandlerMapOf, readersOf } from '@cf-loom/handlers';
import type { contract } from './contract/index.ts';
import getNote from './endpoints/notes/get-note.handler.ts';

export default {
  endpoints: { getNote },
  guards: {},
  commands: {},
  subscriptions: {},
  readers: readersOf({ commands: {}, subscriptions: {} }),
} satisfies HandlerMapOf<typeof contract>;
