import { Type } from '@sinclair/typebox';

import { syncAllHistory } from '../services/solarweb.ts';
import { scrapeAllHistory } from '../services/solarwebScraper.ts';
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
}
