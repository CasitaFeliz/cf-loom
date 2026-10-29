export const settlePayment = defineEndpoint({
  name: 'settlePayment',
  method: 'POST',
  path: '/payments/:paymentId/settle',
  visibility: 'internal',
  description: 'Settles a payment once the Provider has it',
  input: { params: z.object({ paymentId: z.string() }) },
  success: { status: 200, body: z.object({ amount: z.int() }) },
});
