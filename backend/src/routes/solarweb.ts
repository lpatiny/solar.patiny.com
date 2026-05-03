import { Type } from 'typebox';

import { syncAllHistory } from '../services/solarweb.ts';
import {
  getSyncProgress,
  scrapeAllHistory,
} from '../services/solarwebScraper.ts';
import type { FastifyTyped } from '../types.ts';

export default async function solarwebRoutes(fastify: FastifyTyped) {
  fastify.post(
    '/api/solarweb/sync-history',
    {
      schema: {
        response: {
          200: Type.Object({
            synced: Type.Number(),
            errors: Type.Number(),
            startDate: Type.String(),
          }),
        },
      },
    },
    async () => {
      return syncAllHistory();
    },
  );

  fastify.post(
    '/api/solarweb/scrape-history',
    {
      schema: {
        response: {
          200: Type.Object({
            synced: Type.Number(),
            errors: Type.Number(),
            startDate: Type.String(),
          }),
        },
      },
    },
    async () => {
      return scrapeAllHistory();
    },
  );

  fastify.get(
    '/api/solarweb/scrape-progress',
    {
      schema: {
        response: {
          200: Type.Object({
            running: Type.Boolean(),
            currentDate: Type.Union([Type.String(), Type.Null()]),
            synced: Type.Number(),
            errors: Type.Number(),
            total: Type.Number(),
            startDate: Type.String(),
          }),
        },
      },
    },
    () => getSyncProgress(),
  );
}
