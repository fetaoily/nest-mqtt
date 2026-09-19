// EventEmitter-based MqttClient mock: subscribe/publish/unsubscribe invoke
// their callback synchronously, endAsync resolves like mqtt's force close.
import { EventEmitter } from 'node:events';

export function createMockClient(): any {
  const client: any = new EventEmitter();
  client.subscribe = jest.fn((topic: unknown, opts: unknown, cb?: (err: Error | null, granted?: unknown) => void) => {
    if (typeof cb === 'function') cb(null);
    return client;
  });
  client.unsubscribe = jest.fn((topic: unknown, opts: unknown, cb?: (err: Error | null, packet?: unknown) => void) => {
    if (typeof cb === 'function') cb(null, {});
    return client;
  });
  client.publish = jest.fn(
    (topic: unknown, message: unknown, opts: unknown, cb?: (err: Error | null, packet?: unknown) => void) => {
      if (typeof cb === 'function') cb(null, {});
      return client;
    },
  );
  client.endAsync = jest.fn(async () => client);
  return client;
}
