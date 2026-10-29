import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServiceContract } from '@cf-loom/contract';
import { allowedMethodsOf, type Closed, type Matchable } from '@cf-loom/contract/internal';
import type { HandlerMapOf, ResourcesOf } from '@cf-loom/handlers';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  type ServedHandlers,
  type ServeOptions,
  type Serving,
  servingOf,
} from '../answering/index.ts';
import { closedSignalOf, incomingRequestOf, incomingUrlOf } from '../incoming/index.ts';
import { respondedWith } from '../outgoing/index.ts';

/**
 * A Fastify plugin that answers a Contract's Endpoints with their Handlers inside the app, beside
 * the app's own routes: a request whose method and path a declared Endpoint has, Retired ones
 * included, is taken from Fastify and answered as `serve` answers it; every other request goes on
 * to the app. Takes what `serve` takes but `fallback`, and runs `serve`'s startup checks when
 * called. Registering it with a prefix, inside an encapsulated plugin, or on an HTTP/2 app throws.
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
  const plugin: FastifyPluginAsync = async (instance, registration) => {
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

/** Throws unless the plugin is registered on the app itself, with no prefix, over HTTP/1. */
function refusedBy(instance: FastifyInstance, registration: { readonly prefix?: unknown }) {
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
  if (instance.initialConfig.http2) {
    throw new Error('fastifyServe: the app serves HTTP/2, which fastifyServe does not serve');
  }
}

/**
 * Takes the request from Fastify and answers it when a declared Endpoint has its method and path;
 * any other goes on to the app.
 */
async function answeredWhenServed(serving: Serving, request: FastifyRequest, reply: FastifyReply) {
  const url = servedUrlOf(serving.endpoints, request.raw);
  if (url === undefined) {
    return;
  }
  reply.hijack();
  const outgoing = reply.raw;
  setHeadersOfApp(outgoing, reply);
  const asked = incomingRequestOf(request.raw, url, closedSignalOf(outgoing));
  const response =
    asked === undefined ? new Response(null, { status: 400 }) : await serving.http(asked);
  await respondedWith(request.raw, outgoing, response);
}

/** The URL of a request whose method and path a declared Endpoint has, or none. */
function servedUrlOf(endpoints: readonly Matchable[], incoming: IncomingMessage): URL | undefined {
  const read = incomingUrlOf(incoming);
  if (read.kind !== 'url') {
    return undefined;
  }
  const methods = allowedMethodsOf(endpoints, { url: read.url.href });
  return methods.includes(incoming.method ?? '') ? read.url : undefined;
}

/** Writes the headers the app's earlier hooks set on the reply, which a hijacked reply no longer sends. */
function setHeadersOfApp(outgoing: ServerResponse, reply: FastifyReply) {
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) {
      outgoing.setHeader(name, value);
    }
  }
}
