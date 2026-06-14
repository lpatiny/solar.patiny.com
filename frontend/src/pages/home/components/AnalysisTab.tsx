/* eslint-disable @typescript-eslint/naming-convention -- API fields use snake_case */
import { Button, ButtonGroup } from '@blueprintjs/core';
import { useEffect, useMemo, useState } from 'react';

import ComparisonChart from './ComparisonChart.tsx';
import FormulaBlock from './FormulaBlock.tsx';
import MonthlyAnalysisChart from './MonthlyAnalysisChart.tsx';
import WeeklyEnvelopeChart from './WeeklyEnvelopeChart.tsx';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface PanelArray {
  name: string;
  azimuthDeg: number;
  tiltDeg: number;
  areaM2: number;
}

interface PanelConfig {
  efficiency_pct: number;
  total_area_m2: number;
  peak_kw: number;
  arrays: PanelArray[];
}

interface DailyAnalysis {
  date: string;
  actual_kwh: number | null;
  predicted_kwh: number | null;
  clear_sky_kwh: number | null;
  ghi_kwh_per_m2: number | null;
  performance_ratio: number | null;
}

interface MonthlyAnalysis {
  year_month: string;
  actual_kwh: number | null;
  predicted_kwh: number | null;
  clear_sky_kwh: number | null;
  avg_performance_ratio: number | null;
  capacity_factor: number | null;
}

interface AnalysisData {
  daily: DailyAnalysis[];
  monthly: MonthlyAnalysis[];
  panel_config: PanelConfig;
}

// ──────────────────────────────────────────────
// MathML formula strings (native browser rendering, no library)
// ──────────────────────────────────────────────

// cos(i) = cos(z)cos(β) + sin(z)sin(β)cos(Aₛ − γ)
const F_AOI = `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <mrow>
    <mi>cos</mi><mo>&#x2061;</mo><mo>(</mo><mi>i</mi><mo>)</mo>
    <mo>=</mo>
    <mi>cos</mi><mo>&#x2061;</mo><mo>(</mo><mi>z</mi><mo>)</mo>
    <mo>&#x22C5;</mo>
    <mi>cos</mi><mo>&#x2061;</mo><mo>(</mo><mi>&#x03B2;</mi><mo>)</mo>
    <mo>+</mo>
    <mi>sin</mi><mo>&#x2061;</mo><mo>(</mo><mi>z</mi><mo>)</mo>
    <mo>&#x22C5;</mo>
    <mi>sin</mi><mo>&#x2061;</mo><mo>(</mo><mi>&#x03B2;</mi><mo>)</mo>
    <mo>&#x22C5;</mo>
    <mi>cos</mi><mo>&#x2061;</mo><mo>(</mo>
      <msub><mi>A</mi><mi>s</mi></msub>
      <mo>&#x2212;</mo><mi>&#x03B3;</mi>
    <mo>)</mo>
  </mrow>
</math>`;

// E_POA = DNI·cos(i) + DHI·(1+cosβ)/2 + ρ·GHI·(1−cosβ)/2
const F_POA = `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <mrow>
    <msub><mi>E</mi><mtext>POA</mtext></msub>
    <mo>=</mo>
    <mtext>DNI</mtext><mo>&#x22C5;</mo><mi>cos</mi><mo>&#x2061;</mo><mo>(</mo><mi>i</mi><mo>)</mo>
    <mo>+</mo>
    <mtext>DHI</mtext><mo>&#x22C5;</mo>
    <mfrac>
      <mrow><mn>1</mn><mo>+</mo><mi>cos</mi><mo>&#x2061;</mo><mi>&#x03B2;</mi></mrow>
      <mn>2</mn>
    </mfrac>
    <mo>+</mo>
    <mi>&#x03C1;</mi><mo>&#x22C5;</mo><mtext>GHI</mtext><mo>&#x22C5;</mo>
    <mfrac>
      <mrow><mn>1</mn><mo>&#x2212;</mo><mi>cos</mi><mo>&#x2061;</mo><mi>&#x03B2;</mi></mrow>
      <mn>2</mn>
    </mfrac>
  </mrow>
</math>`;

