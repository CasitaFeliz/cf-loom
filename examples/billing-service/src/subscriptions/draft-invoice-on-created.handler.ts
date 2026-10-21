import { handle } from '@cf-loom/handlers';
import { draftOnce } from '../billing/drafts.ts';
import { draftInvoiceOnCreated } from '../readers.generated.ts';

export default handle(draftInvoiceOnCreated, ({ orderId, total }) => {
  draftOnce(orderId, total);
});
