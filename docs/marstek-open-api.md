# Marstek Venus E 3.0 — Open API (UDP JSON-RPC)

The Marstek **Device Open API (Rev 2.0)** is a local **UDP JSON-RPC** API — a
second way to talk to the Venus E 3.0 besides [Modbus](./marstek-modbus.md).

Spec PDF: <https://static-eu.marstekcloud.com/ems/resource/agreement/MarstekDeviceOpenApi.pdf>

You must enable "Open API" in the Marstek app first; the UDP port is set there
(default 30000, the app recommends 49152–65535).

## Transport & discovery

- **Transport:** UDP. Request `{id, method, params}` → reply
  `{id, src, result}` or `{id, src, error:{code, message, data}}`.
- **Discovery:** UDP **broadcast** `Marstek.GetDevice` with `params.ble_mac:"0"`.
- Both Venus E 3.0 units report port **30000**, `ver:148`. IPs are DHCP and
  move — **always re-discover by broadcast, never hard-code an IP.** Each unit
  has a stable `ble_mac` (e.g. `3c1acc36ad10`, `3c1acc36a5b1`); the IP is just a
  hint.
- Discovery returns zero-padded IPs (`192.168.01.52`) that must be normalized to
  `192.168.1.52` (`normalizeMarstekIp`).
- **CRITICAL — the controller is an ESP32: send at most one query per ~10 s.**
  Space all requests ≥ 10 s; never retry faster. Rapid retries make the device
  appear to "go deaf."

## Methods

Verified on Venus E 3.0 (all first-try replies when addressed correctly):
`Marstek.GetDevice`, `Bat.GetStatus`, `ES.GetStatus`, `ES.GetMode`,
`ES.SetMode`.

- **`PV.GetStatus` is NOT supported on Venus E** (PV is Venus D/A only, spec §4).
- Also documented (not all exercised): `Wifi.GetStatus`, `BLE.GetStatus`,
  `EM.GetStatus`, `DOD.SET` (range 30–88), `Ble.Adv`, `Led.Ctrl`.

Status payloads:

- `Bat.GetStatus` → `{soc, charg_flag, dischrg_flag, bat_temp(°C),
bat_capacity(remaining Wh), rated_capacity}`. **`rated_capacity` reads
  5120 Wh** — a per-controller nominal, **not** the real ~11 kWh pack
  ([Battery specs](./battery-specs.md)).
- `ES.GetStatus` → `{bat_soc, bat_cap:5120, pv_power, ongrid_power,
offgrid_power, total_pv / grid_output / grid_input / load_energy Wh}`.

## Power control via `ES.SetMode`

Verified live (`set_result:true`). **The two modes do NOT share a sign
convention** — this caused a bug once (UI charge returned `-32602`):

- **To DISCHARGE → Passive mode.**
  `config:{mode:"Passive", passive_cfg:{power, cd_time}}`. **`power` must be ≥ 0
  (positive = discharge).** Verified: `power:800` → `ongrid_power +797`.
  `cd_time` [s] is a self-expiring countdown. **Passive REJECTS negative power
  with `-32602` Invalid params — you CANNOT charge via Passive on this firmware
  (ver 148).**
- **To CHARGE → Manual mode with NEGATIVE power.**
  `config:{mode:"Manual", manual_cfg:{time_num:0, start_time:"00:00",
end_time:"23:59", week_set:127, power:-W, enable:1}}`. Verified: `power:-800` →
  `ongrid_power -797` (charge from grid). `week_set` is a byte; 127 = all week.
  **`ES.GetMode` does NOT return the Manual schedule params**, so switching modes
  and back is lossy on the user's Manual schedule.
- **Do NOT generalize "negative = charge" to Passive** — that is a Manual-only
  rule. The `ongrid_power` _reading_ sign is consistent across modes: **negative
  = charging/importing, positive = discharging.**
- Output is **capped (~800 W observed at high SOC)** even when commanding
  1500 W.
- `ES.SetMode` returns `{id, set_result:bool}`.

## Scheduling (per-day / per-hour)

Per-day/hour scheduling = Manual mode with multiple `time_num` slots, each
`{time_num, start_time, end_time, week_set, power(signed), enable}`
(charge = negative, discharge = positive); one `ES.SetMode` per slot, paced.

**Two things remain UNVERIFIED on a live unit — confirm before trusting
single-day or scheduled-discharge slots:**

1. The `week_set` per-day **bit order** — assumed bit0 = Mon … bit6 = Sun
   (sum 127 = all week is the only verified value), centralized in `WEEKDAY_BIT`
   in `marstekRegisters.ts`.
2. Whether a Manual slot with **positive** power actually discharges on
   schedule — only Manual-negative charge is live-verified; immediate discharge
   uses Passive instead.

## DHCP self-heal by `ble_mac` (implemented)

The `devices` registry stores each unit's stable `ble_mac`; the IP is only a
hint. On a failed poll, `batteryPoller.ts` broadcast-rediscovers and updates the
host of any device whose `ble_mac` now answers at a new IP (throttled ~15 s,
healing all moved devices in one discovery). `GET /api/devices/scan` returns
discovered `{device, ver, ble_mac, ip, …}` for the frontend scanner
(Configuration tab → "Scan network").

## Where it lives in the code

- UDP transport (rpc, discovery, pacing): `marstekUdpTransport.ts`.
- Reads / mapping: `marstekUdpClient.ts`.
- Control: `marstekControl.ts` — `setMarstekUdpManual` (charge = Manual
  negative / discharge = Passive positive + `cd_time` / stop = Manual
  `enable:0`), back-compat `setMarstekUdpChargePower`, and
  `setMarstekUdpSchedule` (one Manual `ES.SetMode` per `time_num` slot, paced).
- Exposed as `POST /api/devices/:id/manual` and
  `POST /api/devices/:id/schedule`; UI in `ManualControl.tsx` +
  `SchedulePanel.tsx`.
