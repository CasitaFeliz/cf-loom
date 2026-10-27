import { defineGroup } from '@cf-loom/contract';
import { health } from '../endpoints/infrastructure/health.endpoint.ts';

export const infrastructureGroup = defineGroup({
  name: 'infrastructure',
  description: 'What the Service’s own infrastructure calls',
  endpoints: [health],
});
