import { defineGroup } from '@casitafeliz/loom-contract';
import { health } from './health.endpoint.ts';

export const operationsGroup = defineGroup({
  name: 'operations',
  description: 'What the Service’s own infrastructure calls',
  endpoints: [health],
});
