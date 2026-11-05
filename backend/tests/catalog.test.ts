import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { mockCatalogPrisma, productRecord } from './fixtures/catalog';

function setup() {
  const mock = mockCatalogPrisma();
  return { ...mock, app: createApp({ prisma: mock.prisma }) };
}

describe('API pública de catálogo', () => {
  it('GET /api/categories retorna o contrato público', async () => {
    const mock = setup();
    const response = await request(mock.app).get('/api/categories');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: [{ id: 'drinks', name: 'Drinks', description: '', displayOrder: 3 }] });
    expect(mock.connect).not.toHaveBeenCalled();
  });

  it.each(['/api/products', '/api/products/'])('%s retorna página com limite padrão', async (path) => {
    const mock = setup();
    const response = await request(mock.app).get(path);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { items: [{ id: 'rustika-100', priceInCents: 3000, isAvailable: null }], nextCursor: null } });
    expect(mock.productFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 31 }));
  });

  it('GET /api/products/:productId preserva ingredientes, descrição e imagem', async () => {
    const mock = setup();
    const response = await request(mock.app).get('/api/products/rustika-100');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: {
      id: 'rustika-100', categoryId: 'drinks', ingredients: 'Campari / gin / vermute / laranja.',
      description: 'Descrição confirmada.', imageUrl: '/images/negroni.jpg', imageAlt: 'Negroni',
    } });
    expect(response.body.data).not.toHaveProperty('price');
    expect(response.body.data).not.toHaveProperty('publicKey');
  });

  it.each(['UNKNOWN', 'AVAILABLE', 'UNAVAILABLE'])('aceita filtro %s, categoria e limite máximo', async (availability) => {
    const mock = setup();
    const response = await request(mock.app).get('/api/products').query({ categoryId: 'drinks', availability, limit: 50 });
    expect(response.status).toBe(200);
    expect(mock.productFindMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 51, where: expect.objectContaining({ availabilityState: availability, category: { is: { isActive: true, publicKey: 'drinks' } } }),
    }));
  });

  it('lista vazia ou categoria sem resultados retorna 200', async () => {
    const mock = setup();
    mock.productFindMany.mockResolvedValue([]);
    mock.categoryFindMany.mockResolvedValue([]);
    expect((await request(mock.app).get('/api/products?categoryId=sem-resultados')).body)
      .toEqual({ success: true, data: { items: [], nextCursor: null } });
    expect((await request(mock.app).get('/api/categories')).body).toEqual({ success: true, data: [] });
  });

  it('pagina resultados com o cursor retornado', async () => {
    const mock = setup();
    const second = productRecord({ publicKey: 'rustika-101', sourceCode: '101' });
    mock.productFindMany.mockResolvedValueOnce([productRecord(), second]).mockResolvedValueOnce([second]);
    const first = await request(mock.app).get('/api/products?limit=1');
    expect(first.body.data.nextCursor).toBe('rustika-100');
    const next = await request(mock.app).get('/api/products').query({ limit: 1, cursor: first.body.data.nextCursor });
    expect(next.status).toBe(200);
    expect(next.body.data.items.map((item: { id: string }) => item.id)).toEqual(['rustika-101']);
    expect(next.body.data.nextCursor).toBeNull();
  });

  it.each([
    '/api/products?limit=0', '/api/products?limit=51', '/api/products?limit=-1',
    '/api/products?limit=1.5', '/api/products?limit=1e1', '/api/products?limit=',
    '/api/products?limit=01', '/api/products?limit=1&limit=2', '/api/products?limit[value]=1',
    '/api/products?categoryId=', '/api/products?categoryId=DRINKS', '/api/products?categoryId=a%20b',
    '/api/products?categoryId[]=drinks', '/api/products?availability=true', '/api/products?availability=',
    '/api/products?cursor=', '/api/products?cursor=internal-uuid', '/api/products?includeInactive=true',
    '/api/products/uuid-interno', '/api/products/rustika-abc', '/api/products/rustika-100?limit=1',
    '/api/categories?isActive=false', '/api/products/%E0%A4%A',
    `/api/products?categoryId=${'a'.repeat(65)}`, `/api/products/rustika-${'1'.repeat(65)}`,
  ])('rejeita entrada inválida com 400 sem consultar Prisma: %s', async (path) => {
    const mock = setup();
    const response = await request(mock.app).get(path);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } });
    expect(mock.categoryFindMany).not.toHaveBeenCalled();
    expect(mock.productFindMany).not.toHaveBeenCalled();
    expect(mock.productFindFirst).not.toHaveBeenCalled();
  });

  it('produto inexistente ou não público retorna o mesmo 404', async () => {
    const mock = setup();
    mock.productFindFirst.mockResolvedValue(null);
    const response = await request(mock.app).get('/api/products/rustika-999');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, error: { code: 'PRODUCT_NOT_FOUND', message: 'Produto não encontrado.' } });
  });

  it('cursor fora dos filtros retorna 400', async () => {
    const mock = setup();
    mock.productFindFirst.mockResolvedValue(null);
    const response = await request(mock.app).get('/api/products?cursor=rustika-100&categoryId=porcoes');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CURSOR');
  });

  it.each(['/api/categories', '/api/products', '/api/products/rustika-100'])(
    'falhas do Prisma em %s não vazam detalhes na resposta ou logs', async (path) => {
      const mock = setup();
      const failure = new Error('postgresql://private:password@localhost/database SELECT secret');
      mock.categoryFindMany.mockRejectedValue(failure);
      mock.productFindMany.mockRejectedValue(failure);
      mock.productFindFirst.mockRejectedValue(failure);
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const response = await request(mock.app).get(path);
        expect(response.status).toBe(500);
        expect(response.body).toEqual({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Erro interno no servidor.' } });
        expect(JSON.stringify(log.mock.calls)).not.toMatch(/password|postgresql|SELECT secret/);
      } finally { log.mockRestore(); }
    },
  );

  it('createApp sem Prisma mantém health e retorna 503 no catálogo', async () => {
    const app = createApp();
    expect((await request(app).get('/api/health')).status).toBe(200);
    const response = await request(app).get('/api/products');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('CATALOG_UNAVAILABLE');
  });
});
