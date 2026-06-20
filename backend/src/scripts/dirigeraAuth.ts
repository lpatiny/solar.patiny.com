/* eslint-disable camelcase, @typescript-eslint/naming-convention -- DIRIGERA OAuth uses snake_case fields */
import { createInterface } from 'node:readline/promises';

import { Agent, request } from 'undici';

// The hub uses a self-signed certificate, so verification must be disabled.
const agent = new Agent({ connect: { rejectUnauthorized: false } });

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function randomCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

async function main(): Promise<void> {
  const host = process.argv[2];
  if (!host) {
    process.stderr.write(
      'Usage: npm run dirigera-auth -w backend -- <hub-ip>\n',
    );
    process.exitCode = 1;
    return;
  }

  const base = `https://${host}:8443/v1`;
  const verifier = randomCodeVerifier();
  const challenge = await codeChallenge(verifier);

  const authorizeUrl =
    `${base}/oauth/authorize?audience=homesmart.local` +
    `&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`;
  const authorizeResponse = await request(authorizeUrl, { dispatcher: agent });
  if (authorizeResponse.statusCode !== 200) {
    await authorizeResponse.body.dump();
    throw new Error(`authorize failed: ${authorizeResponse.statusCode}`);
  }
  const { code } = (await authorizeResponse.body.json()) as { code: string };

  process.stdout.write(
    'Press the ACTION button on the bottom of your DIRIGERA hub, then press Enter…\n',
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('');
  rl.close();

  const tokenResponse = await request(`${base}/oauth/token`, {
    method: 'POST',
    dispatcher: agent,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      name: 'solar-monitoring',
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }).toString(),
  });
  if (tokenResponse.statusCode !== 200) {
    await tokenResponse.body.dump();
    throw new Error(
      `token request failed: ${tokenResponse.statusCode} — did you press the button in time?`,
    );
  }
  const token = (await tokenResponse.body.json()) as { access_token: string };

  process.stdout.write(
    `\nAdd this to your .env file:\n\nDIRIGERA_HOST=${host}\nDIRIGERA_TOKEN=${token.access_token}\n`,
  );
}

await main();
