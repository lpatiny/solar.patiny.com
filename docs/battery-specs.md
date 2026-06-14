# Battery specifications

Physical capacity and minimum-reserve constraint for the solar installation.

- **Total battery capacity:** 11.059 kWh
- **Minimum reserve when "empty":** 7% of total = ~0.774 kWh
- **Usable capacity:** ~10.285 kWh (93% of 11.059 kWh)

The battery enforces a 7% floor to protect cell longevity / BMS limits — it is
never truly discharged to 0.

When computing state-of-charge percentages, progress bars, or energy figures,
treat 7% (0.774 kWh) as the empty baseline and 11.059 kWh as the 100% full
value.

> Note: the Open API's `rated_capacity` / `bat_cap` register reads **5120 Wh** —
> a per-controller nominal, **not** the real ~11 kWh pack size. Do not treat it
> as the pack capacity (see [Marstek Open API](./marstek-open-api.md)).
