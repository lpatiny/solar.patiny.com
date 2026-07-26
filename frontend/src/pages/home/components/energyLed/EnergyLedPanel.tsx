import { formatW } from '../powerFlowGeometry.ts';

import LedFlux from './LedFlux.tsx';
import type { LedColors } from './LedSquare.tsx';
import LedSquare from './LedSquare.tsx';
import SquareCaption from './SquareCaption.tsx';
import {
  BATTERY_GRID_TRACK,
  BATTERY_ORIGIN,
  BATTERY_TO_HOME_TRACK,
  CONSUMPTION_ORIGIN,
  GRID_ORIGIN,
  GRID_TO_HOME_TRACK,
  SOLAR_ORIGIN,
  SOLAR_TO_BATTERY_TRACK,
  SOLAR_TO_GRID_TRACK,
  SOLAR_TO_HOME_TRACK,
  WALL_SIZE,
} from './ledLayout.ts';
import { ENERGY_SCALE, POWER_SCALE, formatWh } from './ledScale.ts';
import { useEnergyFlow } from './useEnergyFlow.ts';

/** Panel colours, taken from the physical wall's firmware. */
const SOLAR_COLORS: LedColors = {
  high: '#ffff00',
  low: '#505000',
  background: '#101000',
};
// The battery square carries two greens: the BYD share of the level fills the
// ring first in pure green, the Marstek share continues in mint, so the boundary
// says which pack is holding the charge.
const BYD_COLORS: LedColors = {
  high: '#00ff00',
  low: '#005000',
  background: '#001000',
};
const MARSTEK_COLORS: LedColors = {
  high: '#00ff80',
  low: '#005028',
  background: '#001008',
};
const GRID_COLORS: LedColors = {
  high: '#ffffff',
  low: '#505050',
  background: '#101010',
};
const CONSUMPTION_COLORS: LedColors = {
  high: '#ff0000',
  low: '#500000',
  background: '#100000',
};
const FLUX_COLOR = '#0000ff';
const FLUX_BACKGROUND = '#000010';

/** Vertical room above the wall for the two top captions. */
const TOP_CAPTION_H = 92;
/** Vertical room below the wall for the two bottom captions. */
const BOTTOM_CAPTION_H = 76;
/** Horizontal centre of the left-hand column of squares. */
const LEFT_CENTER = 85;
/** Horizontal centre of the right-hand column of squares. */
const RIGHT_CENTER = WALL_SIZE - 85;

/**
 * The live energy wall: four LED squares — solar production (yellow), battery
 * level (green), consumption (red) and the grid (white) — with blue dots
 * marching along every active link at a speed set by the power being
 * transferred. It reproduces the physical panel (hackuarium/esp32-c3) LED for
 * LED, and refreshes every 10 s.
 * @returns The energy wall card.
 */
