import { notFound } from '@cf-loom/contract';
import { handle, reject } from '@cf-loom/handlers';
import { getPayment } from '../../contract/endpoints/payments/get-payment.endpoint.ts';

export default handle(getPayment, () => reject(notFound));
