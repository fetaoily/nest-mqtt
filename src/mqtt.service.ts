import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { MQTT_CLIENT_INSTANCE } from './mqtt.constants';
import { IClientPublishOptions, IClientSubscribeOptions, ISubscriptionGrant, MqttClient, Packet } from 'mqtt';

@Injectable()
export class MqttService implements OnApplicationShutdown {
  constructor(@Inject(MQTT_CLIENT_INSTANCE) private readonly client: MqttClient) {}

  /**
   * Close the connection on application shutdown. Nest calls this on every
   * app.close(); enableShutdownHooks() additionally wires process signals
   * (SIGINT/SIGTERM) to close().
   *
   * When connected the client is ended gracefully: mqtt.js flushes queued
   * messages and sends a DISCONNECT packet, so the broker does not publish
   * the Last Will for a clean shutdown. Otherwise the client is force-ended:
   * mqtt.js never sends DISCONNECT when forced (its _cleanUp(true) path just
   * destroys the stream).
   */
  public async onApplicationShutdown(): Promise<void> {
    if (this.client.connected) {
      await this.client.endAsync();
    } else {
      await this.client.endAsync(true);
    }
  }

  subscribe(topic: string | string[], opts?: IClientSubscribeOptions): Promise<ISubscriptionGrant[]> {
    return new Promise((resolve, reject) => {
      this.client.subscribe(topic, opts || null, (err, granted) => {
        if (err) {
          reject(err);
        } else {
          resolve(granted);
        }
      });
    });
  }

  unsubscribe(topic: string, opts?: IClientSubscribeOptions): Promise<Packet> {
    return new Promise<Packet>((resolve, reject) => {
      this.client.unsubscribe(topic, opts || null, (error, packet) => {
        if (error) {
          reject(error);
        } else {
          resolve(packet);
        }
      });
    });
  }

  publish(topic: string, message: string | Buffer | object, opts?: IClientPublishOptions): Promise<Packet> {
    return new Promise<Packet>((resolve, reject) => {
      if (typeof message === 'object') {
        message = JSON.stringify(message);
      }
      this.client.publish(topic, message, opts || null, (error, packet) => {
        if (error) {
          reject(error);
        } else {
          resolve(packet);
        }
      });
    });
  }
}
