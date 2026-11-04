import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { body, KEY, mockOrderPrisma, TOKEN } from './fixtures/orders';

/** Contract: POST /api/orders requires exact Origin + X-Rustika-Request: 1 (403), JSON (415),
 * a well-formed session cookie (401) and an Idempotency-Key UUID v4 (400), before any database work. */
function setup() {
  const mock = mockOrderPrisma(); const app = createApp({ prisma: mock.prisma });
  const post = () => request(app).post('/api/orders').set('Origin', env.corsOrigin).set('X-Rustika-Request', '1')
    .set('Cookie', `rustika_session=${TOKEN}`).set('Idempotency-Key', KEY).set('Content-Type', 'application/json');
  return { ...mock, app, post };
}

describe('POST /api/orders: header de proteção X-Rustika-Request', () => {
  it('requisição válida com o header cria o pedido (201)', async () => {
    const mock = setup();
    const response = await mock.post().send(body());
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(mock.orderCreate).toHaveBeenCalledTimes(1);
  });

  it('header ausente recebe 403 ORIGIN_NOT_ALLOWED sem tocar no banco', async () => {
    const mock = setup();
    const response = await mock.post().unset('X-Rustika-Request').send(body());
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ success: false, error: { code: 'ORIGIN_NOT_ALLOWED' } });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  // Espaços nas pontas são removidos pelo próprio parser HTTP do Node, então " 1" chega como "1".
  it.each(['0', 'true', '', '01', '11', 'yes', '1,1'])('header com valor inválido %j recebe 403', async (value) => {
    const mock = setup();
    const response = await mock.post().set('X-Rustika-Request', value).send(body());
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it('Origin inválida com header correto continua 403', async () => {
    const mock = setup();
    const response = await mock.post().set('Origin', 'https://attacker.example').send(body());
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it('header correto não dispensa JSON (415) nem Idempotency-Key (400)', async () => {
    const mock = setup();
    expect((await mock.post().set('Content-Type', 'text/plain').send('pedido')).status).toBe(415);
    const missingKey = await mock.post().unset('Idempotency-Key').send(body());
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it('sessão inválida (cookie bem formado e desconhecido) recebe 401 INVALID_SESSION', async () => {
    const mock = setup();
    const response = await mock.post().set('Cookie', `rustika_session=${'c'.repeat(64)}`).send(body());
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_SESSION');
    expect(mock.orderCreate).not.toHaveBeenCalled();
  });

  it('o header é verificado antes da sessão: sem header não revela se o cookie é válido', async () => {
    const mock = setup();
    const response = await mock.post().unset('X-Rustika-Request').set('Cookie', '').send(body());
    expect(response.status).toBe(403);
  });
});
