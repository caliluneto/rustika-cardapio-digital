import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertIntegrationGate } from './support/preflight';
import { adminLogin, openSession, ORIGIN, placeOrder, startHarness } from './support/harness';
import type { Harness } from './support/harness';

/**
 * Executado só contra PostgreSQL real (CI efêmero ou Test autorizado), com as 8 migrations esperadas aplicadas,
 * inclusive 20261105000000_order_status_update_privilege. Cobre o que o duplo em memória não prova:
 * isolamento Serializable real, compare-and-set, rollback, histórico único e ACL por coluna.
 */
assertIntegrationGate(process.env);

let h: Harness;
// Uma única aplicação para toda a suíte: as sessões administrativas vivem em memória DENTRO de cada createApp().
// Login e requisições autenticadas precisam, portanto, usar a MESMA instância (não é um defeito de produção).
let app: ReturnType<Harness['app']>;
let session: string;
let adminCookie: string;
let number: string;

beforeAll(async () => {
  h = await startHarness();
  app = h.app();
  number = h.run.identity.comandas.open;
  session = await openSession(app, h, number);
  const login = await adminLogin(app, h.run.identity.adminEmail, h.fx.adminPassword);
  if (!login.cookie) throw new Error('login de fixture falhou');
  adminCookie = login.cookie;
});
afterAll(async () => { await h?.stop(); });

const item = () => ({ productId: h.fx.products.numeric.publicKey!, quantity: 1, expectedUnitPriceInCents: h.fx.products.numeric.priceInCents });
async function newOrder(): Promise<string> {
  const response = await placeOrder(app, session, [item()]);
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}
const patch = (id: string, body: object, auth: 'admin' | 'none' = 'admin') => {
  const req = request(app).patch(`/api/admin/orders/${id}/status`).set('Origin', ORIGIN).set('X-Rustika-Request', '1').set('Content-Type', 'application/json');
  return (auth === 'admin' ? req.set('Cookie', `rustika_admin=${adminCookie}`) : req).send(body);
};
const rowOf = async (id: string) => (await h.run.ordersFor(number)).find((order) => order.id === id)!;

