import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertIntegrationGate } from './support/preflight';
import { adminLogin, issueInvite, placeOrder, redeem, setCookieLine, startHarness } from './support/harness';
import type { Harness } from './support/harness';

assertIntegrationGate(process.env);

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  const run = h?.run;
  await h?.stop();
  if (run) expect(await run.remaining()).toEqual({ admins: 0, categories: 0, products: 0, comandas: 0, orders: 0 });
});

describe('comandas, convites e sessões com PostgreSQL real', () => {
  it('emissão + resgate: comanda aberta, convite consumido, uma sessão, cookie HttpOnly/Lax em /api', async () => {
    const app = h.app(); const number = h.run.identity.comandas.open;
    const { cookie } = await adminLogin(app, h.run.identity.adminEmail, h.fx.adminPassword);
    const invite = await issueInvite(app, cookie!, number, 5);
    expect(invite.status).toBe(201);
    expect(invite.body.data).toMatchObject({ comanda: { number }, inviteToken: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const before = await h.run.invitationsFor(number);
    expect(before).toHaveLength(1);
    expect(before[0]!.tokenHash).not.toBe(invite.body.data.inviteToken); // só o hash é persistido
    const { response, cookie: session } = await redeem(app, invite.body.data.inviteToken);
    expect(response.status).toBe(201);
    const line = setCookieLine(response, 'rustika_session')!;
    expect(line).toMatch(/HttpOnly/i); expect(line).toMatch(/SameSite=Lax/i); expect(line).toMatch(/Path=\/api(;|$)/);
    const after = await h.run.invitationsFor(number);
    expect(after[0]!.consumedAt).not.toBeNull();
    expect(after[0]!.session).not.toBeNull();
    const current = await request(app).get('/api/comanda-sessions/current').set('Cookie', `rustika_session=${session}`);
    expect(current.status).toBe(200);
    expect(current.body.data.comanda).toEqual({ number, status: 'OPEN' });
  });

  it('convite utilizado duas vezes: o segundo resgate falha e não cria outra sessão', async () => {
    const app = h.app(); const number = h.run.identity.comandas.spare[0]!;
    const { cookie: adminCookie } = await adminLogin(app, h.run.identity.adminEmail, h.fx.adminPassword);
    const invite = await issueInvite(app, adminCookie!, number);
    expect((await redeem(app, invite.body.data.inviteToken)).response.status).toBe(201);
    const second = await redeem(app, invite.body.data.inviteToken);
    expect(second.response.status).toBe(401);
    expect(second.cookie).toBeUndefined();
    const rows = await h.run.invitationsFor(number);
    expect(rows.filter((row) => row.session !== null)).toHaveLength(1);
  });

  it('resgates simultâneos do mesmo convite: exatamente um 201', async () => {
    const app = h.app(); const number = h.run.identity.comandas.spare[1]!;
    const { cookie: adminCookie } = await adminLogin(app, h.run.identity.adminEmail, h.fx.adminPassword);
    const invite = await issueInvite(app, adminCookie!, number);
    const results = await Promise.all(Array.from({ length: 5 }, () => redeem(app, invite.body.data.inviteToken)));
    expect(results.filter((r) => r.response.status === 201)).toHaveLength(1);
    expect((await h.run.invitationsFor(number)).filter((row) => row.session !== null)).toHaveLength(1);
  });

  it('convite expirado: 401 e nada consumido', async () => {
    const number = h.run.identity.comandas.spare[2]!;
    const token = await h.run.insertExpiredInvitation(number);
    const { response, cookie } = await redeem(h.app(), token);
    expect(response.status).toBe(401); expect(cookie).toBeUndefined();
    expect((await h.run.invitationsFor(number))[0]!.consumedAt).toBeNull();
  });

  it('convite revogado: 401', async () => {
    const token = await h.run.insertRevokedInvitation(h.run.identity.comandas.spare[2]!);
    expect((await redeem(h.app(), token)).response.status).toBe(401);
  });

  it('convite expira pela validade pedida na emissão (relógio da aplicação)', async () => {
    const app = h.app();
    const { cookie: adminCookie } = await adminLogin(app, h.run.identity.adminEmail, h.fx.adminPassword);
    const invite = await issueInvite(app, adminCookie!, h.run.identity.comandas.spare[3]!, 1);
    h.clock.advance(2 * 60_000);
    try { expect((await redeem(app, invite.body.data.inviteToken)).response.status).toBe(401); } finally { h.clock.reset(); }
  });

  it('comanda fechada: emissão recusada com 409 COMANDA_CLOSED', async () => {
    const app = h.app();
    const { cookie: adminCookie } = await adminLogin(app, h.run.identity.adminEmail, h.fx.adminPassword);
    const response = await issueInvite(app, adminCookie!, h.run.identity.comandas.closed);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('COMANDA_CLOSED');
  });

  it('sessão revogada: /current e pedido recusados com 401', async () => {
    const app = h.app(); const session = await h.run.insertSession(h.run.identity.comandas.spare[4]!, { revoked: true });
    expect((await request(app).get('/api/comanda-sessions/current').set('Cookie', `rustika_session=${session}`)).status).toBe(401);
    const order = await placeOrder(app, session, [{ productId: h.fx.products.numeric.publicKey!, quantity: 1, expectedUnitPriceInCents: 5999 }]);
    expect(order.status).toBe(401);
    expect(await h.run.ordersFor(h.run.identity.comandas.spare[4]!)).toHaveLength(0);
  });

  it('sessão expirada: 401', async () => {
    const session = await h.run.insertSession(h.run.identity.comandas.spare[4]!, { expired: true });
    expect((await request(h.app()).get('/api/comanda-sessions/current').set('Cookie', `rustika_session=${session}`)).status).toBe(401);
  });

  it('comanda fechada depois do resgate derruba a sessão existente', async () => {
    const number = h.run.identity.comandas.spare[5]!; const app = h.app();
    const { cookie: adminCookie } = await adminLogin(app, h.run.identity.adminEmail, h.fx.adminPassword);
    const invite = await issueInvite(app, adminCookie!, number);
    const { cookie } = await redeem(app, invite.body.data.inviteToken);
    await h.run.closeComanda(number);
    expect((await request(app).get('/api/comanda-sessions/current').set('Cookie', `rustika_session=${cookie}`)).status).toBe(401);
    const order = await placeOrder(app, cookie!, [{ productId: h.fx.products.numeric.publicKey!, quantity: 1, expectedUnitPriceInCents: 5999 }]);
    expect(order.status).toBe(401);
  });

  it('acesso a outra comanda: cada sessão só enxerga a própria e não recupera pedido alheio pela chave', async () => {
    const app = h.app();
    const { cookie: adminCookie } = await adminLogin(app, h.run.identity.adminEmail, h.fx.adminPassword);
    const a = await redeem(app, (await issueInvite(app, adminCookie!, h.run.identity.comandas.open)).body.data.inviteToken);
    const b = await redeem(app, (await issueInvite(app, adminCookie!, h.run.identity.comandas.other)).body.data.inviteToken);
    const items = [{ productId: h.fx.products.numeric.publicKey!, quantity: 1, expectedUnitPriceInCents: 5999 }];
    const key = '22222222-2222-4222-8222-222222222222';
    const first = await placeOrder(app, a.cookie!, items, key);
    const second = await placeOrder(app, b.cookie!, items, key);
    expect(first.status).toBe(201); expect(second.status).toBe(201);
    expect(second.body.data.orderNumber).not.toBe(first.body.data.orderNumber);
    expect(second.body.data.comandaNumber).toBe(h.run.identity.comandas.other);
    const current = await request(app).get('/api/comanda-sessions/current').set('Cookie', `rustika_session=${b.cookie}`);
    expect(current.body.data.comanda.number).toBe(h.run.identity.comandas.other);
  });
});
