/* eslint-disable camelcase -- TypeBox schema keys match JSON API snake_case */
import { Type } from 'typebox';

import { requireAuth } from '../auth.ts';
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
  byd_reserve_pct: Type.Number(),
  marstek_reserve_pct: Type.Number(),
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
  byd_reserve_pct: Type.Optional(Type.Number({ minimum: 0, maximum: 90 })),
  marstek_reserve_pct: Type.Optional(Type.Number({ minimum: 0, maximum: 90 })),
});

const DbStatsResponse = Type.Record(Type.String(), Type.Number());

/** Defaults for the numeric settings stored in the settings table. */
const SETTING_DEFAULTS = {
  solarweb_scrape_delay_ms: 60_000,
  panel_surface_m2: 46,
  panel_efficiency_pct: 21,
  panel_performance_ratio: 0.85,
  panel_temp_coeff_pct_per_c: 0.4,
  byd_reserve_pct: 7,
  marstek_reserve_pct: 5,
} as const;

function setting(key: keyof typeof SETTING_DEFAULTS): number {
  return Number(db.getSetting(key) ?? SETTING_DEFAULTS[key]);
}

/**
 * Build the full configuration response from environment variables and the
 * settings table.
 * @returns the current service configuration (no secrets).
 */
function buildConfigResponse() {
  const froniusHost = process.env.FRONIUS_HOST ?? 'http://192.168.1.30';
  const modbusHost =
    process.env.MODBUS_HOST ?? froniusHost.replace(/^https?:\/\//, '');
  return {
    fronius_host: froniusHost,
    modbus_enabled: process.env.MODBUS_ENABLED === 'true',
    modbus_host: modbusHost,
    modbus_port: Number(process.env.MODBUS_PORT ?? 502),
    solarweb_configured: isSolarWebConfigured(),
    solarweb_scrape_delay_ms: setting('solarweb_scrape_delay_ms'),
    poll_interval_ms: Number(process.env.POLL_INTERVAL_MS ?? 10_000),
    panel_surface_m2: setting('panel_surface_m2'),
    panel_efficiency_pct: setting('panel_efficiency_pct'),
    panel_performance_ratio: setting('panel_performance_ratio'),
    panel_temp_coeff_pct_per_c: setting('panel_temp_coeff_pct_per_c'),
    byd_reserve_pct: setting('byd_reserve_pct'),
    marstek_reserve_pct: setting('marstek_reserve_pct'),
  };
}

/**
 * Returns the current service configuration (no secrets, just on/off status).
 * PATCH /api/config allows updating panel geometry stored in the database.
 * @param fastify
 */
export default async function configRoutes(fastify: FastifyTyped) {
  fastify.get(
    '/api/config',
    { schema: { response: { 200: ConfigResponse } } },
    () => buildConfigResponse(),
  );

  fastify.patch(
    '/api/config',
    {
      preHandler: requireAuth,
      schema: {
        body: PanelSettingsBody,
        response: { 200: ConfigResponse },
      },
    },
    async (request) => {
      for (const [key, value] of Object.entries(request.body)) {
        if (value !== undefined) db.upsertSetting(key, String(value));
      }
      return buildConfigResponse();
    },
  );

  fastify.get(
    '/api/db/stats',
    { schema: { response: { 200: DbStatsResponse } } },
    () => db.getTableStats(),
  );
}
