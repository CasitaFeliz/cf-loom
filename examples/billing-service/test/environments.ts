// biome-ignore-all lint/style/useNamingConvention: the environment variables the Services read

/** What a test puts in front of every name and subject on the Broker, so it shares nothing with another environment. */
export const brokerPrefix = 't-1';

/** The environment a test starts orders-service with, which holds only these settings, so no NATS_URL of the test's own reaches it. */
export function ordersEnvironment(natsUrl: string): Record<string, string> {
  return { BROKER_PREFIX: brokerPrefix, NATS_URL: natsUrl, PORT: '0' };
}

/** The environment a test starts billing-service with, calling the orders-service at `ordersUrl`. */
export function billingEnvironment(natsUrl: string, ordersUrl: string): Record<string, string> {
  return {
    ...ordersEnvironment(natsUrl),
    ORDERS_SERVICE_API_KEY: 'billing-key',
    ORDERS_SERVICE_URL: ordersUrl,
  };
}
