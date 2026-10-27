import { handle } from '@cf-loom/handlers';
import { readers } from '../generated/readers.generated.ts';
import { draftOnce } from './drafts.ts';

export default handle(readers.subscriptions.draftInvoiceOnCreated, ({ orderId, total }) => {
  draftOnce(orderId, total);
});
