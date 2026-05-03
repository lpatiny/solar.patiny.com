import { readChunk, scanSunSpec, withClient } from './modbusScan.ts';

/**
 * Register addresses derived from the SunSpec map at runtime.
 * All values are 1-based Fronius register numbers, or null if not found on
 * this device. Integer-mode values come with a paired scale-factor register.
 */
export interface RegisterMap {
  /** SunSpec inverter model ID: 101=1P int, 103=3P int, 111=1P float, 113=3P float */
  inverterModelId: number;
  voltageAR: number | null;
  voltageBR: number | null;
  voltageCR: number | null;
  voltageSFR: number | null;
  acPowerR: number | null;
  acPowerSFR: number | null;
  frequencyR: number | null;
  frequencySFR: number | null;
  pvDcwSFR: number | null;
  pv1DcwR: number | null;
  pv2DcwR: number | null;
  batterySocR: number | null;
  batterySocSFR: number | null;
  /** SunSpec meter model ID: 201/203=int+SF, 211/213=float32. 0 if no meter found. */
  meterModelId: number;
  /** 1-based register for total grid watts */
  meterWR: number | null;
  /** 1-based register for W_SF; null for float32 meter models */
  meterWSFR: number | null;
}

// ─── Inverter model offset tables ─────────────────────────────────────────────

const INTEGER_OFFSETS: Record<
  101 | 103,
  {
    voltageA: number;
    voltageB: number | null;
    voltageC: number | null;
    voltageSF: number;
    acPower: number;
    acPowerSF: number;
    frequency: number;
    frequencySF: number;
  }
> = {
  101: {
    voltageA: 4,
    voltageB: null,
    voltageC: null,
    voltageSF: 5,
    acPower: 6,
    acPowerSF: 7,
    frequency: 8,
    frequencySF: 9,
  },
  103: {
    voltageA: 8,
    voltageB: 9,
    voltageC: 10,
    voltageSF: 11,
    acPower: 12,
    acPowerSF: 13,
    frequency: 14,
    frequencySF: 15,
  },
};

const FLOAT_OFFSETS: Record<
  111 | 113,
  {
    voltageA: number;
    voltageB: number | null;
    voltageC: number | null;
    acPower: number;
    frequency: number;
  }
> = {
  111: {
    voltageA: 6,
    voltageB: null,
    voltageC: null,
    acPower: 8,
    frequency: 10,
  },
  113: { voltageA: 14, voltageB: 16, voltageC: 18, acPower: 20, frequency: 22 },
};

// ─── Meter model offset tables ─────────────────────────────────────────────────

// W (total real power, int16) and W_SF offsets from model data start
const METER_INT_OFFSETS: Record<
  201 | 202 | 203 | 204,
  { w: number; wSF: number }
> = {
  201: { w: 6, wSF: 7 }, // Single phase AN/AB
  202: { w: 6, wSF: 7 }, // Split single phase
  203: { w: 17, wSF: 21 }, // Three phase WYE
  204: { w: 17, wSF: 21 }, // Three phase Delta
};

// W (float32) offset from model data start; each float32 spans 2 registers
const METER_FLOAT_OFFSETS: Record<211 | 212 | 213 | 214, { w: number }> = {
  211: { w: 10 }, // Single phase float
  212: { w: 10 }, // Split single phase float
  213: { w: 26 }, // Three phase WYE float
  214: { w: 26 }, // Three phase Delta float
};

const METER_INT_MODEL_IDS = new Set([201, 202, 203, 204]);
const METER_FLOAT_MODEL_IDS = new Set([211, 212, 213, 214]);

// ─── Register map builder ─────────────────────────────────────────────────────

/**
 * Scans the inverter and meter SunSpec maps and returns exact register addresses
 * for all measurements. Called once on startup and again after any connection error.
 */
