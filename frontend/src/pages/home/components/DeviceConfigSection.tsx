import { Button, InputGroup, Intent, Switch, Tag } from '@blueprintjs/core';
import { useCallback, useEffect, useState } from 'react';

import type { Device } from '../../../types.ts';

import DeviceScanner from './DeviceScanner.tsx';

const sectionTitleStyle = {
  color: 'var(--text-secondary)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase' as const,
  marginBottom: 6,
  marginTop: 16,
};

interface DeviceDraft {
  name: string;
  host: string;
  port: number;
  enabled: boolean;
}

function draftFrom(device: Device): DeviceDraft {
  return {
    name: device.name,
    host: device.host,
    port: device.port,
    enabled: device.enabled,
  };
}

const numberInputStyle = { width: 70 } as const;

function DeviceRow({
  device,
  onChanged,
}: {
  device: Device;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<DeviceDraft>(draftFrom(device));
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setTestResult(null);
    try {
      await fetch(`/api/devices/${device.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/devices/${device.id}`, { method: 'DELETE' });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setTestResult('testing…');
    try {
      const res = await fetch(`/api/devices/${device.id}/test`, {
        method: 'POST',
      });
      const body = (await res.json()) as { ok: boolean; error: string | null };
      setTestResult(body.ok ? 'reachable ✓' : (body.error ?? 'failed'));
    } catch {
      setTestResult('failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        padding: '8px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <InputGroup
        small
        style={{ width: 130 }}
        value={draft.name}
        onValueChange={(name) => setDraft({ ...draft, name })}
      />
      <InputGroup
        small
        style={{ width: 130 }}
        value={draft.host}
        onValueChange={(host) => setDraft({ ...draft, host })}
      />
      <InputGroup
        small
        type="number"
        style={numberInputStyle}
        value={String(draft.port)}
        onValueChange={(v) => setDraft({ ...draft, port: Number(v) })}
      />
      <Switch
        checked={draft.enabled}
        label="on"
        style={{ marginBottom: 0 }}
        onChange={(e) =>
          setDraft({ ...draft, enabled: e.currentTarget.checked })
        }
      />
      <Button
        small
        intent={Intent.PRIMARY}
        loading={busy}
        onClick={() => void save()}
      >
        Save
      </Button>
      <Button small onClick={() => void test()} disabled={busy}>
        Test
      </Button>
      <Button
        small
        intent={Intent.DANGER}
        minimal
        onClick={() => void remove()}
        disabled={busy}
      >
        Delete
      </Button>
      {testResult && (
        <Tag minimal intent={testResult.includes('✓') ? 'success' : 'warning'}>
          {testResult}
        </Tag>
      )}
    </div>
  );
}

/**
 * Battery device registry management: list, edit, add, delete and test devices.
 * @returns The device configuration section.
 */
export default function DeviceConfigSection() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [newDraft, setNewDraft] = useState<DeviceDraft>({
    name: '',
    host: '',
    port: 30000,
    enabled: true,
  });
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(() => {
    fetch('/api/devices')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Device[]) => setDevices(rows))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function add() {
    if (!newDraft.name || !newDraft.host) return;
    setAdding(true);
    try {
      await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newDraft, type: 'marstek' }),
      });
      setNewDraft({ name: '', host: '', port: 30000, enabled: true });
      refresh();
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <div style={sectionTitleStyle}>Battery Devices</div>
      <div
        style={{
          color: 'var(--text-secondary)',
          fontSize: 11,
          marginBottom: 4,
        }}
      >
        Name · Host · Port · Enabled
      </div>
      {devices.map((device) => (
        <DeviceRow key={device.id} device={device} onChanged={refresh} />
      ))}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          marginTop: 10,
        }}
      >
        <InputGroup
          small
          placeholder="Name"
          style={{ width: 130 }}
          value={newDraft.name}
          onValueChange={(name) => setNewDraft({ ...newDraft, name })}
        />
        <InputGroup
          small
          placeholder="192.168.1.x"
          style={{ width: 130 }}
          value={newDraft.host}
          onValueChange={(host) => setNewDraft({ ...newDraft, host })}
        />
        <InputGroup
          small
          type="number"
          style={numberInputStyle}
          value={String(newDraft.port)}
          onValueChange={(v) => setNewDraft({ ...newDraft, port: Number(v) })}
        />
        <Button
          small
          intent={Intent.SUCCESS}
          loading={adding}
          disabled={!newDraft.name || !newDraft.host}
          onClick={() => void add()}
        >
          Add device
        </Button>
      </div>

      <DeviceScanner devices={devices} onChanged={refresh} />
    </>
  );
}
