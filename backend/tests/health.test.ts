import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';

const app = createApp();

// 3D.3.12: recuperado de health.test-Calil-Notebook.ts (cópia de conflito do OneDrive com a
// versão do início da 3D.3.9). O arquivo ativo tinha regredido para uma versão de 22/10.
describe('inicialização isolada do app', () => {
  it('aceita cliente injetado sem criar conexão durante o health', async () => {
    const prisma = { $connect: vi.fn() } as unknown as PrismaClient;
    const injectedApp = createApp({ prisma });

    expect(injectedApp.locals.prisma).toBe(prisma);
    expect((await request(injectedApp).get('/api/health')).status).toBe(200);
    expect(prisma.$connect).not.toHaveBeenCalled();
  });
});

describe('GET /api/health', () => {
  it('retorna HTTP 200', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
  });

  it('retorna o formato JSON esperado', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        status: 'ok',
        service: 'cardapio-digital-api',
      },
    });
    expect(typeof response.body.data.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(response.body.data.timestamp))).toBe(false);
    expect(typeof response.body.data.uptime).toBe('number');
  });
});

describe('Tratamento de erros', () => {
  // Contrato atual (errorHandler): JSON malformado é 400 INVALID_INPUT. A versão do commit
  // baseline esperava 500 em POST /api/health; essa expectativa antiga NÃO foi restaurada.
  it('retorna erro padronizado quando o JSON da requisição é inválido', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await request(app)
        .post('/api/admin/auth/login')
        .set('Origin', env.corsOrigin)
        .set('X-Rustika-Request', '1')
        .set('Content-Type', 'application/json')
        .send('{invalid');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'JSON inválido.' },
      });
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe('Rotas inexistentes', () => {
  it('retorna HTTP 404 com resposta de erro padronizada', async () => {
    const response = await request(app).get('/api/rota-inexistente');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String),
      },
    });
  });
});
