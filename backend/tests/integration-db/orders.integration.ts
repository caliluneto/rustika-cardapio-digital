import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assertIntegrationGate } from './support/preflight';
import { openSession, placeOrder, startHarness } from './support/harness';
import type { Harness } from './support/harness';

assertIntegrationGate(process.env);

let h: Harness;
let session: string;
let number: string;
const item = (key: keyof Harness['fx']['products'], quantity = 1, price?: number) => ({
  productId: h.fx.products[key].publicKey ?? `rustika-INTERNO${h.run.identity.runId.toUpperCase()}`,
  quantity,
  expectedUnitPriceInCents: price ?? h.fx.products[key].priceInCents,
});

beforeAll(async () => {
  h = await startHarness();
  number = h.run.identity.comandas.open;
  session = await openSession(h.app(), h, number);
});
afterAll(async () => {
  await h?.stop();
});

const ordersNow = async () => (await h.run.ordersFor(number)).length;

describe('pedidos com PostgreSQL real', () => {
  it('produto público válido: 201, pedido, itens com snapshot e histórico RECEIVED persistidos', async () => {
    const response = await placeOrder(h.app(), session, [item('numeric', 2)]);
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ status: 'RECEIVED', comandaNumber: number, totalInCents: 11998 });
    const [order] = (await h.run.ordersFor(number)).filter((row) => row.orderNumber === response.body.data.orderNumber);
    expect(order).toBeDefined();
    expect(order!.totalAmount.toString()).toBe('119.98');
    expect(order!.items).toHaveLength(1);
    expect(order!.items[0]).toMatchObject({ quantity: 2, productPublicKeySnapshot: h.fx.products.numeric.publicKey });
    expect(order!.items[0]!.unitPriceSnapshot.toString()).toBe('59.99');
    expect(order!.statusHistory).toHaveLength(1);
    expect(order!.statusHistory[0]).toMatchObject({ fromStatus: null, toStatus: 'RECEIVED', changedByAdminId: null });
    expect(order!.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(order!.requestDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('PA062240 (código alfanumérico): 201 com total de 5000 centavos', async () => {
    const response = await placeOrder(h.app(), session, [item('alphanumeric', 1, 5000)]);
    expect(response.status).toBe(201);
    expect(response.body.data.totalInCents).toBe(5000);
    expect(response.body.data.items[0].productId).toBe('rustika-PA062240');
  });

  it('produto interno (sem chave pública) é rejeitado sem gravar', async () => {
    const before = await ordersNow();
    const response = await placeOrder(h.app(), session, [item('internal')]);
    expect([400, 404]).toContain(response.status);
    expect(await ordersNow()).toBe(before);
  });

  it.each(['unavailable', 'unknown'] as const)('produto %s: 409 PRODUCT_UNAVAILABLE sem gravar', async (key) => {
    const before = await ordersNow();
    const response = await placeOrder(h.app(), session, [item(key)]);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PRODUCT_UNAVAILABLE');
    expect(await ordersNow()).toBe(before);
  });

  it('preço alterado no banco antes do envio: 409 PRICE_CHANGED e nenhuma linha nova', async () => {
    const before = await ordersNow();
    await h.run.setPrice('priceChange', '25.00');
    const response = await placeOrder(h.app(), session, [item('priceChange', 1, 2000)]);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PRICE_CHANGED');
    expect(await ordersNow()).toBe(before);
    expect((await placeOrder(h.app(), session, [item('priceChange', 1, 2500)])).status).toBe(201);
  });

  it.each([0, 100, -1, 1.5])('quantidade inválida %s: 400 sem gravar', async (quantity) => {
    const before = await ordersNow();
    const response = await placeOrder(h.app(), session, [{ ...item('numeric'), quantity }]);
    expect(response.status).toBe(400);
    expect(await ordersNow()).toBe(before);
  });

  it('Idempotency-Key repetida com o mesmo corpo: 200, mesmo número, uma linha só', async () => {
    const key = randomUUID(); const app = h.app();
    const first = await placeOrder(app, session, [item('numeric')], key);
    const before = await ordersNow();
    const replay = await placeOrder(app, session, [item('numeric')], key);
    expect(first.status).toBe(201); expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await ordersNow()).toBe(before);
  });

  it('mesma chave com corpo diferente: 409 IDEMPOTENCY_CONFLICT', async () => {
    const key = randomUUID(); const app = h.app();
    await placeOrder(app, session, [item('numeric')], key);
    const response = await placeOrder(app, session, [item('numeric', 3)], key);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('cliques duplicados (8 envios simultâneos, mesma chave): exatamente um pedido', async () => {
    const key = randomUUID(); const app = h.app(); const before = await ordersNow();
    const responses = await Promise.all(Array.from({ length: 8 }, () => placeOrder(app, session, [item('numeric')], key)));
    const ok = responses.filter((r) => r.status === 200 || r.status === 201);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(ok.map((r) => r.body.data.orderNumber)).size).toBe(1);
    expect(responses.every((r) => [200, 201, 409].includes(r.status))).toBe(true);
    expect(await ordersNow()).toBe(before + 1);
  });

  it('falha recuperável: resposta perdida e reenvio com a mesma chave devolvem o pedido original', async () => {
    const key = randomUUID();
    const lost = await placeOrder(h.app(), session, [item('alphanumeric', 1, 5000)], key);
    const retry = await placeOrder(h.app(), session, [item('alphanumeric', 1, 5000)], key);
    expect(retry.status).toBe(200);
    expect(retry.body.data.orderNumber).toBe(lost.body.data.orderNumber);
  });

  it('item inexistente no meio do pedido: 404 e nenhuma linha em orders, order_items ou histórico', async () => {
    const before = await ordersNow();
    const response = await placeOrder(h.app(), session, [item('numeric'), { productId: 'rustika-99999999999', quantity: 1, expectedUnitPriceInCents: 100 }]);
    expect(response.status).toBe(404);
    expect(await ordersNow()).toBe(before);
  });

  it('falha de transação depois do INSERT: rollback real no PostgreSQL, 500 sem detalhes', async () => {
    const before = await ordersNow();
    const failing = h.db.app.$extends({ query: { order: { async create({ args, query }) { await query(args); throw new Error('falha forçada após INSERT'); } } } });
    const app = createApp({ prisma: failing as unknown as PrismaClient, authClock: h.clock.now });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await placeOrder(app, session, [item('numeric')]);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erro interno no servidor.' } });
    } finally { log.mockRestore(); }
    expect(await ordersNow()).toBe(before);
  });

  it('resposta HTTP e estado persistido são consistentes (total, itens e número)', async () => {
    const response = await placeOrder(h.app(), session, [item('numeric', 2), item('alphanumeric', 1, 5000)]);
    expect(response.status).toBe(201);
    const order = (await h.run.ordersFor(number)).find((row) => row.orderNumber === response.body.data.orderNumber)!;
    expect(Math.round(Number(order.totalAmount) * 100)).toBe(response.body.data.totalInCents);
    expect(response.body.data.totalInCents).toBe(2 * 5999 + 5000);
    expect(order.items.map((row) => row.productPublicKeySnapshot).sort()).toEqual(response.body.data.items.map((row: { productId: string }) => row.productId).sort());
  });
});
