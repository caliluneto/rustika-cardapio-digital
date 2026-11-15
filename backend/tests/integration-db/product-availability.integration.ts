import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertIntegrationGate } from './support/preflight';
import { adminLogin, openSession, ORIGIN, placeOrder, startHarness } from './support/harness';
import type { Harness } from './support/harness';

/**
 * Executado só contra PostgreSQL real (CI efêmero ou Test autorizado) com as 8 migrations esperadas aplicadas, inclusive
 * 20261106000000_product_availability_update_privilege. Cobre o que o duplo em memória não prova:
 * ACL por coluna efetiva, compare-and-set real, concorrência (inclusive contra a criação de pedido),
 * rollback, integridade dos demais dados e coerência do catálogo público.
 */
assertIntegrationGate(process.env);

let h: Harness;
// Uma única aplicação por suíte: as sessões administrativas vivem em memória dentro de cada createApp().
let app: ReturnType<Harness['app']>;
let session: string;
let adminCookie: string;

beforeAll(async () => {
  h = await startHarness();
  app = h.app();
  session = await openSession(app, h, h.run.identity.comandas.open);
  const login = await adminLogin(app, h.run.identity.adminEmail, h.fx.adminPassword);
  if (!login.cookie) throw new Error('login de fixture falhou');
  adminCookie = login.cookie;
});
afterAll(async () => { await h?.stop(); });

