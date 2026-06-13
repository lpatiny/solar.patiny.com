/* eslint-disable camelcase, @typescript-eslint/naming-convention -- battery reading fields use snake_case to match the DB row */

/**
 * Modbus holding-register map for the Marstek Venus E 3.0, validated against a
 * live device. All values are read with FC03 on unit id 0. Source: the device
 * itself plus the community maps at github.com/scruysberghs/ha-marstek-venus and
 * github.com/bvweerd/marstek_modbus.
 *
 * The device is fragile: it answers ~1-2 requests per TCP connection, allows a
 * single connection at a time, and caps reads at ~10 registers. Blocks below are
 * therefore kept small; the client reconnects between each.
 */
export const MARSTEK_READ_BLOCKS: ReadonlyArray<readonly [number, number]> = [
  [32100, 6], // battery voltage, current, power(int32), SOC, energy
  [32200, 4], // AC voltage, current, power(int32)
  [33000, 8], // total + daily charge/discharge energy (uint32 each)
  [35000, 3], // internal + MOS temperatures
  [35100, 1], // inverter state
  [35110, 3], // charge voltage limit, charge/discharge current limits
  [43000, 1], // user work mode
];

/** Control registers used to drive forced charging over RS485/Modbus. */
export const MARSTEK_CONTROL_REGISTERS = {
  rs485ControlMode: 42000, // 21930 enable, 21947 disable
  forceMode: 42010, // 0 stop, 1 charge, 2 discharge
  chargeToSoc: 42011, // target %
  forceChargePower: 42020, // W
  forceDischargePower: 42021, // W
  userWorkMode: 43000, // 0 manual, ...
} as const;

/** Magic values for the RS485 control-mode register. */
export const RS485_CONTROL_MODE = { enable: 21930, disable: 21947 } as const;

/** Force-mode values for register 42010. */
export const FORCE_MODE = { stop: 0, charge: 1, discharge: 2 } as const;

/**
 * Hard safety ceiling for the forced charge power, in watts. The charge power
 * setpoint may NEVER exceed this value — enforced in the API schema, the route
 * handler, and the Modbus write path, and mirrored by the frontend.
 */
export const MAX_CHARGE_POWER_W = 1000;

/**
 * Hard safety ceiling for the forced discharge power, in watts. Mirrors
 * {@link MAX_CHARGE_POWER_W} for the discharge direction; enforced everywhere a
 * discharge setpoint is accepted. The inverter clamps real output below this
 * anyway (~800 W observed at high SOC even when commanded higher).
 */
export const MAX_DISCHARGE_POWER_W = 1000;

/**
 * Sanity ceiling on the number of Manual-mode time slots a schedule may push.
 * The device's true maximum is undocumented; this guard simply prevents an
 * unbounded list. Extra slots are rejected before any datagram is sent.
 */
export const MAX_SCHEDULE_SLOTS = 10;

/** The seven weekdays, in the order their bit appears in `week_set`. */
export const WEEKDAYS = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
] as const;

/** A weekday name accepted by the schedule API. */
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * Bit value of each weekday inside the Manual-mode `week_set` byte. `127`
 * (every day) is verified live on the device; the individual bit order below is
 * the common Marstek convention (bit 0 = Monday) and should be confirmed
 * against the physical unit before relying on single-day schedules. Centralised
 * here so a correction is a one-line change.
 */
export const WEEKDAY_BIT: Record<Weekday, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 4,
  Thu: 8,
  Fri: 16,
  Sat: 32,
  Sun: 64,
};

/** Every-day `week_set` value (verified on the device). */
export const WEEK_SET_ALL = 127;

/** Best-effort labels for the inverter-state register (35100). */
export const INVERTER_STATE_LABELS: Record<number, string> = {
  0: 'Standby',
  1: 'Charging',
  2: 'Discharging',
  3: 'Idle',
  4: 'Fault',
};

/** A sparse map of register address to its raw 16-bit value. */
export type RegisterMap = Record<number, number>;

function u16(regs: RegisterMap, address: number): number | undefined {
  return regs[address];
}

function i16(regs: RegisterMap, address: number): number | undefined {
  const value = regs[address];
  if (value === undefined) return undefined;
  return value > 0x7fff ? value - 0x1_0000 : value;
}

