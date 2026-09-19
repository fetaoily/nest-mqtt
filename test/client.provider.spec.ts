import { MQTT_CLIENT_INSTANCE, MQTT_LOGGER_PROVIDER, MQTT_OPTION_PROVIDER } from '../src/mqtt.constants';
import { createClientProvider } from '../src/client.provider';
import { createMockClient } from './helpers/mock-client';
import { createMockLogger } from './helpers/mock-logger';

const connectMock = jest.fn();
jest.mock('mqtt', () => ({ connect: (...args: unknown[]) => connectMock(...args) }));

describe('createClientProvider', () => {
  let client: any;

  beforeEach(() => {
    client = createMockClient();
    connectMock.mockReset().mockReturnValue(client);
  });

  it('exposes the connected client under MQTT_CLIENT_INSTANCE', () => {
    const provider = createClientProvider() as any;
    expect(provider.provide).toBe(MQTT_CLIENT_INSTANCE);
    expect(provider.inject).toEqual([MQTT_OPTION_PROVIDER, MQTT_LOGGER_PROVIDER]);
  });

  it('connects with the given options and wires log events around the client', () => {
    const provider = createClientProvider() as any;
    const logger = createMockLogger();
    const returned = provider.useFactory({ host: 'localhost' }, logger);
    expect(returned).toBe(client);
    expect(connectMock).toHaveBeenCalledWith({ host: 'localhost' });
    ['connect', 'disconnect', 'error', 'reconnect', 'close', 'offline'].forEach((event) => {
      expect(client.listenerCount(event)).toBe(1);
    });
    client.emit('error', new Error('x'));
    expect(logger.error).toHaveBeenCalled();
  });
});
