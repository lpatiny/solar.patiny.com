import { createRequire } from 'node:module';

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

export interface SunSpecModel {
  modelId: number;
  /** 1-based Fronius register number of the model header */
  registerAddress: number;
  /** Number of data registers (excludes the 2-register header) */
  length: number;
}

export interface SunSpecScanResult {
  sunspecFound: boolean;
  unitId: number;
  models: SunSpecModel[];
  rawRegisters: Array<{ register: number; value: number; hex: string }>;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const MODBUS_PORT = Number(process.env.MODBUS_PORT ?? 502);
export const MODBUS_HOST =
  process.env.MODBUS_HOST ??
  (process.env.FRONIUS_HOST ?? 'http://192.168.1.30').replace(
    /^https?:\/\//,
    '',
  );

function makeClient(): ModbusClientInterface {
  const require = createRequire(import.meta.url);
  const ModbusRTU = require('modbus-serial') as new () => ModbusClientInterface;
  return new ModbusRTU();
}

export async function withClient<T>(
  unitId: number,
  fn: (client: ModbusClientInterface) => Promise<T>,
): Promise<T> {
  const client = makeClient();
  try {
    await client.connectTCP(MODBUS_HOST, { port: MODBUS_PORT });
    client.setID(unitId);
    client.setTimeout(3000);
    return await fn(client);
  } finally {
    if (client.isOpen) client.close();
  }
}

export async function readChunk(
  client: ModbusClientInterface,
  startAddress: number,
  count: number,
): Promise<number[] | null> {
  try {
    const result = await client.readHoldingRegisters(startAddress, count);
    return result.data;
  } catch {
    return null;
  }
}

const PROBE_ADDRESSES = [40000, 0, 499, 999, 4999, 9999];

// ─── SunSpec scan ─────────────────────────────────────────────────────────────

export async function scanSunSpec(unitId: number): Promise<SunSpecScanResult> {
  return withClient(unitId, async (client) => {
    /* eslint-disable no-await-in-loop -- probing addresses sequentially */
    let foundAddress: number | null = null;
    for (const probe of PROBE_ADDRESSES) {
      if ((await readChunk(client, probe, 2)) !== null) {
        foundAddress = probe;
        break;
      }
    }
    /* eslint-enable no-await-in-loop */

    if (foundAddress === null) {
      return {
        sunspecFound: false,
        unitId,
        models: [],
        rawRegisters: [],
        error: `No readable registers at: ${PROBE_ADDRESSES.map((a) => `addr ${a} (reg ${a + 1})`).join(', ')}`,
      };
    }

    const dumpData = (await readChunk(client, foundAddress, 100)) ?? [];
    const rawRegisters = dumpData.map((val, i) => ({
      register: foundAddress + 1 + i,
      value: val,
      hex: `0x${val.toString(16).padStart(4, '0')}`,
    }));

    const w0 = dumpData[0] ?? 0;
    const w1 = dumpData[1] ?? 0;
    const sunspecFound = ((w0 << 16) | w1) === 0x53756e53;

    if (!sunspecFound) {
      return { sunspecFound, unitId, models: [], rawRegisters };
    }

    const models: SunSpecModel[] = [];
    let offset = foundAddress + 2;

    /* eslint-disable no-await-in-loop -- model chain requires sequential reads */
    for (let i = 0; i < 50; i++) {
      const header = await readChunk(client, offset, 2);
      if (!header) break;
      const modelId = header[0] ?? 0xffff;
      const length = header[1] ?? 0;
      if (modelId === 0xffff || modelId === 0) break;
      models.push({ modelId, registerAddress: offset + 1, length });
      offset += 2 + length;
    }
    /* eslint-enable no-await-in-loop */

    return { sunspecFound, unitId, models, rawRegisters };
  });
}
