import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler';
import { accessLimit, createFixedWindowLimiter, DEFAULT_LIMIT_CAPACITY } from '../../src/security/accessLimits';

function clock(start = 0) {
  let time = start;
  return { now: () => new Date(time), advance: (ms: number) => { time += ms; } };
}

describe('createFixedWindowLimiter', () => {
  it('rajada: conta até o máximo e limita a partir do seguinte', () => {
    const c = clock(); const limiter = createFixedWindowLimiter({ max: 3, windowMs: 1000, now: c.now });
    expect([1, 2, 3].map(() => limiter.hit('a').limited)).toEqual([false, false, false]);
    const fourth = limiter.hit('a');
    expect(fourth.limited).toBe(true);
    expect(fourth.retryAfterSeconds).toBe(1);
  });

  it('peek não conta e indica quando o máximo já foi atingido', () => {
    const c = clock(); const limiter = createFixedWindowLimiter({ max: 2, windowMs: 1000, now: c.now });
    expect(limiter.peek('a').limited).toBe(false);
    limiter.hit('a');
    expect(limiter.peek('a').limited).toBe(false);
    limiter.hit('a');
    expect(limiter.peek('a').limited).toBe(true);
    expect(limiter.peek('a').limited).toBe(true);
    expect(limiter.hit('a').limited).toBe(true);
  });

  it('expiração: a janela reinicia e os registros vencidos são removidos', () => {
    const c = clock(); const limiter = createFixedWindowLimiter({ max: 1, windowMs: 1000, now: c.now });
    limiter.hit('a'); limiter.hit('b');
    expect(limiter.hit('a').limited).toBe(true);
    c.advance(1000);
    expect(limiter.hit('c').limited).toBe(false);
    expect(limiter.size).toBe(1);
    expect(limiter.hit('a').limited).toBe(false);
    expect(limiter.peek('b').limited).toBe(false);
  });

  it('Retry-After reflete o tempo restante da janela', () => {
    const c = clock(); const limiter = createFixedWindowLimiter({ max: 1, windowMs: 60_000, now: c.now });
    limiter.hit('a'); c.advance(45_500);
    expect(limiter.hit('a').retryAfterSeconds).toBe(15);
  });

  it('saturação: capacidade cheia remove o registro mais antigo e aceita a chave nova', () => {
    const c = clock(); const limiter = createFixedWindowLimiter({ max: 1, windowMs: 60_000, now: c.now, capacity: 3 });
    ['a', 'b', 'c'].forEach((key) => { limiter.hit(key); c.advance(1); });
    expect(limiter.hit('d').limited).toBe(false);
    expect(limiter.size).toBe(3);
    expect(limiter.peek('a').limited).toBe(false); // 'a' foi o removido
    expect(limiter.peek('b').limited).toBe(true);
    expect(limiter.hit('c').limited).toBe(true);
  });

  it('memória limitada: 25 mil chaves distintas não passam da capacidade padrão', () => {
    const c = clock(); const limiter = createFixedWindowLimiter({ max: 5, windowMs: 60_000, now: c.now });
    for (let i = 0; i < 25_000; i++) expect(limiter.hit(`ip-${i}`).limited).toBe(false);
    expect(limiter.size).toBe(DEFAULT_LIMIT_CAPACITY);
  }, 30_000); // teste pesado: prazo próprio para não falhar por carga da máquina (3D.3.11)

  it.each([{ max: 0 }, { max: 1.5 }, { windowMs: 0 }, { capacity: 0 }])('recusa configuração inválida %j', (override) => {
    const c = clock();
    expect(() => createFixedWindowLimiter({ max: 1, windowMs: 1000, now: c.now, ...override })).toThrow();
  });
});

describe('accessLimit (middleware das rotas de acesso)', () => {
  function app(capacity: number) {
    const c = clock(); const server = express();
    server.set('trust proxy', false);
    server.use(accessLimit(1, 60_000, c.now, capacity));
    server.get('/', (_req, res) => { res.json({ ok: true }); });
    server.use(errorHandler);
    return server;
  }

  it('responde 429 padronizado com Retry-After', async () => {
    const server = app(10);
    expect((await request(server).get('/')).status).toBe(200);
    const limited = await request(server).get('/');
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ success: false, error: { code: 'TOO_MANY_REQUESTS', message: expect.any(String) } });
    expect(limited.headers['retry-after']).toBe('60');
  });

  it('não confia em X-Forwarded-For para escolher o balde', async () => {
    const server = app(10);
    await request(server).get('/').set('X-Forwarded-For', '203.0.113.1');
    expect((await request(server).get('/').set('X-Forwarded-For', '203.0.113.2')).status).toBe(429);
  });
});
