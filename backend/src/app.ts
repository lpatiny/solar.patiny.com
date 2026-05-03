import fastifyCors from '@fastify/cors';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify from 'fastify';

import batteryRoutes from './routes/battery.ts';
import configRoutes from './routes/config.ts';
import debugModbusRoutes from './routes/debugModbus.ts';
import healthRoutes from './routes/health.ts';
import historyRoutes from './routes/history.ts';
import realtimeRoutes from './routes/realtime.ts';
import solarwebRoutes from './routes/solarweb.ts';
import statsRoutes from './routes/stats.ts';

export async function buildApp() {
  const fastify = Fastify({
    logger: true,
  }).withTypeProvider<TypeBoxTypeProvider>();

  await fastify.register(fastifyCors, { origin: true });
  await fastify.register(configRoutes);
  await fastify.register(debugModbusRoutes);
  await fastify.register(healthRoutes);
  await fastify.register(realtimeRoutes);
  await fastify.register(batteryRoutes);
  await fastify.register(historyRoutes);
  await fastify.register(solarwebRoutes);
  await fastify.register(statsRoutes);

  return fastify;
}
