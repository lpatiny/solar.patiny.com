/* eslint-disable camelcase -- TypeBox schema keys match JSON API snake_case */
import { Type } from 'typebox';

import { db } from '../db/Database.ts';
import { isConfigured as isSolarWebConfigured } from '../services/solarweb.ts';
import type { FastifyTyped } from '../types.ts';

const ConfigResponse = Type.Object({
  fronius_host: Type.String(),
  modbus_enabled: Type.Boolean(),
  modbus_host: Type.String(),
  modbus_port: Type.Number(),
  solarweb_configured: Type.Boolean(),
  poll_interval_ms: Type.Number(),
  panel_surface_m2: Type.Number(),
  panel_efficiency_pct: Type.Number(),
});

const PanelSettingsBody = Type.Object({
  panel_surface_m2: Type.Optional(Type.Number({ minimum: 1 })),
  panel_efficiency_pct: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
});

/**
 * Returns the current service configuration (no secrets, just on/off status).
 * PATCH /api/config allows updating panel geometry stored in the database.
 * @param fastify
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
      const panelSurfaceM2 = Number(db.getSetting('panel_surface_m2') ?? 46);
      const panelEfficiencyPct = Number(
        db.getSetting('panel_efficiency_pct') ?? 21,
      );

      return {
        fronius_host: froniusHost,
        modbus_enabled: modbusEnabled,
        modbus_host: modbusHost,
        modbus_port: modbusPort,
        solarweb_configured: solarwebConfigured,
        poll_interval_ms: pollIntervalMs,
        panel_surface_m2: panelSurfaceM2,
        panel_efficiency_pct: panelEfficiencyPct,
      };
    },
  );

  fastify.patch(
    '/api/config',
    {
      schema: {
        body: PanelSettingsBody,
        response: { 200: ConfigResponse },
      },
    },
    async (request) => {
      const { panel_surface_m2, panel_efficiency_pct } = request.body;
      if (panel_surface_m2 !== undefined) {
        db.upsertSetting('panel_surface_m2', String(panel_surface_m2));
      }
      if (panel_efficiency_pct !== undefined) {
        db.upsertSetting('panel_efficiency_pct', String(panel_efficiency_pct));
      }

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
        panel_surface_m2: Number(db.getSetting('panel_surface_m2') ?? 46),
        panel_efficiency_pct: Number(
          db.getSetting('panel_efficiency_pct') ?? 21,
        ),
      };
    },
  );
}
