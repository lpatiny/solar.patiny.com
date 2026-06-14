# Marstek Venus E 3.0 — Modbus TCP

Two Marstek Venus E 3.0 home batteries are reachable on the LAN via Modbus TCP
(RTU-over-TCP). This documents the access details and the device's quirks.

## Discovery & connection

- **OUI:** both units are `dc:04:5a` on their Modbus interface. IPs are DHCP, so
  re-discover by scanning the `/24` for an open port 502. (`nmap` is broken on
  the dev Mac — Lua 5.5 symbol mismatch — use a parallel
  `nc -G 1 -w 1 -z $ip 502` loop instead.) The other host answering on 502 is
  the **Fronius inverter** (OUI `00:03:ac`), not a battery.
- Both batteries are seeded in migration 004 and live in the `devices` table
  (ids 1 and 2, both enabled).
- **Port:** 502. **Unit / slave ID = 0** — not the documented default of 1; the
  gen-3 firmware responds on 0.
- Register `31000+` decodes as ASCII `VNSE3-0` (Venus E 3.0) — a useful identity
  check.

## Connection quirk (important)

The device's Modbus stack is fragile:

- It answers only ~1–2 requests per TCP connection.
- It allows a single connection at a time (concurrent connects → `ECONNREFUSED`).
- Block size is capped to **≤ 10 registers**.

Reliable pattern: **reconnect for every block, read ≤ 10 registers per request,
pace ~1.5 s between connections, and retry on timeout.** The `modbus-serial`
package (already a dependency) works with this pattern.

## Register map (FC03 holding registers)

| Register      | Meaning                                                   | Scaling            |
| ------------- | --------------------------------------------------------- | ------------------ |
| 32100         | battery voltage                                           | ×0.01              |
| 32101         | current (int16)                                           | ×0.01              |
| 32102         | battery power (int32 W)                                   | — (see below)      |
| 32104         | SOC %                                                     | —                  |
| 32105         | energy kWh                                                | ×0.001             |
| 32200         | AC voltage                                                | ×0.1               |
| 32202         | AC power (int32 W)                                        | — (see below)      |
| 33000 / 33002 | total charge / discharge (uint32 kWh)                     | ×0.01              |
| 33004 / 33006 | daily charge / discharge                                  | —                  |
| 35000         | internal temperature (int16)                              | ×0.1 °C            |
| 35100         | inverter state                                            | — (raw, see below) |
| 35110–35112   | charge / discharge limits                                 | —                  |
| 43000         | user work mode                                            | —                  |
| 42000–42021   | write-only control (RS485 enable, force charge/discharge) | —                  |

Source: `github.com/scruysberghs/ha-marstek-venus` and
`bvweerd/marstek_modbus`.

## Sign convention — verified empirically

Community docs were ambiguous/wrong here; these were confirmed on the live unit,
**do not re-guess**:

- **Negative `ac_power_w` (32202) = CHARGING**, positive = discharging.
  Confirmed by watching SOC rise 61 → 64% while AC power read −797 W; the ~800 W
  magnitude matched the SOC rate. Derive charge/discharge **direction from AC
  power**, not from guessed labels.
- **The DC battery-power register 32102 is unreliable on this unit** — it reads
  a stuck 0 even while charging. Do not use it for direction; use AC power.
- `inverter_state` (35100): **2 was observed during charging** (so it is not
  "discharging"). The 0–4 label mapping is unknown/guessed — show the raw number,
  don't assert a meaning.

## Where it lives in the code

- Backend: `services/marstekClient.ts` (serialized reconnect-per-block reader),
  `services/batteryPoller.ts`, `routes/devices.ts`.
- Frontend: Batteries tab + `components/batteryStatus.ts` (encodes the AC-power
  sign rule).
- Generic DB device registry: `devices` and `battery_readings` tables
  (migration 004).

See also [Battery specifications](./battery-specs.md) and the
[Open API](./marstek-open-api.md) (the alternative control path).
