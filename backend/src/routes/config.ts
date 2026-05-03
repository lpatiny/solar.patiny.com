/* eslint-disable camelcase -- TypeBox schema keys match JSON API snake_case */
import { Type } from '@sinclair/typebox';

import { isConfigured as isSolarWebConfigured } from '../services/solarweb.ts';
import type { FastifyTyped } from '../types.ts';

const ConfigResponse = Type.Object({
  fronius_host: Type.String(),
  modbus_enabled: Type.Boolean(),
  modbus_host: Type.String(),
  modbus_port: Type.Number(),
  solarweb_configured: Type.Boolean(),
  poll_interval_ms: Type.Number(),
});

/**
 * Returns the current service configuration (no secrets, just on/off status).
 */
export default async function configRoutes(fastify: FastifyTyped) {
  fastify.get(
    '/api/config',
    { schema: { response: { 200: ConfigResponse } } },
    async () => {
      const froniusHost = process.env.FRONIUS_HOST ?? 'http://192.168.1.30';
      const modbusEnabled = process.env.MODBUS_ENABLED === 'true';
      const modbusHost =
        process.env.MODBUS_HOST ?? froniusHost.replace(/^https?:\/\//, '');
      const modbusPort = Number(process.env.MODBUS_PORT ?? 502);
      const solarwebConfigured = isSolarWebConfigured();
      const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 10_000);

      return {
        fronius_host: froniusHost,
        modbus_enabled: modbusEnabled,
        modbus_host: modbusHost,
        modbus_port: modbusPort,
        solarweb_configured: solarwebConfigured,
        poll_interval_ms: pollIntervalMs,
      };
    },
  );
}
