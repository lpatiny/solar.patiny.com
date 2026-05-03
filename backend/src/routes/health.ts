import type { FastifyTyped } from '../types.ts';

/**
 * Health check route.
 * @param fastify
 */
export default async function healthRoutes(fastify: FastifyTyped) {
  fastify.get('/api/health', async () => ({ status: 'ok' }));
}
