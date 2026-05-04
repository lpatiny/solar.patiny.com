import { Type } from 'typebox';

import { syncAllHistory } from '../services/solarweb.ts';
import {
  getSessionStatus,
  getSyncProgress,
  importSession,
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
          500: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (_, reply) => {
      try {
        return await scrapeAllHistory();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fastify.log.error({ err: error }, 'scrapeAllHistory failed');
        return reply.code(500).send({ error: message });
      }
    },
  );

  fastify.get(
    '/api/solarweb/session',
    {
      schema: {
        response: {
          200: Type.Object({
            hasSession: Type.Boolean(),
            cookieKeys: Type.Array(Type.String()),
            lastError: Type.Union([Type.String(), Type.Null()]),
            savedAt: Type.Union([Type.String(), Type.Null()]),
          }),
        },
      },
    },
    () => getSessionStatus(),
  );

  fastify.post(
    '/api/solarweb/session',
    {
      schema: {
        body: Type.Object({ cookies: Type.String() }),
        response: {
          200: Type.Object({ ok: Type.Boolean() }),
          400: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const { cookies } = request.body;
      try {
        importSession(cookies);
        return { ok: true };
      } catch (error_) {
        return reply.code(400).send({
          error: error_ instanceof Error ? error_.message : 'Import failed',
        });
      }
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
