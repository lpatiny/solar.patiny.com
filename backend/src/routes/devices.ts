/* eslint-disable camelcase -- API fields use snake_case to match the DB rows */
import type { Static, TSchema } from 'typebox';
import { Type } from 'typebox';

import { requireAuth } from '../auth.ts';
import type { DeviceInput } from '../db/Database.ts';
import { db } from '../db/Database.ts';
import type { BatteryReadingRow, DeviceRow } from '../db/rows.ts';
import { annotateMacConflicts, readArpTable } from '../services/arpTable.ts';
import {
  getLatest,
  isDeviceFresh,
  readLive,
  reloadDevices,
} from '../services/batteryPoller.ts';
import type { ScheduleSlot } from '../services/marstekControl.ts';
import {
  MAX_DISCHARGE_SECONDS,
  setMarstekUdpChargePower,
  setMarstekUdpManual,
  setMarstekUdpSchedule,
} from '../services/marstekControl.ts';
import {
  MAX_CHARGE_POWER_W,
  MAX_DISCHARGE_POWER_W,
  MAX_SCHEDULE_SLOTS,
  WEEKDAYS,
} from '../services/marstekRegisters.ts';
import { discoverMarstekDevices } from '../services/marstekUdpTransport.ts';
import type { FastifyTyped } from '../types.ts';

const Nullable = <T extends TSchema>(schema: T) =>
  Type.Union([schema, Type.Null()]);

const Device = Type.Object({
  id: Type.Number(),
  name: Type.String(),
  type: Type.String(),
  host: Type.String(),
  port: Type.Number(),
  ble_mac: Nullable(Type.String()),
  enabled: Type.Boolean(),
  poll_interval_ms: Type.Number(),
  created_at: Type.Number(),
});

const DeviceBody = Type.Object({
  name: Type.String(),
  type: Type.Optional(Type.String()),
  host: Type.String(),
  port: Type.Optional(Type.Number()),
  ble_mac: Type.Optional(Nullable(Type.String())),
  enabled: Type.Optional(Type.Boolean()),
  poll_interval_ms: Type.Optional(Type.Number()),
});

const DiscoveredDevice = Type.Object({
  device: Type.String(),
  ver: Type.Number(),
  ble_mac: Type.String(),
  wifi_mac: Type.String(),
  wifi_name: Type.String(),
  ip: Type.String(),
  /** Real MAC the host's ARP table resolved for this IP (null if unknown). */
  arp_mac: Nullable(Type.String()),
  /** True when this device shares its effective MAC with another discovered one. */
  mac_conflict: Type.Boolean(),
});

const BatteryValues = Type.Object({
  soc_pct: Nullable(Type.Number()),
  voltage_v: Nullable(Type.Number()),
  current_a: Nullable(Type.Number()),
  power_w: Nullable(Type.Number()),
  ac_power_w: Nullable(Type.Number()),
  energy_kwh: Nullable(Type.Number()),
  internal_temp_c: Nullable(Type.Number()),
  mos_temp_c: Nullable(Type.Number()),
  inverter_state: Nullable(Type.Number()),
  total_charge_kwh: Nullable(Type.Number()),
  total_discharge_kwh: Nullable(Type.Number()),
  daily_charge_kwh: Nullable(Type.Number()),
  daily_discharge_kwh: Nullable(Type.Number()),
});

const ControlParam = Type.Object({
  key: Type.String(),
  label: Type.String(),
  kind: Type.Union([Type.Literal('enum'), Type.Literal('number')]),
  value: Nullable(Type.Number()),
  unit: Type.Optional(Type.String()),
  min: Type.Optional(Type.Number()),
  max: Type.Optional(Type.Number()),
  options: Type.Optional(
    Type.Array(Type.Object({ value: Type.Number(), label: Type.String() })),
  ),
  register: Type.Number(),
});

const BatteryHistoryPoint = Type.Object({
  timestamp: Type.Number(),
  soc_pct: Nullable(Type.Number()),
  power_w: Nullable(Type.Number()),
  ac_power_w: Nullable(Type.Number()),
  energy_kwh: Nullable(Type.Number()),
  total_charge_kwh: Nullable(Type.Number()),
  total_discharge_kwh: Nullable(Type.Number()),
});

const ManualBody = Type.Object({
  action: Type.Union([
    Type.Literal('charge'),
    Type.Literal('discharge'),
    Type.Literal('stop'),
  ]),
  power_w: Type.Optional(
    Type.Integer({ minimum: 0, maximum: MAX_DISCHARGE_POWER_W }),
  ),
  duration_s: Type.Optional(
    Type.Integer({ minimum: 1, maximum: MAX_DISCHARGE_SECONDS }),
  ),
});

const Weekday = Type.Union(WEEKDAYS.map((day) => Type.Literal(day)));

