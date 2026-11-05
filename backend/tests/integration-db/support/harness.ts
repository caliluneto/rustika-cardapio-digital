import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Response } from 'supertest';
import { createApp } from '../../../src/app';
import type { AppDependencies } from '../../../src/app';
import { env } from '../../../src/config/env';
import { openIntegrationDatabases } from './databases';
import type { IntegrationDatabases } from './databases';
import { createRunIdentity, FixtureRun } from './fixtures';
import type { ProvisionedFixtures } from './fixtures';

/**
 * Real stack for one test file: Express app from createApp, real routes and services, real Prisma
 * (role cardapio_test_app) on cardapio_digital_test, plus a run-scoped fixture set written with the
 * fixtures role. `start()` aborts before any write if the preflight fails.
 */
export interface Harness {
  db: IntegrationDatabases;
  run: FixtureRun;
  fx: ProvisionedFixtures;
  clock: { now: () => Date; advance: (ms: number) => void; reset: () => void };
  /** Builds a fresh app (fresh in-memory limits and admin sessions) sharing the same clock. */
  app(limits?: AppDependencies['orderLimits']): ReturnType<typeof createApp>;
  stop(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const db = await openIntegrationDatabases();
  const run = new FixtureRun(db.fixtures, createRunIdentity());
  let offset = 0;
  const clock = { now: () => new Date(Date.now() + offset), advance: (ms: number) => { offset += ms; }, reset: () => { offset = 0; } };
  let fx: ProvisionedFixtures;
  try {
    fx = await run.provision();
  } catch (error) {
    await run.cleanup().catch(() => undefined);
    await db.close();
    throw error;
  }
  return {
    db, run, fx, clock,
    app: (limits) => createApp({ prisma: db.app, authClock: clock.now, orderLimits: limits }),
    async stop() {
      try {
        await run.cleanup();
        if (Object.values(await run.remaining()).some((count) => count !== 0)) throw new Error('Resíduos após limpeza da execução.');
      } finally { await db.close(); }
    },
  };
}

export const ORIGIN = env.corsOrigin;

export function cookieValue(response: Response, name: string): string | undefined {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  const raw = header?.find((line) => line.startsWith(`${name}=`));
  return raw?.split(';')[0]!.slice(name.length + 1) || undefined;
}

export function setCookieLine(response: Response, name: string): string | undefined {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((line) => line.startsWith(`${name}=`));
}

type App = ReturnType<typeof createApp>;

/** Writes always carry the full CSRF contract unless a test removes something on purpose. */
export const write = (app: App, path: string) => request(app).post(path).set('Origin', ORIGIN).set('X-Rustika-Request', '1').set('Content-Type', 'application/json');

export async function adminLogin(app: App, email: string, password: string) {
  const response = await write(app, '/api/admin/auth/login').send({ email, password });
  return { response, cookie: cookieValue(response, 'rustika_admin') };
}

export async function issueInvite(app: App, adminCookie: string, comandaNumber: string, expiresInMinutes?: number) {
  return write(app, '/api/admin/comanda-invitations').set('Cookie', `rustika_admin=${adminCookie}`)
    .send(expiresInMinutes === undefined ? { comandaNumber } : { comandaNumber, expiresInMinutes });
}

export async function redeem(app: App, inviteToken: string) {
  const response = await write(app, '/api/comanda-sessions').send({ inviteToken });
  return { response, cookie: cookieValue(response, 'rustika_session') };
}

/** Admin login + invite + redeem through the real HTTP API. Returns the session cookie. */
export async function openSession(app: App, h: Harness, comandaNumber: string): Promise<string> {
  const { cookie: adminCookie } = await adminLogin(app, h.run.identity.adminEmail, h.fx.adminPassword);
  if (!adminCookie) throw new Error('login de fixture falhou');
  const invite = await issueInvite(app, adminCookie, comandaNumber);
  if (invite.status !== 201) throw new Error(`convite falhou: ${invite.status}`);
  const { cookie } = await redeem(app, invite.body.data.inviteToken);
  if (!cookie) throw new Error('resgate falhou');
  return cookie;
}

export function placeOrder(app: App, sessionCookie: string, items: { productId: string; quantity: number; expectedUnitPriceInCents: number }[], key = randomUUID(), extra: Record<string, unknown> = {}) {
  return write(app, '/api/orders').set('Cookie', `rustika_session=${sessionCookie}`).set('Idempotency-Key', key)
    .send({ customerName: 'Cliente Fixture', tableOrReference: 'Mesa F', items, ...extra });
}