describe('operação administrativa de pedidos com PostgreSQL real', () => {
  it('lista pedidos ativos sem campos sensíveis', async () => {
    const id = await newOrder();
    const response = await request(app).get('/api/admin/orders').set('Cookie', `rustika_admin=${adminCookie}`);
    expect(response.status).toBe(200);
    expect(response.body.data.orders.some((order: { id: string }) => order.id === id)).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(/customerPhone|requestDigest|idempotencyKey|trackingTokenHash/);
  });

  it('cadeia completa RECEIVED → DELIVERED persiste status e um histórico por transição, com o administrador', async () => {
    const id = await newOrder();
    for (const [from, to] of [['RECEIVED', 'IN_PREPARATION'], ['IN_PREPARATION', 'READY'], ['READY', 'DELIVERED']] as const) {
      const response = await patch(id, { expectedStatus: from, toStatus: to });
      expect(response.status).toBe(200);
    }
    const order = await rowOf(id);
    expect(order.status).toBe('DELIVERED');
    expect(order.statusHistory.map((row) => [row.fromStatus, row.toStatus])).toEqual([
      [null, 'RECEIVED'], ['RECEIVED', 'IN_PREPARATION'], ['IN_PREPARATION', 'READY'], ['READY', 'DELIVERED'],
    ]);
    expect(order.statusHistory.slice(1).every((row) => row.changedByAdminId !== null)).toBe(true);
  });

  it('duas atualizações concorrentes (requisições e transações simultâneas no mesmo PostgreSQL, mesma app): uma vence, a outra recebe 409, um único histórico', async () => {
    const id = await newOrder();
    const [a, b] = await Promise.all([
      patch(id, { expectedStatus: 'RECEIVED', toStatus: 'IN_PREPARATION' }),
      patch(id, { expectedStatus: 'RECEIVED', toStatus: 'CANCELLED' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const order = await rowOf(id);
    expect(order.statusHistory).toHaveLength(2); // RECEIVED inicial + exatamente uma transição
    expect(order.status).toBe(order.statusHistory[1]!.toStatus);
  });

  it('transição inválida e expectedStatus divergente não alteram nada', async () => {
    const id = await newOrder();
    expect((await patch(id, { expectedStatus: 'RECEIVED', toStatus: 'DELIVERED' })).status).toBe(422);
    expect((await patch(id, { expectedStatus: 'READY', toStatus: 'DELIVERED' })).status).toBe(409);
    const order = await rowOf(id);
    expect(order.status).toBe('RECEIVED');
    expect(order.statusHistory).toHaveLength(1);
  });

  it('sem sessão administrativa e pedido inexistente', async () => {
    const id = await newOrder();
    expect((await patch(id, { expectedStatus: 'RECEIVED', toStatus: 'IN_PREPARATION' }, 'none')).status).toBe(401);
    expect((await patch(randomUUID(), { expectedStatus: 'RECEIVED', toStatus: 'IN_PREPARATION' })).status).toBe(404);
    expect((await rowOf(id)).status).toBe('RECEIVED');
  });

  it('cookie inventado é rejeitado; a sessão administrativa de uma instância não vale em outra (sessões em memória por instância)', async () => {
    const id = await newOrder();
    const body = { expectedStatus: 'RECEIVED', toStatus: 'IN_PREPARATION' };
    const send = (target: typeof app, cookie: string) => request(target).patch(`/api/admin/orders/${id}/status`)
      .set('Origin', ORIGIN).set('X-Rustika-Request', '1').set('Content-Type', 'application/json').set('Cookie', `rustika_admin=${cookie}`).send(body);
    expect((await send(app, 'f'.repeat(64))).status).toBe(401);
    expect((await send(h.app(), adminCookie)).status).toBe(401);
    expect((await rowOf(id)).status).toBe('RECEIVED');
  });

  it('rollback: falha ao gravar o histórico desfaz a mudança de status (FK de admin inexistente)', async () => {
    const id = await newOrder();
    // A falha é provocada pela própria base: o histórico referencia um administrador que deixa de existir
    // no meio da transação é inviável de forçar via API; aqui comprovamos a atomicidade pelo lado do banco.
    await expect(h.db.app.$transaction(async (tx) => {
      await tx.order.updateMany({ where: { id, status: 'RECEIVED' }, data: { status: 'IN_PREPARATION' } });
      await tx.orderStatusHistory.create({ data: { orderId: id, fromStatus: 'RECEIVED', toStatus: 'IN_PREPARATION', changedByAdminId: randomUUID() } });
    })).rejects.toThrow();
    const order = await rowOf(id);
    expect(order.status).toBe('RECEIVED');
    expect(order.statusHistory).toHaveLength(1);
  });

  it('oito requisições idênticas simultâneas: exatamente uma conclui a transição, as demais 409, um único histórico', async () => {
    const id = await newOrder();
    const results = await Promise.all(Array.from({ length: 8 }, () => patch(id, { expectedStatus: 'RECEIVED', toStatus: 'IN_PREPARATION' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(results.every((r) => r.status === 200 || ['STATUS_CONFLICT', 'ORDER_CONFLICT'].includes(r.body.error.code))).toBe(true);
    const order = await rowOf(id);
    expect(order.status).toBe('IN_PREPARATION');
    expect(order.statusHistory.map((row) => [row.fromStatus, row.toStatus])).toEqual([[null, 'RECEIVED'], ['RECEIVED', 'IN_PREPARATION']]);
  });

  it('a mudança de status não altera nenhum outro dado do pedido nem de seus itens', async () => {
    const id = await newOrder();
    const before = await rowOf(id);
    expect((await patch(id, { expectedStatus: 'RECEIVED', toStatus: 'IN_PREPARATION' })).status).toBe(200);
    const after = await rowOf(id);
    const { status: _s, updatedAt: _u, statusHistory: _h, ...beforeRest } = before;
    const { status: _s2, updatedAt: _u2, statusHistory: _h2, ...afterRest } = after;
    expect(afterRest).toEqual(beforeRest);
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });

  it('ACL por coluna: a role da aplicação só atualiza status/updated_at e nunca apaga pedidos', async () => {
    const id = await newOrder();
    for (const data of [{ customerName: 'alterado' }, { totalAmount: 0 }, { notes: 'x' }, { customerPhone: '0' }, { orderNumber: 999999 }, { tableOrReference: 'x' }]) {
      await expect(h.db.app.order.updateMany({ where: { id }, data }), JSON.stringify(data)).rejects.toThrow();
    }
    await expect(h.db.app.order.deleteMany({ where: { id } })).rejects.toThrow();
    await expect(h.db.app.orderStatusHistory.deleteMany({ where: { orderId: id } })).rejects.toThrow();
    await expect(h.db.app.orderStatusHistory.updateMany({ where: { orderId: id }, data: { toStatus: 'CANCELLED' } })).rejects.toThrow();
    await expect(h.db.app.orderItem.updateMany({ where: { orderId: id }, data: { quantity: 99 } })).rejects.toThrow();
    await expect(h.db.app.$executeRawUnsafe('TRUNCATE TABLE orders')).rejects.toThrow();
    expect((await rowOf(id)).status).toBe('RECEIVED');
    await expect(h.db.app.order.updateMany({ where: { id, status: 'RECEIVED' }, data: { status: 'IN_PREPARATION' } })).resolves.toMatchObject({ count: 1 });
    // CAS no banco: repetir com o status antigo não atualiza nenhuma linha.
    await expect(h.db.app.order.updateMany({ where: { id, status: 'RECEIVED' }, data: { status: 'CANCELLED' } })).resolves.toMatchObject({ count: 0 });
  });
});
