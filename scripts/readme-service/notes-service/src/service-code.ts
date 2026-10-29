export type Notes = { find(noteId: string): Promise<{ id: string; text: string } | undefined> };

export async function notesRepository(): Promise<Notes> {
  return { find: async (noteId) => ({ id: noteId, text: 'A note' }) };
}
