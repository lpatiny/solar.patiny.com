import { Callout, HTMLSelect } from '@blueprintjs/core';
import { useEffect, useState } from 'react';

import type { Device } from '../../../../types.ts';
import LoginPanel from '../LoginPanel.tsx';
import ManualControl from '../ManualControl.tsx';
import SchedulePanel from '../SchedulePanel.tsx';

import { Row, SectionTitle } from './configUi.tsx';

/**
 * Manual battery control, shown when the Battery Control tab is in Manual mode.
 * Lists the controllable Marstek batteries, lets the operator pick one, and —
 * once authenticated — exposes immediate charge/discharge/stop and the per-day
 * schedule editor. The autonomous strategy is off while this mode is active.
 * @returns The manual-control panel.
 */
export default function ManualBatteryPanel() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/devices')
      .then((response) => (response.ok ? response.json() : []))
      .then((all: Device[]) => {
        if (!active) return;
        const marstek = all.filter(
          (device) => device.type === 'marstek' && device.enabled,
        );
        setDevices(marstek);
        setSelectedId((current) => current ?? marstek[0]?.id ?? null);
      })
      .catch(() => {
        if (active) setDevices([]);
      });
    return () => {
      active = false;
    };
  }, []);

  if (devices === null) {
    return <div style={{ fontSize: 12 }}>Loading…</div>;
  }

  if (devices.length === 0) {
    return (
      <Callout intent="warning">
        No controllable Marstek batteries are configured. Add one in the Devices
        tab to control it manually.
      </Callout>
    );
  }

  const selected =
    devices.find((device) => device.id === selectedId) ?? devices[0];
  if (!selected) return null;

  return (
    <div>
      {devices.length > 1 && (
        <Row label="Battery">
          <HTMLSelect
            value={selected.id}
            onChange={(event) =>
              setSelectedId(Number(event.currentTarget.value))
            }
          >
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </HTMLSelect>
        </Row>
      )}

      <LoginPanel>
        <SectionTitle
          title="Immediate control"
          help="Send a one-off charge, discharge or stop command to the selected battery right now. Stays in effect until it expires or you send another."
        />
        <ManualControl deviceId={selected.id} />

        <SectionTitle
          title="Schedule (per day / hour)"
          help="Program recurring charge/discharge slots that run on the battery itself. Write-only: the device cannot report its current schedule back."
        />
        <Callout intent="primary" style={{ margin: '4px 0 8px' }}>
          Slots are pushed to the battery and run on the device itself. Charge
          slots draw from the grid; discharge slots feed it. The device cannot
          report its current schedule, so this editor is write-only.
        </Callout>
        <SchedulePanel deviceId={selected.id} />
      </LoginPanel>
    </div>
  );
}
