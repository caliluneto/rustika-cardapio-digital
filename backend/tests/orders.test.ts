import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { body, KEY, mockOrderPrisma, TOKEN } from './fixtures/orders';

function setup() {
  const mock = mockOrderPrisma(); const app = createApp({ prisma: mock.prisma });
  const post = () => request(app).post('/api/orders').set('Origin', env.corsOrigin).set('X-Rustika-Request', '1')
    .set('Cookie', `rustika_session=${TOKEN}`).set('Idempotency-Key', KEY).set('Content-Type', 'application/json');
  return { ...mock, app, post };
}

describe('POST /api/orders', () => {
  it('confirma com 201 e número do pedido; replay usa 200 e mesmo número', async () => {
    const mock = setup();
    const response = await mock.post().send(body());
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.body).toMatchObject({ success: true, data: { orderNumber: 42, status: 'RECEIVED', comandaNumber: '000123', customerName: 'Ana Silva', totalInCents: 11998 } });
    const replay = await mock.post().send(body());
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(response.body);
    expect(JSON.stringify(response.body)).not.toMatch(/credential|requestDigest|idempotencyKey|sessionId|comandaId/);
    expect(mock.orderCreate).toHaveBeenCalledTimes(1);
  });

  it('preflight permite JSON, cookie e chave de idempotência na origem configurada', async () => {
    const mock = setup();
    const response = await request(mock.app).options('/api/orders').set('Origin', env.corsOrigin)
      .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type,idempotency-key,x-rustika-request');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(env.corsOrigin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-headers']).toMatch(/Idempotency-Key/);
    expect(response.headers['access-control-allow-headers']).toMatch(/X-Rustika-Request/);
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it.each(['absent', 'foreign', 'null'])('recusa origem %s', async (origin) => {
    const mock = setup(); const req = mock.post();
    if (origin === 'absent') req.unset('Origin'); else req.set('Origin', origin === 'foreign' ? 'https://other.example' : 'null');
    expect((await req.send(body())).status).toBe(403);
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it.each(['', 'rustika_session=123', `rustika_session=${TOKEN}; rustika_session=${TOKEN}`])('recusa cookie ausente/inválido/duplicado', async (cookie) => {
    const mock = setup();
    const response = await mock.post().set('Cookie', cookie).send(body());
    expect(response.status).toBe(401); expect(response.body.error.code).toBe('INVALID_SESSION');
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it('cookie desconhecido recebe 401 sem consultar produtos', async () => {
    const mock = setup();
    const response = await mock.post().set('Cookie', `rustika_session=${'b'.repeat(64)}`).send(body());
    expect(response.status).toBe(401); expect(mock.productFind).not.toHaveBeenCalled();
  });

  it.each(['', '123', '11111111-1111-1111-8111-111111111111'])('recusa chave de idempotência inválida', async (key) => {
    const mock = setup(); const response = await mock.post().set('Idempotency-Key', key).send(body());
    expect(response.status).toBe(400); expect(response.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it.each([
    {}, { ...body(), customerName: '' }, { ...body(), customerName: 'x' },
    { ...body(), customerName: '<script>' }, { ...body(), customerName: 'x'.repeat(121) },
    { ...body(), customerPhone: 'not-a-phone' }, { ...body(), notes: 'x'.repeat(501) },
    { ...body(), totalAmount: 1 }, { ...body(), comandaId: 'arbitrary' }, { ...body(), sessionId: 'arbitrary' },
    { ...body(), status: 'DELIVERED' }, { ...body(), items: [] },
    { ...body(), items: [body().items[0], body().items[0]] },
    { ...body(), items: [{ ...body().items[0], quantity: 0 }] },
    { ...body(), items: [{ ...body().items[0], price: 1 }] },
    { ...body(), items: [{ productId: 'rustika-131', quantity: 1 }] },
    { ...body(), items: [{ ...body().items[0], notes: 'x'.repeat(201) }] },
    { ...body(), items: Array.from({ length: 31 }, (_, i) => ({ productId: `rustika-${i}`, quantity: 1, expectedUnitPriceInCents: 1 })) },
    { ...body(), items: [1, 2, 3].map((i) => ({ productId: `rustika-${i}`, quantity: 99, expectedUnitPriceInCents: 1 })) },
  ])('recusa payload inválido antes do banco: %#', async (input) => {
    const mock = setup(); const response = await mock.post().send(input);
    expect(response.status).toBe(400); expect(response.body.error.code).toBe('INVALID_INPUT');
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it('JSON malformado recebe 400; corpo acima de 16 KiB recebe 413', async () => {
    const mock = setup();
    expect((await mock.post().send('{broken')).status).toBe(400);
    expect((await mock.post().send({ ...body(), notes: 'x'.repeat(17000) })).status).toBe(413);
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it('recusa formulário e parâmetros de query', async () => {
    const mock = setup();
    expect((await mock.post().set('Content-Type', 'text/plain').send('pedido')).status).toBe(415);
    expect((await mock.post().query({ sessionId: 'fake' }).send(body())).status).toBe(400);
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it('propaga 404 para produto ausente e 409 para indisponibilidade/preço alterado', async () => {
    const missing = setup(); missing.products.length = 0;
    expect((await missing.post().send(body())).status).toBe(404);
    const unavailable = setup(); unavailable.products[0]!.availabilityState = 'UNKNOWN';
    expect((await unavailable.post().send(body())).body.error.code).toBe('PRODUCT_UNAVAILABLE');
    const changed = setup(); const input = body(); input.items[0]!.expectedUnitPriceInCents = 1;
    const response = await changed.post().send(input);
    expect(response.status).toBe(409); expect(response.body.error.code).toBe('PRICE_CHANGED');
  });

  it('falha transacional não retorna sucesso nem expõe dados internos', async () => {
    const mock = setup(); mock.control.commitError = new Error('postgresql://secret:password@host/database');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await mock.post().send(body());
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erro interno no servidor.' } });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/password|postgresql/);
      expect(mock.committed.size).toBe(0);
    } finally { log.mockRestore(); }
  });

  it('aplicação sem Prisma retorna 503', async () => {
    const response = await request(createApp()).post('/api/orders').set('Origin', env.corsOrigin).set('X-Rustika-Request', '1')
      .set('Cookie', `rustika_session=${TOKEN}`).set('Idempotency-Key', KEY).send(body());
    expect(response.status).toBe(503);
  });
});

describe('GET /api/orders/:orderId', () => {
  async function created() {
    const mock = setup();
    const response = await mock.post().send(body());
    expect(response.status).toBe(201);
    return { mock, order: response.body.data };
  }

  it('a própria sessão acompanha status e histórico sem receber dados internos', async () => {
    const { mock, order } = await created();
    const response = await request(mock.app).get(`/api/orders/${order.id}`).set('Cookie', `rustika_session=${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toMatchObject({
      id: order.id, orderNumber: 42, status: 'RECEIVED', comandaNumber: '000123',
      history: [{ fromStatus: null, toStatus: 'RECEIVED' }],
    });
    expect(JSON.stringify(response.body)).not.toMatch(/credential|requestDigest|idempotencyKey|sessionId|comandaId|changedByAdmin/i);
  });

  it('UUID não autoriza sozinho: cookie ausente/inválido recebe 401 e outra sessão recebe 404', async () => {
    const { mock, order } = await created();
    expect((await request(mock.app).get(`/api/orders/${order.id}`)).status).toBe(401);
    expect((await request(mock.app).get(`/api/orders/${order.id}`).set('Cookie', `rustika_session=${'b'.repeat(64)}`)).status).toBe(401);
    const stored = [...mock.committed.values()][0]!;
    stored.sessionId = '99999999-9999-4999-8999-999999999999';
    const forbidden = await request(mock.app).get(`/api/orders/${order.id}`).set('Cookie', `rustika_session=${TOKEN}`);
    expect(forbidden.status).toBe(404);
    expect(forbidden.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it('valida identificador e recusa query string', async () => {
    const mock = setup();
    const invalid = await request(mock.app).get('/api/orders/not-a-uuid').set('Cookie', `rustika_session=${TOKEN}`);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_ORDER_ID');
    const queried = await request(mock.app).get('/api/orders/44444444-4444-4444-8444-000000000001?token=x')
      .set('Cookie', `rustika_session=${TOKEN}`);
    expect(queried.status).toBe(400);
  });
});
