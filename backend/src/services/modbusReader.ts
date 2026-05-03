/* eslint-disable camelcase, @typescript-eslint/naming-convention -- Modbus register fields use snake_case */
import { createRequire } from 'node:module';

import type { RegisterMap } from './modbusRegisterMap.ts';
import { buildRegisterMap } from './modbusRegisterMap.ts';
import { MODBUS_HOST, MODBUS_PORT } from './modbusScan.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HoldingRegisterResult {
  data: number[];
  buffer: Buffer;
}

interface ModbusClientInterface {
  connectTCP(host: string, options: { port: number }): Promise<void>;
  setID(id: number): void;
  setTimeout(timeout: number): void;
  readHoldingRegisters(
    address: number,
    length: number,
  ): Promise<HoldingRegisterResult>;
  close(): void;
  isOpen: boolean;
}

export interface ModbusReading {
  ac_power_w: number | null;
  voltage_a_v: number | null;
  voltage_b_v: number | null;
  voltage_c_v: number | null;
  frequency_hz: number | null;
  pv1_power_w: number | null;
  pv2_power_w: number | null;
  battery_soc: number | null;
  battery_charging_w: number | null;
  battery_discharging_w: number | null;
  meter_power_w: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addr(register: number): number {
  return register - 1;
}

function toInt16(v: number): number {
  return v >= 0x8000 ? v - 0x10000 : v;
}

// Converts a raw SunSpec scale-factor register to a valid exponent.
// 0x8000 (−32768) means "not implemented" → treat as 0; clamp to ±10 so
// applyScale() can never produce Infinity.
function toSF(raw: number): number {
  const sf = toInt16(raw);
  if (sf === -32768) return 0;
  return Math.max(-10, Math.min(10, sf));
}

function applyScale(raw: number, sf: number): number {
  return raw * 10 ** sf;
}

async function tryRead(
  client: ModbusClientInterface,
  register: number,
  length: number,
): Promise<number[] | null> {
  try {
    const result = await client.readHoldingRegisters(addr(register), length);
    return result.data;
  } catch (error) {
    if (error instanceof Error && /exception 2/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

async function readInt(
  client: ModbusClientInterface,
  reg: number | null,
): Promise<number | null> {
  if (reg === null) return null;
  const data = await tryRead(client, reg, 1);
  return data ? (data[0] ?? null) : null;
}

async function readFloat32(
  client: ModbusClientInterface,
  reg: number | null,
): Promise<number | null> {
  if (reg === null) return null;
  try {
    const result = await client.readHoldingRegisters(addr(reg), 2);
    const value = result.buffer.readFloatBE(0);
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    if (error instanceof Error && /exception 2/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

// ─── Connection & register-map management ────────────────────────────────────

let inverterClient: ModbusClientInterface | null = null;
let meterClient: ModbusClientInterface | null = null;
let registerMap: RegisterMap | null = null;

function makeClient(): ModbusClientInterface {
  const require = createRequire(import.meta.url);
  const ModbusRTU = require('modbus-serial') as new () => ModbusClientInterface;
  return new ModbusRTU();
}

async function getInverterClient(): Promise<{
  client: ModbusClientInterface;
  map: RegisterMap;
}> {
  if (inverterClient?.isOpen && registerMap) {
    return { client: inverterClient, map: registerMap };
  }
  const client = makeClient();
  await client.connectTCP(MODBUS_HOST, { port: MODBUS_PORT });
  client.setID(1);
  client.setTimeout(2000);
  // Discover register addresses from the device's SunSpec map (also scans meter)
  const map = await buildRegisterMap();
  // eslint-disable-next-line require-atomic-updates
  inverterClient = client;
  // eslint-disable-next-line require-atomic-updates
  registerMap = map;
  return { client, map };
}

async function getMeterClient(): Promise<ModbusClientInterface> {
  if (meterClient?.isOpen) return meterClient;
  meterClient = makeClient();
  await meterClient.connectTCP(MODBUS_HOST, { port: MODBUS_PORT });
  meterClient.setID(200);
  meterClient.setTimeout(2000);
  return meterClient;
}

export function closeModbusConnections(): void {
  if (inverterClient?.isOpen) inverterClient.close();
  if (meterClient?.isOpen) meterClient.close();
  inverterClient = null;
  meterClient = null;
  registerMap = null;
}

// ─── Read all registers ───────────────────────────────────────────────────────

const INVERTER_FLOAT_MODELS = new Set([111, 113]);
const METER_FLOAT_MODELS = new Set([211, 212, 213, 214]);

async function readInverterData(
  client: ModbusClientInterface,
  map: RegisterMap,
): Promise<Omit<ModbusReading, 'meter_power_w'>> {
  const isFloat = INVERTER_FLOAT_MODELS.has(map.inverterModelId);

  let voltage_a_v: number | null = null;
  let voltage_b_v: number | null = null;
  let voltage_c_v: number | null = null;
  let ac_power_w: number | null = null;
  let frequency_hz: number | null = null;

  if (isFloat) {
    [voltage_a_v, voltage_b_v, voltage_c_v, ac_power_w, frequency_hz] =
      await Promise.all([
        readFloat32(client, map.voltageAR),
        readFloat32(client, map.voltageBR),
        readFloat32(client, map.voltageCR),
        readFloat32(client, map.acPowerR),
        readFloat32(client, map.frequencyR),
      ]);
  } else {
    const [vA, vB, vC, vSF, w, wSF, hz, hzSF] = await Promise.all([
      readInt(client, map.voltageAR),
      readInt(client, map.voltageBR),
      readInt(client, map.voltageCR),
      readInt(client, map.voltageSFR),
      readInt(client, map.acPowerR),
      readInt(client, map.acPowerSFR),
      readInt(client, map.frequencyR),
      readInt(client, map.frequencySFR),
    ]);
    const vSf = toSF(vSF ?? 0);
    const wSf = toSF(wSF ?? 0);
    const hzSf = toSF(hzSF ?? 0);
    voltage_a_v = vA !== null ? applyScale(vA, vSf) : null;
    voltage_b_v = vB !== null ? applyScale(vB, vSf) : null;
    voltage_c_v = vC !== null ? applyScale(vC, vSf) : null;
    ac_power_w = w !== null ? applyScale(toInt16(w), wSf) : null;
    frequency_hz = hz !== null ? applyScale(hz, hzSf) : null;
  }

  // PV strings (Model 160 — always integer)
  const [dcwSF, pv1, pv2] = await Promise.all([
    readInt(client, map.pvDcwSFR),
    readInt(client, map.pv1DcwR),
    readInt(client, map.pv2DcwR),
  ]);
  const dcwSf = toSF(dcwSF ?? 0);
  const pv1_power_w = pv1 !== null ? applyScale(toInt16(pv1), dcwSf) : null;
  const pv2_power_w = pv2 !== null ? applyScale(toInt16(pv2), dcwSf) : null;

  // Battery SOC (Model 124 — integer)
  // SoC_SF can return 0 during inverter initialisation even though the raw
  // ChaState register is in centipercent (0–10000 = 0–100%).  Treat SF=0 the
  // same as "not implemented" and fall back to the device default of -2.
  const [soc, socSF] = await Promise.all([
    readInt(client, map.batterySocR),
    readInt(client, map.batterySocSFR),
  ]);
  const socSfRaw = socSF !== null ? toSF(socSF) : -2;
  const socSf = socSfRaw === 0 ? -2 : socSfRaw;
  const socValue = soc !== null ? applyScale(soc, socSf) : null;
  // Discard readings outside the valid range so the poller can fall back to
  // the Fronius REST value rather than storing a nonsensical percentage.
  const battery_soc =
    socValue !== null && socValue >= 0 && socValue <= 100 ? socValue : null;

  return {
    ac_power_w,
    voltage_a_v,
    voltage_b_v,
    voltage_c_v,
    frequency_hz,
    pv1_power_w,
    pv2_power_w,
    battery_soc,
    // Battery charge/discharge power not in standard SunSpec models for this device;
    // the REST API battery_w value is used by the poller instead
    battery_charging_w: null,
    battery_discharging_w: null,
  };
}

async function readMeterPower(map: RegisterMap): Promise<number | null> {
  if (map.meterWR === null) return null;
  const meter = await getMeterClient();
  if (METER_FLOAT_MODELS.has(map.meterModelId)) {
    return readFloat32(meter, map.meterWR);
  }
  // Integer + scale factor
  const [wRaw, sfRaw] = await Promise.all([
    readInt(meter, map.meterWR),
    readInt(meter, map.meterWSFR),
  ]);
  if (wRaw === null) return null;
  const result = applyScale(toInt16(wRaw), toSF(sfRaw ?? 0));
  return Number.isFinite(result) ? result : null;
}

/** Read all Modbus data from the GEN24. Returns null if Modbus is unavailable. */
export async function readModbusData(): Promise<ModbusReading | null> {
  try {
    const { client, map } = await getInverterClient();
    const inverterData = await readInverterData(client, map);

    let meter_power_w: number | null = null;
    try {
      meter_power_w = await readMeterPower(map);
    } catch {
      // Smart meter is optional
    }

    return { ...inverterData, meter_power_w };
  } catch (error) {
    // On connection-level errors, reset so the next poll reconnects and rescans
    if (!(error instanceof Error && /exception 2/i.test(error.message))) {
      inverterClient = null;
      registerMap = null;
    }
    throw error;
  }
}
