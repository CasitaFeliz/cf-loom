import type { Http, ServiceContract } from '@cf-loom/contract';
import { allowedMethodsOf, type Closed, type Matchable } from '@cf-loom/contract/internal';
import type { HandlerMapOf, ResourcesOf } from '@cf-loom/handlers';
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  RawServerBase,
  RouteGenericInterface,
} from 'fastify';
import {
  type ServedHandlers,
  type ServeOptions,
  type Serving,
  servingOf,
} from '../answering/index.ts';
import {
  type Incoming,
  incomingRequestOf,
  incomingUrlOf,
  unreadableResponse,
} from '../incoming/index.ts';
import { respondedWith, type Taken, takenOf } from '../outgoing/index.ts';

/**
 * A Fastify plugin that answers a Contract's Endpoints with their Handlers inside the app, taking
 * from Fastify every request whose method and path a declared Endpoint has and leaving the rest
 * to the app's own routes. It takes what `serve` takes but `fallback`.
 */
export function fastifyServe<
  const C extends ServiceContract,
  const Handlers extends Pick<HandlerMapOf<C, never>, 'endpoints' | 'guards'>,
  const Given extends Omit<
    ServeOptions<ResourcesOf<Pick<Handlers, 'endpoints' | 'guards'>>>,
    'fallback'
  >,
>(
  contract: C,
  handlers: Handlers,
  options: Closed<Given, Omit<ServeOptions<object>, 'fallback'>>,
): FastifyPluginAsync;
export function fastifyServe(
  contract: ServiceContract,
  handlers: ServedHandlers,
  options: Omit<ServeOptions<object>, 'fallback'>,
): FastifyPluginAsync {
  const serving = servingOf(contract, handlers, options);
  const plugin: FastifyPluginAsync<Record<never, never>, RawServerBase> = async (
    instance,
    registration,
  ) => {
    refusedBy(instance, registration);
    instance.addHook('onRequest', async (request, reply) => {
      await answeredWhenServed(serving, request, reply);
    });
  };
  return Object.assign(plugin, {
    [Symbol.for('skip-override')]: true,
    [Symbol.for('fastify.display-name')]: 'fastifyServe',
  });
}

/** Throws unless the plugin is registered on the app itself, with no prefix. */
function refusedBy(
  instance: FastifyInstance<RawServerBase>,
  registration: { readonly prefix?: unknown },
) {
  if (registration.prefix) {
    throw new Error(
      `fastifyServe: registered with the prefix ${String(registration.prefix)}; register it with none: an Endpoint's path is its whole path`,
    );
  }
  if (Object.getPrototypeOf(instance) !== Object.prototype) {
    throw new Error(
      'fastifyServe: registered inside an encapsulated plugin, where its hook would cover only that plugin; register it on the app',
    );
  }
}

/**
 * Takes the request from Fastify and answers it when a declared Endpoint has its method and path;
 * any other goes on to the app.
 */
async function answeredWhenServed(
  serving: Serving,
  request: FastifyRequest<RouteGenericInterface, RawServerBase>,
  reply: FastifyReply<RouteGenericInterface, RawServerBase>,
) {
  const url = servedUrlOf(serving.endpoints, request.raw);
  if (url === undefined) {
    return;
  }
  reply.hijack();
  const taken = takenOf(request.raw, reply.raw, reply.getHeaders());
  await respondedWith(taken, answeredFor(serving.http, taken, url));
}

/** What answers a request taken from Fastify: `serve`'s Response, or 400 when no `Request` can be built. */
async function answeredFor(http: Http, { incoming, closed }: Taken, url: URL): Promise<Response> {
  const asked = incomingRequestOf(incoming, url, closed);
  return asked === undefined ? unreadableResponse() : await http(asked);
}

/** The URL of a request whose method and path a declared Endpoint has, or none. */
function servedUrlOf(endpoints: readonly Matchable[], incoming: Incoming): URL | undefined {
  const read = incomingUrlOf(incoming);
  if (read.kind !== 'url') {
    return undefined;
  }
  const methods = allowedMethodsOf(endpoints, { url: read.url.href });
  return methods.includes(incoming.method ?? '') ? read.url : undefined;
}
