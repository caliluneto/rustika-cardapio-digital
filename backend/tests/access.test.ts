import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createAccessRouters } from '../src/routes/access.routes';
import express from 'express';
import { env } from '../src/config/env';
import { errorHandler } from '../src/middleware/errorHandler';
import { mockAccessPrisma, TEST_PASSWORD } from './fixtures/access';
import { body, KEY } from './fixtures/orders';
import { ADMIN_SESSION_MS } from '../src/security/adminSessions';

function cookieHeader(response: request.Response): string {
  const cookies = response.headers['set-cookie'];
  if (!Array.isArray(cookies) || typeof cookies[0] !== 'string') throw new Error('Cookie esperado na resposta de teste.');
  return cookies[0];
}
const cookie = (response: request.Response) => cookieHeader(response).split(';')[0]!;

async function setup() {
  const mock = await mockAccessPrisma();
  const app = createApp({ prisma: mock.prisma, authClock: mock.now });
  const post = (path: string) => request(app).post(path).set('Origin', env.corsOrigin).set('X-Rustika-Request', '1').set('Content-Type', 'application/json');
  const login = () => post('/api/admin/auth/login').send({ email: mock.admin.email, password: TEST_PASSWORD });
  return { ...mock, app, post, login };
}

describe('HTTP autenticação e convites', () => {
  it('fluxo completo login -> convite -> cookie legítimo -> pedido 201', async () => {
    const mock = await setup();
    const login = await mock.login(); expect(login.status).toBe(200);
    expect(login.body.data.admin.email).toBe(mock.admin.email);
    expect(JSON.stringify(login.body)).not.toMatch(/passwordHash|token|credential/);
    expect(cookieHeader(login)).toMatch(/HttpOnly/);
    expect(cookieHeader(login)).toMatch(/SameSite=Strict/);
    expect(cookieHeader(login)).toMatch(/Path=\/api\/admin/);
    const issued = await mock.post('/api/admin/comanda-invitations').set('Cookie', cookie(login)).send({ comandaNumber: '000123' });
    expect(issued.status).toBe(201); expect(issued.body.data.inviteToken).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.headers['cache-control']).toBe('no-store');
    const redeemed = await mock.post('/api/comanda-sessions').send({ inviteToken: issued.body.data.inviteToken });
    expect(redeemed.status).toBe(201);
    expect(redeemed.body).toMatchObject({ success: true, data: { comanda: { number: '000123', status: 'OPEN' } } });
    expect(JSON.stringify(redeemed.body)).not.toMatch(/token|Hash|invitationId|sessionId/);
    expect(cookieHeader(redeemed)).toMatch(/^rustika_session=[0-9a-f]{64};/);
    expect(cookieHeader(redeemed)).toMatch(/HttpOnly/);
    expect(cookieHeader(redeemed)).toMatch(/SameSite=Lax/);
    expect(cookieHeader(redeemed)).toMatch(/Path=\/api;/);
    expect((await request(mock.app).get('/api/comanda-sessions/current').set('Cookie', cookie(redeemed))).status).toBe(200);
    const order = await request(mock.app).post('/api/orders').set('Origin', env.corsOrigin).set('X-Rustika-Request', '1').set('Cookie', cookie(redeemed)).set('Idempotency-Key', KEY).send(body());
    expect(order.status).toBe(201);
    expect(order.body.data).toMatchObject({ orderNumber: 42, totalInCents: 11998, status: 'RECEIVED' });
  });

  it('logout elimina cookie e revoga a sessão no servidor', async () => {
    const mock = await setup(); const login = await mock.login(); const saved = cookie(login);
    expect((await request(mock.app).get('/api/admin/auth/session').set('Cookie', saved)).status).toBe(200);
    const logout = await mock.post('/api/admin/auth/logout').set('Cookie', saved).send({});
    expect(logout.status).toBe(204); expect(cookieHeader(logout)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await request(mock.app).get('/api/admin/auth/session').set('Cookie', saved)).status).toBe(401);
    expect((await mock.post('/api/admin/comanda-invitations').set('Cookie', saved).send({ comandaNumber: '1' })).status).toBe(401);
  });

  it('sessão administrativa expirada não emite convite', async () => {
    const mock = await setup(); const login = await mock.login(); mock.advance(ADMIN_SESSION_MS);
    const response = await mock.post('/api/admin/comanda-invitations').set('Cookie', cookie(login)).send({ comandaNumber: '1' });
    expect(response.status).toBe(401); expect(mock.inviteCreate).not.toHaveBeenCalled();
  });

  it('acesso administrativo sem autenticação é recusado', async () => {
    const mock = await setup();
    expect((await request(mock.app).get('/api/admin/auth/session')).status).toBe(401);
    expect((await mock.post('/api/admin/comanda-invitations').send({ comandaNumber: '1' })).status).toBe(401);
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it('login inválido não emite cookie', async () => {
    const mock = await setup(); const response = await mock.post('/api/admin/auth/login').send({ email: mock.admin.email, password: 'wrong' });
    expect(response.status).toBe(401); expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it.each(['origin', 'header', 'type', 'query', 'oversize'])(
    'proteção de entrada: %s', async (scenario) => {
      const mock = await setup(); const req = mock.post('/api/admin/auth/login');
      if (scenario === 'origin') req.set('Origin', 'https://other.example');
      if (scenario === 'header') req.unset('X-Rustika-Request');
      if (scenario === 'type') req.set('Content-Type', 'text/plain');
      if (scenario === 'query') req.query({ token: 'never-in-url' });
      const response = await req.send(scenario === 'type' ? 'body' : { email: mock.admin.email, password: scenario === 'oversize' ? 'x'.repeat(5000) : TEST_PASSWORD });
      expect(response.status).toBe(({ origin: 403, header: 403, type: 415, query: 400, oversize: 413 })[scenario]);
      expect(mock.adminFind).not.toHaveBeenCalled();
    },
  );

  it('limite de login bloqueia tentativas excessivas sem consultar credenciais', async () => {
    const mock = await setup();
    for (let i = 0; i < 10; i++) expect((await mock.post('/api/admin/auth/login').send({})).status).toBe(400);
    const response = await mock.login();
    expect(response.status).toBe(429); expect(response.headers['retry-after']).toBeDefined();
    expect(mock.adminFind).not.toHaveBeenCalled();
  });

  it.each(['', '1', 'g'.repeat(64)])('convite malformado é recusado sem cookie', async (token) => {
    const mock = await setup(); const response = await mock.post('/api/comanda-sessions').send({ inviteToken: token });
    expect(response.status).toBe(401); expect(response.headers['set-cookie']).toBeUndefined();
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it('reutilização do convite por HTTP falha sem emitir outro cookie', async () => {
    const mock = await setup(); const login = await mock.login();
    const invite = await mock.post('/api/admin/comanda-invitations').set('Cookie', cookie(login)).send({ comandaNumber: '1' });
    const payload = { inviteToken: invite.body.data.inviteToken };
    expect((await mock.post('/api/comanda-sessions').send(payload)).status).toBe(201);
    const replay = await mock.post('/api/comanda-sessions').send(payload);
    expect(replay.status).toBe(401); expect(replay.headers['set-cookie']).toBeUndefined();
  });

  it('falha de commit não emite cookie e não revela erros internos', async () => {
    const mock = await setup(); const login = await mock.login();
    const invite = await mock.post('/api/admin/comanda-invitations').set('Cookie', cookie(login)).send({ comandaNumber: '1' });
    mock.control.failCommit = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await mock.post('/api/comanda-sessions').send({ inviteToken: invite.body.data.inviteToken });
      expect(response.status).toBe(500); expect(response.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify([response.body, log.mock.calls])).not.toMatch(/private|simulated|tokenHash/);
    } finally { log.mockRestore(); }
  });

  it('cookie Secure é emitido quando configurado para HTTPS', async () => {
    const mock = await mockAccessPrisma(); const app = express();
    app.use('/api/admin', createAccessRouters(mock.prisma, { origin: 'https://menu.example', secureCookies: true, now: mock.now }).adminRouter);
    app.use(errorHandler);
    const response = await request(app).post('/api/admin/auth/login').set('Origin', 'https://menu.example').set('X-Rustika-Request', '1').send({ email: mock.admin.email, password: TEST_PASSWORD });
    expect(response.status).toBe(200); expect(cookieHeader(response)).toMatch(/; Secure/);
  });

  it('preflight aceita credentials e header de proteção', async () => {
    const mock = await setup();
    const response = await request(mock.app).options('/api/comanda-sessions').set('Origin', env.corsOrigin).set('Access-Control-Request-Method', 'POST');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-headers']).toMatch(/X-Rustika-Request/);
  });
});