// k_t = GHI / (S₀ · E₀ · cos z)
const F_KT = `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <mrow>
    <msub><mi>k</mi><mi>t</mi></msub>
    <mo>=</mo>
    <mfrac>
      <mtext>GHI</mtext>
      <mrow>
        <msub><mi>S</mi><mn>0</mn></msub>
        <mo>&#x22C5;</mo>
        <msub><mi>E</mi><mn>0</mn></msub>
        <mo>&#x22C5;</mo>
        <mi>cos</mi><mo>&#x2061;</mo><mo>(</mo><mi>z</mi><mo>)</mo>
      </mrow>
    </mfrac>
  </mrow>
</math>`;

// GHI_clear = S₀ · E₀ · cos(z) · 0.7^(AM^0.678)
const F_CLEARSKY = `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <mrow>
    <msub><mi>GHI</mi><mtext>clear</mtext></msub>
    <mo>=</mo>
    <msub><mi>S</mi><mn>0</mn></msub>
    <mo>&#x22C5;</mo>
    <msub><mi>E</mi><mn>0</mn></msub>
    <mo>&#x22C5;</mo>
    <mi>cos</mi><mo>&#x2061;</mo><mo>(</mo><mi>z</mi><mo>)</mo>
    <mo>&#x22C5;</mo>
    <msup>
      <mn>0.7</mn>
      <msup><mtext>AM</mtext><mn>0.678</mn></msup>
    </msup>
  </mrow>
</math>`;

// AM = 1 / (cos z + 0.50572·(96.08 − z_deg)^−1.6364)
const F_AM = `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <mrow>
    <mtext>AM</mtext>
    <mo>=</mo>
    <mfrac>
      <mn>1</mn>
      <mrow>
        <mi>cos</mi><mo>&#x2061;</mo><mo>(</mo><mi>z</mi><mo>)</mo>
        <mo>+</mo>
        <mn>0.50572</mn>
        <mo>&#x22C5;</mo>
        <msup>
          <mrow><mo>(</mo><mn>96.08</mn><mo>&#x2212;</mo><msub><mi>z</mi><mo>&#xB0;</mo></msub><mo>)</mo></mrow>
          <mn>&#x2212;1.6364</mn>
        </msup>
      </mrow>
    </mfrac>
  </mrow>
</math>`;

// P = E_POA · A · η
const F_POWER = `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
  <mrow>
    <mi>P</mi>
    <mo>=</mo>
    <msub><mi>E</mi><mtext>POA</mtext></msub>
    <mo>&#x22C5;</mo>
    <mi>A</mi>
    <mo>&#x22C5;</mo>
    <mi>&#x03B7;</mi>
  </mrow>
</math>`;

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 12,
  marginBottom: 24,
  padding: '20px 24px',
};

const headingStyle: React.CSSProperties = {
  color: '#f1f5f9',
  fontSize: 16,
  fontWeight: 600,
  marginBottom: 12,
  marginTop: 0,
};

const subHeadingStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 8,
  marginTop: 16,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const textStyle: React.CSSProperties = {
  color: '#cbd5e1',
  fontSize: 14,
  lineHeight: 1.7,
  marginBottom: 8,
};

const citeStyle: React.CSSProperties = {
  color: '#64748b',
  fontSize: 12,
};

const linkStyle: React.CSSProperties = {
  color: '#60a5fa',
  textDecoration: 'none',
};

const metricStyle: React.CSSProperties = {
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  flex: '1 1 140px',
  minWidth: 120,
  padding: '12px 16px',
  textAlign: 'center',
};

