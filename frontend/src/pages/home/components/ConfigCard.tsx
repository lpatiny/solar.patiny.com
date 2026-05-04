import { Button, Intent, NumericInput, Tag, TextArea } from '@blueprintjs/core';
import { useEffect, useRef, useState } from 'react';

import type { ConfigData } from '../HomePage.tsx';

interface ConfigCardProps {
  config: ConfigData;
  onConfigChange: (updated: ConfigData) => void;
  modbusStatus: 'ok' | 'error' | 'disabled';
  modbusError: string | null;
}

interface SyncResult {
  synced: number;
  errors: number;
  startDate: string;
}

interface SessionStatus {
  hasSession: boolean;
  cookieKeys: string[];
  lastError: string | null;
  savedAt: string | null;
}

interface SyncProgress {
  running: boolean;
  currentDate: string | null;
  synced: number;
  errors: number;
  total: number;
  startDate: string;
}

function Row({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        alignItems: 'center',
        display: 'flex',
        gap: 8,
        justifyContent: 'space-between',
        padding: '5px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
        {label}
      </span>
      <span style={{ fontSize: 12 }}>
        {value}
        {children}
      </span>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div
      style={{
        color: 'var(--text-secondary)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        marginBottom: 6,
        marginTop: 16,
      }}
    >
      {title}
    </div>
  );
}

