/* eslint-disable camelcase -- Open API wire fields are snake_case */
import type { Socket } from 'node:dgram';
import { createSocket } from 'node:dgram';

import { afterAll, beforeAll, expect, test } from 'vitest';

import { setMarstekUdpChargePower } from '../marstekControl.ts';
import { MAX_CHARGE_POWER_W } from '../marstekRegisters.ts';
import type { EsStatusResult } from '../marstekUdpClient.ts';
import {
  readMarstekUdp,
  readMarstekUdpBattery,
  toMarstekValues,
} from '../marstekUdpClient.ts';
import {
  _setUdpTiming,
  discoverMarstekDevices,
  normalizeMarstekIp,
} from '../marstekUdpTransport.ts';

const ES_STATUS: EsStatusResult = {
  id: 0,
  bat_soc: 85,
  bat_cap: 5120,
  pv_power: 0,
  ongrid_power: -797,
  offgrid_power: 0,
  total_pv_energy: 0,
  total_grid_output_energy: 12223,
  total_grid_input_energy: 15738,
  total_load_energy: 0,
};

// Records the last ES.SetMode params the fake device received.
let lastSetMode: Record<string, unknown> | null = null;
let device: Socket;
let port: number;

function reply(method: string): object | null {
  if (method === 'Marstek.GetDevice') {
    return {
      device: 'VenusE 3.0',
      ver: 148,
      ble_mac: '3c1acc36ad10',
      wifi_mac: 'f80da9c91ded',
      wifi_name: 'cheminfoFibre',
      ip: '192.168.01.33',
    };
  }
  if (method === 'ES.GetStatus') return ES_STATUS;
  if (method === 'Bat.GetStatus') {
    return {
      id: 0,
      soc: 85,
      charg_flag: true,
      dischrg_flag: true,
      bat_temp: 26,
      bat_capacity: 4382,
      rated_capacity: 5120,
    };
  }
  if (method === 'ES.SetMode') return { id: 0, set_result: true };
  return null;
}

beforeAll(async () => {
  _setUdpTiming({ minIntervalMs: 5, timeoutMs: 1000 });
  device = createSocket('udp4');
  device.on('message', (msg, rinfo) => {
    const request = JSON.parse(msg.toString());
    if (request.method === 'ES.SetMode') lastSetMode = request.params;
    const result = reply(request.method);
    if (result === null) return;
    const payload = JSON.stringify({
      id: request.id,
      src: 'VenusE-test',
      result,
    });
    device.send(payload, rinfo.port, rinfo.address);
  });
  await new Promise<void>((resolve) => {
    device.bind(0, '127.0.0.1', () => {
      port = device.address().port;
      resolve();
    });
  });
});

afterAll(() => {
  device.close();
});

test('reads ES.GetStatus and maps to MarstekValues', async () => {
  const { status, values } = await readMarstekUdp({ host: '127.0.0.1', port });

  expect(status).toStrictEqual(ES_STATUS);
  expect(values.soc_pct).toBe(85);
  expect(values.ac_power_w).toBe(-797);
  expect(values.energy_kwh).toBe(5.12);
  expect(values.total_charge_kwh).toBe(15.738);
  expect(values.total_discharge_kwh).toBe(12.223);
  expect(values.power_w).toBeNull();
});

test('reads Bat.GetStatus detail', async () => {
  const bat = await readMarstekUdpBattery({ host: '127.0.0.1', port });

  expect(bat).toStrictEqual({
    id: 0,
    soc: 85,
    charg_flag: true,
    dischrg_flag: true,
    bat_temp: 26,
    bat_capacity: 4382,
    rated_capacity: 5120,
  });
});

test('sets charge power as a negated Manual command', async () => {
  const ok = await setMarstekUdpChargePower({ host: '127.0.0.1', port }, 800);

  expect(ok).toBe(true);
  expect(lastSetMode).toStrictEqual({
    id: 0,
    config: {
      mode: 'Manual',
      manual_cfg: {
        time_num: 0,
        start_time: '00:00',
        end_time: '23:59',
        week_set: 127,
        power: -800,
        enable: 1,
      },
    },
  });
});

test('discovers the device by broadcast and normalizes its IP', async () => {
  const devices = await discoverMarstekDevices({
    broadcastAddress: '127.0.0.1',
    port,
    timeoutMs: 300,
  });

  expect(devices).toHaveLength(1);
  expect(devices[0]?.device).toBe('VenusE 3.0');
  expect(devices[0]?.ble_mac).toBe('3c1acc36ad10');
  // The fake device reports zero-padded "192.168.01.33"; it must be normalized.
  expect(devices[0]?.ip).toBe('192.168.1.33');
});

test('normalizeMarstekIp strips zero-padded octets, leaves others alone', () => {
  expect(normalizeMarstekIp('192.168.01.52')).toBe('192.168.1.52');
  expect(normalizeMarstekIp('192.168.1.122')).toBe('192.168.1.122');
  expect(normalizeMarstekIp('010.000.000.001')).toBe('10.0.0.1');
  expect(normalizeMarstekIp('not-an-ip')).toBe('not-an-ip');
});

test('rejects a charge power above the hard cap before any send', async () => {
  await expect(
    setMarstekUdpChargePower(
      { host: '127.0.0.1', port },
      MAX_CHARGE_POWER_W + 1,
    ),
  ).rejects.toThrow(
    `power must be an integer between 0 and ${MAX_CHARGE_POWER_W} W`,
  );
});

test('rejects a non-integer charge power', async () => {
  await expect(
    setMarstekUdpChargePower({ host: '127.0.0.1', port }, 100.5),
  ).rejects.toThrow(
    `power must be an integer between 0 and ${MAX_CHARGE_POWER_W} W`,
  );
});

test('toMarstekValues keeps the charging sign convention', () => {
  const charging = toMarstekValues({ ...ES_STATUS, ongrid_power: -500 });
  const discharging = toMarstekValues({ ...ES_STATUS, ongrid_power: 500 });

  expect(charging.ac_power_w).toBe(-500);
  expect(discharging.ac_power_w).toBe(500);
});
