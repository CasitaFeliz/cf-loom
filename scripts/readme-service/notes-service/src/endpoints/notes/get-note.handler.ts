import { handle, success } from '@cf-loom/handlers';
import { getNote } from '../../contract/endpoints/notes/get-note.endpoint.ts';
import type { Notes } from '../../service-code.ts';

export default handle(
  getNote,
  async ({ params }, _call, { resources: { notes } }: { resources: { notes: Notes } }) => {
    await notes.find(params.noteId);
    return success({ id: params.noteId });
  },
);
