import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { AppDependencies } from '../src/app';
import { env } from '../src/config/env';
import { ORDER_RATE_LIMITS } from '../src/routes/order.routes';
import { body, mockOrderPrisma, TOKEN } from './fixtures/orders';

const WINDOW = 60_000;
const OTHER_TOKEN = 'd'.repeat(64);

function setup(limits: AppDependencies['orderLimits'] = {}) {
  const mock = mockOrderPrisma();
  let time = Date.parse('2026-11-03T12:00:00Z');
  const clock = { advance: (ms: number) => { time += ms; } };
  const app = createApp({ prisma: mock.prisma, authClock: () => new Date(time), orderLimits: limits });
  let seq = 0;
  const nextKey = () => `11111111-1111-4111-8111-${String(++seq).padStart(12, '0')}`;
  const post = (token = TOKEN, key = nextKey()) => request(app).post('/api/orders').set('Origin', env.corsOrigin)
    .set('X-Rustika-Request', '1').set('Cookie', `rustika_session=${token}`).set('Idempotency-Key', key)
    .set('Content-Type', 'application/json');
  return { ...mock, app, post, clock };
}

describe('POST /api/orders: limites de requisição', () => {
  it('valores padrão documentados', () => {
    expect(ORDER_RATE_LIMITS.perSession).toEqual({ max: 10, windowMs: 300_000 });
    expect(ORDER_RATE_LIMITS.invalidSessionPerIp).toEqual({ max: 30, windowMs: 300_000 });
    expect(ORDER_RATE_LIMITS.perIp).toEqual({ max: 300, windowMs: 300_000 });
    expect(ORDER_RATE_LIMITS.capacity).toBe(10000);
  });

  it('rajada da mesma sessão: o pedido seguinte ao limite recebe 429 com Retry-After e não chega ao serviço', async () => {
    const mock = setup({ perSession: { max: 3, windowMs: WINDOW } });
    for (let i = 0; i < 3; i++) expect((await mock.post().send(body())).status).toBe(201);
    const limited = await mock.post().send(body());
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: expect.any(String) } });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(mock.orderCreate).toHaveBeenCalledTimes(3);
  });

  it('a janela expira e a sessão volta a pedir', async () => {
    const mock = setup({ perSession: { max: 2, windowMs: WINDOW } });
    await mock.post().send(body()); await mock.post().send(body());
    expect((await mock.post().send(body())).status).toBe(429);
    mock.clock.advance(WINDOW);
    expect((await mock.post().send(body())).status).toBe(201);
  });

  it('várias sessões no mesmo IP (Wi-Fi compartilhado) têm baldes independentes', async () => {
    const mock = setup({ perSession: { max: 2, windowMs: WINDOW } });
    mock.addCredential(OTHER_TOKEN);
    await mock.post().send(body()); await mock.post().send(body());
    expect((await mock.post().send(body())).status).toBe(429);
    expect((await mock.post(OTHER_TOKEN).send(body())).status).toBe(201);
    expect((await mock.post(OTHER_TOKEN).send(body())).status).toBe(201);
  });

  it('com o limite padrão, 20 mesas no mesmo IP enviando 10 pedidos cada não recebem 429', async () => {
    const mock = setup();
    const tokens = Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(2, '0').repeat(32));
    tokens.forEach((token) => mock.addCredential(token));
    const statuses: number[] = [];
    for (const token of tokens) for (let i = 0; i < 10; i++) statuses.push((await mock.post(token).send(body())).status);
    expect(statuses.filter((status) => status === 429)).toHaveLength(0);
  }, 30_000); // 200 requisições HTTP: prazo próprio para não falhar por carga da máquina (3D.3.11)

  it('tentativas com sessão inválida: após o limite o IP recebe 429, mas a sessão já validada continua', async () => {
    const mock = setup({ invalidSessionPerIp: { max: 3, windowMs: WINDOW } });
    expect((await mock.post().send(body())).status).toBe(201); // TOKEN passa a ser sessão confiável
    for (let i = 0; i < 3; i++) {
      const probe = await mock.post(i.toString().repeat(64)).send(body());
      expect(probe.status).toBe(401);
    }
    const blocked = await mock.post('e'.repeat(64)).send(body());
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect((await mock.post().send(body())).status).toBe(201);
  });

  it('cookie malformado também conta como tentativa inválida', async () => {
    const mock = setup({ invalidSessionPerIp: { max: 2, windowMs: WINDOW } });
    expect((await mock.post('123').send(body())).status).toBe(401);
    expect((await mock.post('xyz').send(body())).status).toBe(401);
    expect((await mock.post('f'.repeat(64)).send(body())).status).toBe(429);
    const calls = mock.transaction.mock.calls.length;
    expect(calls).toBe(0);
  });

  it('o bloqueio por tentativas inválidas expira com a janela', async () => {
    const mock = setup({ invalidSessionPerIp: { max: 1, windowMs: WINDOW } });
    await mock.post('1'.repeat(64)).send(body());
    expect((await mock.post().send(body())).status).toBe(429); // sessão válida mas ainda não confirmada
    mock.clock.advance(WINDOW);
    expect((await mock.post().send(body())).status).toBe(201);
  });

  it('teto amplo por IP vale antes de qualquer outra verificação e responde 429, não 413', async () => {
    const mock = setup({ perIp: { max: 2, windowMs: WINDOW } });
    await mock.post().send(body()); await mock.post().unset('Origin').send(body());
    const oversized = await mock.post().send({ ...body(), notes: 'x'.repeat(17000) });
    expect(oversized.status).toBe(429);
    const foreign = await mock.post().set('Origin', 'https://other.example').send(body());
    expect(foreign.status).toBe(429);
  });

  it('replays com a mesma chave também contam no limite da sessão', async () => {
    const mock = setup({ perSession: { max: 2, windowMs: WINDOW } });
    const key = '11111111-1111-4111-8111-aaaaaaaaaaaa';
    expect((await mock.post(TOKEN, key).send(body())).status).toBe(201);
    expect((await mock.post(TOKEN, key).send(body())).status).toBe(200);
    expect((await mock.post(TOKEN, key).send(body())).status).toBe(429);
    expect(mock.orderCreate).toHaveBeenCalledTimes(1);
  });

  it('saturação da memória: capacidade cheia não bloqueia um cliente novo', async () => {
    const mock = setup({ capacity: 5, invalidSessionPerIp: { max: 1000, windowMs: WINDOW } });
    const tokens = Array.from({ length: 12 }, (_, i) => (i + 16).toString(16).repeat(64).slice(0, 64));
    tokens.forEach((token) => mock.addCredential(token));
    for (const token of tokens) expect((await mock.post(token).send(body())).status).toBe(201);
  });
});
