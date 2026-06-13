# solar-monitoring

Solar energy monitoring and control dashboard for Fronius inverter with battery storage. Displays real-time power flow, battery state, grid import/export, and historical energy statistics. Optionally polls SolarWeb cloud API for daily production totals.

## Features

- Real-time data from Fronius inverter via local HTTP API (every 10 s by default)
- Battery, grid, solar, and consumption power flow display
- Historical charts (raw, hourly, daily) backed by SQLite
- Optional Modbus TCP for advanced monitoring and battery charge control
- Optional SolarWeb cloud API for daily production totals and history sync

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
3. After starting the tunnel, go to Published applications tab → add application with Service `HTTP`, URL `http://localhost:3000` (the cloudflared sidecar is host-networked), hostname `solar-monitoring.lactame.com` (or your chosen domain).

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

The backend runs on `http://localhost:3000` and the Vite dev server on `http://localhost:5173` with API proxying to the backend. Set `PORT` in `.env` to change the backend port.

## Configuration

All configuration is via environment variables (see `.env.example` for the full list). Key variables:

| Variable                | Default | Description                                    |
| ----------------------- | ------- | ---------------------------------------------- |
| `PORT`                  | `3000`  | Backend HTTP port                              |
| `FRONIUS_HOST`          | —       | Local inverter URL, e.g. `http://192.168.1.30` |
| `POLL_INTERVAL_MS`      | `10000` | Data polling interval                          |
| `MODBUS_ENABLED`        | `false` | Enable Modbus TCP polling                      |
| `SOLARWEB_PV_SYSTEM_ID` | —       | SolarWeb system ID for cloud sync              |
