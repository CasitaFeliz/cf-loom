import type { MessageMeta } from '@cf-loom/handlers';
import type { Broker, CommandSender, EventPublisher } from '@cf-loom/messaging';
import type { BrokerLimits, BrokerPlan, JetStreamConnecting } from '@cf-loom/messaging/jetstream';
import type { contract } from './contract/index.ts';
import type { Resources } from './resources.ts';

export type Orders = {
  find(
    orderId: string,
    callerId: string,
  ): Promise<
    | {
        id: string;
        status: 'pending' | 'paid';
        total: { amount: number; currency: string };
        locked: boolean;
        lockedAt: string;
      }
    | undefined
  >;
};
export type Callers = { byKey(key: string | undefined): Promise<{ id: string } | undefined> };
export type Permissions = { of(userId: string): Promise<string[]> };
export type Notifications = { send(paymentId: string): Promise<void> };

export declare function ordersRepository(): Promise<Orders>;
export declare function mongoOrders(): Promise<Orders>;
export declare function mongoCallers(): Promise<Callers>;
export declare function mongoPermissions(): Promise<Permissions>;
export declare function mongoNotifications(): Promise<Notifications>;
export declare function preflight(request: Request): Response;

export declare const resources: Resources;
export declare const orders: Orders;
export declare const notifications: Notifications;
export declare const ORDER_ID: string;
export declare const baseUrl: string;
export declare const broker: Broker;
export declare const plan: BrokerPlan;
export declare const limits: BrokerLimits;
export declare const connecting: JetStreamConnecting;
export declare const newOrder: { customerId: string; total: { amount: number; currency: string } };
export declare const body: { paymentId: string; method: 'card' | 'transfer' };

export declare const publisher: EventPublisher<typeof contract>;
export declare const sender: CommandSender<typeof contract>;
export declare const orderId: string;
export declare const total: { amount: number; currency: string };
export declare const order: { id: string };
export declare const meta: MessageMeta;
