/* eslint-disable camelcase, @typescript-eslint/naming-convention -- TypeBox schema keys mirror DB snake_case fields */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';

import {
  aggregateMonthly,
  computeDailyAnalysis,
  computeWeeklyEnvelope,
  getPanelConfig,
} from '../services/analysisService.ts';

const PanelArraySchema = Type.Object({
  name: Type.String(),
  azimuthDeg: Type.Number(),
  tiltDeg: Type.Number(),
  areaM2: Type.Number(),
});

const PanelConfigSchema = Type.Object({
  efficiency_pct: Type.Number(),
  total_area_m2: Type.Number(),
  peak_kw: Type.Number(),
  arrays: Type.Array(PanelArraySchema),
});

const DailyAnalysisSchema = Type.Object({
  date: Type.String(),
  actual_kwh: Type.Union([Type.Number(), Type.Null()]),
  predicted_kwh: Type.Union([Type.Number(), Type.Null()]),
  clear_sky_kwh: Type.Union([Type.Number(), Type.Null()]),
  ghi_kwh_per_m2: Type.Union([Type.Number(), Type.Null()]),
  performance_ratio: Type.Union([Type.Number(), Type.Null()]),
});

const MonthlyAnalysisSchema = Type.Object({
  year_month: Type.String(),
  actual_kwh: Type.Union([Type.Number(), Type.Null()]),
  predicted_kwh: Type.Union([Type.Number(), Type.Null()]),
  clear_sky_kwh: Type.Union([Type.Number(), Type.Null()]),
  avg_performance_ratio: Type.Union([Type.Number(), Type.Null()]),
  capacity_factor: Type.Union([Type.Number(), Type.Null()]),
});

const WeeklyEnvelopePointSchema = Type.Object({
  week: Type.Number(),
  max_kwh: Type.Number(),
  best_date: Type.String(),
  clear_sky_kwh: Type.Number(),
});

const analysisRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/api/analysis/weekly-envelope',
    {
      schema: {
        response: { 200: Type.Array(WeeklyEnvelopePointSchema) },
      },
    },
    async () => computeWeeklyEnvelope(),
  );

  fastify.get(
    '/api/analysis',
    {
      schema: {
        querystring: Type.Object({
          from: Type.Number(),
          to: Type.Number(),
        }),
        response: {
          200: Type.Object({
            daily: Type.Array(DailyAnalysisSchema),
            monthly: Type.Array(MonthlyAnalysisSchema),
            panel_config: PanelConfigSchema,
          }),
        },
      },
    },
    async (request) => {
      const { from, to } = request.query;
      const daily = computeDailyAnalysis(from, to);
      const monthly = aggregateMonthly(daily);
      const panel_config = getPanelConfig();
      return { daily, monthly, panel_config };
    },
  );
};

export default analysisRoutes;
