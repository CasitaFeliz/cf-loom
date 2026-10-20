import { defineGroup } from '@cf-loom/contract';
import { health } from './health.endpoint.ts';

export const infrastructureGroup = defineGroup({
  name: 'infrastructure',
  description: 'What the Service’s own infrastructure calls',
  endpoints: [health],
});
