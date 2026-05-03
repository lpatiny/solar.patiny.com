/* eslint-disable @typescript-eslint/naming-convention -- API response types use snake_case */
import {
  Button,
  ButtonGroup,
  Classes,
  Tab,
  Tabs,
  Tag,
} from '@blueprintjs/core';
import type { ChangeEvent } from 'react';
import { useEffect, useState } from 'react';

import BatteryCard from './components/BatteryCard.tsx';
import ChargingStrategyChart from './components/ChargingStrategyChart.tsx';
import ConfigCard from './components/ConfigCard.tsx';
import DayPowerChart from './components/DayPowerChart.tsx';
import ElectricalCard from './components/ElectricalCard.tsx';
import EnergyChart from './components/EnergyChart.tsx';
import HistoryChart from './components/HistoryChart.tsx';
import NeighborExportCard from './components/NeighborExportCard.tsx';
import PowerFlowCard from './components/PowerFlowCard.tsx';

type BatteryMode = 'auto' | 'charge' | 'discharge' | 'idle';

export interface RealtimeData {
  timestamp: number;
  production_w: number;
  grid_w: number;
  battery_w: number;
  consumption_w: number;
  battery_soc: number;
  grid_injection_w: number;
  is_stale: boolean;
  modbus_status: 'ok' | 'error' | 'disabled';
  modbus_error: string | null;
  // Modbus-enhanced (null when not enabled)
  ac_power_w: number | null;
  voltage_a_v: number | null;
  voltage_b_v: number | null;
  voltage_c_v: number | null;
  frequency_hz: number | null;
  pv1_power_w: number | null;
  pv2_power_w: number | null;
  battery_charging_w: number | null;
  battery_discharging_w: number | null;
  meter_power_w: number | null;
}

export interface BatteryStatus {
  soc: number;
  power_w: number;
  mode: BatteryMode;
  charge_rate_percent: number;
  capacity_wh: number;
  modbus_enabled: boolean;
}

export interface DailyStat {
  period: string;
  export_kwh: number;
}

export interface ConfigData {
  fronius_host: string;
  modbus_enabled: boolean;
  modbus_host: string;
  modbus_port: number;
  solarweb_configured: boolean;
  poll_interval_ms: number;
  panel_surface_m2: number;
  panel_efficiency_pct: number;
}

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

const POLL_MS = 10_000;

