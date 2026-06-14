import { Type } from 'typebox';

import { requireAuth } from '../auth.ts';
import { syncAllHistory } from '../services/solarweb.ts';
import {
  cancelSync,
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
      preHandler: requireAuth,
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
      preHandler: requireAuth,
      schema: {
        response: {
          200: Type.Object({ started: Type.Boolean() }),
          409: Type.Object({ error: Type.String() }),
        },
      },
    },
    async (_, reply) => {
      if (getSyncProgress().running) {
        return reply.code(409).send({ error: 'Sync already in progress' });
      }
      // Fire-and-forget: return immediately so the HTTP connection closes
      // before Cloudflare's ~100 s timeout. Client polls /scrape-progress.
      void scrapeAllHistory().catch((error: unknown) => {
        fastify.log.error({ err: error }, 'scrapeAllHistory failed');
      });
      return { started: true };
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
      preHandler: requireAuth,
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

  fastify.post(
    '/api/solarweb/scrape-cancel',
    {
      preHandler: requireAuth,
      schema: {
        response: { 200: Type.Object({ cancelled: Type.Boolean() }) },
      },
    },
    () => {
      cancelSync();
      return { cancelled: true };
    },
  );

  fastify.get(
    '/api/solarweb/scrape-progress',
    {
      schema: {
        response: {
          200: Type.Object({
            running: Type.Boolean(),
            cancelled: Type.Boolean(),
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
