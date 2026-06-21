import { Agent, request } from 'undici';

const DIRIGERA_HOST = process.env.DIRIGERA_HOST ?? '';
const DIRIGERA_TOKEN = process.env.DIRIGERA_TOKEN ?? '';

// The DIRIGERA hub serves its local API over HTTPS with a self-signed
// certificate, so certificate verification must be disabled for this host. The
// dispatcher is scoped to the DIRIGERA requests only — it never affects the
// global fetch used for Fronius / SolarWeb / MeteoSwiss.
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

/** Attributes a DIRIGERA device may expose (a superset across all device types). */
export interface DirigeraAttributes {
  customName?: string;
  model?: string;
  firmwareVersion?: string;
  otaStatus?: string;
  // Lights / controllers
  isOn?: boolean;
  lightLevel?: number;
  colorHue?: number;
  colorSaturation?: number;
  colorTemperature?: number;
  colorMode?: string;
  // Remotes / controllers
  batteryPercentage?: number;
  // Environment sensors
  currentTemperature?: number | null;
  currentRH?: number | null;
  currentCO2?: number | null;
  currentPM25?: number | null;
}

/** A raw device entry as returned by the hub's `/v1/devices` endpoint. */
export interface DirigeraDevice {
  id: string;
  type?: string;
  deviceType?: string;
  isReachable?: boolean;
  attributes?: DirigeraAttributes;
  room?: { name?: string } | null;
}

/** Whether the DIRIGERA hub host and access token are both configured. */
export function isConfigured(): boolean {
  return DIRIGERA_HOST !== '' && DIRIGERA_TOKEN !== '';
}

/**
 * Fetch the full device list from the DIRIGERA hub's local API.
 * @returns every device the hub knows about (reachable or not)
 */
export async function fetchDevices(): Promise<DirigeraDevice[]> {
  // Use undici's own request (not the global fetch) so the Agent dispatcher
  // types stay consistent and to avoid the self-signed cert being verified.
  const { statusCode, body } = await request(
    `https://${DIRIGERA_HOST}:8443/v1/devices`,
    {
      dispatcher: insecureAgent,
      headers: { authorization: `Bearer ${DIRIGERA_TOKEN}` },
    },
  );
  if (statusCode !== 200) {
    await body.dump();
    throw new Error(`DIRIGERA API error: ${statusCode}`);
  }
  return (await body.json()) as DirigeraDevice[];
}