function tsToDateInput(ts: number): string {
  const d = new Date(ts * 1000);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

export default function HomePage() {
  const [realtime, setRealtime] = useState<RealtimeData | null>(null);
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  const [todayExport, setTodayExport] = useState<number | undefined>();
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyRange, setHistoryRange] = useState<{
    from: number;
    to: number;
  }>(() => ({
    from: Math.floor(Date.now() / 1000) - 86_400,
    to: Math.floor(Date.now() / 1000),
  }));

  // Realtime + config polling
  useEffect(() => {
    let cancelled = false;

    async function loadRealtime() {
      try {
        const [rt, bat] = await Promise.all([
          apiFetch<RealtimeData>('/api/realtime'),
          apiFetch<BatteryStatus>('/api/battery'),
        ]);
        if (!cancelled) {
          setRealtime(rt);
          setBattery(bat);
          setError(null);
        }
      } catch (error_) {
        if (!cancelled) {
          setError(
            error_ instanceof Error ? error_.message : 'Connection error',
          );
        }
      }
    }

    async function loadConfig() {
      try {
        const cfg = await apiFetch<ConfigData>('/api/config');
        if (!cancelled) setConfig(cfg);
      } catch {
        // non-critical
      }
    }

    void loadRealtime();
    void loadConfig();

    const pollInterval = setInterval(() => void loadRealtime(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(pollInterval);
    };
  }, []);

  // Today's export stats
  useEffect(() => {
    let cancelled = false;

    async function loadTodayStats() {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const stats = await apiFetch<DailyStat[]>(
          `/api/stats?resolution=day&from=${today}&to=${today}`,
        );
        if (!cancelled) {
          setTodayExport(stats.find((s) => s.period === today)?.export_kwh);
        }
      } catch {
        // non-critical
      }
    }

    void loadTodayStats();
    const interval = setInterval(() => void loadTodayStats(), 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  function handleModeChange(mode: BatteryMode, ratePercent: number) {
    void fetch('/api/battery/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, ratePercent }),
    }).catch((error_: unknown) => {
      setError(error_ instanceof Error ? error_.message : 'Control error');
    });
  }

  function setLast24h() {
    const to = Math.floor(Date.now() / 1000);
    setHistoryRange({ from: to - 86_400, to });
  }

  function setTodayPreset() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    setHistoryRange({
      from: Math.floor(start.getTime() / 1000),
      to: Math.floor(Date.now() / 1000),
    });
  }

  function setYesterdayPreset() {
    const start = new Date();
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 0);
    setHistoryRange({
      from: Math.floor(start.getTime() / 1000),
      to: Math.floor(end.getTime() / 1000),
    });
  }

  function setLastNDays(days: number) {
    const to = Math.floor(Date.now() / 1000);
    setHistoryRange({ from: to - days * 86_400, to });
  }

  function setThisYearPreset() {
    const start = new Date();
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
    setHistoryRange({
      from: Math.floor(start.getTime() / 1000),
      to: Math.floor(Date.now() / 1000),
    });
  }

  function setAllTimePreset() {
    void apiFetch<{ oldest: number | null; newest: number | null }>(
      '/api/history/range',
    ).then(({ oldest }) => {
      setHistoryRange({
        from: oldest ?? 0,
        to: Math.floor(Date.now() / 1000),
      });
    });
  }

  function handleFromChange(e: ChangeEvent<HTMLInputElement>) {
    const ts = Math.floor(
      new Date(`${e.target.value}T00:00:00`).getTime() / 1000,
    );
    if (!Number.isNaN(ts)) setHistoryRange((r) => ({ ...r, from: ts }));
  }

  function handleToChange(e: ChangeEvent<HTMLInputElement>) {
    const ts = Math.floor(
      new Date(`${e.target.value}T23:59:59`).getTime() / 1000,
    );
    if (!Number.isNaN(ts)) setHistoryRange((r) => ({ ...r, to: ts }));
  }

  const overviewPanel = (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16,
        paddingTop: 20,
      }}
    >
      <PowerFlowCard
        productionW={realtime?.production_w ?? 0}
        gridW={realtime?.grid_w ?? 0}
        batteryW={realtime?.battery_w ?? 0}
        consumptionW={realtime?.consumption_w ?? 0}
        isStale={realtime?.is_stale ?? false}
      />
      <NeighborExportCard
        gridInjectionW={realtime?.grid_injection_w ?? 0}
        todayExportKwh={todayExport}
      />
      {battery && (
        <BatteryCard
          soc={battery.soc}
          powerW={battery.power_w}
          mode={battery.mode}
          chargeRatePercent={battery.charge_rate_percent}
          modbusEnabled={battery.modbus_enabled}
          onModeChange={handleModeChange}
        />
      )}
      <ChargingStrategyChart />
      <DayPowerChart />
    </div>
  );

  const electricalPanel = (
    <div style={{ paddingTop: 20 }}>
      <ElectricalCard realtime={realtime} />
    </div>
  );

  const rangeControls = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
        flexWrap: 'wrap',
      }}
    >
      <ButtonGroup variant="minimal">
        <Button size="small" onClick={setLast24h}>
          24h
        </Button>
        <Button size="small" onClick={setTodayPreset}>
          Today
        </Button>
        <Button size="small" onClick={setYesterdayPreset}>
          Yesterday
        </Button>
        <Button size="small" onClick={() => setLastNDays(7)}>
          7d
        </Button>
        <Button size="small" onClick={() => setLastNDays(30)}>
          30d
        </Button>
        <Button size="small" onClick={setThisYearPreset}>
          Year
        </Button>
        <Button size="small" onClick={setAllTimePreset}>
          All time
        </Button>
      </ButtonGroup>
      <input
        type="date"
        className={Classes.INPUT}
        style={{ width: 140 }}
        value={tsToDateInput(historyRange.from)}
        onChange={handleFromChange}
      />
      <span style={{ color: 'var(--text-secondary)' }}>–</span>
      <input
        type="date"
        className={Classes.INPUT}
        style={{ width: 140 }}
        value={tsToDateInput(historyRange.to)}
        onChange={handleToChange}
      />
    </div>
  );

  const historyPanel = (
    <div style={{ paddingTop: 20 }}>
      {rangeControls}
      <EnergyChart from={historyRange.from} to={historyRange.to} />
      <div style={{ marginTop: 16 }} />
      <HistoryChart from={historyRange.from} to={historyRange.to} />
      <div style={{ marginTop: 16 }} />
      <ChargingStrategyChart
        historyDate={new Date(historyRange.from * 1000)
          .toISOString()
          .slice(0, 10)}
      />
    </div>
  );

  const configPanel = (
    <div style={{ paddingTop: 20 }}>
      {config && (
        <ConfigCard
          config={config}
          onConfigChange={setConfig}
          modbusStatus={realtime?.modbus_status ?? 'disabled'}
          modbusError={realtime?.modbus_error ?? null}
        />
      )}
    </div>
  );

  return (
    <div
      className={Classes.DARK}
      style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Solar Monitoring</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {error && (
            <Tag intent="danger" minimal>
              {error}
            </Tag>
          )}
          {realtime && !error && (
            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              Updated {new Date(realtime.timestamp * 1000).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs id="main" defaultSelectedTabId="overview" size="large" animate>
        <Tab id="overview" title="Overview" panel={overviewPanel} />
        <Tab id="electrical" title="Electrical" panel={electricalPanel} />
        <Tab id="history" title="History" panel={historyPanel} />
        <Tab id="config" title="Configuration" panel={configPanel} />
      </Tabs>
    </div>
  );
}