const ScheduleSlotBody = Type.Object({
  start_time: Type.String(),
  end_time: Type.String(),
  days: Type.Array(Weekday),
  action: Type.Union([Type.Literal('charge'), Type.Literal('discharge')]),
  power_w: Type.Integer({ minimum: 0, maximum: MAX_DISCHARGE_POWER_W }),
  enable: Type.Optional(Type.Boolean()),
});

const ScheduleBody = Type.Object({
  slots: Type.Array(ScheduleSlotBody, { maxItems: MAX_SCHEDULE_SLOTS }),
});

const IdParams = Type.Object({ id: Type.Number() });
const ErrorResponse = Type.Object({ error: Type.String() });

function toApiDevice(row: DeviceRow) {
  return { ...row, enabled: row.enabled === 1 };
}

function bodyToInput(
  body: Static<typeof DeviceBody>,
  existing?: DeviceRow,
): DeviceInput {
  return {
    name: body.name,
    type: body.type ?? existing?.type ?? 'marstek',
    host: body.host,
    port: body.port ?? existing?.port ?? 30000,
    ble_mac: body.ble_mac ?? existing?.ble_mac ?? null,
    enabled: body.enabled ?? (existing ? existing.enabled === 1 : true),
    poll_interval_ms:
      body.poll_interval_ms ?? existing?.poll_interval_ms ?? 60_000,
  };
}

function rawToHistoryPoint(row: BatteryReadingRow) {
  return {
    timestamp: row.timestamp,
    soc_pct: row.soc_pct,
    power_w: row.power_w,
    ac_power_w: row.ac_power_w,
    energy_kwh: row.energy_kwh,
    total_charge_kwh: row.total_charge_kwh,
    total_discharge_kwh: row.total_discharge_kwh,
  };
}

/**
 * Device registry CRUD plus battery live/history/control endpoints.
 * @param fastify
 */

