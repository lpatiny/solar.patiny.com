// Cloud transmission factor derived from MeteoSwiss weather mask bit flags.
// Bit layout: 6=Sun, 5=Thunder, 4=Cloud, 3=Fog, 1=Snow, 0=Rain
export function cloudFactorFromMask(mask: number): number {
  const hasSun = (mask & 64) !== 0;
  const hasCloud = (mask & 16) !== 0;
  const hasFog = (mask & 8) !== 0;
  const hasRain = (mask & 1) !== 0;
  const hasSnow = (mask & 2) !== 0;

  if (hasFog) return 0.05;
  if (hasSun && !hasCloud && !hasRain && !hasSnow) return 0.9;
  if (hasSun && hasCloud && !hasRain && !hasSnow) return 0.55;
  if (hasSun && (hasRain || hasSnow)) return 0.35;
  if (!hasSun && hasCloud && !hasRain && !hasSnow) return 0.12;
  if (!hasSun && hasCloud && (hasRain || hasSnow)) return 0.07;
  return 0.25;
}

export function weatherDescription(mask: number): string {
  const hasSun = (mask & 64) !== 0;
  const hasCloud = (mask & 16) !== 0;
  const hasFog = (mask & 8) !== 0;
  const hasRain = (mask & 1) !== 0;
  const hasSnow = (mask & 2) !== 0;
  const hasThunder = (mask & 32) !== 0;

  if (hasFog) return 'Fog';
  if (hasThunder) return hasSun ? 'Thunderstorms possible' : 'Thunderstorms';
  if (hasSun && !hasCloud && !hasRain && !hasSnow) return 'Clear';
  if (hasSun && hasCloud && !hasRain) return 'Partly cloudy';
  if (hasSun && hasRain) return 'Sunny with showers';
  if (hasSun && hasSnow) return 'Sunny with snow';
  if (hasCloud && !hasRain && !hasSnow) return 'Overcast';
  if (hasCloud && hasRain) return 'Rainy';
  if (hasCloud && hasSnow) return 'Snowy';
  return 'Mixed';
}