export async function buildRegisterMap(): Promise<RegisterMap> {
  const { models } = await scanSunSpec(1);

  const find = (id: number) => models.find((m) => m.modelId === id);

  // ── Inverter model (prefer three-phase float, then single-phase float, then int+SF)
  const invModel = find(113) ?? find(111) ?? find(103) ?? find(101) ?? null;

  const inverterModelId = invModel?.modelId ?? 0;
  let voltageAR: number | null = null;
  let voltageBR: number | null = null;
  let voltageCR: number | null = null;
  let voltageSFR: number | null = null;
  let acPowerR: number | null = null;
  let acPowerSFR: number | null = null;
  let frequencyR: number | null = null;
  let frequencySFR: number | null = null;

  if (invModel) {
    const dataStart = invModel.registerAddress + 2;

    if (invModel.modelId === 101 || invModel.modelId === 103) {
      const off = INTEGER_OFFSETS[invModel.modelId];
      voltageAR = dataStart + off.voltageA;
      voltageBR = off.voltageB !== null ? dataStart + off.voltageB : null;
      voltageCR = off.voltageC !== null ? dataStart + off.voltageC : null;
      voltageSFR = dataStart + off.voltageSF;
      acPowerR = dataStart + off.acPower;
      acPowerSFR = dataStart + off.acPowerSF;
      frequencyR = dataStart + off.frequency;
      frequencySFR = dataStart + off.frequencySF;
    } else if (invModel.modelId === 111 || invModel.modelId === 113) {
      const off = FLOAT_OFFSETS[invModel.modelId];
      voltageAR = dataStart + off.voltageA;
      voltageBR = off.voltageB !== null ? dataStart + off.voltageB : null;
      voltageCR = off.voltageC !== null ? dataStart + off.voltageC : null;
      acPowerR = dataStart + off.acPower;
      frequencyR = dataStart + off.frequency;
    }
  }

  // ── Model 160 — Multiple MPPT ────────────────────────────────────────────────
  const m160 = find(160);
  let pvDcwSFR: number | null = null;
  let pv1DcwR: number | null = null;
  let pv2DcwR: number | null = null;

  if (m160) {
    const dataStart = m160.registerAddress + 2;
    pvDcwSFR = dataStart + 2; // DCW_SF at fixed offset 2

    await withClient(1, async (client) => {
      const nData = await readChunk(client, dataStart + 6 - 1, 1);
      const n = nData?.[0] ?? 0;
      if (n > 0) {
        const moduleSize = Math.floor((m160.length - 8) / n);
        const mod0Start = dataStart + 8;
        pv1DcwR = mod0Start + 7;
        if (n >= 2) pv2DcwR = mod0Start + moduleSize + 7;
      } else {
        pv1DcwR = dataStart + 8 + 7;
        pv2DcwR = dataStart + 8 + 20 + 7;
      }
    }).catch(() => {
      pv1DcwR = dataStart + 8 + 7;
      pv2DcwR = dataStart + 8 + 20 + 7;
    });
  }

  // ── Model 124 — Basic Storage Control ────────────────────────────────────────
  const m124 = find(124);
  let batterySocR: number | null = null;
  let batterySocSFR: number | null = null;

  if (m124) {
    const dataStart = m124.registerAddress + 2;
    batterySocR = dataStart + 6; // ChaState at offset 6
    batterySocSFR = dataStart + 23; // SoC_SF at offset 23 (not 21 which is WChaDisChaGra_SF)
  }

  // ── Smart meter (unit ID 200) ─────────────────────────────────────────────────
  let meterModelId = 0;
  let meterWR: number | null = null;
  let meterWSFR: number | null = null;

  try {
    const { models: meterModels } = await scanSunSpec(200);
    const findMeter = (id: number) => meterModels.find((m) => m.modelId === id);
    // Prefer float32 models (213/211) — no scale-factor register needed.
    // Fall back to integer+SF (203/201) if float32 is not available.
    const meterModel =
      findMeter(213) ??
      findMeter(211) ??
      findMeter(214) ??
      findMeter(212) ??
      findMeter(203) ??
      findMeter(201) ??
      findMeter(204) ??
      findMeter(202) ??
      null;

    if (meterModel) {
      meterModelId = meterModel.modelId;
      const dataStart = meterModel.registerAddress + 2;

      if (METER_INT_MODEL_IDS.has(meterModelId)) {
        const off = METER_INT_OFFSETS[meterModelId as 201 | 202 | 203 | 204];
        meterWR = dataStart + off.w;
        meterWSFR = dataStart + off.wSF;
      } else if (METER_FLOAT_MODEL_IDS.has(meterModelId)) {
        const off = METER_FLOAT_OFFSETS[meterModelId as 211 | 212 | 213 | 214];
        meterWR = dataStart + off.w;
      }
    }
  } catch {
    // Smart meter is optional
  }

  return {
    inverterModelId,
    voltageAR,
    voltageBR,
    voltageCR,
    voltageSFR,
    acPowerR,
    acPowerSFR,
    frequencyR,
    frequencySFR,
    pvDcwSFR,
    pv1DcwR,
    pv2DcwR,
    batterySocR,
    batterySocSFR,
    meterModelId,
    meterWR,
    meterWSFR,
  };
}