export default function ConfigCard({
  config,
  onConfigChange,
  modbusStatus,
  modbusError,
}: ConfigCardProps) {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(
    null,
  );
  const [showLoginHelper, setShowLoginHelper] = useState(false);
  const [cookiePaste, setCookiePaste] = useState('');
  const [importingSession, setImportingSession] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [panelSurface, setPanelSurface] = useState(config.panel_surface_m2);
  const [panelEfficiency, setPanelEfficiency] = useState(
    config.panel_efficiency_pct,
  );
  const [performanceRatio, setPerformanceRatio] = useState(
    config.panel_performance_ratio,
  );
  const [tempCoeff, setTempCoeff] = useState(config.panel_temp_coeff_pct_per_c);
  const [savingPanel, setSavingPanel] = useState(false);
  const [panelSaveError, setPanelSaveError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [syncingWeather, setSyncingWeather] = useState(false);
  const [weatherSyncResult, setWeatherSyncResult] = useState<{
    inserted: number;
    years: number[];
  } | null>(null);
  const [weatherSyncError, setWeatherSyncError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/solarweb/session')
      .then((r) => r.json())
      .then((s) => setSessionStatus(s as SessionStatus))
      .catch(() => null);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleImportSession() {
    setImportingSession(true);
    setImportError(null);
    setImportSuccess(false);
    try {
      const res = await fetch('/api/solarweb/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: cookiePaste }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok)
        throw new Error(data.error ?? `HTTP ${res.status}`);
      setImportSuccess(true);
      setCookiePaste('');
      setShowLoginHelper(false);
      const s = await fetch('/api/solarweb/session').then((r) => r.json());
      setSessionStatus(s as SessionStatus);
    } catch (error_) {
      setImportError(
        error_ instanceof Error ? error_.message : 'Import failed',
      );
    } finally {
      setImportingSession(false);
    }
  }

  async function handleSavePanelSettings() {
    setSavingPanel(true);
    setPanelSaveError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          panel_surface_m2: panelSurface,
          panel_efficiency_pct: panelEfficiency,
          panel_performance_ratio: performanceRatio,
          panel_temp_coeff_pct_per_c: tempCoeff,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = (await res.json()) as ConfigData;
      onConfigChange(updated);
    } catch (error_) {
      setPanelSaveError(
        error_ instanceof Error ? error_.message : 'Save failed',
      );
    } finally {
      setSavingPanel(false);
    }
  }

  async function handleSyncHistory() {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    setSyncProgress(null);

    // Poll progress every second while the long-running POST is in flight
    pollRef.current = setInterval(() => {
      void fetch('/api/solarweb/scrape-progress')
        .then((r) => r.json())
        .then((p) => setSyncProgress(p as SyncProgress))
        .catch(() => null);
    }, 1000);

    try {
      const res = await fetch('/api/solarweb/scrape-history', {
        method: 'POST',
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) detail = `${detail}: ${body.error}`;
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }
      setSyncResult((await res.json()) as SyncResult);
    } catch (error_) {
      setSyncError(error_ instanceof Error ? error_.message : 'Sync failed');
    } finally {
      setSyncing(false);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setSyncProgress(null);
    }
  }

  async function handleSyncWeatherHistory() {
    setSyncingWeather(true);
    setWeatherSyncResult(null);
    setWeatherSyncError(null);
    try {
      const res = await fetch('/api/weather/sync', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setWeatherSyncResult(
        (await res.json()) as { inserted: number; years: number[] },
      );
    } catch (error_) {
      setWeatherSyncError(
        error_ instanceof Error ? error_.message : 'Sync failed',
      );
    } finally {
      setSyncingWeather(false);
    }
  }

  return (
    <div className="card">
      <span className="card-title">Configuration</span>

      <SectionTitle title="Solar Panels" />
      <Row label="Surface area">
        <NumericInput
          value={panelSurface}
          onValueChange={(v) => setPanelSurface(v)}
          min={1}
          stepSize={1}
          minorStepSize={null}
          style={{ width: 80 }}
          rightElement={
            <span
              style={{
                color: 'var(--text-secondary)',
                fontSize: 11,
                padding: '0 6px',
                lineHeight: '30px',
              }}
            >
              m²
            </span>
          }
        />
      </Row>
      <Row label="Panel efficiency">
        <NumericInput
          value={panelEfficiency}
          onValueChange={(v) => setPanelEfficiency(v)}
          min={1}
          max={100}
          stepSize={1}
          minorStepSize={null}
          style={{ width: 80 }}
          rightElement={
            <span
              style={{
                color: 'var(--text-secondary)',
                fontSize: 11,
                padding: '0 6px',
                lineHeight: '30px',
              }}
            >
              %
            </span>
          }
        />
      </Row>
      <Row label="Performance ratio">
        <NumericInput
          value={performanceRatio}
          onValueChange={(v) => setPerformanceRatio(v)}
          min={0.1}
          max={1}
          stepSize={0.01}
          minorStepSize={null}
          style={{ width: 80 }}
          rightElement={
            <span
              style={{
                color: 'var(--text-secondary)',
                fontSize: 11,
                padding: '0 6px',
                lineHeight: '30px',
              }}
            >
              (0–1)
            </span>
          }
        />
      </Row>
      <Row label="Temp. coefficient">
        <NumericInput
          value={tempCoeff}
          onValueChange={(v) => setTempCoeff(v)}
          min={0}
          max={1}
          stepSize={0.01}
          minorStepSize={null}
          style={{ width: 80 }}
          rightElement={
            <span
              style={{
                color: 'var(--text-secondary)',
                fontSize: 11,
                padding: '0 6px',
                lineHeight: '30px',
              }}
            >
              %/°C
            </span>
          }
        />
      </Row>
      <Row
        label="Peak DC power"
        value={`${((panelSurface * panelEfficiency) / 100).toFixed(1)} kW`}
      />
      <div
        style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}
      >
        <Button
          intent={Intent.PRIMARY}
          loading={savingPanel}
          size="small"
          onClick={() => void handleSavePanelSettings()}
        >
          Save panel settings
        </Button>
        {panelSaveError && (
          <span style={{ fontSize: 11, color: '#fca5a5' }}>
            {panelSaveError}
          </span>
        )}
      </div>

      <SectionTitle title="Fronius REST" />
      <Row label="Host" value={config.fronius_host} />
      <Row label="Poll interval" value={`${config.poll_interval_ms / 1000}s`} />

      <SectionTitle title="Modbus TCP" />
      <Row label="Status">
        {modbusStatus === 'ok' && (
          <Tag intent={Intent.SUCCESS} minimal>
            Connected
          </Tag>
        )}
        {modbusStatus === 'error' && (
          <Tag intent={Intent.DANGER} minimal>
            Error
          </Tag>
        )}
        {modbusStatus === 'disabled' && <Tag minimal>Disabled</Tag>}
      </Row>
      {config.modbus_enabled && (
        <Row
          label="Host"
          value={`${config.modbus_host}:${config.modbus_port}`}
        />
      )}
      {modbusError && (
        <div
          style={{
            color: '#fca5a5',
            fontSize: 11,
            marginTop: 4,
            wordBreak: 'break-all',
            fontFamily: 'monospace',
          }}
        >
          {modbusError}
        </div>
      )}

      <SectionTitle title="SolarWeb Cloud" />
      <Row label="Cloud sync">
        <Tag
          intent={config.solarweb_configured ? Intent.SUCCESS : Intent.WARNING}
          minimal
        >
          {config.solarweb_configured ? 'Configured' : 'Not configured'}
        </Tag>
      </Row>
      <Row
        label="Stats source"
        value={
          config.solarweb_configured ? 'SolarWeb + local' : 'Local readings'
        }
      />

      <div
        style={{
          marginTop: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Button
          intent={Intent.PRIMARY}
          loading={syncing}
          disabled={!config.solarweb_configured || syncing}
          onClick={() => void handleSyncHistory()}
          size="small"
        >
          Sync History
        </Button>
        {syncing && syncProgress && (
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {syncProgress.currentDate ?? '…'}
            {syncProgress.total > 0 && (
              <>
                {' '}
                ({syncProgress.synced}/{syncProgress.total})
              </>
            )}
          </span>
        )}
        {syncResult && !syncing && (
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {syncResult.synced} days synced
            {syncResult.errors > 0 && `, ${syncResult.errors} errors`}
            {syncResult.startDate ? ` from ${syncResult.startDate}` : ''}
          </span>
        )}
        {syncError && !syncing && (
          <span style={{ fontSize: 11, color: '#fca5a5' }}>{syncError}</span>
        )}
      </div>

      <SectionTitle title="SolarWeb Login" />
      <Row label="Session">
        {sessionStatus === null ? (
          <Tag minimal>Loading…</Tag>
        ) : sessionStatus.hasSession ? (
          <Tag intent={Intent.SUCCESS} minimal>
            Active
          </Tag>
        ) : (
          <Tag intent={Intent.DANGER} minimal>
            {sessionStatus.lastError ? 'CAPTCHA blocked' : 'No session'}
          </Tag>
        )}
      </Row>
      {sessionStatus?.savedAt && (
        <Row
          label="Saved"
          value={new Date(sessionStatus.savedAt).toLocaleString()}
        />
      )}
      {sessionStatus?.lastError && (
        <div
          style={{
            color: '#fca5a5',
            fontSize: 11,
            marginTop: 4,
            wordBreak: 'break-all',
          }}
        >
          {sessionStatus.lastError}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <Button
          size="small"
          intent={
            sessionStatus && !sessionStatus.hasSession
              ? Intent.WARNING
              : Intent.NONE
          }
          onClick={() => setShowLoginHelper((v) => !v)}
        >
          {showLoginHelper ? 'Hide' : 'Fix Login'}
        </Button>
        {importSuccess && !showLoginHelper && (
          <span style={{ fontSize: 11, color: '#86efac', marginLeft: 10 }}>
            Session imported successfully
          </span>
        )}
      </div>
      {showLoginHelper && (
        <div
          style={{
            background: 'var(--card-bg, #1a1a2e)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            marginTop: 10,
            padding: 12,
            fontSize: 12,
          }}
        >
          <div style={{ marginBottom: 10, color: 'var(--text-secondary)' }}>
            The session cookie is HttpOnly and cannot be read via the console.
            Use the DevTools Network tab instead.
          </div>

          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Step 1 — Log in to SolarWeb
          </div>
          <div style={{ marginBottom: 8 }}>
            <a
              href="https://www.solarweb.com"
              target="_blank"
              rel="noreferrer"
              style={{ color: '#60a5fa' }}
            >
              Open solarweb.com ↗
            </a>{' '}
            and complete login (solve any CAPTCHA if prompted).
          </div>

          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Step 2 — Copy the Cookie request header
          </div>
          <div style={{ marginBottom: 4 }}>
            Press <b>F12</b> on the SolarWeb tab → <b>Network</b> → reload the
            page → click any request to <code>www.solarweb.com</code> →{' '}
            <b>Headers</b> → scroll to <b>Request Headers</b> → find{' '}
            <code>Cookie:</code> and copy its full value.
          </div>
          <div
            style={{
              background: '#0f172a',
              borderRadius: 4,
              color: 'var(--text-secondary)',
              fontFamily: 'monospace',
              fontSize: 11,
              marginBottom: 10,
              padding: '6px 10px',
            }}
          >
            F12 → Network → any solarweb.com request → Headers → Cookie: …
          </div>

          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Step 3 — Paste and import
          </div>
          <TextArea
            value={cookiePaste}
            onChange={(e) => setCookiePaste(e.target.value)}
            placeholder="Paste full Cookie header value here…"
            fill
            rows={4}
            style={{ fontFamily: 'monospace', fontSize: 11, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              intent={Intent.PRIMARY}
              size="small"
              loading={importingSession}
              disabled={!cookiePaste.trim()}
              onClick={() => void handleImportSession()}
            >
              Import Session
            </Button>
            {importError && (
              <span style={{ fontSize: 11, color: '#fca5a5' }}>
                {importError}
              </span>
            )}
          </div>
        </div>
      )}

      <SectionTitle title="MeteoSwiss Weather" />
      <Row label="Stations" value="PRE (Saint-Prex) / PUY (Pully)" />
      <Row label="Live polling" value="Every 10 min (automatic)" />
      <div
        style={{
          marginTop: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Button
          intent={Intent.PRIMARY}
          loading={syncingWeather}
          disabled={syncingWeather}
          onClick={() => void handleSyncWeatherHistory()}
          size="small"
        >
          Sync Meteo History
        </Button>
        {weatherSyncResult && !syncingWeather && (
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {weatherSyncResult.inserted.toLocaleString()} readings inserted
            {weatherSyncResult.years.length > 0 &&
              ` (${weatherSyncResult.years[0]}–${weatherSyncResult.years.at(-1)})`}
          </span>
        )}
        {weatherSyncError && !syncingWeather && (
          <span style={{ fontSize: 11, color: '#fca5a5' }}>
            {weatherSyncError}
          </span>
        )}
      </div>
    </div>
  );
}
