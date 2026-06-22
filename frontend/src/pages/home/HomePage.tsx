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

import AnalysisTab from './components/AnalysisTab.tsx';
import BatteriesSummary from './components/BatteriesSummary.tsx';
import BatteriesTab from './components/BatteriesTab.tsx';
import ChargingStrategyChart from './components/ChargingStrategyChart.tsx';
import ConfigCard from './components/ConfigCard.tsx';
import DayPowerChart from './components/DayPowerChart.tsx';
import DirigeraTab from './components/DirigeraTab.tsx';
import ElectricalCard from './components/ElectricalCard.tsx';
import EnergyChart from './components/EnergyChart.tsx';
import HeaderAuth from './components/HeaderAuth.tsx';
import HistoryChart from './components/HistoryChart.tsx';
import NeighborExportCard from './components/NeighborExportCard.tsx';
import PowerFlowCard from './components/PowerFlowCard.tsx';
import type { FlowBattery } from './components/PowerFlowDiagram.tsx';
import PowerFlowDiagram from './components/PowerFlowDiagram.tsx';
import TemperatureHistoryChart from './components/TemperatureHistoryChart.tsx';
import TemperaturesCard from './components/TemperaturesCard.tsx';
import WeatherChart from './components/WeatherChart.tsx';
import { sumMarstekPowerW, sumStoredKwh } from './components/batteryStatus.ts';
import { useAuth } from './components/useAuth.ts';
import { useBatteryDevicesLive } from './components/useBatteryDevicesLive.ts';

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
  solarweb_scrape_delay_ms: number;
  poll_interval_ms: number;
  marstek_poll_interval_ms: number;
  panel_surface_m2: number;
  panel_efficiency_pct: number;
  panel_performance_ratio: number;
  panel_temp_coeff_pct_per_c: number;
  byd_reserve_pct: number;
  marstek_reserve_pct: number;
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
  const { status } = useAuth();
  const authenticated = status?.authenticated ?? false;
  const [realtime, setRealtime] = useState<RealtimeData | null>(null);
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  const [todayExport, setTodayExport] = useState<number | undefined>();
  const { devices, liveById } = useBatteryDevicesLive();
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<string>(
    () => localStorage.getItem('solar-active-tab') ?? 'overview',
  );
  const [historyRange, setHistoryRange] = useState<{
    from: number;
    to: number;
  }>(() => {
    try {
      const saved = localStorage.getItem('solar-history-range');
      if (saved) {
        const parsed = JSON.parse(saved) as { from: number; to: number };
        if (typeof parsed.from === 'number' && typeof parsed.to === 'number') {
          return parsed;
        }
      }
    } catch {
      // ignore invalid stored value
    }
    return {
      from: Math.floor(Date.now() / 1000) - 86_400,
      to: Math.floor(Date.now() / 1000),
    };
  });

  useEffect(() => {
    localStorage.setItem('solar-history-range', JSON.stringify(historyRange));
  }, [historyRange]);

  // The Configuration tab is only available while logged in. Derive the active
  // tab so a logged-out user lands on the overview without losing their stored
  // preference (it is restored once they log back in).
  const activeTab =
    !authenticated && selectedTab === 'config' ? 'overview' : selectedTab;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const delta = e.key === 'ArrowLeft' ? -1 : 1;
        setHistoryRange((r) => {
          const duration = r.to - r.from;
          return {
            from: r.from + delta * duration,
            to: r.to + delta * duration,
          };
        });
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  function openBatteriesTab() {
    setSelectedTab('batteries');
    localStorage.setItem('solar-active-tab', 'batteries');
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

  function setMonthPreset(year: number, month: number) {
    const start = new Date(year, month, 1, 0, 0, 0);
    const end = new Date(year, month + 1, 0, 23, 59, 59);
    setHistoryRange({
      from: Math.floor(start.getTime() / 1000),
      to: Math.floor(end.getTime() / 1000),
    });
  }

  function setFullYearPreset(year: number) {
    const start = new Date(year, 0, 1, 0, 0, 0);
    const end = new Date(year, 11, 31, 23, 59, 59);
    setHistoryRange({
      from: Math.floor(start.getTime() / 1000),
      to: Math.floor(end.getTime() / 1000),
    });
  }

  function navigateMonth(delta: number) {
    const mid = new Date(((historyRange.from + historyRange.to) / 2) * 1000);
    setMonthPreset(mid.getFullYear(), mid.getMonth() + delta);
  }

  function navigateYear(delta: number) {
    const mid = new Date(((historyRange.from + historyRange.to) / 2) * 1000);
    setFullYearPreset(mid.getFullYear() + delta);
  }

  function navigatePeriod(delta: number) {
    setHistoryRange((r) => {
      const duration = r.to - r.from;
      return { from: r.from + delta * duration, to: r.to + delta * duration };
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

  const totalStoredKwh = battery
    ? sumStoredKwh(battery.soc, battery.capacity_wh / 1000, devices, liveById)
    : undefined;

  // The Fronius reading only knows its own BYD battery, so fold the Marstek
  // discharge/charge into the battery flow (Fronius under-reports the load by
  // whatever the Marstek is supplying, see batteryStrategy.decide). Same sign
  // convention: positive = discharging.
  const marstekPowerW = sumMarstekPowerW(devices, liveById);

  // Derive home consumption from the house power balance so the four rows are
  // always internally consistent (production + battery discharge + grid import
  // − grid export). grid_w is positive for import, negative for export, so it
  // folds in with a single addition. Using Fronius's separately-measured
  // consumption_w instead drifts from the other rows because the readings are
  // sampled with slight time skew.
  const productionW = realtime?.production_w ?? 0;
  const gridW = realtime?.grid_w ?? 0;
  const batteryW = (realtime?.battery_w ?? 0) + marstekPowerW;
  const consumptionW = productionW + batteryW + gridW;

  // Each battery as its own flow node: the Fronius BYD plus every Marstek device.
  // Positive watts = discharging (into the hub), negative = charging.
  const flowBatteries: FlowBattery[] = [];
  if (battery) {
    flowBatteries.push({
      id: 'byd',
      name: 'BYD',
      watts: battery.power_w,
      soc: battery.soc,
    });
  }
  for (const device of devices) {
    const values = liveById[device.id]?.values;
    if (!values) continue;
    flowBatteries.push({
      id: `device-${device.id}`,
      name: device.name,
      watts: values.ac_power_w ?? 0,
      soc: values.soc_pct,
    });
  }

  const overviewPanel = (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
        gap: 16,
        paddingTop: 20,
      }}
    >
      <PowerFlowDiagram
        productionW={productionW}
        gridW={gridW}
        consumptionW={consumptionW}
        batteries={flowBatteries}
        isStale={realtime?.is_stale ?? false}
      />
      <PowerFlowCard
        productionW={productionW}
        gridW={gridW}
        batteryW={batteryW}
        consumptionW={consumptionW}
        totalStoredKwh={totalStoredKwh}
        isStale={realtime?.is_stale ?? false}
      />
      <NeighborExportCard
        gridInjectionW={realtime?.grid_injection_w ?? 0}
        todayExportKwh={todayExport}
      />
      <TemperaturesCard />
      {battery && (
        <BatteriesSummary
          homeSoc={battery.soc}
          homePowerW={battery.power_w}
          homeHost={config?.fronius_host || config?.modbus_host || null}
          homeCapacityKwh={battery.capacity_wh / 1000}
          homeReservePct={config?.byd_reserve_pct ?? 7}
          marstekReservePct={config?.marstek_reserve_pct ?? 5}
          homeOffline={realtime?.is_stale ?? false}
          devices={devices}
          liveById={liveById}
          onOpen={openBatteriesTab}
        />
      )}
      <ChargingStrategyChart />
      <DayPowerChart />
    </div>
  );

  const modbusDisabled = !realtime || realtime.modbus_status === 'disabled';

  const electricalPanel = (
    <div style={{ paddingTop: 20 }}>
      <ElectricalCard
        realtime={realtime}
        reservePct={config?.byd_reserve_pct ?? 7}
      />
      {modbusDisabled && (
        <div style={{ marginTop: 16 }}>
          <ChargingStrategyChart />
        </div>
      )}
    </div>
  );

  const midDate = new Date(((historyRange.from + historyRange.to) / 2) * 1000);
  const monthLabel = midDate.toLocaleDateString([], {
    month: 'short',
    year: 'numeric',
  });
  const yearLabel = String(midDate.getFullYear());

  const rangeControls = (
    <div
      style={{
        alignItems: 'center',
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 12,
        paddingBottom: 10,
        paddingTop: 10,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <ButtonGroup variant="minimal">
        <Button
          size="small"
          icon="arrow-left"
          onClick={() => navigatePeriod(-1)}
          title="Previous period (←)"
        />
        <Button
          size="small"
          icon="arrow-right"
          onClick={() => navigatePeriod(1)}
          title="Next period (→)"
        />
      </ButtonGroup>

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
        <Button size="small" onClick={setAllTimePreset}>
          All time
        </Button>
      </ButtonGroup>

      <ButtonGroup variant="minimal">
        <Button
          size="small"
          icon="chevron-left"
          onClick={() => navigateMonth(-1)}
        />
        <Button
          size="small"
          onClick={() =>
            setMonthPreset(midDate.getFullYear(), midDate.getMonth())
          }
        >
          {monthLabel}
        </Button>
        <Button
          size="small"
          icon="chevron-right"
          onClick={() => navigateMonth(1)}
        />
      </ButtonGroup>

      <ButtonGroup variant="minimal">
        <Button
          size="small"
          icon="chevron-left"
          onClick={() => navigateYear(-1)}
        />
        <Button
          size="small"
          onClick={() => setFullYearPreset(midDate.getFullYear())}
        >
          {yearLabel}
        </Button>
        <Button
          size="small"
          icon="chevron-right"
          onClick={() => navigateYear(1)}
        />
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
      <WeatherChart from={historyRange.from} to={historyRange.to} />
      <div style={{ marginTop: 16 }} />
      <TemperatureHistoryChart from={historyRange.from} to={historyRange.to} />
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
          flexWrap: 'wrap',
          gap: 8,
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
          <HeaderAuth />
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        id="main"
        selectedTabId={activeTab}
        onChange={(id) => {
          const tab = String(id);
          setSelectedTab(tab);
          localStorage.setItem('solar-active-tab', tab);
        }}
        size="large"
        animate
      >
        <Tab id="overview" title="Overview" panel={overviewPanel} />
        <Tab id="electrical" title="Electrical" panel={electricalPanel} />
        <Tab id="batteries" title="Batteries" panel={<BatteriesTab />} />
        <Tab id="history" title="History" panel={historyPanel} />
        <Tab id="analysis" title="Analysis" panel={<AnalysisTab />} />
        <Tab id="dirigera" title="Dirigera" panel={<DirigeraTab />} />
        {authenticated && (
          <Tab id="config" title="Configuration" panel={configPanel} />
        )}
      </Tabs>
    </div>
  );
}
