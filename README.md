# solar-monitoring

Solar energy monitoring and control dashboard for Fronius inverter with battery storage. Displays real-time power flow, battery state, grid import/export, and historical energy statistics. Optionally polls SolarWeb cloud API for daily production totals.

## Features

- Real-time data from Fronius inverter via local HTTP API (every 10 s by default)
- Battery, grid, solar, and consumption power flow display
- Historical charts (raw, hourly, daily) backed by SQLite
- Optional Modbus TCP for advanced monitoring and battery charge control
- Optional SolarWeb cloud API for daily production totals and history sync
- Optional IKEA DIRIGERA hub environment sensors (temperature, humidity, CO₂, PM2.5)

See [`docs/`](./docs/README.md) for hardware integration notes (battery specs,
Marstek Modbus register map, and the Marstek Open API).

## How it works — the power model

There are two classes of battery in this installation, and the difference is
fundamental to every calculation in the app:

- **The Fronius inverter + BYD battery are _measured_.** The Fronius Smart Meter
  sits at the grid connection point and reports the real flows for solar
  production (`P_PV`), the BYD battery (`P_Akku`: positive = discharging,
  negative = charging), grid exchange (`P_Grid`: positive = importing, negative
  = exporting) and the resulting house load (`P_Load`). These are ground truth.
- **The two Marstek Venus E batteries are _controlled_, not measured by Fronius.**
  They are simply plugged into ordinary household sockets and driven over UDP
  (charge/discharge setpoints). The Fronius meter has no idea they exist — it
  sees them as part of the ordinary household load.

The consequence that drives the whole control strategy:

> Because the Marstek batteries are **behind** the Fronius meter, the Fronius
> consumption reading **lies** about the true household load. **Charging** a
> Marstek looks to Fronius like extra consumption (it over-reports). **Discharging**
> a Marstek looks like reduced consumption (it under-reports).

Formally, with `marstek_net = Σ(Marstek discharge) − Σ(Marstek charge)`:

```
true household load  L = production_w + grid_w + battery_w + marstek_net
                       = consumption_w(Fronius) + marstek_net
```

So `consumption_w` reported by Fronius is **not** the real consumption whenever a
Marstek is active — the real consumption is `consumption_w + marstek_net`. The
autonomous strategy therefore derives the Marstek discharge target from the full
power balance (`grid + BYD + Marstek`), never from the raw Fronius consumption
figure, so it stays correct regardless of how the Marstek distort the meter. The
frontend power-balance chart likewise reconstructs the true load by adding the
Marstek's own AC power back in.

## Requirements

- Node.js 24+ (for local development)
- Docker + Docker Compose v2 (for deployment)
- Fronius inverter reachable on the local network

## Setup

Copy the environment template and fill in your values:

```sh
cp .env.example .env
# Edit .env with your Fronius host IP and optional SolarWeb credentials
```

## Deployment

Select a deployment mode by uncommenting one `COMPOSE_FILE=` line in `.env`
(see `.env.example`); with none set, `compose.yaml` is used. `compose.yaml` and
`compose.cloudflared.yaml` run host-networked so the Marstek battery poller's
UDP-broadcast discovery and DHCP self-heal work — broadcast cannot cross a Docker
bridge network. `compose.traefik.yaml` stays on a bridge (Traefik routes by
container name) and therefore cannot discover/self-heal batteries: pin each
battery to a static DHCP reservation and set its host explicitly.

### Standard (host-networked, binds `PORT` on the host)

Leave `COMPOSE_FILE` unset, or set `COMPOSE_FILE=compose.yaml`:

```sh
docker compose pull && docker compose up -d
```

To build from the current checkout instead of pulling the released image:

```sh
docker compose up -d --build
```

### Cloudflare Tunnel (public HTTPS via Cloudflare)

1. Go to [Cloudflare dashboard](https://dash.cloudflare.com) → Networking → Tunnels → Create a tunnel → Cloudflared connector.
2. Copy the tunnel token and add it to `.env` as `TUNNEL_TOKEN=...`.
3. After starting the tunnel, go to Published applications tab → add application with Service `HTTP`, URL `http://localhost:60504` (the cloudflared sidecar is host-networked), hostname `solar-monitoring.lactame.com` (or your chosen domain).

```sh
# in .env: COMPOSE_FILE=compose.cloudflared.yaml
docker compose up -d
```

### Traefik reverse proxy (public HTTPS via existing Traefik)

Requires an existing Traefik instance on an external Docker network named `traefik` with a `websecure` entrypoint and a `letsencrypt` cert resolver. Adjust the `Host(...)` label in `compose.traefik.yaml` to your chosen hostname. Battery discovery/self-heal is unavailable in this mode (bridge networking — see above).

```sh
# in .env: COMPOSE_FILE=compose.traefik.yaml
# Edit compose.traefik.yaml and set your hostname in the traefik label
docker compose up -d
```

## Local development

```sh
npm install
npm run dev
```

The backend runs on `http://localhost:60504` and the Vite dev server on `http://localhost:5173` with API proxying to the backend. Set `PORT` in `.env` to change the backend port.

## Configuration

All configuration is via environment variables (see `.env.example` for the full list). Key variables:

| Variable                | Default | Description                                    |
| ----------------------- | ------- | ---------------------------------------------- |
| `PORT`                  | `60504` | Backend HTTP port                              |
| `FRONIUS_HOST`          | —       | Local inverter URL, e.g. `http://192.168.1.30` |
| `POLL_INTERVAL_MS`      | `10000` | Data polling interval                          |
| `MODBUS_ENABLED`        | `false` | Enable Modbus TCP polling                      |
| `SOLARWEB_PV_SYSTEM_ID` | —       | SolarWeb system ID for cloud sync              |
| `DIRIGERA_HOST`         | —       | IKEA DIRIGERA hub LAN IP (temperature sensors) |
| `DIRIGERA_TOKEN`        | —       | DIRIGERA access token (see below)              |

### IKEA DIRIGERA temperature sensors

The overview page shows the temperature, humidity, CO₂ and PM2.5 reported by
every environment sensor paired to an IKEA DIRIGERA hub (e.g. ALPSTUGA units).
Set `DIRIGERA_HOST` to the hub's LAN IP, then generate an access token with the
one-time pairing helper — press the action button on the bottom of the hub when
prompted:

```sh
npm run dirigera-auth -w backend -- <hub-ip>
```

It prints the `DIRIGERA_HOST` / `DIRIGERA_TOKEN` lines to paste into `.env`. The
card stays hidden until both are set and the hub reports at least one sensor.

Every metric is also recorded to SQLite every 5 minutes (table
`temperature_readings`). The Temperatures card shows live values per sensor plus
**last-24h** temperature and humidity trends; the History tab plots **all
metrics** (temperature, humidity, CO₂, PM2.5) over the selected date range. Tune
the cadence with `DIRIGERA_PERSIST_INTERVAL_MS`.
