import fastifyCors from '@fastify/cors';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify from 'fastify';

import { registerAuth } from './auth.ts';
import analysisRoutes from './routes/analysis.ts';
import batteryRoutes from './routes/battery.ts';
import configRoutes from './routes/config.ts';
import debugModbusRoutes from './routes/debugModbus.ts';
import deviceRoutes from './routes/devices.ts';
import forecastRoutes from './routes/forecast.ts';
import healthRoutes from './routes/health.ts';
import historyRoutes from './routes/history.ts';
import realtimeRoutes from './routes/realtime.ts';
import solarwebRoutes from './routes/solarweb.ts';
import statsRoutes from './routes/stats.ts';
import strategyRoutes from './routes/strategy.ts';
import weatherRoutes from './routes/weather.ts';

export async function buildApp() {
  const fastify = Fastify({
    logger: true,
    // Behind the Traefik / Cloudflare TLS terminators; needed for the session
    // cookie's `secure: 'auto'` to detect HTTPS from X-Forwarded-Proto.
    trustProxy: true,
  }).withTypeProvider<TypeBoxTypeProvider>();

  await fastify.register(fastifyCors, { origin: true, credentials: true });
  await registerAuth(fastify);
  await fastify.register(analysisRoutes);
  await fastify.register(configRoutes);
  await fastify.register(debugModbusRoutes);
  await fastify.register(deviceRoutes);
  await fastify.register(forecastRoutes);
  await fastify.register(healthRoutes);
  await fastify.register(realtimeRoutes);
  await fastify.register(batteryRoutes);
  await fastify.register(historyRoutes);
  await fastify.register(solarwebRoutes);
  await fastify.register(statsRoutes);
  await fastify.register(strategyRoutes);
  await fastify.register(weatherRoutes);

  return fastify;
}