type Key = keyof Harness['fx']['products'];
const fx = (key: Key) => h.fx.products[key];
const patchOf = (publicKey: string, body: object, auth: 'admin' | 'none' = 'admin') => {
  const req = request(app).patch(`/api/admin/products/${publicKey}/availability`).set('Origin', ORIGIN).set('X-Rustika-Request', '1').set('Content-Type', 'application/json');
  return (auth === 'admin' ? req.set('Cookie', `rustika_admin=${adminCookie}`) : req).send(body);
};
const patch = (key: Key, body: object, auth: 'admin' | 'none' = 'admin') => patchOf(fx(key).publicKey!, body, auth);
const listProducts = () => request(app).get('/api/admin/products').set('Cookie', `rustika_admin=${adminCookie}`);
const rowOf = (key: Key) => h.db.fixtures.product.findUniqueOrThrow({ where: { id: fx(key).id } });
const stateOf = async (key: Key) => (await rowOf(key)).availabilityState;
const setState = (key: Key, availabilityState: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN') => h.db.fixtures.product.update({ where: { id: fx(key).id }, data: { availabilityState } });
const publicProduct = (key: Key) => request(app).get(`/api/products/${fx(key).publicKey}`);
const item = (key: Key) => ({ productId: fx(key).publicKey!, quantity: 1, expectedUnitPriceInCents: fx(key).priceInCents });

describe('disponibilidade de produtos com PostgreSQL real', () => {
  it('lista: apenas produtos publicáveis, sem campos internos, e exige sessão', async () => {
    expect((await request(app).get('/api/admin/products')).status).toBe(401);
    const response = await listProducts();
    expect(response.status).toBe(200);
    const ids = response.body.data.products.map((p: { id: string }) => p.id);
    for (const key of ['numeric', 'alphanumeric', 'unavailable', 'unknown', 'priceChange'] as Key[]) expect(ids).toContain(fx(key).publicKey);
    expect(JSON.stringify(response.body)).not.toMatch(/isAvailable|description|"price"|sourceGroup/);
    // o insumo interno do fixture não tem publicKey e jamais é listado
    expect(response.body.data.products.every((p: { name: string }) => !p.name.startsWith('INTERNO FIXTURE'))).toBe(true);
  });

  it('UNKNOWN → AVAILABLE persiste só o estado; preço, ativo, categoria, chaves e legado ficam intactos', async () => {
    const before = await rowOf('unknown');
    expect(before.availabilityState).toBe('UNKNOWN');
    const response = await patch('unknown', { expectedState: 'UNKNOWN', toState: 'AVAILABLE' });
    expect(response.status).toBe(200);
    expect(response.body.data.product.availabilityState).toBe('AVAILABLE');
    const after = await rowOf('unknown');
    expect(after.availabilityState).toBe('AVAILABLE');
    const { availabilityState: _a, updatedAt: _u, ...restAfter } = after;
    const { availabilityState: _b, updatedAt: _v, ...restBefore } = before;
    expect(restAfter).toEqual(restBefore);
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });

  it('catálogo público reflete o estado: AVAILABLE=true, UNAVAILABLE=false, UNKNOWN=null', async () => {
    await setState('priceChange', 'AVAILABLE');
    expect((await publicProduct('priceChange')).body.data.isAvailable).toBe(true);
    expect((await patch('priceChange', { expectedState: 'AVAILABLE', toState: 'UNAVAILABLE' })).status).toBe(200);
    expect((await publicProduct('priceChange')).body.data.isAvailable).toBe(false);
    await setState('priceChange', 'UNKNOWN');
    expect((await publicProduct('priceChange')).body.data.isAvailable).toBeNull();
    await setState('priceChange', 'AVAILABLE');
  });

  it('transições inválidas e expectedState divergente não alteram nada', async () => {
    expect(await stateOf('numeric')).toBe('AVAILABLE');
    expect((await patch('numeric', { expectedState: 'AVAILABLE', toState: 'UNKNOWN' })).status).toBe(422);
    expect((await patch('numeric', { expectedState: 'AVAILABLE', toState: 'AVAILABLE' })).status).toBe(422);
    expect((await patch('numeric', { expectedState: 'UNAVAILABLE', toState: 'AVAILABLE' })).status).toBe(409);
    expect(await stateOf('numeric')).toBe('AVAILABLE');
  });

  it('sem sessão: 401; cookie inventado: 401; id inexistente: 404; id inválido: 400; corpo com campos extras: 400', async () => {
    const body = { expectedState: 'UNAVAILABLE', toState: 'AVAILABLE' };
    expect((await patch('unavailable', body, 'none')).status).toBe(401);
    expect((await request(app).patch(`/api/admin/products/${fx('unavailable').publicKey}/availability`).set('Origin', ORIGIN)
      .set('X-Rustika-Request', '1').set('Content-Type', 'application/json').set('Cookie', `rustika_admin=${'f'.repeat(64)}`).send(body)).status).toBe(401);
    expect((await patchOf('rustika-NAOEXISTE9', body)).status).toBe(404);
    expect((await patchOf('invalido', body)).status).toBe(400);
    expect((await patch('unavailable', { ...body, price: 0 })).status).toBe(400);
    expect(await stateOf('unavailable')).toBe('UNAVAILABLE');
  });

  it('produto inativo não é gerenciável (422) e não ganha vendabilidade por disponibilidade', async () => {
    await h.db.fixtures.product.update({ where: { id: fx('alphanumeric').id }, data: { isActive: false } });
    try {
      const response = await patch('alphanumeric', { expectedState: 'AVAILABLE', toState: 'UNAVAILABLE' });
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('PRODUCT_NOT_MANAGEABLE');
      expect(await stateOf('alphanumeric')).toBe('AVAILABLE');
      expect((await listProducts()).body.data.products.some((p: { id: string }) => p.id === fx('alphanumeric').publicKey)).toBe(false);
    } finally {
      await h.db.fixtures.product.update({ where: { id: fx('alphanumeric').id }, data: { isActive: true } });
    }
  });

  it('duas atualizações concorrentes do mesmo estado: uma vence (200), a outra 409; estado final consistente', async () => {
    await setState('numeric', 'UNKNOWN');
    const [a, b] = await Promise.all([
      patch('numeric', { expectedState: 'UNKNOWN', toState: 'AVAILABLE' }),
      patch('numeric', { expectedState: 'UNKNOWN', toState: 'UNAVAILABLE' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await stateOf('numeric')).toBe(a.status === 200 ? 'AVAILABLE' : 'UNAVAILABLE');
    await setState('numeric', 'AVAILABLE');
  });

  it('oito requisições idênticas simultâneas: exatamente uma conclui, sete 409', async () => {
    await setState('priceChange', 'UNKNOWN');
    const results = await Promise.all(Array.from({ length: 8 }, () => patch('priceChange', { expectedState: 'UNKNOWN', toState: 'AVAILABLE' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(results.every((r) => r.status === 200 || ['AVAILABILITY_CONFLICT', 'PRODUCT_CONFLICT'].includes(r.body.error.code))).toBe(true);
    expect(await stateOf('priceChange')).toBe('AVAILABLE');
  });

  it('pedido com produto indisponível é rejeitado (409) sem persistir pedido parcial', async () => {
    const before = await h.run.ordersFor(h.run.identity.comandas.open);
    const response = await placeOrder(app, session, [item('numeric'), item('unavailable')]);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PRODUCT_UNAVAILABLE');
    expect(await h.run.ordersFor(h.run.identity.comandas.open)).toHaveLength(before.length);
  });

  it('cliente via produto disponível; admin marca indisponível; o pedido seguinte é rejeitado sem pedido parcial', async () => {
    await setState('numeric', 'AVAILABLE');
    expect((await publicProduct('numeric')).body.data.isAvailable).toBe(true);
    const before = (await h.run.ordersFor(h.run.identity.comandas.open)).length;
    expect((await patch('numeric', { expectedState: 'AVAILABLE', toState: 'UNAVAILABLE' })).status).toBe(200);
    const rejected = await placeOrder(app, session, [item('numeric'), item('priceChange')]);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('PRODUCT_UNAVAILABLE');
    expect((await h.run.ordersFor(h.run.identity.comandas.open)).length).toBe(before);
    // volta a ficar disponível: o mesmo pedido é aceito
    expect((await patch('numeric', { expectedState: 'UNAVAILABLE', toState: 'AVAILABLE' })).status).toBe(200);
    expect((await placeOrder(app, session, [item('numeric')])).status).toBe(201);
  });

  it('corrida entre indisponibilizar e pedir: nunca há pedido com produto que terminou indisponível antes do commit do pedido', async () => {
    await setState('priceChange', 'AVAILABLE');
    const [toggle, order] = await Promise.all([
      patch('priceChange', { expectedState: 'AVAILABLE', toState: 'UNAVAILABLE' }),
      placeOrder(app, session, [item('priceChange')]),
    ]);
    expect(toggle.status).toBe(200);
    expect([201, 409]).toContain(order.status);
    if (order.status === 409) expect(order.body.error.code).toBe('PRODUCT_UNAVAILABLE');
    expect(await stateOf('priceChange')).toBe('UNAVAILABLE');
    // depois do commit da alteração, nenhum novo pedido é aceito
    expect((await placeOrder(app, session, [item('priceChange')])).status).toBe(409);
  });

  it('ACL por coluna: a role da aplicação só atualiza availability_state/updated_at em products e nunca apaga', async () => {
    const id = fx('unavailable').id;
    const where = { id };
    for (const data of [{ price: 1 }, { isActive: false }, { name: 'x' }, { publicKey: 'rustika-HACK' }, { sourceCode: 'HACK' }, { isAvailable: false },
      { categoryId: h.fx.categoryId }, { sourceName: 'x' }, { sourceGroup: 'x' }, { description: 'x' }]) {
      await expect(h.db.app.product.updateMany({ where, data: data as never }), JSON.stringify(data)).rejects.toThrow();
    }
    await expect(h.db.app.product.deleteMany({ where })).rejects.toThrow();
    await expect(h.db.app.$executeRawUnsafe('TRUNCATE TABLE products')).rejects.toThrow();
    await expect(h.db.app.product.create({ data: { categoryId: h.fx.categoryId, name: 'x', price: 1 } })).rejects.toThrow();
    await expect(h.db.app.category.updateMany({ where: { id: h.fx.categoryId }, data: { isActive: false } })).rejects.toThrow();
    // o que a migration concede funciona e é compare-and-set também no banco
    expect(await stateOf('unavailable')).toBe('UNAVAILABLE');
    await expect(h.db.app.product.updateMany({ where: { id, availabilityState: 'UNAVAILABLE' }, data: { availabilityState: 'AVAILABLE' } })).resolves.toMatchObject({ count: 1 });
    await expect(h.db.app.product.updateMany({ where: { id, availabilityState: 'UNAVAILABLE' }, data: { availabilityState: 'UNKNOWN' } })).resolves.toMatchObject({ count: 0 });
    await setState('unavailable', 'UNAVAILABLE');
  });

  it('rollback: falha depois de alterar o estado desfaz a mudança', async () => {
    const id = fx('unknown').id;
    const start = await stateOf('unknown');
    const next = start === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE';
    await expect(h.db.app.$transaction(async (tx) => {
      await tx.product.updateMany({ where: { id, availabilityState: start }, data: { availabilityState: next } });
      await tx.$executeRawUnsafe(`SELECT 1/0`);
    })).rejects.toThrow();
    expect(await stateOf('unknown')).toBe(start);
  });

  it('o id aleatório de produto inexistente e a sessão de outra instância são rejeitados', async () => {
    expect((await patchOf(`rustika-${randomUUID().slice(0, 8).toUpperCase()}`, { expectedState: 'UNKNOWN', toState: 'AVAILABLE' })).status).toBe(404);
    const other = h.app();
    const response = await request(other).patch(`/api/admin/products/${fx('numeric').publicKey}/availability`).set('Origin', ORIGIN)
      .set('X-Rustika-Request', '1').set('Content-Type', 'application/json').set('Cookie', `rustika_admin=${adminCookie}`)
      .send({ expectedState: 'AVAILABLE', toState: 'UNAVAILABLE' });
    expect(response.status).toBe(401);
    expect(await stateOf('numeric')).toBe('AVAILABLE');
  });
});
