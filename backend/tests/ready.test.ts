import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createReadyRouter, READY_FAIL_CACHE_MS, READY_OK_CACHE_MS, READY_TIMEOUT_MS } from '../src/routes/ready.routes';
import express from 'express';

const fakePrisma = (impl: () => Promise<unknown>) => ({ $queryRaw: vi.fn(impl) }) as unknown as PrismaClient & { $queryRaw: ReturnType<typeof vi.fn> };

describe('GET /api/ready (3D.5.2)', () => {
  it('200 quando o banco responde e o schema tem a coluna esperada; somente leitura', async () => {
    const prisma = fakePrisma(async () => [{ ok: 1 }]);
    const response = await request(createApp({ prisma })).get('/api/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { status: 'ready' } });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('503 genérico, sem detalhes, quando o banco falha (mensagem interna nunca é exposta)', async () => {
    const prisma = fakePrisma(async () => { throw new Error('connection refused to db-secret-host:5432 password=abc'); });
    const response = await request(createApp({ prisma })).get('/api/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ success: false, error: { code: 'NOT_READY', message: 'Serviço indisponível no momento.' } });
    expect(JSON.stringify(response.body)).not.toMatch(/secret|password|5432/);
  });

  it('503 sem cliente de banco e o /api/health continua 200 sem consultar o banco', async () => {
    const app = createApp();
    expect((await request(app).get('/api/ready')).status).toBe(503);
    const prisma = fakePrisma(async () => [1]);
    expect((await request(createApp({ prisma })).get('/api/health')).status).toBe(200);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('usa cache curto (sucesso e falha) para não amplificar carga no banco', async () => {
    let time = 1_000_000;
    let fail = false;
    const prisma = fakePrisma(async () => { if (fail) throw new Error('x'); return [1]; });
    const app = express(); app.use('/ready', createReadyRouter(prisma, () => time));
    await request(app).get('/ready'); await request(app).get('/ready');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2); // 2 consultas da primeira sondagem; a segunda veio do cache
    time += READY_OK_CACHE_MS + 1; fail = true;
    expect((await request(app).get('/ready')).status).toBe(503);
    const calls = prisma.$queryRaw.mock.calls.length;
    await request(app).get('/ready');
    expect(prisma.$queryRaw.mock.calls.length).toBe(calls); // falha também fica em cache por pouco tempo
    time += READY_FAIL_CACHE_MS + 1; fail = false;
    expect((await request(app).get('/ready')).status).toBe(200);
  });

  it('respeita o timeout quando o banco não responde (503 em ~2 s, sem pendurar a requisição)', async () => {
    const prisma = fakePrisma(() => new Promise(() => undefined));
    const app = express(); app.use('/ready', createReadyRouter(prisma));
    const started = Date.now();
    expect((await request(app).get('/ready')).status).toBe(503);
    expect(Date.now() - started).toBeGreaterThanOrEqual(READY_TIMEOUT_MS - 100);
    expect(Date.now() - started).toBeLessThan(READY_TIMEOUT_MS + 1500);
  });
});
