import { Type } from 'typebox';

import { readChunk, scanSunSpec, withClient } from '../services/modbusScan.ts';
import type { FastifyTyped } from '../types.ts';

const RawRegister = Type.Object({
  register: Type.Number(),
  value: Type.Number(),
  hex: Type.String(),
  int16: Type.Number(),
});

const SunSpecModelSchema = Type.Object({
  modelId: Type.Number(),
  registerAddress: Type.Number(),
  length: Type.Number(),
});

const ScanResult = Type.Object({
  sunspecFound: Type.Boolean(),
  unitId: Type.Number(),
  models: Type.Array(SunSpecModelSchema),
  rawRegisters: Type.Array(Type.Omit(RawRegister, ['int16'])),
  error: Type.Optional(Type.String()),
});

const ModelDumpResult = Type.Object({
  unitId: Type.Number(),
  models: Type.Array(
    Type.Object({
      modelId: Type.Number(),
      registerAddress: Type.Number(),
      length: Type.Number(),
      dataRegisters: Type.Array(RawRegister),
    }),
  ),
  error: Type.Optional(Type.String()),
});

/**
 * Scans the Modbus device SunSpec map to discover supported models and register
 * addresses. Used for debugging register mapping issues.
 * @param fastify
 */
export default async function debugModbusRoutes(fastify: FastifyTyped) {
  fastify.get(
    '/api/debug/modbus',
    { schema: { response: { 200: ScanResult } } },
    async () => {
      return scanSunSpec(1);
    },
  );

  fastify.get(
    '/api/debug/modbus/meter',
    { schema: { response: { 200: ScanResult } } },
    async () => {
      return scanSunSpec(200);
    },
  );

  // Dumps the first 30 data registers of every model found on a unit.
  // Use /api/debug/modbus/dump/1 for inverter, /api/debug/modbus/dump/200 for meter.
  fastify.get(
    '/api/debug/modbus/dump/:unitId',
    {
      schema: {
        params: Type.Object({ unitId: Type.String() }),
        response: { 200: ModelDumpResult },
      },
    },
    async (request) => {
      const unitId = Number(request.params.unitId);
      try {
        const scan = await scanSunSpec(unitId);
        const models = await withClient(unitId, async (client) => {
          /* eslint-disable no-await-in-loop -- sequential model reads needed for debug */
          const results = [];
          for (const model of scan.models) {
            const dataStart = model.registerAddress; // 1-based, after model ID header
            const count = Math.min(model.length, 30);
            // dataStart is the 1-based register of the model ID. +1 skips ID, +1 skips length.
            const raw = (await readChunk(client, dataStart + 1, count)) ?? [];
            const dataRegisters = raw.map((val, i) => ({
              register: dataStart + 2 + i, // 1-based
              value: val,
              hex: `0x${val.toString(16).padStart(4, '0')}`,
              int16: val >= 0x8000 ? val - 0x10000 : val,
            }));
            results.push({ ...model, dataRegisters });
          }
          /* eslint-enable no-await-in-loop */
          return results;
        });
        return { unitId, models };
      } catch (error) {
        return {
          unitId,
          models: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
}
