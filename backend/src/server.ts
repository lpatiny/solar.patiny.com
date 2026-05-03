import { existsSync } from 'node:fs';
import { join } from 'node:path';

import fastifyStatic from '@fastify/static';

import { buildApp } from './app.ts';
import { startPoller, stopPoller } from './services/poller.ts';

const fastify = await buildApp();

const frontendDist = join(import.meta.dirname, '../../frontend/dist');
if (existsSync(frontendDist)) {
  await fastify.register(fastifyStatic, {
    root: frontendDist,
    prefix: '/',
    decorateReply: true,
  });

  fastify.setNotFoundHandler(async (request, reply) => {
    if (!request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });
}

startPoller(fastify.log);

fastify.addHook('onClose', () => {
  stopPoller();
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
await fastify.listen({ port, host: '0.0.0.0' });
