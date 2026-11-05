import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler';
import { createOrderRouter } from '../../src/routes/order.routes';
import type { OrderRateLimits } from '../../src/routes/order.routes';
import { createFixedWindowLimiter, rateLimitAddress } from '../../src/security/accessLimits';
import { body, mockOrderPrisma, TOKEN } from '../fixtures/orders';

const ORIGIN = 'http://localhost:5173';

function clock(start = 0) {
  let time = start;
  return { now: () => new Date(time), advance: (ms: number) => { time += ms; } };
}

describe('limitador sob saturação adversarial', () => {
  it('inundar a tabela com chaves novas não zera o contador de quem já atingiu o limite', () => {
    const c = clock(); const limiter = createFixedWindowLimiter({ max: 3, windowMs: 60_000, now: c.now, capacity: 100 });
    for (let i = 0; i < 4; i++) limiter.hit('abusador');
    expect(limiter.peek('abusador').limited).toBe(true);
    for (let i = 0; i < 1_000; i++) limiter.hit(`descartavel-${i}`);
    expect(limiter.peek('abusador').limited).toBe(true);
    expect(limiter.hit('abusador').limited).toBe(true);
    expect(limiter.size).toBeLessThanOrEqual(200);
  });

  it('a inundação não bloqueia um cliente legítimo novo', () => {
    const c = clock(); const limiter = createFixedWindowLimiter({ max: 3, windowMs: 60_000, now: c.now, capacity: 50 });
    for (let i = 0; i < 5_000; i++) limiter.hit(`descartavel-${i}`);
    expect(limiter.hit('cliente-legitimo').limited).toBe(false);
    expect(limiter.hit('cliente-legitimo').limited).toBe(false);
  });

  it('o depósito de bloqueados também é limitado: cede a entrada cuja penalidade termina primeiro', () => {
    const c = clock(); const limiter = createFixedWindowLimiter({ max: 2, windowMs: 60_000, now: c.now, capacity: 10, blockedCapacity: 2 });
    for (const key of ['a', 'b', 'c']) { limiter.hit(key); limiter.hit(key); c.advance(10); }
    expect(limiter.blockedSize).toBe(2);
    expect(limiter.peek('a').limited).toBe(false);
    expect(limiter.peek('b').limited).toBe(true);
    expect(limiter.peek('c').limited).toBe(true);
  });

  it('bloqueados expiram com a janela e liberam memória quando o depósito enche', () => {
    const c = clock(); const limiter = createFixedWindowLimiter({ max: 1, windowMs: 1_000, now: c.now, capacity: 10, blockedCapacity: 3 });
    ['a', 'b', 'c'].forEach((key) => limiter.hit(key));
    expect(limiter.blockedSize).toBe(3);
    c.advance(1_000);
    expect(limiter.peek('a').limited).toBe(false);
    limiter.hit('d');
    expect(limiter.blockedSize).toBe(1);
    expect(limiter.peek('d').limited).toBe(true);
  });

  it('a janela conta desde o primeiro acesso, mesmo depois de a chave ir para os bloqueados', () => {
    const c = clock(); const limiter = createFixedWindowLimiter({ max: 2, windowMs: 60_000, now: c.now });
    limiter.hit('k'); c.advance(30_000); limiter.hit('k');
    expect(limiter.hit('k').retryAfterSeconds).toBe(30);
    c.advance(30_000);
    expect(limiter.hit('k').limited).toBe(false);
  });

  it('memória total limitada a capacidade + bloqueados mesmo com 50 mil chaves e abusadores', () => {
    const c = clock(); const limiter = createFixedWindowLimiter({ max: 2, windowMs: 60_000, now: c.now, capacity: 1_000, blockedCapacity: 500 });
    for (let i = 0; i < 50_000; i++) { limiter.hit(`k-${i}`); if (i % 10 === 0) limiter.hit(`k-${i}`); }
    expect(limiter.size).toBeLessThanOrEqual(1_500);
    expect(limiter.blockedSize).toBeLessThanOrEqual(500);
  }, 30_000); // teste pesado: prazo próprio para não falhar por carga da máquina (3D.3.11)
});

describe('rateLimitAddress', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:0DB8:0001:0002::1', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::ffff%eth0', '2001:db8:1:2::/64'],
    ['::1', '0:0:0:0::/64'],
    ['64:ff9b::192.0.2.33', '64:ff9b:0:0::/64'],
    [undefined, 'unknown'],
  ])('%s -> %s', (input, expected) => {
    expect(rateLimitAddress(input)).toBe(expected);
  });

  it('endereços diferentes do mesmo /64 caem no mesmo balde; outro /64 não', () => {
    expect(rateLimitAddress('2001:db8:1:2::1')).toBe(rateLimitAddress('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    expect(rateLimitAddress('2001:db8:1:3::1')).not.toBe(rateLimitAddress('2001:db8:1:2::1'));
  });
});

