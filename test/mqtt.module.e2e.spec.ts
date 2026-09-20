// End-to-end: bootstrap MqttModule through real Nest DI (forRootAsync useClass,
// the path that used to fail with a broken MQTT_OPTION_PROVIDER registration),
// route a message through the explorer, and close the connection on shutdown.
// mqtt.connect is mocked with an EventEmitter client; no broker is involved.
import 'reflect-metadata';
import { Buffer } from 'node:buffer';
import { Controller, INestApplicationContext, Inject, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MqttModule, MqttModuleOptions, MqttOptionsFactory, Payload, Subscribe, Topic } from '../src';
import { createMockClient } from './helpers/mock-client';
import { createMockLogger } from './helpers/mock-logger';

const connectMock = jest.fn();
jest.mock('mqtt', () => ({ connect: (...args: unknown[]) => connectMock(...args) }));

const logger = createMockLogger();

@Controller()
class TextPayloadHandler {
  public readonly received: unknown[][] = [];

  @Subscribe({ topic: 'e2e/text/#', transform: 'json' })
  public onMessage(@Payload('text') payload: string, @Topic() topic: string): void {
    this.received.push([payload, topic]);
  }
}

@Controller()
class AsyncFailureHandler {
  public readonly handled: unknown[] = [];

  @Subscribe('e2e/async/#')
  public async onMessage(@Payload() payload: unknown): Promise<void> {
    this.handled.push(payload);
    throw new Error('async boom');
  }
}

class TestMqttOptions implements MqttOptionsFactory {
  public createMqttConnectOptions(): MqttModuleOptions {
    return { host: 'localhost', port: 1883, connectTimeout: 100 };
  }
}

const E2E_CONFIG = 'E2E_CONFIG';

@Module({
  providers: [{ provide: E2E_CONFIG, useValue: { host: 'from-import' } }],
  exports: [{ provide: E2E_CONFIG, useValue: { host: 'from-import' } }],
})
class ConfigModule {}

// a factory whose constructor dependency can only resolve if forRootAsync
// forwards options.imports into the dynamic module
class ImportedOptionsFactory implements MqttOptionsFactory {
  constructor(@Inject(E2E_CONFIG) private readonly cfg: { host: string }) {}

  public createMqttConnectOptions(): MqttModuleOptions {
    return { host: this.cfg.host, port: 1883, connectTimeout: 100 };
  }
}

describe('MqttModule (e2e)', () => {
  let app: INestApplicationContext | null = null;
  let client: any;

  beforeEach(async () => {
    jest.resetAllMocks();
    client = createMockClient();
    client.connected = true;
    connectMock.mockReturnValue(client);

    const moduleRef = await Test.createTestingModule({
      imports: [MqttModule.forRootAsync({ useClass: TestMqttOptions, logger: { useValue: logger } })],
      controllers: [TextPayloadHandler, AsyncFailureHandler],
    }).compile();

    // init() keeps a plain application context (no HTTP adapter needed);
    // close() below triggers onApplicationShutdown hooks unconditionally.
    app = await moduleRef.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('boots via forRootAsync({ useClass }) and connects with the factory options', () => {
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledWith(expect.objectContaining({ host: 'localhost' }));
  });

  it('subscribes the discovered @Subscribe topics', () => {
    expect(client.subscribe).toHaveBeenCalledWith('e2e/text/#', undefined, expect.any(Function));
    expect(client.subscribe).toHaveBeenCalledWith('e2e/async/#', undefined, expect.any(Function));
  });

  it('forwards options.imports so useClass factories can resolve dependencies', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        MqttModule.forRootAsync({ imports: [ConfigModule], useClass: ImportedOptionsFactory }),
      ],
    }).compile();
    const app = await moduleRef.init();
    try {
      expect(connectMock).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'from-import' }));
    } finally {
      await app.close();
    }
  });

  it('applies the @Payload(transform) parameter over the topic-level transform', () => {
    client.emit('message', 'e2e/text/dev1', Buffer.from(JSON.stringify({ a: 1 })), { cmd: 'publish' });
    expect(app!.get(TextPayloadHandler).received).toEqual([['{"a":1}', 'e2e/text/dev1']]);
  });

  it('logs async handler rejections instead of crashing', async () => {
    client.emit('message', 'e2e/async/1', Buffer.from('{"a":1}'), {});
    await new Promise((resolve) => setImmediate(resolve));
    expect(app!.get(AsyncFailureHandler).handled).toEqual([{ a: 1 }]);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'async boom' }));
  });

  it('ends the connection gracefully on application shutdown (connected)', async () => {
    await app!.close();
    app = null;
    expect(client.endAsync).toHaveBeenCalledTimes(1);
    expect(client.endAsync).toHaveBeenCalledWith();
  });
});