const prBadge = (pr: number): React.CSSProperties => ({
  background: pr >= 0.75 ? '#14532d' : pr >= 0.6 ? '#713f12' : '#450a0a',
  borderRadius: 4,
  color: pr >= 0.75 ? '#4ade80' : pr >= 0.6 ? '#fde047' : '#f87171',
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 700,
  padding: '1px 6px',
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

type ViewMode = 'year' | 'month';

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function periodRange(
  mode: ViewMode,
  year: number,
  month: number,
): { from: number; to: number } {
  const now = Math.floor(Date.now() / 1000);
  if (mode === 'year') {
    return {
      from: Math.floor(Date.UTC(year, 0, 1) / 1000),
      to: Math.min(Math.floor(Date.UTC(year, 11, 31, 23, 59, 59) / 1000), now),
    };
  }
  return {
    from: Math.floor(Date.UTC(year, month, 1) / 1000),
    to: Math.min(
      Math.floor(Date.UTC(year, month + 1, 0, 23, 59, 59) / 1000),
      now,
    ),
  };
}

// ──────────────────────────────────────────────
// Summary metrics
// ──────────────────────────────────────────────

function SummaryMetrics({
  daily,
  monthly,
}: {
  daily: DailyAnalysis[];
  monthly: MonthlyAnalysis[];
}) {
  const totalActual = useMemo(
    () => daily.reduce((s, d) => s + (d.actual_kwh ?? 0), 0),
    [daily],
  );
  const totalClearSky = useMemo(
    () => daily.reduce((s, d) => s + (d.clear_sky_kwh ?? 0), 0),
    [daily],
  );
  const medianPR = useMemo(() => {
    const prs = monthly
      .map((m) => m.avg_performance_ratio)
      .filter((v): v is number => v !== null)
      .toSorted((a, b) => a - b);
    if (prs.length === 0) return null;
    return prs[Math.floor(prs.length / 2)] ?? null;
  }, [monthly]);
  const avgCF = useMemo(() => {
    const cfs = monthly
      .map((m) => m.capacity_factor)
      .filter((v): v is number => v !== null);
    if (cfs.length === 0) return null;
    return cfs.reduce((s, v) => s + v, 0) / cfs.length;
  }, [monthly]);

  return (
    <div
      style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}
    >
      <div style={metricStyle}>
        <div style={{ color: '#4ade80', fontSize: 22, fontWeight: 700 }}>
          {totalActual.toFixed(0)}
        </div>
        <div style={{ color: '#64748b', fontSize: 11 }}>kWh produced</div>
      </div>
      <div style={metricStyle}>
        <div style={{ color: '#60a5fa', fontSize: 22, fontWeight: 700 }}>
          {totalClearSky.toFixed(0)}
        </div>
        <div style={{ color: '#64748b', fontSize: 11 }}>kWh clear-sky max</div>
      </div>
      <div style={metricStyle}>
        <div style={{ color: '#f59e0b', fontSize: 22, fontWeight: 700 }}>
          {medianPR !== null ? `${(medianPR * 100).toFixed(0)}%` : '—'}
        </div>
        <div style={{ color: '#64748b', fontSize: 11 }}>
          median correction factor
        </div>
      </div>
      <div style={metricStyle}>
        <div style={{ color: '#c084fc', fontSize: 22, fontWeight: 700 }}>
          {avgCF !== null ? `${(avgCF * 100).toFixed(0)}%` : '—'}
        </div>
        <div style={{ color: '#64748b', fontSize: 11 }}>
          avg capacity factor
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Monthly PR table
// ──────────────────────────────────────────────

function MonthlyTable({ monthly }: { monthly: MonthlyAnalysis[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          borderCollapse: 'collapse',
          color: '#cbd5e1',
          fontSize: 13,
          width: '100%',
        }}
      >
        <thead>
          <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
            <th style={{ padding: '6px 10px', textAlign: 'left' }}>Month</th>
            <th style={{ padding: '6px 10px', textAlign: 'right' }}>
              Actual (kWh)
            </th>
            <th style={{ padding: '6px 10px', textAlign: 'right' }}>
              Predicted (kWh)
            </th>
            <th style={{ padding: '6px 10px', textAlign: 'right' }}>
              Clear-sky (kWh)
            </th>
            <th style={{ padding: '6px 10px', textAlign: 'right' }}>
              Correction factor
            </th>
            <th style={{ padding: '6px 10px', textAlign: 'right' }}>
              Capacity factor
            </th>
          </tr>
        </thead>
        <tbody>
          {monthly.map((m) => (
            <tr
              key={m.year_month}
              style={{ borderBottom: '1px solid #1e293b' }}
            >
              <td style={{ padding: '5px 10px' }}>{m.year_month}</td>
              <td
                style={{
                  padding: '5px 10px',
                  textAlign: 'right',
                  color: '#4ade80',
                }}
              >
                {m.actual_kwh?.toFixed(1) ?? '—'}
              </td>
              <td
                style={{
                  padding: '5px 10px',
                  textAlign: 'right',
                  color: '#f59e0b',
                }}
              >
                {m.predicted_kwh?.toFixed(1) ?? '—'}
              </td>
              <td
                style={{
                  padding: '5px 10px',
                  textAlign: 'right',
                  color: '#60a5fa',
                }}
              >
                {m.clear_sky_kwh?.toFixed(1) ?? '—'}
              </td>
              <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                {m.avg_performance_ratio !== null ? (
                  <span style={prBadge(m.avg_performance_ratio)}>
                    {(m.avg_performance_ratio * 100).toFixed(0)}%
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                {m.capacity_factor !== null
                  ? `${(m.capacity_factor * 100).toFixed(0)}%`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────
// Main tab
// ──────────────────────────────────────────────

export default function AnalysisTab() {
  const now = new Date();
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('year');
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [minYear, setMinYear] = useState<number>(now.getFullYear());

  useEffect(() => {
    void apiFetch<{ oldest: number | null }>('/api/history/range').then(
      ({ oldest }) => {
        if (oldest !== null) {
          setMinYear(new Date(oldest * 1000).getFullYear());
        }
      },
    );
  }, []);

  function navigate(delta: number) {
    if (viewMode === 'year') {
      setSelectedYear((y) =>
        Math.max(minYear, Math.min(now.getFullYear(), y + delta)),
      );
    } else {
      const total = selectedYear * 12 + selectedMonth + delta;
      const minTotal = minYear * 12;
      const maxTotal = now.getFullYear() * 12 + now.getMonth();
      const clamped = Math.max(minTotal, Math.min(maxTotal, total));
      setSelectedYear(Math.floor(clamped / 12));
      setSelectedMonth(clamped % 12);
    }
  }

  const periodLabel =
    viewMode === 'year'
      ? String(selectedYear)
      : `${MONTH_NAMES[selectedMonth]} ${selectedYear}`;

  const canGoPrev =
    viewMode === 'year'
      ? selectedYear > minYear
      : selectedYear * 12 + selectedMonth > minYear * 12;

  const canGoNext =
    viewMode === 'year'
      ? selectedYear < now.getFullYear()
      : selectedYear * 12 + selectedMonth <
        now.getFullYear() * 12 + now.getMonth();

  // Show the loader / clear the error as soon as the period changes — during
  // render, not in the fetch effect, to avoid a cascading re-render.
  const fetchKey = `${viewMode}|${selectedYear}|${selectedMonth}`;
  const [loadingKey, setLoadingKey] = useState(fetchKey);
  if (fetchKey !== loadingKey) {
    setLoadingKey(fetchKey);
    setLoading(true);
    setError(null);
  }

  useEffect(() => {
    const range = periodRange(viewMode, selectedYear, selectedMonth);
    void apiFetch<AnalysisData>(
      `/api/analysis?from=${range.from}&to=${range.to}`,
    )
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((error_: unknown) => {
        setError(
          error_ instanceof Error ? error_.message : 'Error loading analysis',
        );
        setLoading(false);
      });
  }, [viewMode, selectedYear, selectedMonth]);

  return (
    <div style={{ paddingTop: 20, maxWidth: 1060 }}>
      {/* ── Title ── */}
      <h2
        style={{
          color: '#f1f5f9',
          fontSize: 18,
          fontWeight: 700,
          marginBottom: 20,
          marginTop: 0,
        }}
      >
        Solar Production Analysis
      </h2>

      {/* ── Installation ── */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>1. Installation</h3>
        <p style={textStyle}>
          The system is located in Denges, Switzerland (46.543°N, 6.510°E). It
          consists of three panel arrays with a total area of{' '}
          {data?.panel_config.total_area_m2 ?? 46} m² and a nominal peak power
          of{' '}
          <strong style={{ color: '#f1f5f9' }}>
            {data?.panel_config.peak_kw.toFixed(2) ?? '9.66'} kW
            <sub>p</sub>
          </strong>{' '}
          at standard test conditions (STC: 1000 W/m², 25°C, AM 1.5).
        </p>
        <table
          style={{
            borderCollapse: 'collapse',
            color: '#cbd5e1',
            fontSize: 13,
            marginTop: 8,
          }}
        >
          <thead>
            <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
              <th style={{ padding: '5px 14px 5px 0', textAlign: 'left' }}>
                Array
              </th>
              <th style={{ padding: '5px 14px', textAlign: 'right' }}>
                Area (m²)
              </th>
              <th style={{ padding: '5px 14px', textAlign: 'right' }}>
                Tilt (°)
              </th>
              <th style={{ padding: '5px 14px', textAlign: 'right' }}>
                Azimuth
              </th>
            </tr>
          </thead>
          <tbody>
            {(
              data?.panel_config.arrays ?? [
                { name: 'East', areaM2: 20, tiltDeg: 10, azimuthDeg: 90 },
                { name: 'West', areaM2: 20, tiltDeg: 10, azimuthDeg: 270 },
                { name: 'South', areaM2: 6, tiltDeg: 90, azimuthDeg: 180 },
              ]
            ).map((a) => (
              <tr key={a.name} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '4px 14px 4px 0' }}>{a.name}</td>
                <td style={{ padding: '4px 14px', textAlign: 'right' }}>
                  {a.areaM2}
                </td>
                <td style={{ padding: '4px 14px', textAlign: 'right' }}>
                  {a.tiltDeg}
                </td>
                <td style={{ padding: '4px 14px', textAlign: 'right' }}>
                  {a.azimuthDeg === 90
                    ? 'East (90°)'
                    : a.azimuthDeg === 270
                      ? 'West (270°)'
                      : 'South (180°)'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ ...textStyle, marginTop: 12 }}>
          Panel efficiency η ={' '}
          <strong style={{ color: '#f1f5f9' }}>
            {data?.panel_config.efficiency_pct ?? 21}%
          </strong>{' '}
          (manufacturer STC value). Radiation data from MeteoSwiss automatic
          weather network (station Pregny–Chambésy, PRE), measured as global
          horizontal irradiance (GHI) at 10-minute intervals.
        </p>
      </section>

      {/* ── Solar geometry ── */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>2. Solar Geometry and Angle of Incidence</h3>
        <p style={textStyle}>
          Sun position (altitude and azimuth) is calculated using the{' '}
          <em>suncalc</em> library (Agafonkin, 2014), which implements the
          algorithm from Meeus (1998). For each 10-minute interval we derive the
          solar zenith angle <em>z</em> and the solar azimuth{' '}
          <em>
            A<sub>s</sub>
          </em>{' '}
          (measured from north, clockwise). The angle of incidence <em>i</em> on
          a panel with tilt β from horizontal and azimuth γ is:
        </p>
        <FormulaBlock html={F_AOI} />
        <p style={textStyle}>
          The east and west arrays (β = 10°) each receive direct beam in the
          morning and afternoon respectively, while the vertical south facade (β
          = 90°) captures beam radiation most effectively in winter when the sun
          is low. The E/W split distributes production more evenly throughout
          the day compared to a single south-facing roof, at the cost of
          slightly lower annual yield.
        </p>
      </section>

      {/* ── Irradiance model ── */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>3. Irradiance Transposition Model</h3>

        <p style={subHeadingStyle}>3a. Erbs Decomposition (GHI → DNI + DHI)</p>
        <p style={textStyle}>
          MeteoSwiss provides only global horizontal irradiance (GHI). To
          compute the direct normal irradiance (DNI) and diffuse horizontal
          irradiance (DHI) needed for the transposition, we use the Erbs et al.
          (1982) diffuse fraction model based on the clearness index:
        </p>
        <FormulaBlock html={F_KT} />
        <p style={textStyle}>
          where S₀ = 1361 W/m² is the solar constant and E₀ accounts for the
          Earth–Sun distance variation (±3.3%). The diffuse fraction k
          <sub>d</sub> = DHI/GHI is then a piecewise function of k<sub>t</sub>{' '}
          (see Erbs et al., 1982, Eq. 1). DNI = (GHI − DHI)/cos(z).
        </p>

        <p style={subHeadingStyle}>3b. Isotropic Sky Transposition</p>
        <p style={textStyle}>
          The plane-of-array irradiance E<sub>POA</sub> for each array combines
          the direct beam, an isotropic diffuse sky term, and ground-reflected
          irradiance with albedo ρ = 0.20 (Liu &amp; Jordan, 1961; Hay &amp;
          McKay, 1985):
        </p>
        <FormulaBlock html={F_POA} />
        <p style={textStyle}>
          The three arrays are computed independently and their power outputs
          summed. Predicted electrical power:
        </p>
        <FormulaBlock html={F_POWER} />
        <p style={textStyle}>
          where A is the panel area (m²) and η is the panel efficiency (21%).
          Note that this formula gives the <em>ideal</em> electrical output;
          real-world losses from the inverter, wiring, temperature derating, and
          soiling are captured by the empirical{' '}
          <strong>correction factor</strong> (Section 5).
        </p>
      </section>

      {/* ── Clear-sky model ── */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>4. Clear-sky Maximum (Bird Model)</h3>
        <p style={textStyle}>
          To estimate the theoretical maximum production under cloudless
          conditions we use the Bird &amp; Hulstrom (1981) simplified broadband
          clear-sky model:
        </p>
        <FormulaBlock html={F_CLEARSKY} />
        <p style={textStyle}>
          where AM is the optical air mass (Kasten &amp; Young, 1989):
        </p>
        <FormulaBlock html={F_AM} />
        <p style={textStyle}>
          The clear-sky GHI is then transposed to POA using the same Erbs +
          isotropic model as for the measured data. This gives the{' '}
          <strong style={{ color: '#60a5fa' }}>blue curve</strong> in the chart
          below.
        </p>
        <p style={textStyle}>
          <strong>Winter limitation.</strong> Below a solar elevation of ~10°
          (roughly November–January at 46.5°N), the Rayleigh scattering and
          aerosol extinction increase rapidly with air mass, and the simplified
          Bird model tends to overestimate transmittance. Additionally, snow
          accumulation on the panels can reduce production to zero for several
          days. The clear-sky curve should therefore be treated as an upper
          bound in winter; actual clear-sky days in December–January can be
          20–40% below the modelled value.
        </p>
      </section>

      {/* ── Comparison charts ── */}
      <section style={sectionStyle}>
        <div
          style={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <h3 style={{ ...headingStyle, marginBottom: 0 }}>
            5. Comparison: Measured vs. Modelled Production
          </h3>

          <ButtonGroup variant="outlined" size="small">
            <Button
              active={viewMode === 'year'}
              onClick={() => setViewMode('year')}
            >
              Year
            </Button>
            <Button
              active={viewMode === 'month'}
              onClick={() => setViewMode('month')}
            >
              Month
            </Button>
          </ButtonGroup>

          <ButtonGroup variant="outlined" size="small">
            <Button
              icon="chevron-left"
              disabled={!canGoPrev}
              onClick={() => navigate(-1)}
            />
            <Button style={{ minWidth: 90, textAlign: 'center' }}>
              {periodLabel}
            </Button>
            <Button
              icon="chevron-right"
              disabled={!canGoNext}
              onClick={() => navigate(1)}
            />
          </ButtonGroup>

          {loading && (
            <span style={{ color: '#64748b', fontSize: 12 }}>Computing…</span>
          )}
          {error && (
            <span style={{ color: '#f87171', fontSize: 12 }}>{error}</span>
          )}
        </div>

        {data ? (
          <>
            <SummaryMetrics daily={data.daily} monthly={data.monthly} />
            {data.daily.every((d) => d.predicted_kwh === null) && (
              <div
                style={{
                  background: '#1c2a1c',
                  border: '1px solid #365036',
                  borderRadius: 8,
                  color: '#86efac',
                  fontSize: 13,
                  marginBottom: 12,
                  padding: '10px 14px',
                }}
              >
                No MeteoSwiss radiation data found for this period. Run{' '}
                <strong>POST /api/weather/sync</strong> (or use the
                Configuration tab if available) to fetch historical weather data
                and enable the predicted and clear-sky lines.
              </div>
            )}
            <ComparisonChart daily={data.daily} />
          </>
        ) : (
          <div
            style={{ color: '#64748b', padding: '40px 0', textAlign: 'center' }}
          >
            {loading ? 'Computing solar model…' : 'No data'}
          </div>
        )}

        <p style={{ ...textStyle, marginTop: 16 }}>
          The <strong style={{ color: '#4ade80' }}>green curve</strong> is the
          actual daily production from the Fronius SolarWeb 5-minute energy
          meter. The <strong style={{ color: '#f59e0b' }}>amber curve</strong>{' '}
          is the model prediction driven by MeteoSwiss GHI. The{' '}
          <strong style={{ color: '#60a5fa' }}>blue curve</strong> is the
          clear-sky maximum from the Bird model, independent of measured
          radiation. Days where the amber and green curves closely track
          indicate accurate cloud modelling; systematic offset indicates
          panel-specific losses (shading, soiling, degradation) or station
          displacement.
        </p>
      </section>

      {/* ── Monthly stats ── */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>6. Monthly Statistics</h3>

        {data ? (
          <>
            <MonthlyAnalysisChart monthly={data.monthly} />
            <div style={{ marginTop: 20 }}>
              <MonthlyTable monthly={data.monthly} />
            </div>
          </>
        ) : (
          <div
            style={{ color: '#64748b', padding: '40px 0', textAlign: 'center' }}
          >
            {loading ? 'Loading…' : 'No data'}
          </div>
        )}

        <p style={{ ...textStyle, marginTop: 16 }}>
          <strong>Correction factor</strong> = actual / model-predicted. A value
          below 1 indicates system losses not captured by the simple η model
          (inverter efficiency ~97%, wiring ~2%, temperature derating ~3–8% in
          summer, soiling ~1–2%). Expected range: 0.70–0.85. Values above 1
          suggest the MeteoSwiss station experiences slightly less irradiance
          than the installation (station is ~6 km away). The{' '}
          <strong>capacity factor</strong> = actual / clear-sky theoretical,
          indicating what fraction of the astronomical maximum was captured.
        </p>
      </section>

      {/* ── Weekly empirical envelope ── */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>7. Weekly Production Envelope</h3>
        <p style={textStyle}>
          For each of the 52 calendar weeks, the chart below shows the{' '}
          <strong style={{ color: '#4ade80' }}>
            single best daily production
          </strong>{' '}
          recorded across <em>all available years</em> of data. Taking the
          maximum rather than the mean eliminates the influence of cloudy days:
          overcast readings are outliers toward zero, while the peak represents
          what the system actually achieved on a clear day during that week of
          the year. The resulting curve traces the empirical seasonal capacity
          of the installation — rising steeply from winter to a summer plateau
          and falling again in autumn — and can be compared directly with the
          theoretical Bird clear-sky model in Section 4.
        </p>
        <WeeklyEnvelopeChart />
        <p style={{ ...textStyle, marginTop: 16 }}>
          Weeks with a lower recorded maximum (e.g. early January) may simply
          reflect that no fully clear day happened to fall in that week across
          the observed years, or that snow covered the panels. As more years of
          data accumulate the envelope will converge toward the true clear-sky
          ceiling.
        </p>
      </section>

      {/* ── References ── */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>References</h3>
        <ol
          style={{
            color: '#64748b',
            fontSize: 13,
            lineHeight: 1.8,
            paddingLeft: 20,
          }}
        >
          <li style={citeStyle}>
            Bird, R.E. &amp; Hulstrom, R.L. (1981).{' '}
            <em>
              A Simplified Clear Atmosphere Model for Direct and Diffuse
              Insolation on Horizontal Surfaces
            </em>
            . SERI/TR-642-761, Solar Energy Research Institute.{' '}
            <a
              href="https://en.wikipedia.org/wiki/Solar_irradiance"
              style={linkStyle}
            >
              Wikipedia: Solar irradiance
            </a>
          </li>
          <li style={citeStyle}>
            Erbs, D.G., Klein, S.A. &amp; Duffie, J.A. (1982). Estimation of the
            diffuse radiation fraction for hourly, daily and monthly-average
            global radiation. <em>Solar Energy</em>, 28(4), 293–302.{' '}
            <a
              href="https://doi.org/10.1016/0038-092X(82)90302-4"
              style={linkStyle}
            >
              doi:10.1016/0038-092X(82)90302-4
            </a>
          </li>
          <li style={citeStyle}>
            Liu, B.Y.H. &amp; Jordan, R.C. (1961). Daily insolation on surfaces
            tilted towards the equator. <em>ASHRAE Journal</em>, 3(10), 53–59.{' '}
            <a
              href="https://en.wikipedia.org/wiki/Solar_irradiance"
              style={linkStyle}
            >
              Wikipedia: Solar irradiance
            </a>
          </li>
          <li style={citeStyle}>
            Kasten, F. &amp; Young, A.T. (1989). Revised optical air mass tables
            and approximation formula. <em>Applied Optics</em>, 28(22),
            4735–4738.{' '}
            <a href="https://doi.org/10.1364/AO.28.004735" style={linkStyle}>
              doi:10.1364/AO.28.004735
            </a>{' '}
            ·{' '}
            <a
              href="https://en.wikipedia.org/wiki/Air_mass_(solar_energy)"
              style={linkStyle}
            >
              Wikipedia: Air mass
            </a>
          </li>
          <li style={citeStyle}>
            Meeus, J. (1998). <em>Astronomical Algorithms</em> (2nd ed.).
            Willmann-Bell. — basis for the suncalc sun position algorithm.{' '}
            <a
              href="https://en.wikipedia.org/wiki/Jean_Meeus"
              style={linkStyle}
            >
              Wikipedia: Jean Meeus
            </a>
          </li>
          <li style={citeStyle}>
            MeteoSwiss (2024). Open Government Data — Automatic weather network
            (SMN), station PRE (Pregny–Chambésy).{' '}
            <a
              href="https://en.wikipedia.org/wiki/MeteoSwiss"
              style={linkStyle}
            >
              Wikipedia: MeteoSwiss
            </a>
          </li>
          <li style={citeStyle}>
            Duffie, J.A. &amp; Beckman, W.A. (2013).{' '}
            <em>Solar Engineering of Thermal Processes</em> (4th ed.). Wiley. —
            standard reference for transposition models and performance ratio.{' '}
            <a href="https://doi.org/10.1002/9781118671603" style={linkStyle}>
              doi:10.1002/9781118671603
            </a>
          </li>
        </ol>
      </section>
    </div>
  );
}
