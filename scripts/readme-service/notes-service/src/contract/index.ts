import { getNote } from './endpoints/notes/get-note.endpoint.ts';

const notesGroup = defineGroup({ name: 'notes', description: 'Notes', endpoints: [getNote] });

export const contract = defineService({ name: 'notes-service', groups: [notesGroup] });
