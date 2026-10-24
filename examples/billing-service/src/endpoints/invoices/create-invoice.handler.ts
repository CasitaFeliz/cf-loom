import { notFound } from '@cf-loom/contract';
import { fault, handle, reject, success } from '@cf-loom/handlers';
import { invoiceFor } from '../../billing/invoice-for.ts';
import { createInvoice } from '../../contract/endpoints/invoices/create-invoice.endpoint.ts';
import { orderLocked } from '../../contract/rejections/order-locked.rejection.ts';
import { orderNotBillable } from '../../contract/rejections/order-not-billable.rejection.ts';
import type { Needs } from '../../resources.ts';

export default handle(
  createInvoice,
  async ({ body }, _context, { resources: { orders } }: Needs<'orders'>) => {
    const invoicing = await invoiceFor(orders, body.orderId);
    switch (invoicing.kind) {
      case 'invoice':
        return success(invoicing.invoice);
      case 'not-found':
        return reject(notFound);
      case 'locked':
        return reject(orderLocked, { lockedAt: invoicing.lockedAt });
      case 'not-billable':
        return reject(orderNotBillable, { orderStatus: invoicing.orderStatus });
      case 'unavailable': {
        const { retryable } = invoicing;
        return fault({ committed: 'no', retryable, message: 'orders-service is unavailable' });
      }
    }
  },
);
