import type { ReactNode } from 'react';

import type { Point } from './powerFlowGeometry.ts';
import {
  FLOW_THRESHOLD_W,
  GRID,
  HOME,
  HUB,
  HUB_R,
  NODE_R,
  SOLAR,
  batteryPositions,
  edgePath,
  flowDuration,
  formatW,
} from './powerFlowGeometry.ts';
import {
  BatteryIcon,
  GridIcon,
  HomeIcon,
  InverterIcon,
  SunIcon,
} from './powerFlowIcons.tsx';

/** One battery to render in the flow diagram. */
export interface FlowBattery {
  id: string;
  name: string;
  /** AC power: positive = discharging (into hub), negative = charging (from hub). */
  watts: number;
  /** State of charge in percent, or null when unknown. */
  soc: number | null;
  /**
   * True when the device's telemetry is stale (offline): its `watts`/`soc` are
   * last-known, not live, so the node renders "offline" with no flow rather than
   * a phantom charge/discharge.
   * @default false
   */
  offline?: boolean;
}

interface PowerFlowDiagramProps {
  /** Solar production in watts (always into the hub). */
  productionW: number;
  /** Grid power: positive = importing, negative = exporting. */
  gridW: number;
  /** Home consumption in watts (always out of the hub). */
  consumptionW: number;
  /** Each battery's live power and charge. */
  batteries: FlowBattery[];
  /** Whether the readings are stale. */
  isStale: boolean;
}

interface Edge {
  key: string;
  node: Point;
  watts: number;
  /** True when energy flows out of the hub toward the node. */
  out: boolean;
  color: string;
}

function batteryStateLabel(watts: number, offline = false): string {
  if (offline) return 'offline';
  if (watts > FLOW_THRESHOLD_W) return 'discharging';
  if (watts < -FLOW_THRESHOLD_W) return 'charging';
  return 'idle';
}

/** Muted colour for an offline battery node (vs the live battery colour). */
const OFFLINE_COLOR = 'var(--text-secondary)';

interface FlowNodeViewProps {
  pos: Point;
  color: string;
  name: string;
  value: string;
  sub?: string;
  icon: ReactNode;
}

