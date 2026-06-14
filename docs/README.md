# Documentation

Reference notes for the solar monitoring & control stack. These capture
hard-won, empirically verified details about the hardware integrations that are
not obvious from the code alone.

- [Battery specifications](./battery-specs.md) — physical capacity and the
  minimum-reserve constraint used for state-of-charge maths.
- [Marstek Venus E — Modbus TCP](./marstek-modbus.md) — RTU-over-TCP access,
  register map, connection quirks, and the verified power sign convention.
- [Marstek Venus E — Open API (UDP JSON-RPC)](./marstek-open-api.md) — the
  local UDP control API, charge/discharge modes, scheduling, and DHCP
  self-heal by `ble_mac`.
