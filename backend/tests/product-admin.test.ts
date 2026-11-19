import request from 'supertest';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { ADMIN_PRODUCT_LIST_LIMIT, isManageable, parseAvailabilityUpdate, parseProductId } from '../src/services/productAvailability.service';
import { publicProductWhere } from '../src/services/catalog.service';
import { TEST_PASSWORD } from './fixtures/access';
import { mockProductPrisma, storedProduct } from './fixtures/productOps';
import type { StoredProduct } from './fixtures/productOps';

const cookieOf = (response: request.Response) => (response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
const ID = 'rustika-1001';

async function setup(initial: StoredProduct[] = [storedProduct('1001')]) {
  const mock = await mockProductPrisma(initial);
  const app = createApp({ prisma: mock.prisma, authClock: mock.now });
  const write = (method: 'post' | 'patch', path: string) =>
    request(app)[method](path).set('Origin', env.corsOrigin).set('X-Rustika-Request', '1').set('Content-Type', 'application/json');
  const login = await write('post', '/api/admin/auth/login').send({ email: mock.admin.email, password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  const cookie = cookieOf(login);
  const list = () => request(app).get('/api/admin/products').set('Cookie', cookie);
  const patch = (id: string, body: unknown, withCookie = true) => {
    const req = write('patch', `/api/admin/products/${id}/availability`);
    return (withCookie ? req.set('Cookie', cookie) : req).send(body as object);
  };
  return { ...mock, app, cookie, list, patch, write };
}
const move = (expectedState: string, toState: string, extra: object = {}) => ({ expectedState, toState, ...extra });

describe('validação de entrada (pura)', () => {
  it('aceita somente a chave pública rustika-<código>', () => {
    expect(parseProductId('rustika-1001')).toBe('rustika-1001');
    expect(parseProductId('rustika-AB12')).toBe('rustika-AB12');
    for (const bad of ['', '1001', 'rustika-', 'rustika-a b', 'rustika-../x', "rustika-1';DROP", 'RUSTIKA-1', 'rustika-' + '1'.repeat(65), undefined, 7, null]) {
      expect(() => parseProductId(bad), String(bad)).toThrow(/Identificador/);
    }
  });
  it('corpo estrito: exatamente expectedState e toState válidos', () => {
    expect(parseAvailabilityUpdate({ expectedState: 'UNKNOWN', toState: 'AVAILABLE' })).toEqual({ expectedState: 'UNKNOWN', toState: 'AVAILABLE' });
    for (const bad of [null, [], 'x', {}, { expectedState: 'UNKNOWN' }, { toState: 'AVAILABLE' }, { expectedState: 'x', toState: 'AVAILABLE' },
      { expectedState: 'UNKNOWN', toState: 7 }, { expectedState: 'UNKNOWN', toState: 'AVAILABLE', price: 1 }]) {
      expect(() => parseAvailabilityUpdate(bad), JSON.stringify(bad)).toThrow();
    }
  });
  it('isManageable espelha o predicado público', () => {
    const base = storedProduct('1') as unknown as Parameters<typeof isManageable>[0];
    expect(isManageable(base)).toBe(true);
    expect(isManageable({ ...base, isActive: false })).toBe(false);
    expect(isManageable({ ...base, publicKey: null })).toBe(false);
    expect(isManageable({ ...base, sourceCode: null })).toBe(false);
    expect(isManageable({ ...base, category: { ...base.category, isActive: false } })).toBe(false);
    expect(isManageable({ ...base, category: { ...base.category, publicKey: null } })).toBe(false);
  });
  it('o predicado de listagem é o mesmo do catálogo público', () => {
    const where = publicProductWhere();
    expect(where).toMatchObject({ isActive: true, publicKey: { not: null }, sourceCode: { not: null }, sourceName: { not: null }, sourceGroup: { not: null } });
  });
});

  vi.setConfig({ testTimeout: 10000 });

describe('GET /api/admin/products', () => {
  it('exige sessão administrativa; cookie inválido ou de comanda não dá acesso', async () => {
    const { app } = await setup();
    expect((await request(app).get('/api/admin/products')).status).toBe(401);
    expect((await request(app).get('/api/admin/products').set('Cookie', 'rustika_admin=' + 'f'.repeat(64))).status).toBe(401);
    expect((await request(app).get('/api/admin/products').set('Cookie', 'rustika_session=' + 'a'.repeat(64))).status).toBe(401);
  });

  it('admin: 200, no-store, campos mínimos, ordem determinística e só produtos publicáveis', async () => {
    const { list } = await setup([
      storedProduct('2002', { availabilityState: 'AVAILABLE' }),
      storedProduct('1001', { availabilityState: 'UNAVAILABLE' }),
      storedProduct('3003', { category: { publicKey: 'bebidas', name: 'Bebidas', displayOrder: 2, isActive: true } }),
      storedProduct('4004', { isActive: false }),
      storedProduct('5005', { publicKey: null }),
      storedProduct('6006', { category: { publicKey: 'insumo', name: 'Insumo', displayOrder: 3, isActive: false } }),
      storedProduct('7007', { sourceCode: null }),
    ]);
    const response = await list();
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { products, truncated } = response.body.data;
    expect(truncated).toBe(false);
    expect(products.map((p: { id: string }) => p.id)).toEqual(['rustika-1001', 'rustika-2002', 'rustika-3003']);
    expect(products[0]).toEqual({
      id: 'rustika-1001', sourceCode: '1001', name: 'Produto 1001', categoryId: 'frios', categoryName: 'Frios',
      priceInCents: 2990, availabilityState: 'UNAVAILABLE', updatedAt: '2026-11-05T12:00:00.000Z',
      description: 'Descrição', ingredients: 'Ingredientes', imageUrl: '/produto.jpg', imageAlt: 'Produto',
    });
  });

  it('expõe somente os campos editáveis do RF006 e não vaza campos internos', async () => {
    const { list } = await setup();
    const text = JSON.stringify((await list()).body);
    expect(text).toMatch(/description|ingredients|imageUrl|imageAlt/);
    expect(text).not.toMatch(/isAvailable|descriptionSource|stock|sourceName|sourceGroup|isActive|"price"/);
  });

  it('limite seguro e truncamento', async () => {
    const many = Array.from({ length: ADMIN_PRODUCT_LIST_LIMIT + 3 }, (_, i) => storedProduct(String(10000 + i)));
    const { list, findMany } = await setup(many);
    const response = await list();
    expect(response.body.data.products).toHaveLength(ADMIN_PRODUCT_LIST_LIMIT);
    expect(response.body.data.truncated).toBe(true);
    expect(findMany.mock.calls[0]![0].take).toBe(ADMIN_PRODUCT_LIST_LIMIT + 1);
  });

  it('lista vazia e recusa de parâmetros de consulta', async () => {
    const { list, app, cookie } = await setup([]);
    expect((await list()).body.data).toEqual({ truncated: false, products: [] });
    const q = await request(app).get('/api/admin/products?search=x').set('Cookie', cookie);
    expect(q.status).toBe(400);
    expect(q.body.error.code).toBe('INVALID_INPUT');
  });

  it('erro de banco vira 500 genérico', async () => {
    const { list, control } = await setup();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    control.listError = true;
    const response = await list();
    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Erro interno no servidor.' });
    expect(JSON.stringify(response.body)).not.toMatch(/10\.0\.0\.5|relation|driver/);
    spy.mockRestore();
  });
});

describe('PATCH /api/admin/products/:productId/availability', () => {
  it('sem sessão: 401 mesmo com id inválido, e nada muda', async () => {
    const { patch, products } = await setup();
    expect((await patch(ID, move('UNKNOWN', 'AVAILABLE'), false)).status).toBe(401);
    expect((await patch('lixo', move('UNKNOWN', 'AVAILABLE'), false)).status).toBe(401);
    expect(products()[0]!.availabilityState).toBe('UNKNOWN');
  });

  it('proteção de escrita: Origin e cabeçalho obrigatórios, corpo JSON', async () => {
    const { app, cookie } = await setup();
    const base = () => request(app).patch(`/api/admin/products/${ID}/availability`).set('Cookie', cookie);
    expect((await base().set('X-Rustika-Request', '1').set('Content-Type', 'application/json').send(move('UNKNOWN', 'AVAILABLE'))).status).toBe(403);
    expect((await base().set('Origin', 'https://evil.example').set('X-Rustika-Request', '1').set('Content-Type', 'application/json').send(move('UNKNOWN', 'AVAILABLE'))).status).toBe(403);
    expect((await base().set('Origin', env.corsOrigin).set('Content-Type', 'application/json').send(move('UNKNOWN', 'AVAILABLE'))).status).toBe(403);
  });

  it('id inválido: 400; produto inexistente: 404', async () => {
    const { patch } = await setup();
    expect((await patch('rustika-..%2Fx', move('UNKNOWN', 'AVAILABLE'))).status).toBe(400);
    expect((await patch('abc', move('UNKNOWN', 'AVAILABLE'))).body.error.code).toBe('INVALID_PRODUCT_ID');
    const missing = await patch('rustika-9999', move('UNKNOWN', 'AVAILABLE'));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('corpo inválido: estado desconhecido, campos ausentes e campos extras (preço, isActive, categoria...) são 400', async () => {
    const { patch, products } = await setup();
    for (const body of [{}, { expectedState: 'UNKNOWN' }, move('X', 'AVAILABLE'), move('UNKNOWN', 'Y'), move('UNKNOWN', 'AVAILABLE', { price: 0 }),
      move('UNKNOWN', 'AVAILABLE', { isActive: false }), move('UNKNOWN', 'AVAILABLE', { categoryId: 'x' }), move('UNKNOWN', 'AVAILABLE', { publicKey: 'x' }), []]) {
      const response = await patch(ID, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(products()[0]!.availabilityState).toBe('UNKNOWN');
  });

  it('UNKNOWN → AVAILABLE só por ação explícita; grava SOMENTE availabilityState e preserva todo o resto', async () => {
    const { patch, products, writes } = await setup();
    const before = products()[0]!;
    const response = await patch(ID, move('UNKNOWN', 'AVAILABLE'));
    expect(response.status).toBe(200);
    expect(response.body.data.product).toMatchObject({ id: ID, availabilityState: 'AVAILABLE', priceInCents: 2990 });
    const after = products()[0]!;
    const { availabilityState: _a, updatedAt: _u, ...restAfter } = after;
    const { availabilityState: _b, updatedAt: _v, ...restBefore } = before;
    expect(restAfter).toEqual(restBefore);
    expect(after.price.equals(new Prisma.Decimal('29.90'))).toBe(true);
    expect(writes()).toEqual([['availabilityState']]);
  });

  it('AVAILABLE → UNAVAILABLE e UNAVAILABLE → AVAILABLE', async () => {
    const { patch, products } = await setup([storedProduct('1001', { availabilityState: 'AVAILABLE' })]);
    expect((await patch(ID, move('AVAILABLE', 'UNAVAILABLE'))).body.data.product.availabilityState).toBe('UNAVAILABLE');
    expect(products()[0]!.availabilityState).toBe('UNAVAILABLE');
    expect((await patch(ID, move('UNAVAILABLE', 'AVAILABLE'))).body.data.product.availabilityState).toBe('AVAILABLE');
  });

  it('UNKNOWN nunca é alvo; transição para o mesmo estado é 422', async () => {
    const { patch, products } = await setup([storedProduct('1001', { availabilityState: 'AVAILABLE' })]);
    const toUnknown = await patch(ID, move('AVAILABLE', 'UNKNOWN'));
    expect(toUnknown.status).toBe(422);
    expect(toUnknown.body.error.code).toBe('INVALID_TRANSITION');
    expect((await patch(ID, move('AVAILABLE', 'AVAILABLE'))).status).toBe(422);
    expect(products()[0]!.availabilityState).toBe('AVAILABLE');
  });

  it('expectedState divergente do atual: 409 sem alterar', async () => {
    const { patch, products } = await setup([storedProduct('1001', { availabilityState: 'UNAVAILABLE' })]);
    const response = await patch(ID, move('AVAILABLE', 'UNAVAILABLE'));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('AVAILABILITY_CONFLICT');
    expect(products()[0]!.availabilityState).toBe('UNAVAILABLE');
  });

  it.each<[string, Partial<StoredProduct>]>([
    ['produto inativo', { isActive: false }],
    ['categoria inativa', { category: { publicKey: 'x', name: 'X', displayOrder: 9, isActive: false } }],
    ['insumo interno (sem publicKey)', { publicKey: 'rustika-INT1', sourceCode: 'INT1', sourceName: 'INSUMO', sourceGroup: 'INSUMOS', category: { publicKey: null, name: 'Insumos', displayOrder: 9, isActive: true } }],
    ['sem código de origem', { sourceCode: null }],
    ['sem nome de origem', { sourceName: null }],
    ['sem grupo de origem', { sourceGroup: null }],
  ])('%s não é gerenciável: 422 e nada muda', async (_label, overrides) => {
    const product = storedProduct('1001', overrides);
    const { patch, products } = await setup([product]);
    const response = await patch(product.publicKey ?? ID, move('UNKNOWN', 'AVAILABLE'));
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PRODUCT_NOT_MANAGEABLE');
    expect(products()[0]!.availabilityState).toBe('UNKNOWN');
  });

  it('duas atualizações concorrentes do mesmo estado: uma vence (200), a outra recebe 409', async () => {
    const { patch, products, control, writes } = await setup();
    control.barrier = 2;
    const [a, b] = await Promise.all([patch(ID, move('UNKNOWN', 'AVAILABLE')), patch(ID, move('UNKNOWN', 'UNAVAILABLE'))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(products()[0]!.availabilityState).toBe(a.status === 200 ? 'AVAILABLE' : 'UNAVAILABLE');
    expect(writes()).toHaveLength(1);
  });

  it('oito requisições idênticas simultâneas: exatamente uma conclui', async () => {
    const { patch, control, products } = await setup();
    control.barrier = 8;
    const results = await Promise.all(Array.from({ length: 8 }, () => patch(ID, move('UNKNOWN', 'AVAILABLE'))));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(products()[0]!.availabilityState).toBe('AVAILABLE');
  });

  it('conflito de serialização persistente vira 409 genérico', async () => {
    const { patch, control, products } = await setup();
    control.serializationFailures = 99;
    const response = await patch(ID, move('UNKNOWN', 'AVAILABLE'));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PRODUCT_CONFLICT');
    expect(products()[0]!.availabilityState).toBe('UNKNOWN');
  });

  it('falha antes do commit desfaz tudo e responde 500 genérico', async () => {
    const { patch, control, products } = await setup();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    control.failBeforeCommit = true;
    const response = await patch(ID, move('UNKNOWN', 'AVAILABLE'));
    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Erro interno no servidor.' });
    expect(JSON.stringify(response.body)).not.toMatch(/10\.0\.0\.5|commit/);
    expect(products()[0]!.availabilityState).toBe('UNKNOWN');
    spy.mockRestore();
  });

  it('admin desativado depois do login perde o acesso (401)', async () => {
    const { patch, control, products } = await setup();
    control.missingAdmin = true;
    expect((await patch(ID, move('UNKNOWN', 'AVAILABLE'))).status).toBe(401);
    expect(products()[0]!.availabilityState).toBe('UNKNOWN');
  });

  it('o novo estado aparece na listagem seguinte (refresh sem recarregar a página)', async () => {
    const { patch, list } = await setup();
    await patch(ID, move('UNKNOWN', 'AVAILABLE'));
    expect((await list()).body.data.products[0].availabilityState).toBe('AVAILABLE');
  });
});
