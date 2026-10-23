import { Socket } from 'node:net';

/** Makes any connection the process tries throw, so a Service started by a refusal test reaches no NATS. */
Socket.prototype.connect = () => {
  throw new Error('the Service tried to open a connection');
};
