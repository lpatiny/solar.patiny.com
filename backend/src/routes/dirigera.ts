/* eslint-disable camelcase -- TypeBox schema keys match JSON API snake_case */
import { Type } from 'typebox';

import { getDevices } from '../services/dirigeraDevices.ts';
import type { FastifyTyped } from '../types.ts';

const N = Type.Union([Type.Number(), Type.Null()]); // nullable number shorthand

const DevicesResponse = Type.Object({
  timestamp: Type.Number(),
  is_stale: Type.Boolean(),
  configured: Type.Boolean(),
  devices: Type.Array(
    Type.Object({
      id: Type.String(),
      type: Type.String(),
      model: Type.String(),
      name: Type.String(),
      room: Type.Union([Type.String(), Type.Null()]),
      is_reachable: Type.Boolean(),
      is_on: Type.Union([Type.Boolean(), Type.Null()]),
      light_level: N,
      color_mode: Type.Union([Type.String(), Type.Null()]),
      color: Type.Union([
        Type.Object({ hue: Type.Number(), saturation: Type.Number() }),
        Type.Null(),
      ]),
      color_temperature: N,
      battery_percentage: N,
      temperature_c: N,
      humidity_pct: N,
      co2_ppm: N,
      pm25_ugm3: N,
      firmware_version: Type.Union([Type.String(), Type.Null()]),
      ota_status: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
});

/**
 * Read-only status of every device the IKEA DIRIGERA hub reports (lights,
 * remotes, sensors, gateway), served from the in-memory poll cache.
 * @param fastify
 */
export default async function dirigeraRoutes(fastify: FastifyTyped) {
  fastify.get(
    '/api/dirigera/devices',
    { schema: { response: { 200: DevicesResponse } } },
    () => getDevices(),
  );
}
