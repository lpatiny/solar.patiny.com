/* eslint-disable camelcase, @typescript-eslint/naming-convention -- Open API wire fields are snake_case */
import { createSocket } from 'node:dgram';

/** A Marstek device reachable over the local UDP Open API. */
export interface UdpDeviceAddress {
  host: string;
  /** UDP port the Open API listens on (device default 30000). */
  port: number;
}

/** Result of `Marstek.GetDevice` discovery. */
export interface MarstekDeviceInfo {
  device: string;
  ver: number;
  ble_mac: string;
  wifi_mac: string;
  wifi_name: string;
  ip: string;
}

/**
 * Marstek is an ESP32: it must not be queried more than once every ~10 s, and
 * answers a single UDP datagram per request. Requests to one device are
 * serialized and paced; tests override these via {@link _setUdpTiming}.
 */
let timing = { minIntervalMs: 10_000, timeoutMs: 4000 };

const lastSentAt = new Map<string, number>();
const queues = new Map<string, Promise<unknown>>();
let nextId = 1;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const keyOf = (address: UdpDeviceAddress): string =>
  `${address.host}:${address.port}`;

/**
 * Discover Marstek devices on the LAN via a `Marstek.GetDevice` UDP broadcast.
 * Collects every reply until the timeout elapses (IP is DHCP, so discover
 * rather than hard-code an address).
 * @param options - broadcast address, port and collection window
 * @param options.broadcastAddress - destination broadcast address. Defaults to `255.255.255.255`.
 * @param options.port - UDP port to probe. Defaults to `30000`.
 * @param options.timeoutMs - how long to collect replies, in ms. Defaults to `2000`.
 * @returns the distinct devices that replied
 */
export async function discoverMarstekDevices(options?: {
  broadcastAddress?: string;
  port?: number;
  timeoutMs?: number;
}): Promise<MarstekDeviceInfo[]> {
  const broadcastAddress = options?.broadcastAddress ?? '255.255.255.255';
  const port = options?.port ?? 30000;
  const windowMs = options?.timeoutMs ?? 2000;
  const found = new Map<string, MarstekDeviceInfo>();
  const socket = createSocket('udp4');

  await new Promise<void>((resolve, reject) => {
    socket.on('error', reject);
    socket.on('message', (msg) => {
      const result = parseDeviceInfo(msg);
      if (result?.ble_mac) {
        found.set(result.ble_mac, {
          ...result,
          ip: normalizeMarstekIp(result.ip),
        });
      }
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      const payload = JSON.stringify({
        id: nextId++,
        method: 'Marstek.GetDevice',
        params: { ble_mac: '0' },
      });
      socket.send(payload, port, broadcastAddress, (error) =>
        error ? reject(error) : undefined,
      );
      setTimeout(resolve, windowMs);
    });
  }).finally(() => {
    socket.close();
  });

  return [...found.values()];
}

/**
 * Override request pacing/timeout (tests only).
 * @param next - pacing overrides
 * @param next.minIntervalMs - minimum ms between requests to one device
 * @param next.timeoutMs - per-request reply timeout in ms
 */
export function _setUdpTiming(next: {
  minIntervalMs?: number;
  timeoutMs?: number;
}): void {
  timing = { ...timing, ...next };
}

/**
 * Normalize an IPv4 address with zero-padded octets to canonical form, e.g.
 * `192.168.01.52` → `192.168.1.52` (the device reports padded octets). Returns
 * the input unchanged if it is not a dotted quad of valid octets.
 * @param ip - the IP string to normalize
 * @returns the canonical dotted-quad form
 */
export function normalizeMarstekIp(ip: string): string {
  const parts = ip.split('.');
  if (parts.length !== 4) return ip;
  const octets = parts.map(Number);
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return ip;
  return octets.join('.');
}

function parseDeviceInfo(message: Buffer): MarstekDeviceInfo | null {
  try {
    const parsed = JSON.parse(message.toString()) as {
      result?: MarstekDeviceInfo;
    };
    return parsed.result ?? null;
  } catch {
    return null;
  }
}

/**
 * Send one paced JSON-RPC request to a device and await its single reply. One
 * serialized, paced queue per device so concurrent callers never breach the
 * ESP32's ~10 s minimum interval.
 * @param address - device host and UDP port
 * @param method - JSON-RPC method name
 * @param params - JSON-RPC params object
 * @returns the parsed `result` field of the reply
 */
export function rpc<T>(
  address: UdpDeviceAddress,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const key = keyOf(address);
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const since = Date.now() - (lastSentAt.get(key) ?? 0);
      const wait = timing.minIntervalMs - since;
      if (wait > 0 && lastSentAt.has(key)) await sleep(wait);
      lastSentAt.set(key, Date.now());
      return sendReceive<T>(address, method, params);
    });
  queues.set(
    key,
    run.catch(() => undefined),
  );
  return run;
}

function sendReceive<T>(
  address: UdpDeviceAddress,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const socket = createSocket('udp4');
    const id = nextId++;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`${method}: no UDP reply from ${keyOf(address)}`));
    }, timing.timeoutMs);

    const finish = (error: Error | null, value?: T): void => {
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(value as T);
    };

    socket.on('error', (error) => finish(error));
    socket.on('message', (msg) => {
      let parsed: { result?: T; error?: { code: number; message: string } };
      try {
        parsed = JSON.parse(msg.toString());
      } catch {
        finish(new Error(`${method}: invalid JSON reply`));
        return;
      }
      if (parsed.error) {
        finish(
          new Error(
            `${method}: ${parsed.error.message} (${parsed.error.code})`,
          ),
        );
      } else {
        finish(null, parsed.result);
      }
    });

    socket.bind(() => {
      const payload = JSON.stringify({ id, method, params });
      socket.send(payload, address.port, address.host, (error) =>
        error ? finish(error) : undefined,
      );
    });
  });
}
