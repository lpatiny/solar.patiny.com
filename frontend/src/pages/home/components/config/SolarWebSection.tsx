import { Button, Intent, NumericInput, Tag } from '@blueprintjs/core';
import { useEffect, useRef, useState } from 'react';

import type { ConfigData } from '../../HomePage.tsx';

import SolarWebLogin from './SolarWebLogin.tsx';
import { unitStyle } from './configStyles.ts';
import { Row, SectionTitle } from './configUi.tsx';

interface SolarWebSectionProps {
  config: ConfigData;
  onConfigChange: (updated: ConfigData) => void;
}

interface SyncResult {
  synced: number;
  errors: number;
  startDate: string;
  cancelled: boolean;
}

interface SyncProgress {
  running: boolean;
  cancelled: boolean;
  currentDate: string | null;
  synced: number;
  errors: number;
  total: number;
  startDate: string;
}

export default function SolarWebSection({
  config,
  onConfigChange,
}: SolarWebSectionProps) {
  const [scrapeDelaySec, setScrapeDelaySec] = useState(
    Math.round(config.solarweb_scrape_delay_ms / 1000),
  );
  const [savingDelay, setSavingDelay] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleSaveDelay() {
    setSavingDelay(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // eslint-disable-next-line camelcase -- backend /api/config uses snake_case keys
          solarweb_scrape_delay_ms: scrapeDelaySec * 1000,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = (await res.json()) as ConfigData;
      onConfigChange(updated);
    } catch {
      /* ignore — the value stays in the input */
    } finally {
      setSavingDelay(false);
    }
  }

  async function handleSyncHistory() {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    setSyncProgress(null);

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

      // Scrape runs in the background — poll until running goes false.
      await new Promise<void>((resolve) => {
        pollRef.current = setInterval(() => {
          void fetch('/api/solarweb/scrape-progress')
            .then((r) => r.json())
            .then((p) => {
              const progress = p as SyncProgress;
              setSyncProgress(progress);
              if (!progress.running) {
                if (pollRef.current) clearInterval(pollRef.current);
                pollRef.current = null;
                setSyncResult({
                  synced: progress.synced,
                  errors: progress.errors,
                  startDate: progress.startDate,
                  cancelled: progress.cancelled,
                });
                resolve();
              }
            })
            .catch(() => null);
        }, 2000);
      });
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
    <div>
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

      <Row label="Scrape delay">
        <NumericInput
          value={scrapeDelaySec}
          onValueChange={(v) => setScrapeDelaySec(v)}
          min={1}
          stepSize={10}
          style={{ width: 70 }}
          rightElement={<span style={unitStyle}>s</span>}
        />
      </Row>
      <div style={{ marginTop: 8 }}>
        <Button
          size="small"
          loading={savingDelay}
          onClick={() => void handleSaveDelay()}
        >
          Save scrape delay
        </Button>
      </div>

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
        {syncing && (
          <Button
            intent={Intent.DANGER}
            size="small"
            onClick={() => {
              void fetch('/api/solarweb/scrape-cancel', { method: 'POST' });
            }}
          >
            Cancel
          </Button>
        )}
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
            {syncResult.cancelled && ' (cancelled)'}
            {syncResult.startDate ? ` from ${syncResult.startDate}` : ''}
          </span>
        )}
        {syncError && !syncing && (
          <span style={{ fontSize: 11, color: '#fca5a5' }}>{syncError}</span>
        )}
      </div>

      <SectionTitle title="SolarWeb Login" />
      <SolarWebLogin />
    </div>
  );
}
