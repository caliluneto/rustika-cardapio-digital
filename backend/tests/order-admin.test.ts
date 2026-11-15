import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { ORDER_STATUSES, canTransitionOrder, nextOrderStatuses } from '../src/domain/rules';
import { ADMIN_ORDER_LIST_LIMIT, ORDER_STATUS_NOTE_MAX } from '../src/services/orderOperations.service';
import { TEST_PASSWORD } from './fixtures/access';
import { mockOpsPrisma, orderId, storedOrder } from './fixtures/orderOps';
import type { StoredOrder } from './fixtures/orderOps';

const cookieOf = (response: request.Response) => (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;

async function setup(initial: StoredOrder[] = [storedOrder(1)]) {
  const mock = await mockOpsPrisma(initial);
  const app = createApp({ prisma: mock.prisma, authClock: mock.now });
  const write = (method: 'post' | 'patch', path: string) =>
    request(app)[method](path).set('Origin', env.corsOrigin).set('X-Rustika-Request', '1').set('Content-Type', 'application/json');
  const login = await write('post', '/api/admin/auth/login').send({ email: mock.admin.email, password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  const cookie = cookieOf(login);
  const list = (query = '') => request(app).get(`/api/admin/orders${query}`).set('Cookie', cookie);
  const patch = (id: string, body: unknown, withCookie = true) => {
    const req = write('patch', `/api/admin/orders/${id}/status`);
    return (withCookie ? req.set('Cookie', cookie) : req).send(body as object);
  };
  return { ...mock, app, cookie, list, patch, write };
}

describe('domínio: estados e transições reutilizados', () => {
  it('a lista de estados vem da mesma tabela da máquina existente', () => {
    expect([...ORDER_STATUSES]).toEqual(['RECEIVED', 'IN_PREPARATION', 'READY', 'DELIVERED', 'CANCELLED']);
    expect(nextOrderStatuses('RECEIVED')).toEqual(['IN_PREPARATION', 'CANCELLED']);
    expect(nextOrderStatuses('IN_PREPARATION')).toEqual(['READY', 'CANCELLED']);
    expect(nextOrderStatuses('READY')).toEqual(['DELIVERED']);
    expect(nextOrderStatuses('DELIVERED')).toEqual([]);
    expect(nextOrderStatuses('CANCELLED')).toEqual([]);
    for (const from of ORDER_STATUSES) for (const to of ORDER_STATUSES) {
      expect(nextOrderStatuses(from).includes(to), `${from}->${to}`).toBe(canTransitionOrder(from, to));
    }
  });
});

  vi.setConfig({ testTimeout: 10000 });

describe('GET /api/admin/orders', () => {
  it('exige sessão administrativa: anônimo e cookie inválido recebem 401', async () => {
    const { app } = await setup();
    const anonymous = await request(app).get('/api/admin/orders');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ success: false, error: { code: expect.any(String) } });
    expect((await request(app).get('/api/admin/orders').set('Cookie', 'rustika_admin=' + 'f'.repeat(64))).status).toBe(401);
  });

  it('cookie de comanda (cliente) não dá acesso', async () => {
    const { app } = await setup();
    expect((await request(app).get('/api/admin/orders').set('Cookie', 'rustika_session=' + 'a'.repeat(64))).status).toBe(401);
  });

  it('admin válido: 200, no-store, todos os estados, ordem determinística e histórico', async () => {
    const { list } = await setup([
      storedOrder(3, { createdAt: new Date('2026-11-05T12:00:00Z') }),
      storedOrder(2, { createdAt: new Date('2026-11-05T12:00:00Z') }),
      storedOrder(1, { createdAt: new Date('2026-11-05T11:00:00Z'), status: 'READY' }),
      storedOrder(4, { status: 'DELIVERED' }),
      storedOrder(5, { status: 'CANCELLED' }),
      storedOrder(6, { status: 'IN_PREPARATION', createdAt: new Date('2026-11-05T13:00:00Z'), notes: 'Sem gelo' }),
    ]);
    const response = await list();
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { orders, truncated, nextCursor } = response.body.data;
    expect(truncated).toBe(false);
    expect(nextCursor).toBeNull();
    expect(orders.map((order: { orderNumber: number }) => order.orderNumber)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(orders[5]).toMatchObject({
      id: orderId(1), orderNumber: 1, status: 'READY', comandaNumber: '000123', customerName: 'Cliente 1', tableOrReference: 'Mesa 2',
      totalInCents: 5998, allowedTransitions: ['DELIVERED'], history: [{ fromStatus: null, toStatus: 'RECEIVED', actorName: null }],
      items: [{ productNameSnapshot: 'Frios', quantity: 2, unitPriceInCentsSnapshot: 2999, subtotalInCents: 5998, notes: null }],
    });
    expect(orders[0]).toMatchObject({ status: 'IN_PREPARATION', notes: 'Sem gelo', allowedTransitions: ['READY', 'CANCELLED'] });
    expect(orders[5].createdAt).toBe('2026-11-05T11:00:00.000Z');
    expect(typeof orders[0].updatedAt).toBe('string');
  });

  it('não vaza telefone, digest, chave de idempotência nem hashes', async () => {
    const { list } = await setup([storedOrder(1, { trackingTokenHash: 't'.repeat(64) })]);
    const text = JSON.stringify((await list()).body);
    expect(text).not.toMatch(/99999-0000|customerPhone|requestDigest|idempotency|trackingToken|Hash|credential|sessionId/i);
    expect(text).not.toContain('d'.repeat(64));
    expect(text).not.toContain('k'.repeat(64));
  });

  it('limite seguro: devolve no máximo o limite e sinaliza truncamento', async () => {
    const many = Array.from({ length: ADMIN_ORDER_LIST_LIMIT + 5 }, (_, i) => storedOrder(i + 1));
    const { list, findMany } = await setup(many);
    const response = await list('?limit=100');
    expect(response.body.data.orders).toHaveLength(ADMIN_ORDER_LIST_LIMIT);
    expect(response.body.data.truncated).toBe(true);
    expect(response.body.data.orders[0].orderNumber).toBe(ADMIN_ORDER_LIST_LIMIT + 5);
    expect(response.body.data.nextCursor).toBe(orderId(6));
    expect(findMany.mock.calls[0]![0].take).toBe(ADMIN_ORDER_LIST_LIMIT + 1);
  });

  it('lista vazia é um resultado válido', async () => {
    const { list } = await setup([]);
    const response = await list();
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ truncated: false, nextCursor: null, orders: [] });
  });

  it('filtra por status, pagina por cursor sem duplicar e recusa parâmetros inválidos', async () => {
    const { list } = await setup([
      storedOrder(1, { status: 'DELIVERED' }), storedOrder(2, { status: 'READY' }),
      storedOrder(3, { status: 'DELIVERED' }), storedOrder(4, { status: 'CANCELLED' }),
    ]);
    const first = await list('?status=DELIVERED&limit=1');
    expect(first.status).toBe(200);
    expect(first.body.data.orders.map((order: { orderNumber: number }) => order.orderNumber)).toEqual([3]);
    const second = await list(`?status=DELIVERED&limit=1&cursor=${first.body.data.nextCursor}`);
    expect(second.body.data.orders.map((order: { orderNumber: number }) => order.orderNumber)).toEqual([1]);
    expect(second.body.data.nextCursor).toBeNull();
    for (const query of ['?status=UNKNOWN', '?limit=0', '?limit=101', '?cursor=x', '?extra=1']) {
      const response = await list(query);
      expect(response.status).toBe(400);
      expect(['INVALID_INPUT', 'INVALID_STATUS', 'INVALID_ORDER_ID']).toContain(response.body.error.code);
    }
  });

  it('erro de banco vira 500 genérico, sem detalhes internos', async () => {
    const { list, control } = await setup();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    control.listError = true;
    const response = await list();
    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Erro interno no servidor.' });
    expect(JSON.stringify(response.body)).not.toMatch(/10\.0\.0\.5|relation|driver/);
    expect(spy.mock.calls.flat().join(' ')).not.toMatch(/10\.0\.0\.5|relation "orders"/);
    spy.mockRestore();
  });

  it('admin desativado depois do login perde o acesso (401)', async () => {
    const { list, control } = await setup();
    control.missingAdmin = true;
    expect((await list()).status).toBe(401);
  });
});