function FlowNodeView({
  pos,
  color,
  name,
  value,
  sub,
  icon,
}: FlowNodeViewProps) {
  return (
    <g>
      <circle
        cx={pos.x}
        cy={pos.y}
        r={NODE_R}
        style={{
          fill: color,
          fillOpacity: 0.12,
          stroke: color,
          strokeWidth: 2,
        }}
      />
      {icon}
      <text
        x={pos.x}
        y={pos.y + NODE_R + 17}
        textAnchor="middle"
        style={{ fill: 'var(--text-secondary)', fontSize: 12 }}
      >
        {name}
      </text>
      <text
        x={pos.x}
        y={pos.y + NODE_R + 35}
        textAnchor="middle"
        style={{ fill: 'var(--text)', fontSize: 14, fontWeight: 600 }}
      >
        {value}
      </text>
      {sub && (
        <text
          x={pos.x}
          y={pos.y + NODE_R + 50}
          textAnchor="middle"
          style={{ fill: 'var(--text-secondary)', fontSize: 11 }}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

/**
 * Animated SVG diagram of the live energy flow between solar production, the
 * grid, every battery and home consumption. A flowing line of dots travels along
 * each active link — its direction shows whether energy enters or leaves the hub,
 * and its speed scales with the power magnitude.
 * @param root0 - Component props.
 * @param root0.productionW - Solar production in watts.
 * @param root0.gridW - Grid power (positive import, negative export).
 * @param root0.consumptionW - Home consumption in watts.
 * @param root0.batteries - Live state of each battery.
 * @param root0.isStale - Whether the readings are stale.
 * @returns The animated power-flow card.
 */
export default function PowerFlowDiagram({
  productionW,
  gridW,
  consumptionW,
  batteries,
  isStale,
}: PowerFlowDiagramProps) {
  const positions = batteryPositions(batteries.length);
  const batteryNodes = batteries.map((battery, index) => ({
    battery,
    pos: positions[index] ?? HUB,
  }));

  const edges: Edge[] = [
    {
      key: 'solar',
      node: SOLAR,
      watts: productionW,
      out: false,
      color: 'var(--solar)',
    },
    {
      key: 'home',
      node: HOME,
      watts: consumptionW,
      out: true,
      color: 'var(--consumption)',
    },
    {
      key: 'grid',
      node: GRID,
      watts: gridW,
      out: gridW < 0,
      color: gridW < 0 ? 'var(--grid-export)' : 'var(--grid-import)',
    },
  ];
  for (const { battery, pos } of batteryNodes) {
    edges.push({
      key: battery.id,
      node: pos,
      // An offline battery has no live flow — force 0 so no animated line shows.
      watts: battery.offline ? 0 : battery.watts,
      out: battery.watts < 0,
      color: 'var(--battery)',
    });
  }

  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span className="card-title" style={{ marginBottom: 0 }}>
          Live Power Flow
        </span>
        {isStale && <span className="stale-badge">Stale</span>}
      </div>

      <svg
        viewBox="0 0 680 600"
        role="img"
        aria-label="Live power flow diagram"
        style={{ width: '100%', height: 'auto', opacity: isStale ? 0.5 : 1 }}
      >
        {edges.map((edge) => {
          const d = edgePath(edge.node);
          const active = Math.abs(edge.watts) >= FLOW_THRESHOLD_W;
          return (
            <g key={edge.key}>
              <path d={d} className="pf-wire" />
              {active && (
                <path
                  d={d}
                  className={`pf-flow ${edge.out ? 'pf-flow-out' : 'pf-flow-in'}`}
                  style={{
                    stroke: edge.color,
                    animationDuration: `${flowDuration(edge.watts)}s`,
                  }}
                />
              )}
            </g>
          );
        })}

        <FlowNodeView
          pos={SOLAR}
          color="var(--solar)"
          name="Solar"
          value={formatW(productionW)}
          icon={<SunIcon x={SOLAR.x} y={SOLAR.y} color="var(--solar)" />}
        />
        <FlowNodeView
          pos={GRID}
          color={gridW < 0 ? 'var(--grid-export)' : 'var(--grid-import)'}
          name="Grid"
          value={formatW(gridW)}
          sub={
            Math.abs(gridW) < FLOW_THRESHOLD_W
              ? 'idle'
              : gridW < 0
                ? 'exporting'
                : 'importing'
          }
          icon={
            <GridIcon
              x={GRID.x}
              y={GRID.y}
              color={gridW < 0 ? 'var(--grid-export)' : 'var(--grid-import)'}
            />
          }
        />
        <FlowNodeView
          pos={HOME}
          color="var(--consumption)"
          name="Home"
          value={formatW(consumptionW)}
          icon={<HomeIcon x={HOME.x} y={HOME.y} color="var(--consumption)" />}
        />

        {batteryNodes.map(({ battery, pos }) => {
          const color = battery.offline ? OFFLINE_COLOR : 'var(--battery)';
          return (
            <FlowNodeView
              key={battery.id}
              pos={pos}
              color={color}
              name={battery.name}
              value={
                battery.offline
                  ? 'offline'
                  : battery.soc == null
                    ? formatW(battery.watts)
                    : `${Math.round(battery.soc)}%`
              }
              sub={
                battery.offline
                  ? 'no recent data'
                  : `${batteryStateLabel(battery.watts)}${
                      Math.abs(battery.watts) >= FLOW_THRESHOLD_W
                        ? ` · ${formatW(battery.watts)}`
                        : ''
                    }`
              }
              icon={
                <BatteryIcon
                  x={pos.x}
                  y={pos.y}
                  color={color}
                  soc={battery.offline ? null : battery.soc}
                />
              }
            />
          );
        })}

        <circle
          cx={HUB.x}
          cy={HUB.y}
          r={HUB_R}
          style={{
            fill: 'var(--surface-raised)',
            stroke: 'var(--border)',
            strokeWidth: 2,
          }}
        />
        <InverterIcon x={HUB.x} y={HUB.y} color="var(--text-secondary)" />
        <text
          x={HUB.x}
          y={HUB.y + HUB_R + 18}
          textAnchor="middle"
          style={{ fill: 'var(--text-secondary)', fontSize: 12 }}
        >
          Inverter
        </text>
      </svg>
    </div>
  );
}
