import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import type { FastifyTyped } from './types.ts';

const AUTH_USERNAME = process.env.AUTH_USERNAME ?? 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD ?? 'lpclpc';

// @fastify/session refuses a secret shorter than 32 chars. The fallback only
// matters for local development; production must set SESSION_SECRET in .env.
const SESSION_SECRET =
  process.env.SESSION_SECRET ??
  'dev-only-insecure-session-secret-change-me-please';

const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

declare module 'fastify' {
  interface Session {
    authenticated?: boolean;
    username?: string;
  }
}

const LoginBody = Type.Object({
  username: Type.String(),
  password: Type.String(),
});

const ErrorResponse = Type.Object({ error: Type.String() });

/**
 * preHandler guard for routes that mutate device/battery control state. Replies
 * 401 when the request has no authenticated session.
 * @param request - The incoming request.
 * @param reply - The reply used to short-circuit unauthenticated requests.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.session.authenticated) {
    await reply.code(401).send({ error: 'authentication required' });
  }
}

/**
 * Registers cookie + server-side session support and the auth routes
 * (login / logout / me). Must be registered before any route that uses
 * {@link requireAuth}.
 * @param fastify - The Fastify instance.
 */
export async function registerAuth(fastify: FastifyTyped): Promise<void> {
  await fastify.register(fastifyCookie);
  await fastify.register(fastifySession, {
    secret: SESSION_SECRET,
    cookieName: 'solar_session',
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // 'auto' sends Secure only over HTTPS, so it works locally (http) and
      // behind the Traefik/Cloudflare TLS terminators in production.
      secure: 'auto',
      maxAge: SESSION_MAX_AGE_MS,
    },
  });

  fastify.post(
    '/api/auth/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Authenticate and start a session.',
        body: LoginBody,
        response: {
          200: Type.Object({
            authenticated: Type.Boolean(),
            username: Type.String(),
          }),
          401: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body;
      if (username !== AUTH_USERNAME || password !== AUTH_PASSWORD) {
        return reply.code(401).send({ error: 'invalid credentials' });
      }
      request.session.authenticated = true;
      request.session.username = username;
      return { authenticated: true, username };
    },
  );

  fastify.post(
    '/api/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Destroy the current session.',
        response: { 200: Type.Object({ authenticated: Type.Boolean() }) },
      },
    },
    async (request) => {
      await request.session.destroy();
      return { authenticated: false };
    },
  );

  fastify.get(
    '/api/auth/me',
    {
      schema: {
        tags: ['auth'],
        summary: 'Return the current authentication status.',
        response: {
          200: Type.Object({
            authenticated: Type.Boolean(),
            username: Type.Union([Type.String(), Type.Null()]),
          }),
        },
      },
    },
    (request) => ({
      authenticated: request.session.authenticated === true,
      username: request.session.username ?? null,
    }),
  );
}
