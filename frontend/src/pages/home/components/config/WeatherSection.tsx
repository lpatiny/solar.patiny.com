import { Button, Intent } from '@blueprintjs/core';
import { useState } from 'react';

import { secondaryTextStyle } from './configStyles.ts';
import { ErrorText, Row } from './configUi.tsx';

export default function WeatherSection() {
  const [syncingWeather, setSyncingWeather] = useState(false);
  const [weatherSyncResult, setWeatherSyncResult] = useState<{
    inserted: number;
    years: number[];
  } | null>(null);
  const [weatherSyncError, setWeatherSyncError] = useState<string | null>(null);

  async function handleSyncWeatherHistory() {
    setSyncingWeather(true);
    setWeatherSyncResult(null);
    setWeatherSyncError(null);
    try {
      const res = await fetch('/api/weather/sync', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setWeatherSyncResult(
        (await res.json()) as { inserted: number; years: number[] },
      );
    } catch (error_) {
      setWeatherSyncError(
        error_ instanceof Error ? error_.message : 'Sync failed',
      );
    } finally {
      setSyncingWeather(false);
    }
  }

  return (
    <div>
      <Row
        label="Stations"
        help="MeteoSwiss stations whose measurements (sunshine, temperature) feed the production forecast and the clear-sky comparison."
        value="PRE (Saint-Prex) / PUY (Pully)"
      />
      <Row
        label="Live polling"
        help="Current weather is fetched automatically every 10 minutes; no action needed."
        value="Every 10 min (automatic)"
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
          loading={syncingWeather}
          disabled={syncingWeather}
          onClick={() => void handleSyncWeatherHistory()}
          size="small"
        >
          Sync Meteo History
        </Button>
        {weatherSyncResult && !syncingWeather && (
          <span style={secondaryTextStyle}>
            {weatherSyncResult.inserted.toLocaleString()} readings inserted
            {weatherSyncResult.years.length > 0 &&
              ` (${weatherSyncResult.years[0]}–${weatherSyncResult.years.at(-1)})`}
          </span>
        )}
        {weatherSyncError && !syncingWeather && (
          <ErrorText>{weatherSyncError}</ErrorText>
        )}
      </div>
    </div>
  );
}
