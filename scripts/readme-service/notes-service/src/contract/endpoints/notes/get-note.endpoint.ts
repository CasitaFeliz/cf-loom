export const getNote = defineEndpoint({
  name: 'getNote',
  method: 'GET',
  path: '/notes/:noteId',
  visibility: 'public',
  description: 'One note by id',
  input: { params: z.object({ noteId: z.uuid() }) },
  success: { status: 200, body: z.object({ id: z.uuid() }) },
});