describe('PATCH /api/admin/orders/:orderId/status', () => {
  const move = (expected: string, to: string, extra: object = {}) => ({ expectedStatus: expected, toStatus: to, ...extra });

  it('sem sessão: 401 e nada muda', async () => {
    const { patch, orders, history } = await setup();
    const response = await patch(orderId(1), move('RECEIVED', 'IN_PREPARATION'), false);
    expect(response.status).toBe(401);
    expect(orders()[0]!.status).toBe('RECEIVED');
    expect(history()).toHaveLength(0);
  });

  it('cliente público (cookie de comanda) não consegue alterar status', async () => {
    const { app, orders } = await setup();
    const response = await request(app).patch(`/api/admin/orders/${orderId(1)}/status`)
      .set('Origin', env.corsOrigin).set('X-Rustika-Request', '1').set('Cookie', 'rustika_session=' + 'a'.repeat(64))
      .send(move('RECEIVED', 'IN_PREPARATION'));
    expect(response.status).toBe(401);
    expect(orders()[0]!.status).toBe('RECEIVED');
  });

  it('proteção de escrita: sem Origin/cabeçalho 403; sem JSON 415', async () => {
    const { app, cookie } = await setup();
    const noOrigin = await request(app).patch(`/api/admin/orders/${orderId(1)}/status`).set('Cookie', cookie).send(move('RECEIVED', 'IN_PREPARATION'));
    expect(noOrigin.status).toBe(403);
    const wrongType = await request(app).patch(`/api/admin/orders/${orderId(1)}/status`)
      .set('Origin', env.corsOrigin).set('X-Rustika-Request', '1').set('Cookie', cookie).set('Content-Type', 'text/plain').send('x');
    expect(wrongType.status).toBe(415);
  });

  it('identificador inválido: 400 INVALID_ORDER_ID', async () => {
    const { patch, transaction } = await setup();
    for (const id of ['1', 'abc', 'not-a-uuid', '55555555-5555-4555-8555-00000000000', `${orderId(1)}x`]) {
      const response = await patch(id, move('RECEIVED', 'IN_PREPARATION'));
      expect(response.status, id).toBe(400);
      expect(response.body.error.code).toBe('INVALID_ORDER_ID');
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it('pedido inexistente: 404 ORDER_NOT_FOUND', async () => {
    const { patch, history } = await setup();
    const response = await patch(orderId(99), move('RECEIVED', 'IN_PREPARATION'));
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ORDER_NOT_FOUND');
    expect(history()).toHaveLength(0);
  });

  it('corpo inválido: status desconhecido, campos ausentes, campos extras e tipos errados', async () => {
    const { patch, orders, history } = await setup();
    const cases: [string, unknown, string][] = [
      ['toStatus desconhecido', move('RECEIVED', 'EM_PREPARO'), 'INVALID_STATUS'],
      ['expectedStatus desconhecido', move('PENDENTE', 'IN_PREPARATION'), 'INVALID_STATUS'],
      ['minúsculas', move('received', 'in_preparation'), 'INVALID_STATUS'],
      ['toStatus numérico', move('RECEIVED', 1 as unknown as string), 'INVALID_STATUS'],
      ['sem expectedStatus', { toStatus: 'IN_PREPARATION' }, 'INVALID_INPUT'],
      ['sem toStatus', { expectedStatus: 'RECEIVED' }, 'INVALID_INPUT'],
      ['campo extra', move('RECEIVED', 'IN_PREPARATION', { status: 'READY' }), 'INVALID_INPUT'],
      ['campo extra de privilégio', move('RECEIVED', 'IN_PREPARATION', { changedByAdminId: 'x' }), 'INVALID_INPUT'],
      ['corpo array', [], 'INVALID_INPUT'],
      ['corpo texto', 'RECEIVED', 'INVALID_INPUT'],
      ['notes não texto', move('RECEIVED', 'CANCELLED', { notes: 5 }), 'INVALID_INPUT'],
      ['notes vazia', move('RECEIVED', 'CANCELLED', { notes: '   ' }), 'INVALID_INPUT'],
      ['notes longa', move('RECEIVED', 'CANCELLED', { notes: 'x'.repeat(ORDER_STATUS_NOTE_MAX + 1) }), 'INVALID_INPUT'],
      ['notes com controle', move('RECEIVED', 'CANCELLED', { notes: 'a\u0000b' }), 'INVALID_INPUT'],
    ];
    for (const [label, body, code] of cases) {
      const response = await patch(orderId(1), body);
      expect(response.status, label).toBe(400);
      expect(response.body.error.code, label).toBe(code);
    }
    expect(orders()[0]!.status).toBe('RECEIVED');
    expect(history()).toHaveLength(0);
  });

  it('transições proibidas: 422 INVALID_TRANSITION, sem alterar nada', async () => {
    const forbidden: [string, string][] = [
      ['RECEIVED', 'READY'], ['RECEIVED', 'DELIVERED'], ['RECEIVED', 'RECEIVED'], ['IN_PREPARATION', 'RECEIVED'],
      ['IN_PREPARATION', 'DELIVERED'], ['READY', 'CANCELLED'], ['READY', 'IN_PREPARATION'], ['DELIVERED', 'RECEIVED'],
      ['DELIVERED', 'CANCELLED'], ['CANCELLED', 'RECEIVED'], ['CANCELLED', 'IN_PREPARATION'],
    ];
    for (const [from, to] of forbidden) {
      const { patch, orders, history } = await setup([storedOrder(1, { status: from as StoredOrder['status'] })]);
      const response = await patch(orderId(1), move(from, to));
      expect(response.status, `${from}->${to}`).toBe(422);
      expect(response.body.error.code).toBe('INVALID_TRANSITION');
      expect(orders()[0]!.status).toBe(from);
      expect(history()).toHaveLength(0);
    }
  }, 60000);

  it('transições válidas: cadeia completa, histórico consistente com o administrador', async () => {
    const { patch, orders, history, admin } = await setup();
    const chain: [string, string][] = [['RECEIVED', 'IN_PREPARATION'], ['IN_PREPARATION', 'READY'], ['READY', 'DELIVERED']];
    for (const [from, to] of chain) {
      const response = await patch(orderId(1), move(from, to));
      expect(response.status, `${from}->${to}`).toBe(200);
      expect(response.body.data.order).toMatchObject({ id: orderId(1), status: to, allowedTransitions: nextOrderStatuses(to as 'READY') });
      expect(JSON.stringify(response.body)).not.toMatch(/99999-0000|requestDigest|Hash/);
    }
    expect(orders()[0]!.status).toBe('DELIVERED');
    expect(history().map((row) => [row.fromStatus, row.toStatus, row.changedByAdminId])).toEqual([
      ['RECEIVED', 'IN_PREPARATION', admin.id], ['IN_PREPARATION', 'READY', admin.id], ['READY', 'DELIVERED', admin.id],
    ]);
    const finalAttempt = await patch(orderId(1), move('DELIVERED', 'DELIVERED'));
    expect(finalAttempt.status).toBe(422);
    expect(history()).toHaveLength(3);
  });

  it('cancelamento com motivo grava o motivo no histórico; READY não cancela', async () => {
    const { patch, history } = await setup([storedOrder(1, { status: 'IN_PREPARATION' }), storedOrder(2, { status: 'READY' })]);
    const cancelled = await patch(orderId(1), move('IN_PREPARATION', 'CANCELLED', { notes: '  Cliente desistiu  ' }));
    expect(cancelled.status).toBe(200);
    expect(history()).toMatchObject([{ fromStatus: 'IN_PREPARATION', toStatus: 'CANCELLED', notes: 'Cliente desistiu' }]);
    expect((await patch(orderId(2), move('READY', 'CANCELLED'))).status).toBe(422);
  });

  it('expectedStatus divergente: 409 STATUS_CONFLICT, sem histórico e com orientação para atualizar', async () => {
    const { patch, history, orders } = await setup([storedOrder(1, { status: 'IN_PREPARATION' })]);
    const response = await patch(orderId(1), move('RECEIVED', 'IN_PREPARATION'));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STATUS_CONFLICT');
    expect(response.body.error.message).toMatch(/IN_PREPARATION/);
    expect(orders()[0]!.status).toBe('IN_PREPARATION');
    expect(history()).toHaveLength(0);
  });

  it('duplo clique / repetição: a segunda chamada igual recebe 409 e não duplica o histórico', async () => {
    const { patch, history } = await setup();
    expect((await patch(orderId(1), move('RECEIVED', 'IN_PREPARATION'))).status).toBe(200);
    const again = await patch(orderId(1), move('RECEIVED', 'IN_PREPARATION'));
    expect(again.status).toBe(409);
    expect(history()).toHaveLength(1);
  });

  it('duas atualizações concorrentes: exatamente uma vence, a outra recebe 409, um único histórico', async () => {
    const { patch, history, orders, control, transaction } = await setup();
    control.barrier = 2; // as duas transações leem o mesmo estado antes de qualquer commit
    const [a, b] = await Promise.all([
      patch(orderId(1), move('RECEIVED', 'IN_PREPARATION')),
      patch(orderId(1), move('RECEIVED', 'CANCELLED')),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('STATUS_CONFLICT');
    expect(history()).toHaveLength(1);
    expect(orders()[0]!.status).toBe(history()[0]!.toStatus);
    expect(transaction.mock.calls.length).toBeGreaterThanOrEqual(3); // a perdedora repetiu após o conflito de serialização
  });

  it('falha antes do commit: rollback total (status e histórico intactos) e 500 genérico', async () => {
    const { patch, history, orders, control } = await setup();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    control.failBeforeCommit = true;
    const response = await patch(orderId(1), move('RECEIVED', 'IN_PREPARATION'));
    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Erro interno no servidor.' });
    expect(JSON.stringify(response.body)).not.toMatch(/10\.0\.0\.5|commit/);
    expect(spy.mock.calls.flat().join(' ')).not.toMatch(/10\.0\.0\.5/);
    expect(orders()[0]!.status).toBe('RECEIVED');
    expect(history()).toHaveLength(0);
    spy.mockRestore();
  });

  it('admin desativado durante a operação: 401 e nada é gravado', async () => {
    const { patch, control, history, orders } = await setup();
    control.missingAdmin = true;
    expect((await patch(orderId(1), move('RECEIVED', 'IN_PREPARATION'))).status).toBe(401);
    expect(orders()[0]!.status).toBe('RECEIVED');
    expect(history()).toHaveLength(0);
  });

  it('a rota de status não aceita query string', async () => {
    const { app, cookie } = await setup();
    const response = await request(app).patch(`/api/admin/orders/${orderId(1)}/status?x=1`)
      .set('Origin', env.corsOrigin).set('X-Rustika-Request', '1').set('Cookie', cookie).send(move('RECEIVED', 'IN_PREPARATION'));
    expect(response.status).toBe(400);
  });
});

describe('sessões administrativas: ciclo de vida por instância da aplicação (regressão)', () => {
  const body = { expectedStatus: 'RECEIVED', toStatus: 'IN_PREPARATION' };

  it('login e requisições autenticadas na MESMA aplicação funcionam (listagem e PATCH)', async () => {
    const { list, patch, orders } = await setup();
    expect((await list()).status).toBe(200);
    expect((await patch(orderId(1), body)).status).toBe(200);
    expect(orders()[0]!.status).toBe('IN_PREPARATION');
  });

  it('sem cookie e com cookie inventado: 401, e o pedido não muda (PATCH e GET)', async () => {
    const { patch, app, orders } = await setup();
    expect((await patch(orderId(1), body, false)).status).toBe(401);
    const forged = await request(app).patch(`/api/admin/orders/${orderId(1)}/status`).set('Origin', env.corsOrigin)
      .set('X-Rustika-Request', '1').set('Cookie', 'rustika_admin=' + 'f'.repeat(64)).send(body);
    expect(forged.status).toBe(401);
    expect((await request(app).get('/api/admin/orders').set('Cookie', 'rustika_admin=' + 'f'.repeat(64))).status).toBe(401);
    expect(orders()[0]!.status).toBe('RECEIVED');
  });

  it('sem sessão e com sessão válida em pedido inexistente são condições distintas: 401 versus 404', async () => {
    const { patch } = await setup();
    const missing = orderId(99);
    expect((await patch(missing, body, false)).status).toBe(401);
    expect((await patch(missing, body)).status).toBe(404);
  });

  it('a sessão de uma instância NÃO vale em outra (sessões em memória por createApp; segurança inalterada)', async () => {
    const { cookie, prisma, now, orders } = await setup();
    const other = createApp({ prisma, authClock: now });
    expect((await request(other).get('/api/admin/orders').set('Cookie', cookie)).status).toBe(401);
    const response = await request(other).patch(`/api/admin/orders/${orderId(1)}/status`).set('Origin', env.corsOrigin)
      .set('X-Rustika-Request', '1').set('Cookie', cookie).send(body);
    expect(response.status).toBe(401);
    expect(orders()[0]!.status).toBe('RECEIVED');
  });

  it('requisições concorrentes na mesma aplicação, todas autenticadas, não recebem 401', async () => {
    const { patch, control } = await setup();
    control.barrier = 2;
    const results = await Promise.all([patch(orderId(1), body), patch(orderId(1), { ...body, toStatus: 'CANCELLED' })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('estrutura: privilégio mínimo e sem DELETE no código novo', () => {
  it('o serviço só usa as operações previstas pela concessão (findMany/findUnique/updateMany/create)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(path.join(__dirname, '../src/services/orderOperations.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\.(delete|deleteMany|upsert|update|createMany|\$executeRaw|\$queryRaw)\b/);
    expect(source).toMatch(/updateMany\(/);
    expect(source).toMatch(/data: \{ status: update\.toStatus \}/);
  });
});