function u32(regs: RegisterMap, address: number): number | undefined {
  const high = regs[address];
  const low = regs[address + 1];
  if (high === undefined || low === undefined) return undefined;
  return high * 0x1_0000 + low;
}

function i32(regs: RegisterMap, address: number): number | undefined {
  const value = u32(regs, address);
  if (value === undefined) return undefined;
  return value > 0x7fff_ffff ? value - 0x1_0000_0000 : value;
}

function scale(value: number | undefined, factor: number): number | null {
  return value === undefined ? null : value * factor;
}

/** Decoded battery measurements ready to persist (sans device_id/timestamp). */
export interface MarstekValues {
  soc_pct: number | null;
  voltage_v: number | null;
  current_a: number | null;
  power_w: number | null;
  ac_power_w: number | null;
  energy_kwh: number | null;
  internal_temp_c: number | null;
  mos_temp_c: number | null;
  inverter_state: number | null;
  total_charge_kwh: number | null;
  total_discharge_kwh: number | null;
  daily_charge_kwh: number | null;
  daily_discharge_kwh: number | null;
}

/**
 * Decode the battery measurement registers into scaled values. Missing
 * registers (block read failed) decode to null.
 * @param regs - register address to raw value map
 */
export function decodeBatteryValues(regs: RegisterMap): MarstekValues {
  return {
    voltage_v: scale(u16(regs, 32100), 0.01),
    current_a: scale(i16(regs, 32101), 0.01),
    power_w: scale(i32(regs, 32102), 1),
    soc_pct: scale(u16(regs, 32104), 1),
    energy_kwh: scale(u16(regs, 32105), 0.001),
    ac_power_w: scale(i32(regs, 32202), 1),
    total_charge_kwh: scale(u32(regs, 33000), 0.01),
    total_discharge_kwh: scale(u32(regs, 33002), 0.01),
    daily_charge_kwh: scale(u32(regs, 33004), 0.01),
    daily_discharge_kwh: scale(u32(regs, 33006), 0.01),
    internal_temp_c: scale(i16(regs, 35000), 0.1),
    mos_temp_c: scale(i16(regs, 35001), 0.1),
    inverter_state: scale(u16(regs, 35100), 1),
  };
}

/** One controllable parameter, with its current value and limits. */
export interface ControlParam {
  key: string;
  label: string;
  kind: 'enum' | 'number';
  value: number | null;
  unit?: string;
  min?: number;
  max?: number;
  options?: Array<{ value: number; label: string }>;
  register: number;
}

/**
 * Describe the controllable parameters and their current values. Used to render
 * the (read-only, in v1) control panel.
 * @param regs - register address to raw value map
 */
export function decodeControlParams(regs: RegisterMap): ControlParam[] {
  return [
    {
      key: 'forceMode',
      label: 'Force charge/discharge',
      kind: 'enum',
      value: null,
      options: [
        { value: 0, label: 'Stop' },
        { value: 1, label: 'Charge' },
        { value: 2, label: 'Discharge' },
      ],
      register: MARSTEK_CONTROL_REGISTERS.forceMode,
    },
    {
      key: 'chargeToSoc',
      label: 'Charge to SOC',
      kind: 'number',
      value: scale(u16(regs, 32104), 1),
      unit: '%',
      min: 0,
      max: 100,
      register: MARSTEK_CONTROL_REGISTERS.chargeToSoc,
    },
    {
      key: 'chargeCurrentLimit',
      label: 'Charge current limit',
      kind: 'number',
      value: scale(u16(regs, 35111), 0.1),
      unit: 'A',
      register: MARSTEK_CONTROL_REGISTERS.forceChargePower,
    },
    {
      key: 'dischargeCurrentLimit',
      label: 'Discharge current limit',
      kind: 'number',
      value: scale(u16(regs, 35112), 0.1),
      unit: 'A',
      register: MARSTEK_CONTROL_REGISTERS.forceDischargePower,
    },
    {
      key: 'userWorkMode',
      label: 'User work mode',
      kind: 'number',
      value: scale(u16(regs, 43000), 1),
      register: MARSTEK_CONTROL_REGISTERS.userWorkMode,
    },
  ];
}
