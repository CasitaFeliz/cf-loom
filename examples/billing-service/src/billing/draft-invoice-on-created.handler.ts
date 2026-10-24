import { handle } from '@cf-loom/handlers';
import { draftInvoiceOnCreated } from '../generated/readers.generated.ts';
import { draftOnce } from './drafts.ts';

export default handle(draftInvoiceOnCreated, ({ orderId, total }) => {
  draftOnce(orderId, total);
});
