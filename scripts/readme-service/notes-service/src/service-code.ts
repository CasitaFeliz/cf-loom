export type Notes = { find(noteId: string): Promise<{ id: string } | undefined> };

export async function notesRepository(): Promise<Notes> {
  return { find: async (noteId) => ({ id: noteId }) };
}
