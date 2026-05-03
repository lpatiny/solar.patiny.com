/* eslint-disable camelcase -- TypeBox schema keys and API fields use snake_case */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';

import { db } from '../db/Database.ts';
import {
  computeChargingProfileFromReadings,
  getForecast,
} from '../services/forecastService.ts';
import {
  fetchStationReadings,
  filterReadings,
} from '../services/meteoStationService.ts';
import { getCurrentReading } from '../services/poller.ts';
import { getSunTimesForDate } from '../utils/sunTimes.ts';

const MeteoReadingSchema = Type.Object({
  timestamp: Type.Number(),
  station: Type.String(),
  temperatureC: Type.Union([Type.Number(), Type.Null()]),
  globalRadiationWm2: Type.Union([Type.Number(), Type.Null()]),
  humidityPct: Type.Union([Type.Number(), Type.Null()]),
  precipitationMm: Type.Union([Type.Number(), Type.Null()]),
  sunshineMin: Type.Union([Type.Number(), Type.Null()]),
});

const SlotSchema = Type.Object({
  timestamp: Type.Number(),
  endTimestamp: Type.Number(),
  temperatureC: Type.Number(),
  precipitationMm: Type.Number(),
  weatherMask: Type.Number(),
  weatherDescription: Type.String(),
  cloudFactor: Type.Number(),
  predictedProductionKwh: Type.Number(),
  typicalConsumptionKwh: Type.Number(),
  batteryChargeKwh: Type.Number(),
  neighborExportKwh: Type.Number(),
  batterySocStartPct: Type.Number(),
  batterySocEndPct: Type.Number(),
  isPast: Type.Boolean(),
  clearSkyIrradianceWm2: Type.Number(),
  predictedIrradianceWm2: Type.Number(),
});

const forecastRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/api/forecast',
    {
      schema: {
        response: {
          200: Type.Object({
            slots: Type.Array(SlotSchema),
            sunriseTs: Type.Number(),
            sunsetTs: Type.Number(),
            solarNoonTs: Type.Number(),
            totalDayPredictedKwh: Type.Number(),
            remainingPredictedKwh: Type.Number(),
            currentSocPct: Type.Number(),
            batteryCapacityKwh: Type.Number(),
            pvPeakKw: Type.Number(),
            pvScalingFactor: Type.Number(),
            neighborExportTargetW: Type.Number(),
            meteoReadings: Type.Array(MeteoReadingSchema),
          }),
        },
      },
    },
    async () => {
      const current = getCurrentReading();
      const currentSocPct = current?.battery_soc ?? 50;
      return getForecast(currentSocPct);
    },
  );

  fastify.get(
    '/api/forecast/history',
    {
      schema: {
        querystring: Type.Object({
          date: Type.String(),
        }),
        response: {
          200: Type.Object({
            date: Type.String(),
            pvScalingFactor: Type.Number(),
            sunriseTs: Type.Number(),
            sunsetTs: Type.Number(),
            solarNoonTs: Type.Number(),
            profile: Type.Array(
              Type.Object({
                timestamp: Type.Number(),
                productionW: Type.Number(),
                batteryChargeW: Type.Number(),
                neighborExportW: Type.Number(),
                batterySocPct: Type.Number(),
              }),
            ),
            meteoReadings: Type.Array(MeteoReadingSchema),
          }),
        },
      },
    },
    async (request) => {
      const { date } = request.query;
      const dayStart = Math.floor(
        new Date(`${date}T00:00:00`).getTime() / 1000,
      );
      const dayEnd = dayStart + 86_400;

      const [hourlyReadings, allMeteoReadings] = await Promise.all([
        Promise.resolve(db.queryReadingsHourly(dayStart, dayEnd)),
        fetchStationReadings(),
      ]);
      const sunTimes = getSunTimesForDate(new Date(`${date}T12:00:00Z`));
      const meteoReadings = filterReadings(allMeteoReadings, dayStart, dayEnd);

      const firstSoc =
        hourlyReadings.find((r) => r.battery_soc !== null)?.battery_soc ?? 20;

      const profile = computeChargingProfileFromReadings(
        hourlyReadings.map((r) => ({
          bucket: r.bucket,
          production_w: r.production_w,
          battery_soc: r.battery_soc,
        })),
        firstSoc,
      );

      const pvScalingFactor =
        (Number(db.getSetting('panel_surface_m2') ?? 46) *
          Number(db.getSetting('panel_efficiency_pct') ?? 21) *
          0.8) /
        100;

      return {
        date,
        pvScalingFactor,
        sunriseTs: sunTimes.sunrise,
        sunsetTs: sunTimes.sunset,
        solarNoonTs: sunTimes.solarNoon,
        profile,
        meteoReadings,
      };
    },
  );
};

export default forecastRoutes;
