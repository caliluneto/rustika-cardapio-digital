import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertIntegrationGate } from './support/preflight';
import { adminLogin, issueInvite, ORIGIN, setCookieLine, startHarness, write } from './support/harness';
import type { Harness } from './support/harness';

assertIntegrationGate(process.env); // segunda trava: importar o arquivo sem as variáveis falha na hora

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => {
  await h?.stop();
});

describe('autenticação administrativa com PostgreSQL real', () => {
  it('login válido: 200, dados públicos e cookie HttpOnly/Strict restrito a /api/admin', async () => {
    const app = h.app();
    const { response, cookie } = await adminLogin(app, h.run.identity.adminEmail, h.fx.adminPassword);
    expect(response.status).toBe(200);
    expect(response.body.data.admin).toEqual({ id: h.fx.adminId, name: expect.any(String), email: h.run.identity.adminEmail });
    expect(JSON.stringify(response.body)).not.toMatch(/password|hash|token/i);
    expect(cookie).toMatch(/^[0-9a-f]{64}$/);
    const line = setCookieLine(response, 'rustika_admin')!;
    expect(line).toMatch(/HttpOnly/i); expect(line).toMatch(/SameSite=Strict/i); expect(line).toMatch(/Path=\/api\/admin/);
    const session = await request(app).get('/api/admin/auth/session').set('Cookie', `rustika_admin=${cookie}`);
    expect(session.status).toBe(200);
  });

  it.each([
    ['senha errada', () => ({ email: h.run.identity.adminEmail, password: 'senha-errada-123' })],
    ['e-mail inexistente', () => ({ email: `nao-existe-${h.run.identity.runId}@rustika.test`, password: h.fx.adminPassword })],
    ['conta inativa', () => ({ email: h.run.identity.inactiveAdminEmail, password: h.fx.adminPassword })],
  ])('credenciais inválidas (%s): 401 genérico e nenhum cookie', async (_label, input) => {
    const response = await write(h.app(), '/api/admin/auth/login').send(input());
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('sessão administrativa ausente: emissão de convite recusada sem gravar nada', async () => {
    const response = await write(h.app(), '/api/admin/comanda-invitations').send({ comandaNumber: h.run.identity.comandas.spare[0] });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('ADMIN_UNAUTHENTICATED');
    expect(await h.run.invitationsFor(h.run.identity.comandas.spare[0]!)).toHaveLength(0);
  });

  it('sessão administrativa expirada (1 h): 401 e nenhum convite criado', async () => {
    const app = h.app();
    const { cookie } = await adminLogin(app, h.run.identity.adminEmail, h.fx.adminPassword);
    h.clock.advance(61 * 60_000);
    try {
      const response = await issueInvite(app, cookie!, h.run.identity.comandas.spare[1]!);
      expect(response.status).toBe(401);
      expect(await h.run.invitationsFor(h.run.identity.comandas.spare[1]!)).toHaveLength(0);
    } finally { h.clock.reset(); }
  });

  it('logout revoga a sessão no servidor e limpa o cookie', async () => {
    const app = h.app();
    const { cookie } = await adminLogin(app, h.run.identity.adminEmail, h.fx.adminPassword);
    const logout = await write(app, '/api/admin/auth/logout').set('Cookie', `rustika_admin=${cookie}`).send({});
    expect(logout.status).toBe(204);
    expect((await request(app).get('/api/admin/auth/session').set('Cookie', `rustika_admin=${cookie}`)).status).toBe(401);
  });

  it.each([
    ['Origin estrangeira', (r: request.Test) => r.set('Origin', 'https://attacker.example'), 403],
    ['sem X-Rustika-Request', (r: request.Test) => r.unset('X-Rustika-Request'), 403],
    ['texto puro', (r: request.Test) => r.set('Content-Type', 'text/plain'), 415],
  ])('proteção de Origin/CSRF no login: %s', async (_label, mutate, status) => {
    const req = mutate(request(h.app()).post('/api/admin/auth/login').set('Origin', ORIGIN).set('X-Rustika-Request', '1').set('Content-Type', 'application/json'));
    const response = await req.send(status === 415 ? 'x' : JSON.stringify({ email: h.run.identity.adminEmail, password: h.fx.adminPassword }));
    expect(response.status).toBe(status);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