/** Router mounted with a test-only middleware that fixes request.ip from a header. */
function routeApp(limits: Partial<OrderRateLimits>) {
  const mock = mockOrderPrisma(); const c = clock(Date.parse('2026-11-03T12:00:00Z'));
  const app = express();
  app.use((req, _res, next) => {
    const ip = req.get('X-Test-Ip');
    if (ip) Object.defineProperty(req, 'ip', { value: ip, configurable: true });
    next();
  });
  app.use('/api/orders', createOrderRouter(mock.prisma, ORIGIN, { now: c.now, limits }));
  app.use(errorHandler);
  let seq = 0;
  const post = (ip: string, token = TOKEN) => request(app).post('/api/orders').set('X-Test-Ip', ip).set('Origin', ORIGIN)
    .set('X-Rustika-Request', '1').set('Cookie', `rustika_session=${token}`)
    .set('Idempotency-Key', `11111111-1111-4111-8111-${String(++seq).padStart(12, '0')}`).set('Content-Type', 'application/json');
  return { ...mock, post, clock: c };
}

describe('POST /api/orders: concorrência e reciclagem de chaves', () => {
  it('rajada simultânea da mesma sessão: exatamente o limite passa, o resto recebe 429', async () => {
    const mock = routeApp({ perSession: { max: 5, windowMs: 60_000 } });
    const responses = await Promise.all(Array.from({ length: 20 }, () => mock.post('198.51.100.1').send(body())));
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(mock.orderCreate).toHaveBeenCalledTimes(5);
  });

  it('a mesma sessão usada de vários IPs continua no mesmo balde', async () => {
    const mock = routeApp({ perSession: { max: 3, windowMs: 60_000 } });
    for (const ip of ['198.51.100.1', '198.51.100.2', '2001:db8::1']) expect((await mock.post(ip).send(body())).status).toBe(201);
    expect((await mock.post('203.0.113.99').send(body())).status).toBe(429);
  });

  it('girar endereços dentro do mesmo /64 não contorna o limite de sessões inválidas', async () => {
    const mock = routeApp({ invalidSessionPerIp: { max: 3, windowMs: 60_000 } });
    for (let i = 1; i <= 3; i++) {
      expect((await mock.post(`2001:db8:a:b::${i.toString(16)}`, 'f'.repeat(64)).send(body())).status).toBe(401);
    }
    expect((await mock.post('2001:db8:a:b::ffff', 'e'.repeat(64)).send(body())).status).toBe(429);
    expect((await mock.post('2001:db8:a:c::1', 'e'.repeat(64)).send(body())).status).toBe(401);
  });

  it('o teto por IP agrupa o /64 inteiro', async () => {
    const mock = routeApp({ perIp: { max: 2, windowMs: 60_000 } });
    await mock.post('2001:db8:5:5::1').send(body());
    await mock.post('2001:db8:5:5::2').send(body());
    expect((await mock.post('2001:db8:5:5::3').send(body())).status).toBe(429);
  });

  it('IPv4 mapeado em IPv6 e IPv4 puro são o mesmo cliente', async () => {
    const mock = routeApp({ perIp: { max: 1, windowMs: 60_000 } });
    await mock.post('198.51.100.7').send(body());
    expect((await mock.post('::ffff:198.51.100.7').send(body())).status).toBe(429);
  });

  it('inundação de cookies inválidos de muitos IPs não zera o bloqueio de um IP já bloqueado', async () => {
    const mock = routeApp({ invalidSessionPerIp: { max: 2, windowMs: 60_000 }, capacity: 20 });
    await mock.post('203.0.113.1', '1'.repeat(64)).send(body());
    await mock.post('203.0.113.1', '2'.repeat(64)).send(body());
    for (let i = 0; i < 60; i++) await mock.post(`198.18.0.${i}`, '3'.repeat(64)).send(body());
    expect((await mock.post('203.0.113.1', '4'.repeat(64)).send(body())).status).toBe(429);
  });

  it('sessão confirmada segue atendida enquanto o IP compartilhado está bloqueado por tentativas inválidas', async () => {
    const mock = routeApp({ invalidSessionPerIp: { max: 2, windowMs: 60_000 } });
    expect((await mock.post('198.51.100.50').send(body())).status).toBe(201);
    await mock.post('198.51.100.50', '1'.repeat(64)).send(body());
    await mock.post('198.51.100.50', '2'.repeat(64)).send(body());
    expect((await mock.post('198.51.100.50', '3'.repeat(64)).send(body())).status).toBe(429);
    expect((await mock.post('198.51.100.50').send(body())).status).toBe(201);
  });
});
