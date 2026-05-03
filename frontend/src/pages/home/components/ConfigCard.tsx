import { Button, Intent, NumericInput, Tag } from '@blueprintjs/core';
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
  const [syncing, setSyncing] = useState(false);
  const [panelSurface, setPanelSurface] = useState(config.panel_surface_m2);
  const [panelEfficiency, setPanelEfficiency] = useState(
    config.panel_efficiency_pct,
  );
  const [savingPanel, setSavingPanel] = useState(false);
  const [panelSaveError, setPanelSaveError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

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
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = (await res.json()) as ConfigData;
      onConfigChange(updated);
    } catch (error_) {
      setPanelSaveError(error_ instanceof Error ? error_.message : 'Save failed');
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      <Row
        label="Peak DC power"
        value={`${((panelSurface * panelEfficiency) / 100).toFixed(1)} kW`}
      />
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
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
    </div>
  );
}
