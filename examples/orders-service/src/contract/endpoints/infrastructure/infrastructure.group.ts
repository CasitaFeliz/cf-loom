import { defineGroup } from '@casitafeliz/loom-contract';
import { health } from './health.endpoint.ts';

export const infrastructureGroup = defineGroup({
  name: 'infrastructure',
  description: 'What the Service’s own infrastructure calls',
  endpoints: [health],
});
