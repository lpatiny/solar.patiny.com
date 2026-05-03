import { createRequire } from 'node:module';

export type BatteryMode = 'auto' | 'charge' | 'discharge' | 'idle';

const MODBUS_ENABLED = process.env.MODBUS_ENABLED === 'true';
const MODBUS_HOST = process.env.MODBUS_HOST ?? '192.168.1.30';
const MODBUS_PORT = Number(process.env.MODBUS_PORT ?? 502);
const MODBUS_UNIT_ID = Number(process.env.MODBUS_UNIT_ID ?? 1);
// SunSpec model 124 registers — check Fronius Modbus documentation for your firmware
const STORAGE_CTRL_REGISTER = Number(
  process.env.MODBUS_STORAGE_CTRL_REGISTER ?? 40355,
);
const CHARGE_RATE_REGISTER = Number(
  process.env.MODBUS_CHARGE_RATE_REGISTER ?? 40357,
);

// StorCtl_Mod values (SunSpec model 124)
const STORAGE_MODE: Record<BatteryMode, number> = {
  auto: 0,
  charge: 1,
  discharge: 2,
  idle: 5,
};

let currentMode: BatteryMode = 'auto';
let currentRatePercent = 100;

export function getModbusEnabled(): boolean {
  return MODBUS_ENABLED;
}

export function getCurrentBatteryControl(): {
  mode: BatteryMode;
  ratePercent: number;
} {
  return { mode: currentMode, ratePercent: currentRatePercent };
}

export async function setBatteryControl(
  mode: BatteryMode,
  ratePercent: number,
): Promise<void> {
  if (!MODBUS_ENABLED) {
    throw new Error(
      'Modbus is not enabled. Set MODBUS_ENABLED=true and configure Modbus registers.',
    );
  }

  // Use createRequire for CJS compatibility
  const require = createRequire(import.meta.url);

  const ModbusRTU = require('modbus-serial') as new () => {
    connectTCP(host: string, options: { port: number }): Promise<void>;
    setID(id: number): void;
    writeRegister(address: number, value: number): Promise<unknown>;
    close(): void;
  };

  const client = new ModbusRTU();
  try {
    await client.connectTCP(MODBUS_HOST, { port: MODBUS_PORT });
    client.setID(MODBUS_UNIT_ID);

    const modeValue = STORAGE_MODE[mode];
    await client.writeRegister(STORAGE_CTRL_REGISTER, modeValue);
    await client.writeRegister(CHARGE_RATE_REGISTER, ratePercent);

    currentMode = mode;
    currentRatePercent = ratePercent;
  } finally {
    client.close();
  }
}
