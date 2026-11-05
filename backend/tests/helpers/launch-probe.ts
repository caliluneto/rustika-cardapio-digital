/** Sonda do teste e2e-launch-env: mesma ordem de imports dos pontos de entrada reais (launch-env primeiro, Prisma depois). */
import { guardedLaunch } from '../integration-db/e2e/launch-env';
import '@prisma/client';
import { assertE2eGate } from '../integration-db/e2e/gate';

const injectedBeforeGate = process.env.DATABASE_URL !== undefined;
try {
  guardedLaunch(assertE2eGate);
  process.stdout.write(`${JSON.stringify({ ok: true, injectedBeforeGate, urlAfter: process.env.DATABASE_URL !== undefined })}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({ ok: false, injectedBeforeGate, mentionsUrl: /DATABASE_URL/.test(message) })}\n`);
}
