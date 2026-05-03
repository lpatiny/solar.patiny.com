/* eslint-disable camelcase, @typescript-eslint/naming-convention -- Fronius API and DB fields use snake_case */
const FRONIUS_HOST = process.env.FRONIUS_HOST ?? 'http://192.168.1.30';

interface FroniusPowerFlowResponse {
  Body: {
    Data: {
      Site: {
        P_Akku: number | null;
        P_Grid: number | null;
        P_Load: number | null;
        P_PV: number | null;
      };
    };
  };
  Head: { Status: { Code: number } };
}

interface FroniusStorageResponse {
  Body: {
    Data: Record<
      string,
      {
        Controller: {
          Capacity_Maximum: number;
          StateOfCharge_Relative: number;
        };
      }
    >;
  };
}

export interface FroniusReading {
  timestamp: number;
  production_w: number;
  grid_w: number;
  battery_w: number;
  consumption_w: number;
  battery_soc: number | null;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${FRONIUS_HOST}${path}`);
  if (!res.ok) throw new Error(`Fronius API error: ${res.status} ${path}`);
  return res.json() as Promise<T>;
}

export async function fetchPowerFlow(): Promise<FroniusReading> {
  const [flow, storage] = await Promise.all([
    fetchJson<FroniusPowerFlowResponse>(
      '/solar_api/v1/GetPowerFlowRealtimeData.fcgi',
    ),
    fetchJson<FroniusStorageResponse>(
      '/solar_api/v1/GetStorageRealtimeData.cgi?Scope=System',
    ).catch(() => null),
  ]);

  const site = flow.Body.Data.Site;
  const production_w = site.P_PV ?? 0;
  const grid_w = site.P_Grid ?? 0;
  const battery_w = site.P_Akku ?? 0;
  // P_Load is negative in the Fronius API (consuming = negative power flow)
  const consumption_w = Math.abs(site.P_Load ?? 0);

  let battery_soc: number | null = null;
  if (storage) {
    const controllers = Object.values(storage.Body.Data);
    if (controllers.length > 0 && controllers[0]) {
      battery_soc = controllers[0].Controller.StateOfCharge_Relative;
    }
  }

  return {
    timestamp: Math.floor(Date.now() / 1000),
    production_w,
    grid_w,
    battery_w,
    consumption_w,
    battery_soc,
  };
}