export default function EnergyLedPanel() {
  const { data, error } = useEnergyFlow();

  const production = data?.production_w ?? 0;
  const consumption = data?.consumption_w ?? 0;
  const gridImport = data?.grid_import_w ?? 0;
  const gridExport = data?.grid_export_w ?? 0;
  const storedWh = data?.battery_stored_wh ?? 0;
  const bydStoredWh = data?.byd_stored_wh ?? 0;
  const marstekStoredWh = data?.marstek_stored_wh ?? 0;
  const charge = data?.battery_charge_w ?? 0;
  const discharge = data?.battery_discharge_w ?? 0;
  const gridToBattery = data?.grid_to_battery_w ?? 0;
  const batteryToGrid = data?.battery_to_grid_w ?? 0;

  // The battery ↔ grid link runs along one anti-diagonal in either direction,
  // so flip the track when the grid is charging the batteries.
  const batteryGridTrack =
    gridToBattery > batteryToGrid
      ? { from: BATTERY_GRID_TRACK.to, to: BATTERY_GRID_TRACK.from }
      : BATTERY_GRID_TRACK;

  const batterySub =
    charge > 0
      ? `charging ${formatW(charge)}`
      : discharge > 0
        ? `discharging ${formatW(discharge)}`
        : 'idle';
  // The square carries the magnitude exchanged with the grid in either
  // direction — only one of import/export is ever non-zero — and which way it
  // goes is read off the flux leaving or entering the square.
  const gridPower = gridImport + gridExport;
  const gridSub =
    gridExport > 0 ? 'exporting' : gridImport > 0 ? 'importing' : 'idle';

  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <span className="card-title" style={{ marginBottom: 0 }}>
          Energy Wall
        </span>
        {error && <span className="stale-badge">{error}</span>}
        {!error && data?.is_stale && <span className="stale-badge">Stale</span>}
      </div>

      <svg
        viewBox={`0 0 ${WALL_SIZE} ${TOP_CAPTION_H + WALL_SIZE + BOTTOM_CAPTION_H}`}
        role="img"
        aria-label="Energy wall: solar production, battery level, consumption and grid"
        style={{
          background: '#05070c',
          borderRadius: 'var(--radius)',
          display: 'block',
          height: 'auto',
          margin: '0 auto',
          maxWidth: 560,
          opacity: data?.is_stale ? 0.55 : 1,
          width: '100%',
        }}
      >
        <SquareCaption
          x={LEFT_CENTER}
          y={0}
          title="Solar production"
          value={formatW(production)}
          color={SOLAR_COLORS.high}
        />
        <SquareCaption
          x={RIGHT_CENTER}
          y={0}
          title="Battery level"
          value={formatWh(storedWh)}
          sub={`${Math.round(data?.battery_soc_pct ?? 0)} % · ${batterySub}`}
          extra={`BYD ${formatWh(bydStoredWh)} · Marstek ${formatWh(marstekStoredWh)}`}
          color={BYD_COLORS.high}
        />

        <g transform={`translate(0 ${TOP_CAPTION_H})`}>
          <LedFlux
            track={SOLAR_TO_BATTERY_TRACK}
            watts={data?.solar_to_battery_w ?? 0}
            color={FLUX_COLOR}
            background={FLUX_BACKGROUND}
          />
          <LedFlux
            track={SOLAR_TO_GRID_TRACK}
            watts={data?.solar_to_grid_w ?? 0}
            color={FLUX_COLOR}
            background={FLUX_BACKGROUND}
          />
          <LedFlux
            track={SOLAR_TO_HOME_TRACK}
            watts={data?.solar_to_home_w ?? 0}
            color={FLUX_COLOR}
            background={FLUX_BACKGROUND}
          />
          <LedFlux
            track={BATTERY_TO_HOME_TRACK}
            watts={data?.battery_to_home_w ?? 0}
            color={FLUX_COLOR}
            background={FLUX_BACKGROUND}
          />
          <LedFlux
            track={GRID_TO_HOME_TRACK}
            watts={data?.grid_to_home_w ?? 0}
            color={FLUX_COLOR}
            background={FLUX_BACKGROUND}
          />
          <LedFlux
            track={batteryGridTrack}
            watts={Math.max(gridToBattery, batteryToGrid)}
            color={FLUX_COLOR}
            background={FLUX_BACKGROUND}
          />

          <LedSquare
            origin={SOLAR_ORIGIN}
            value={production}
            scale={POWER_SCALE}
            colors={SOLAR_COLORS}
          />
          <LedSquare
            origin={BATTERY_ORIGIN}
            value={bydStoredWh}
            scale={ENERGY_SCALE}
            colors={BYD_COLORS}
            stacked={{ value: marstekStoredWh, colors: MARSTEK_COLORS }}
          />
          <LedSquare
            origin={GRID_ORIGIN}
            value={gridPower}
            scale={POWER_SCALE}
            colors={GRID_COLORS}
          />
          <LedSquare
            origin={CONSUMPTION_ORIGIN}
            value={consumption}
            scale={POWER_SCALE}
            colors={CONSUMPTION_COLORS}
          />
        </g>

        <SquareCaption
          x={LEFT_CENTER}
          y={TOP_CAPTION_H + WALL_SIZE}
          title="Network"
          value={formatW(gridPower)}
          sub={gridSub}
          color={GRID_COLORS.high}
        />
        <SquareCaption
          x={RIGHT_CENTER}
          y={TOP_CAPTION_H + WALL_SIZE}
          title="Consumption"
          value={formatW(consumption)}
          color={CONSUMPTION_COLORS.high}
        />
      </svg>

      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: 12,
          marginTop: 12,
          textAlign: 'center',
        }}
      >
        Around a square: one LED = 500 W (1.25 kWh for the battery). Inside it:
        one LED = 50 W (125 Wh). The battery counts only usable energy — the
        reserve floor is left out, so empty really is dark — and splits in two
        greens: the BYD share fills the ring first in pure green, the Marstek
        share continues in mint. The blue dots march faster as the transfer
        grows.
      </p>
    </div>
  );
}
