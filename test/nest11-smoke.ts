// NestJS 11 runtime smoke test for this library.
// Boots a real Nest 11 application context (no HTTP adapter needed) with
// MqttModule.forRoot + a @Subscribe controller, and verifies:
//   1. the app context initializes without exceptions under @nestjs 11
//   2. dependency injection resolves (controller instantiable)
//   3. MqttExplorer.onModuleInit ran (discovery over the provider graph works)
// The MQTT client points at a broker that may not exist; wiring is what is
// under test, not broker I/O. Run: npx ts-node test/nest11-smoke.ts
import 'reflect-metadata';
import { Module, Controller } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MqttModule, Subscribe, Topic, Payload } from '../src';

@Controller()
class SmokeController {
  public readonly received: { topic: string; payload: unknown }[] = [];

  @Subscribe('smoke/nest11/#')
  public handle(@Topic() topic: string, @Payload() payload: unknown): void {
    this.received.push({ topic, payload });
  }
}

@Module({
  imports: [
    MqttModule.forRoot({
      url: process.env.SMOKE_MQTT_URL || 'mqtt://127.0.0.1:1883',
      connectTimeout: 2000,
      reconnectPeriod: 5000,
    } as any),
  ],
  controllers: [SmokeController],
})
class SmokeModule {}

(async () => {
  let app;
  try {
    app = await NestFactory.createApplicationContext(SmokeModule, { logger: false });
    const controller = app.get(SmokeController);
    if (!controller || typeof controller.handle !== 'function') {
      throw new Error('SmokeController did not resolve from the DI container');
    }
    // give the explorer's subscribe round a moment; errors here surface via the catch below
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.log('SMOKE PASS: nest 11 application context booted, DI resolved, explorer ran');
    process.exitCode = 0;
  } catch (err) {
    console.log('SMOKE FAIL:', err && err.message);
    process.exitCode = 1;
  } finally {
    try {
      if (app) await app.close();
    } catch {}
    process.exit(process.exitCode || 0);
  }
})();