export default async function deviceRoutes(fastify: FastifyTyped) {
  fastify.get(
    '/api/devices',
    { schema: { response: { 200: Type.Array(Device) } } },
    async () => db.listDevices().map(toApiDevice),
  );

  fastify.get(
    '/api/devices/scan',
    {
      schema: {
        tags: ['devices'],
        summary:
          'Broadcast-discover Marstek devices on the LAN; flag duplicate MACs.',
        description:
          'Discovers Marstek units and cross-checks each IP against the host ARP ' +
          'table. `mac_conflict` is true when two units resolve to one MAC: a real ' +
          'L2 collision if `arp_mac` match, otherwise a firmware-reported artifact.',
        response: { 200: Type.Array(DiscoveredDevice) },
      },
    },
    async () =>
      annotateMacConflicts(await discoverMarstekDevices(), readArpTable()),
  );

  fastify.post(
    '/api/devices',
    {
      preHandler: requireAuth,
      schema: { body: DeviceBody, response: { 200: Device } },
    },
    async (request) => {
      const device = db.insertDevice(bodyToInput(request.body));
      reloadDevices();
      return toApiDevice(device);
    },
  );

  fastify.patch(
    '/api/devices/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: IdParams,
        body: DeviceBody,
        response: { 200: Device, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      const existing = db.getDevice(request.params.id);
      if (!existing) return reply.code(404).send({ error: 'device not found' });
      const updated = db.updateDevice(
        request.params.id,
        bodyToInput(request.body, existing),
      );
      if (!updated) return reply.code(404).send({ error: 'device not found' });
      reloadDevices();
      return toApiDevice(updated);
    },
  );

  fastify.delete(
    '/api/devices/:id',
    { preHandler: requireAuth, schema: { params: IdParams } },
    async (request, reply) => {
      if (!db.getDevice(request.params.id)) {
        return reply.code(404).send({ error: 'device not found' });
      }
      db.deleteDevice(request.params.id);
      reloadDevices();
      return { deleted: true };
    },
  );

  fastify.post(
    '/api/devices/:id/test',
    { schema: { params: IdParams } },
    async (request, reply) => {
      const entry = await readLive(request.params.id);
      if (!entry) return reply.code(404).send({ error: 'device not found' });
      return {
        ok: entry.error === null,
        error: entry.error,
        // After a failed poll readLive carries forward the last snapshot, so flag
        // whether those values are still fresh rather than serving them as live.
        is_stale: !isDeviceFresh(request.params.id),
        values: entry.values,
      };
    },
  );

  fastify.get(
    '/api/devices/:id/live',
    {
      schema: {
        params: IdParams,
        response: {
          200: Type.Object({
            device_id: Type.Number(),
            timestamp: Type.Number(),
            is_stale: Type.Boolean(),
            error: Nullable(Type.String()),
            values: Type.Union([BatteryValues, Type.Null()]),
            control: Type.Array(ControlParam),
          }),
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const device = db.getDevice(request.params.id);
      if (!device) return reply.code(404).send({ error: 'device not found' });
      const entry = getLatest(device.id);
      if (!entry) {
        return {
          device_id: device.id,
          timestamp: 0,
          is_stale: true,
          error: null,
          values: null,
          control: [],
        };
      }
      return {
        device_id: device.id,
        timestamp: entry.timestamp,
        // Staleness is measured from the last SUCCESSFUL read (isDeviceFresh →
        // valuesAt), not the last poll ATTEMPT (entry.timestamp): a device that
        // keeps failing must read as stale, not stay "fresh" because we keep
        // retrying it. This is the same gate the control loop uses.
        is_stale: !isDeviceFresh(device.id),
        error: entry.error,
        values: entry.values,
        control: entry.control,
      };
    },
  );

  fastify.get(
    '/api/devices/:id/control',
    {
      schema: {
        params: IdParams,
        response: {
          200: Type.Object({
            writable: Type.Boolean(),
            params: Type.Array(ControlParam),
          }),
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const device = db.getDevice(request.params.id);
      if (!device) return reply.code(404).send({ error: 'device not found' });
      return { writable: false, params: getLatest(device.id)?.control ?? [] };
    },
  );

  fastify.post(
    '/api/devices/:id/charge-power',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['devices'],
        summary: 'Set the forced charge power (W); hard capped at the maximum.',
        params: IdParams,
        body: Type.Object({
          power_w: Type.Integer({ minimum: 0, maximum: MAX_CHARGE_POWER_W }),
        }),
        response: {
          200: Type.Object({ ok: Type.Boolean(), power_w: Type.Number() }),
          400: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const device = db.getDevice(request.params.id);
      if (!device) return reply.code(404).send({ error: 'device not found' });
      const powerW = request.body.power_w;
      // Defence in depth: the schema already caps the value, but never let one
      // above the hard ceiling reach the device write path.
      if (powerW > MAX_CHARGE_POWER_W) {
        return reply.code(400).send({
          error: `charge power may not exceed ${MAX_CHARGE_POWER_W} W`,
        });
      }
      try {
        await setMarstekUdpChargePower(
          { host: device.host, port: device.port },
          powerW,
        );
        return { ok: true, power_w: powerW };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: message });
      }
    },
  );

  fastify.post(
    '/api/devices/:id/manual',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['devices'],
        summary:
          'Immediate manual control: charge (Manual), discharge (Passive), or stop.',
        params: IdParams,
        body: ManualBody,
        response: {
          200: Type.Object({
            ok: Type.Boolean(),
            action: Type.String(),
            power_w: Type.Number(),
          }),
          400: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const device = db.getDevice(request.params.id);
      if (!device) return reply.code(404).send({ error: 'device not found' });
      const {
        action,
        power_w: powerW = 0,
        duration_s: durationS,
      } = request.body;
      try {
        const ok = await setMarstekUdpManual(
          { host: device.host, port: device.port },
          { action, powerW, durationS },
        );
        return { ok, action, power_w: action === 'stop' ? 0 : powerW };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: message });
      }
    },
  );

  fastify.post(
    '/api/devices/:id/schedule',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['devices'],
        summary:
          'Push a per-day/hour charge & discharge schedule (Manual-mode slots).',
        params: IdParams,
        body: ScheduleBody,
        response: {
          200: Type.Object({
            ok: Type.Boolean(),
            results: Type.Array(Type.Boolean()),
          }),
          400: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const device = db.getDevice(request.params.id);
      if (!device) return reply.code(404).send({ error: 'device not found' });
      const slots: ScheduleSlot[] = request.body.slots.map((slot) => ({
        startTime: slot.start_time,
        endTime: slot.end_time,
        days: slot.days,
        action: slot.action,
        powerW: slot.power_w,
        enable: slot.enable,
      }));
      try {
        const results = await setMarstekUdpSchedule(
          { host: device.host, port: device.port },
          slots,
        );
        return { ok: results.every(Boolean), results };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: message });
      }
    },
  );

  fastify.get(
    '/api/devices/:id/history',
    {
      schema: {
        params: IdParams,
        querystring: Type.Object({
          from: Type.Optional(Type.Number()),
          to: Type.Optional(Type.Number()),
          resolution: Type.Optional(
            Type.Union([
              Type.Literal('raw'),
              Type.Literal('hourly'),
              Type.Literal('daily'),
            ]),
          ),
        }),
        response: { 200: Type.Array(BatteryHistoryPoint), 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!db.getDevice(id)) {
        return reply.code(404).send({ error: 'device not found' });
      }
      const now = Math.floor(Date.now() / 1000);
      const from = request.query.from ?? now - 86_400;
      const to = request.query.to ?? now;
      const resolution = request.query.resolution ?? 'raw';

      if (resolution === 'hourly') {
        return db
          .queryBatteryReadingsHourly(id, from, to)
          .map((r) => ({ ...r, timestamp: r.bucket }));
      }
      if (resolution === 'daily') {
        return db
          .queryBatteryReadingsDaily(id, from, to)
          .map((r) => ({ ...r, timestamp: r.bucket }));
      }
      return db.queryBatteryReadingsRaw(id, from, to).map(rawToHistoryPoint);
    },
  );
}
