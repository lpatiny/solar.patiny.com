import { useEffect, useState } from 'react';

import type { Device, DeviceLive } from '../../../types.ts';

import BatteryCell from './BatteryCell.tsx';
import { deviceCellData, usableBattery } from './batteryStatus.ts';

interface BatteryDeviceCardProps {
  device: Device;
  selected: boolean;
  reservePct: number;
  onSelect: () => void;
}

const POLL_MS = 5_000;

/**
 * Summary card for one Marstek device: polls its live snapshot and renders the
 * shared battery cell with the directional arrow logo.
 * @param root0 - Component props.
 * @param root0.device - The device to display.
 * @param root0.selected - Whether this card is the selected one.
 * @param root0.reservePct - Reserve floor in percent, hidden from the display.
 * @param root0.onSelect - Called when the card is clicked.
 * @returns The device summary card.
 */
export default function BatteryDeviceCard({
  device,
  selected,
  reservePct,
  onSelect,
}: BatteryDeviceCardProps) {
  const [live, setLive] = useState<DeviceLive | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch(`/api/devices/${device.id}/live`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: DeviceLive | null) => {
          if (!cancelled) setLive(data);
        })
        .catch(() => undefined);
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [device.id]);

  const data = deviceCellData(device, live);
  const usable = usableBattery(data.soc, data.capacityKwh, reservePct);

  return (
    <BatteryCell
      name={device.name}
      statusLabel={data.statusLabel}
      offline={data.offline}
      soc={usable.soc}
      flow={data.flow}
      watts={data.watts}
      subtitle={data.subtitle}
      capacityKwh={usable.capacityKwh}
      highlighted={selected}
      onClick={onSelect}
    />
  );
}
