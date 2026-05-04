/* eslint-disable camelcase, @typescript-eslint/naming-convention -- TypeBox schema keys match JSON API snake_case */
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
  solarweb_scrape_delay_ms: Type.Number(),
  poll_interval_ms: Type.Number(),
  panel_surface_m2: Type.Number(),
  panel_efficiency_pct: Type.Number(),
  panel_performance_ratio: Type.Number(),
  panel_temp_coeff_pct_per_c: Type.Number(),
});

const PanelSettingsBody = Type.Object({
  solarweb_scrape_delay_ms: Type.Optional(Type.Number({ minimum: 1000 })),
  panel_surface_m2: Type.Optional(Type.Number({ minimum: 1 })),
  panel_efficiency_pct: Type.Optional(
    Type.Number({ minimum: 1, maximum: 100 }),
  ),
  panel_performance_ratio: Type.Optional(
    Type.Number({ minimum: 0.1, maximum: 1 }),
  ),
  panel_temp_coeff_pct_per_c: Type.Optional(
    Type.Number({ minimum: 0, maximum: 1 }),
  ),
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
      const solarwebScrapeDelayMs = Number(
        db.getSetting('solarweb_scrape_delay_ms') ?? 60_000,
      );
      const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 10_000);
      const panelSurfaceM2 = Number(db.getSetting('panel_surface_m2') ?? 46);
      const panelEfficiencyPct = Number(
        db.getSetting('panel_efficiency_pct') ?? 21,
      );
      const panelPerformanceRatio = Number(
        db.getSetting('panel_performance_ratio') ?? 0.85,
      );
      const panelTempCoeffPctPerC = Number(
        db.getSetting('panel_temp_coeff_pct_per_c') ?? 0.4,
      );

      return {
        fronius_host: froniusHost,
        modbus_enabled: modbusEnabled,
        modbus_host: modbusHost,
        modbus_port: modbusPort,
        solarweb_configured: solarwebConfigured,
        solarweb_scrape_delay_ms: solarwebScrapeDelayMs,
        poll_interval_ms: pollIntervalMs,
        panel_surface_m2: panelSurfaceM2,
        panel_efficiency_pct: panelEfficiencyPct,
        panel_performance_ratio: panelPerformanceRatio,
        panel_temp_coeff_pct_per_c: panelTempCoeffPctPerC,
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
      const {
        solarweb_scrape_delay_ms,
        panel_surface_m2,
        panel_efficiency_pct,
        panel_performance_ratio,
        panel_temp_coeff_pct_per_c,
      } = request.body;
      if (solarweb_scrape_delay_ms !== undefined) {
        db.upsertSetting(
          'solarweb_scrape_delay_ms',
          String(solarweb_scrape_delay_ms),
        );
      }
      if (panel_surface_m2 !== undefined) {
        db.upsertSetting('panel_surface_m2', String(panel_surface_m2));
      }
      if (panel_efficiency_pct !== undefined) {
        db.upsertSetting('panel_efficiency_pct', String(panel_efficiency_pct));
      }
      if (panel_performance_ratio !== undefined) {
        db.upsertSetting(
          'panel_performance_ratio',
          String(panel_performance_ratio),
        );
      }
      if (panel_temp_coeff_pct_per_c !== undefined) {
        db.upsertSetting(
          'panel_temp_coeff_pct_per_c',
          String(panel_temp_coeff_pct_per_c),
        );
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
        solarweb_scrape_delay_ms: Number(
          db.getSetting('solarweb_scrape_delay_ms') ?? 60_000,
        ),
        poll_interval_ms: pollIntervalMs,
        panel_surface_m2: Number(db.getSetting('panel_surface_m2') ?? 46),
        panel_efficiency_pct: Number(
          db.getSetting('panel_efficiency_pct') ?? 21,
        ),
        panel_performance_ratio: Number(
          db.getSetting('panel_performance_ratio') ?? 0.85,
        ),
        panel_temp_coeff_pct_per_c: Number(
          db.getSetting('panel_temp_coeff_pct_per_c') ?? 0.4,
        ),
      };
    },
  );
}
