import { Logger } from '@nestjs/common';
import { MqttModuleOptions, MqttOptionsFactory } from '../src/mqtt.interface';
import { MQTT_LOGGER_PROVIDER, MQTT_OPTION_PROVIDER } from '../src/mqtt.constants';
import {
  createLoggerProvider,
  createOptionProviders,
  createOptionsProvider,
} from '../src/options.provider';
import { createMockLogger } from './helpers/mock-logger';

class OptionsFactory implements MqttOptionsFactory {
  public createMqttConnectOptions(): MqttModuleOptions {
    return { host: 'localhost' };
  }
}

describe('createOptionProviders', () => {
  it('registers the useClass options factory on MQTT_OPTION_PROVIDER', () => {
    const providers = createOptionProviders({ useClass: OptionsFactory }) as any[];
    expect(providers).toHaveLength(2);
    const [optionsProvider, classProvider] = providers;
    expect(optionsProvider.provide).toBe(MQTT_OPTION_PROVIDER);
    expect(optionsProvider.inject).toEqual([OptionsFactory]);
    expect(classProvider).toMatchObject({ provide: OptionsFactory, useClass: OptionsFactory });
  });

  it('resolves the options by invoking the useClass factory instance', async () => {
    const providers = createOptionProviders({ useClass: OptionsFactory });
    const options = await (providers[0] as any).useFactory(new OptionsFactory());
    expect(options).toEqual({ host: 'localhost' });
  });

  it('registers a useFactory provider with its inject list', () => {
    const factory = () => ({ host: 'x' });
    const providers = createOptionProviders({ useFactory: factory, inject: [String] }) as any[];
    expect(providers).toHaveLength(1);
    expect(providers[0].provide).toBe(MQTT_OPTION_PROVIDER);
    expect(providers[0].useFactory).toBe(factory);
    expect(providers[0].inject).toEqual([String]);
  });

  it('registers a useExisting provider on MQTT_OPTION_PROVIDER', () => {
    const provider = createOptionsProvider({ useExisting: OptionsFactory }) as any;
    expect(provider.provide).toBe(MQTT_OPTION_PROVIDER);
    expect(provider.inject).toEqual([OptionsFactory]);
  });

  it('throws a descriptive error when called directly with no options source', () => {
    expect(() => createOptionsProvider({})).toThrow('useFactory');
  });

  it('throws a descriptive error when no options source is configured', () => {
    expect(() => createOptionProviders({})).toThrow('useClass');
  });
});

describe('createLoggerProvider', () => {
  it('defaults to a "MqttModule" logger instance', () => {
    const provider = createLoggerProvider({}) as any;
    expect(provider.provide).toBe(MQTT_LOGGER_PROVIDER);
    expect(provider.useValue).toBeInstanceOf(Logger);
  });

  it('passes a logger instance through with useValue', () => {
    const fake = createMockLogger();
    const provider = createLoggerProvider({ logger: { useValue: fake } }) as any;
    expect(provider.useValue).toBe(fake);
  });

  it('registers a logger class with useClass', () => {
    class MyLogger {
      public log = jest.fn();
      public error = jest.fn();
      public warn = jest.fn();
    }
    const provider = createLoggerProvider({ logger: { useClass: MyLogger } }) as any;
    expect(provider.useClass).toBe(MyLogger);
  });
});
