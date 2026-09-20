import { MqttModuleAsyncOptions, MqttModuleOptions, MqttOptionsFactory } from './mqtt.interface';
import { Logger, Provider } from '@nestjs/common';
import { MQTT_LOGGER_PROVIDER, MQTT_OPTION_PROVIDER } from './mqtt.constants';

// single shared factory body for both factory-based option sources
const createMqttOptions = async (optionFactory: MqttOptionsFactory) =>
  await optionFactory.createMqttConnectOptions();

const NO_OPTIONS_SOURCE_ERROR =
  'MqttModule async options require one of "useFactory", "useExisting" or "useClass".';

export function createOptionsProvider(options: MqttModuleAsyncOptions): Provider {
  if (options.useFactory) {
    return {
      provide: MQTT_OPTION_PROVIDER,
      useFactory: options.useFactory,
      inject: options.inject || [],
    };
  }

  if (options.useExisting) {
    return {
      provide: MQTT_OPTION_PROVIDER,
      useFactory: createMqttOptions,
      inject: [options.useExisting],
    };
  }

  throw new Error(NO_OPTIONS_SOURCE_ERROR);
}

export function createOptionProviders(options: MqttModuleAsyncOptions): Provider[] {
  if (options.useExisting || options.useFactory) {
    return [createOptionsProvider(options)];
  }
  if (!options.useClass) {
    throw new Error(NO_OPTIONS_SOURCE_ERROR);
  }
  return [
    {
      // the options factory must land on MQTT_OPTION_PROVIDER: the client
      // provider (createClientProvider) injects that token, and the
      // MQTT_CLIENT_INSTANCE token is taken by createClientProvider itself.
      provide: MQTT_OPTION_PROVIDER,
      useFactory: createMqttOptions,
      inject: [options.useClass],
    },
    {
      provide: options.useClass,
      useClass: options.useClass,
    },
  ];
}

export function createLoggerProvider(options: MqttModuleOptions | MqttModuleAsyncOptions): Provider {
  if (!options.logger) {
    return {
      provide: MQTT_LOGGER_PROVIDER,
      useValue: new Logger('MqttModule'),
    };
  } else {
    if (options.logger.useClass) {
      return {
        provide: MQTT_LOGGER_PROVIDER,
        useClass: options.logger.useClass,
      };
    } else {
      return {
        provide: MQTT_LOGGER_PROVIDER,
        useValue: options.logger.useValue,
      };
    }
  }
}
