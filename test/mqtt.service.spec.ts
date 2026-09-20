import { MqttService } from '../src/mqtt.service';
import { createMockClient } from './helpers/mock-client';

describe('mqtt.service', () => {
  let client: any;
  let service: MqttService;

  beforeEach(() => {
    client = createMockClient();
    service = new MqttService(client);
  });

  describe('subscribe', () => {
    it('resolves with the granted subscriptions', async () => {
      const granted = [{ topic: 'a/b', qos: 1 }];
      client.subscribe.mockImplementation((t, o, cb) => {
        cb(null, granted);
        return client;
      });
      await expect(service.subscribe('a/b', { qos: 1 })).resolves.toBe(granted);
      expect(client.subscribe).toHaveBeenCalledWith('a/b', { qos: 1 }, expect.any(Function));
    });

    it('defaults the options to null when omitted', async () => {
      await service.subscribe('a/b');
      expect(client.subscribe).toHaveBeenCalledWith('a/b', null, expect.any(Function));
    });

    it('rejects when the client reports an error', async () => {
      client.subscribe.mockImplementation((t, o, cb) => {
        cb(new Error('nope'));
        return client;
      });
      await expect(service.subscribe('a/b')).rejects.toThrow('nope');
    });
  });

  describe('unsubscribe', () => {
    it('resolves with the packet', async () => {
      const packet = { cmd: 'unsubscribe' };
      client.unsubscribe.mockImplementation((t, o, cb) => {
        cb(null, packet);
        return client;
      });
      await expect(service.unsubscribe('a/b')).resolves.toBe(packet);
      expect(client.unsubscribe).toHaveBeenCalledWith('a/b', null, expect.any(Function));
    });

    it('rejects when the client reports an error', async () => {
      client.unsubscribe.mockImplementation((t, o, cb) => {
        cb(new Error('nope'));
        return client;
      });
      await expect(service.unsubscribe('a/b')).rejects.toThrow('nope');
    });
  });

  describe('publish', () => {
    it('JSON-stringifies object messages and passes the options through', async () => {
      await service.publish('a/b', { a: 1 }, { qos: 1 });
      expect(client.publish).toHaveBeenCalledWith('a/b', '{"a":1}', { qos: 1 }, expect.any(Function));
    });

    it('sends string messages untouched and JSON-stringifies object-like values (incl. Buffer)', async () => {
      // documented current behavior: publish() stringifies every "object",
      // so Buffers are serialized as {"type":"Buffer",...} (see mqtt.service.ts)
      const raw = Buffer.from('raw');
      await service.publish('a/b', 'text');
      await service.publish('a/b', raw);
      expect(client.publish).toHaveBeenNthCalledWith(1, 'a/b', 'text', null, expect.any(Function));
      expect(client.publish).toHaveBeenNthCalledWith(2, 'a/b', JSON.stringify(raw), null, expect.any(Function));
    });

    it('defaults the options to null when omitted', async () => {
      await service.publish('a/b', 'x');
      expect(client.publish).toHaveBeenCalledWith('a/b', 'x', null, expect.any(Function));
    });

    it('rejects when the client reports an error', async () => {
      client.publish.mockImplementation((t, m, o, cb) => {
        cb(new Error('nope'));
        return client;
      });
      await expect(service.publish('a/b', 'x')).rejects.toThrow('nope');
    });
  });

  describe('onApplicationShutdown', () => {
    it('ends gracefully when connected: flushes and sends DISCONNECT (no Last Will)', async () => {
      client.connected = true;
      await service.onApplicationShutdown();
      expect(client.endAsync).toHaveBeenCalledTimes(1);
      expect(client.endAsync).toHaveBeenCalledWith();
    });

    it('bounds the graceful wait so a half-open dead socket cannot hang close()', async () => {
      jest.useFakeTimers();
      try {
        client.connected = true;
        // never-settling endAsync: outgoingEmpty never fires on a dead socket
        client.endAsync.mockImplementation(() => new Promise<void>(() => {}));
        const pending = service.onApplicationShutdown();
        await jest.advanceTimersByTimeAsync(5000); // MqttService.SHUTDOWN_GRACE_MS (private const in src)
        await pending; // would hang the test if the grace race did not exist
        expect(client.endAsync).toHaveBeenCalledWith();
      } finally {
        jest.useRealTimers();
      }
    });

    it('force-ends when already disconnected', async () => {
      client.connected = false;
      await service.onApplicationShutdown();
      expect(client.endAsync).toHaveBeenCalledTimes(1);
      expect(client.endAsync).toHaveBeenCalledWith(true);
    });
  });
});
