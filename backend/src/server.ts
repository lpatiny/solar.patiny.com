import { existsSync } from 'node:fs';
import { join } from 'node:path';

import fastifyStatic from '@fastify/static';

import { buildApp } from './app.ts';
import {
  startBatteryPolling,
  stopBatteryPolling,
} from './services/batteryPoller.ts';
import {
  startBatteryStrategy,
  stopBatteryStrategy,
} from './services/batteryStrategy.ts';
import {
  startDirigeraPolling,
  stopDirigeraPolling,
} from './services/dirigeraService.ts';
import { startPoller, stopPoller } from './services/poller.ts';

const fastify = await buildApp();

const frontendDist = join(import.meta.dirname, '../../frontend/dist');
if (existsSync(frontendDist)) {
  await fastify.register(fastifyStatic, {
    root: frontendDist,
    prefix: '/',
    decorateReply: true,
  });

  fastify.setNotFoundHandler(async (request, reply) => {
    if (!request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });
}

fastify.log.info(
  {
    TZ: process.env.TZ ?? '(not set)',
    FRONIUS_HOST: process.env.FRONIUS_HOST ?? '(default: http://192.168.1.30)',
    MODBUS_ENABLED: process.env.MODBUS_ENABLED ?? '(default: false)',
    SOLARWEB_PV_SYSTEM_ID: process.env.SOLARWEB_PV_SYSTEM_ID
      ? 'set'
      : 'NOT SET',
    SOLARWEB_USERNAME: process.env.SOLARWEB_USERNAME ? 'set' : 'NOT SET',
    SOLARWEB_PASSWORD: process.env.SOLARWEB_PASSWORD ? 'set' : 'NOT SET',
    SOLARWEB_HISTORY_START:
      process.env.SOLARWEB_HISTORY_START ?? '(not set, defaults to 1 year ago)',
  },
  'Environment configuration',
);

startPoller(fastify.log);
startBatteryPolling(fastify.log);
startBatteryStrategy(fastify.log);
startDirigeraPolling(fastify.log);

fastify.addHook('onClose', () => {
  stopPoller();
  stopBatteryPolling();
  stopBatteryStrategy();
  stopDirigeraPolling();
});

const port = process.env.PORT ? Number(process.env.PORT) : 60504;
await fastify.listen({ port, host: '0.0.0.0' });
