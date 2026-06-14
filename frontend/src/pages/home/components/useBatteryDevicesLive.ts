import { useEffect, useState } from 'react';

import type { Device, DeviceLive } from '../../../types.ts';

/** The configured battery devices and their latest live snapshots. */
export interface BatteryDevicesLive {
  devices: Device[];
  liveById: Record<number, DeviceLive>;
}

const POLL_MS = 5_000;

/**
 * Load every configured battery device and poll each one's live reading, so the
 * device data is fetched once and shared by every consumer on the page. The
 * Marstek devices are rate-limited, so a single poller is used rather than one
 * per component.
 * @returns The devices and their live snapshots keyed by device id.
 */
export function useBatteryDevicesLive(): BatteryDevicesLive {
  const [devices, setDevices] = useState<Device[]>([]);
  const [liveById, setLiveById] = useState<Record<number, DeviceLive>>({});

  useEffect(() => {
    let cancelled = false;
    fetch('/api/devices')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Device[]) => {
        if (!cancelled) setDevices(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (devices.length === 0) return undefined;
    let cancelled = false;
    function loadDevice(device: Device) {
      fetch(`/api/devices/${device.id}/live`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: DeviceLive | null) => {
          if (!cancelled && data) {
            setLiveById((prev) => ({ ...prev, [device.id]: data }));
          }
        })
        .catch(() => undefined);
    }
    function load() {
      for (const device of devices) loadDevice(device);
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [devices]);

  return { devices, liveById };
}
