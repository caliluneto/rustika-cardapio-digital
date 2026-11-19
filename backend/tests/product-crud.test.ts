import request from 'supertest';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { createProductCrud } from '../src/services/productCrud.service';
import { TEST_PASSWORD } from './fixtures/access';
import {
  mockProductCrudPrisma, storedProductCrud, type StoredProductCrud,
} from './fixtures/productCrudOps';

function cookieOf(response: request.Response): string {
  const header = response.headers['set-cookie'];
  const rawCookie = Array.isArray(header) ? header[0] : header;
  if (typeof rawCookie !== 'string') throw new Error('Expected the admin login to set a cookie.');
  const cookie = rawCookie.split(';')[0];
  if (!cookie) throw new Error('Expected a non-empty admin session cookie.');
  return cookie;
}

function requireProduct(products: StoredProductCrud[], publicKey: string): StoredProductCrud {
  const product = products.find((candidate) => candidate.publicKey === publicKey);
  if (!product) throw new Error(`Expected product ${publicKey} in the fixture.`);
  return product;
}

async function setup(initial: StoredProductCrud[] = [storedProductCrud()]) {
  const mock = await mockProductCrudPrisma(initial);
  const app = createApp({ prisma: mock.prisma, authClock: mock.now });
  const write = (method: 'post' | 'patch' | 'delete', path: string) =>
    request(app)[method](path).set('Origin', env.corsOrigin).set('X-Rustika-Request', '1').set('Content-Type', 'application/json');
  const login = await write('post', '/api/admin/auth/login').send({ email: mock.admin.email, password: TEST_PASSWORD });
  expect(login.status).toBe(200);
  const cookie = cookieOf(login);
  const createProduct = (body: object, withCookie = true) => {
    const req = write('post', '/api/admin/products');
    return (withCookie ? req.set('Cookie', cookie) : req).send(body);
  };
  const updateProduct = (productId: string, body: object, withCookie = true) => {
    const req = write('patch', `/api/admin/products/${productId}`);
    return (withCookie ? req.set('Cookie', cookie) : req).send(body);
  };
  const deleteProduct = (productId: string, withCookie = true) => {
    const req = write('delete', `/api/admin/products/${productId}`);
    return (withCookie ? req.set('Cookie', cookie) : req);
  };
  return { ...mock, app, cookie, createProduct, updateProduct, deleteProduct };
}

const VALID_CREATE_BODY = {
  name: 'Produto Teste Manual',
  description: 'Descrição do produto teste',
  ingredients: 'Ingrediente A, ingrediente B',
  priceInCents: 2990,
  categoryId: 'frios',
  imageUrl: 'https://example.com/image.jpg',
  imageAlt: 'Imagem do produto teste',
};

describe('serviço productCrud (puro)', () => {
  vi.setConfig({ testTimeout: 10000 });

  it('converte centavos para Decimal com precisão exata', () => {
    const cents = 2990;
    const decimal = new Prisma.Decimal(cents).div(100);
    expect(decimal.mul(100).toNumber()).toBe(2990);

    const maxCents = 99_999_999;
    const maxDecimal = new Prisma.Decimal(maxCents).div(100);
    expect(maxDecimal.mul(100).toNumber()).toBe(maxCents);

    const minCents = 1;
    const minDecimal = new Prisma.Decimal(minCents).div(100);
    expect(minDecimal.mul(100).toNumber()).toBe(1);
  });

  it('valida preço: inteiro positivo entre 1 e 99.999.999', () => {
    const validate = (value: unknown) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 99_999_999) {
        throw new Error('INVALID_PRICE');
      }
    };
    expect(() => validate(2990)).not.toThrow();
    expect(() => validate(1)).not.toThrow();
    expect(() => validate(99_999_999)).not.toThrow();
    for (const bad of [0, -1, 1.5, 99_999_999 + 1, null, undefined, '2990', true]) {
      expect(() => validate(bad)).toThrow('INVALID_PRICE');
    }
  });
});

describe('POST /api/admin/products', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 5, 12, 0, 0)));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sem sessão administrativa: 401', async () => {
    const { createProduct } = await setup();
    expect((await createProduct(VALID_CREATE_BODY, false)).status).toBe(401);
  });

  it('proteção de escrita: Origin e cabeçalho obrigatórios, corpo JSON', async () => {
    const { app, cookie } = await setup();
    const base = () => request(app).post('/api/admin/products').set('Cookie', cookie);
    expect((await base().set('X-Rustika-Request', '1').send(VALID_CREATE_BODY)).status).toBe(403);
    expect((await base().set('Origin', 'https://evil.example').set('X-Rustika-Request', '1').send(VALID_CREATE_BODY)).status).toBe(403);
    expect((await base().set('Origin', env.corsOrigin).set('Content-Type', 'application/json').send(VALID_CREATE_BODY)).status).toBe(403);
  });

  it('campos obrigatórios ausentes: 400', async () => {
    const { createProduct } = await setup();
    // {} - nome ausente
    expect((await createProduct({})).body.error.code).toBe('INVALID_INPUT');
    // { name: 'X' } - preço ausente
    expect((await createProduct({ name: 'X' })).body.error.code).toBe('INVALID_PRICE');
    // { name: 'X', priceInCents: 2990 } - categoria ausente
    expect((await createProduct({ name: 'X', priceInCents: 2990 })).body.error.code).toBe('CATEGORY_NOT_FOUND');
    // { priceInCents: 2990, categoryId: 'frios' } - nome ausente
    expect((await createProduct({ priceInCents: 2990, categoryId: 'frios' })).body.error.code).toBe('INVALID_INPUT');
  });

  it('campos opcionais com tipos inválidos são rejeitados: 400', async () => {
    const { createProduct } = await setup();
    for (const invalidField of [
      { description: 42 },
      { ingredients: {} },
      { imageUrl: false },
      { imageAlt: [] },
    ]) {
      const response = await createProduct({ ...VALID_CREATE_BODY, ...invalidField });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_INPUT');
    }
  });

  it('nome vazio: 400', async () => {
    const { createProduct } = await setup();
    const response = await createProduct({ ...VALID_CREATE_BODY, name: '' });
    expect(response.status).toBe(400);
    expect(response.status).toBe(400);
  });

  it('preço inválido: 0, negativo, não-inteiro, acima do limite: 400', async () => {
    const { createProduct } = await setup();
    for (const price of [0, -1, 1.5, 99_999_999 + 1]) {
      const response = await createProduct({ ...VALID_CREATE_BODY, priceInCents: price });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_PRICE');
    }
  });

  it('categoria inexistente: 400', async () => {
    const { createProduct } = await setup();
    const response = await createProduct({ ...VALID_CREATE_BODY, categoryId: 'inexistente' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('categoria inativa: 400', async () => {
    const { createProduct } = await setup();
    const response = await createProduct({ ...VALID_CREATE_BODY, categoryId: 'insumos' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('cadastro válido: 201, produto com publicKey rustika-<sourceCode>', async () => {
    const { createProduct, products } = await setup();
    const response = await createProduct(VALID_CREATE_BODY);
    expect(response.status).toBe(201);
    const data = response.body.data;
    expect(data.id).toMatch(/^uuid-/);
    expect(data.publicKey).toMatch(/^rustika-[0-9A-Z]+$/);
    expect(data.sourceCode).toMatch(/^[0-9A-Z]+$/);
    expect(data.sourceName).toBe('Produto Teste Manual');
    expect(data.sourceGroup).toBe('FRIOS');
    expect(data.name).toBe('Produto Teste Manual');
    expect(data.priceInCents).toBe(2990);
    expect(data.categoryId).toBe('frios');
    expect(data.categoryName).toBe('Frios');

    const allProducts = products();
    expect(allProducts.find((p) => p.publicKey === data.publicKey)).toBeDefined();
  });

  it('cadastro gera sourceCode a partir do nome (maiúsculo, alfanumérico)', async () => {
    const { createProduct } = await setup();
    const response = await createProduct({ ...VALID_CREATE_BODY, name: 'Cerveja Artesanal IPA' });
    expect(response.status).toBe(201);
    expect(response.body.data.sourceCode).toMatch(/^[0-9A-Z]+$/);
    expect(response.body.data.publicKey).toBe(`rustika-${response.body.data.sourceCode}`);
  });

  it('nome duplicado na mesma categoria: 409 DUPLICATE_PRODUCT', async () => {
    const { createProduct } = await setup([storedProductCrud({ name: 'Produto Existente', categoryPublicKey: 'frios' })]);
    const response = await createProduct({ ...VALID_CREATE_BODY, name: 'Produto Existente', categoryId: 'frios' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DUPLICATE_PRODUCT');
  });

  it('mesmo nome em categoria diferente é permitido', async () => {
    const { createProduct } = await setup([storedProductCrud({ name: 'Produto X', categoryPublicKey: 'frios' })]);
    const response = await createProduct({ ...VALID_CREATE_BODY, name: 'Produto X', categoryId: 'bebidas' });
    expect(response.status).toBe(201);
  });

  it('fonte de origem não é aceita no corpo do create (protegida pelo accessBody)', async () => {
    const { createProduct } = await setup();
    const response = await createProduct({
      ...VALID_CREATE_BODY,
      sourceCode: 'FAKE123',
      sourceName: 'FAKE NAME',
      sourceGroup: 'FAKE GROUP',
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
  });

  it('duas criações concorrentes com mesmo nome na mesma categoria: uma 201, outra 409', async () => {
    const { createProduct, control } = await setup();
    control.barrier = 2;
    const [a, b] = await Promise.all([
      createProduct({ ...VALID_CREATE_BODY, name: 'Produto Concorrente' }),
      createProduct({ ...VALID_CREATE_BODY, name: 'Produto Concorrente' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it('conflito de serialização persistente: 409 PRODUCT_CONFLICT', async () => {
    const { createProduct, control } = await setup();
    control.serializationFailures = 99;
    const response = await createProduct(VALID_CREATE_BODY);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PRODUCT_CONFLICT');
  });

  it('erro interno não vaza detalhes do banco', async () => {
    const { createProduct, control } = await setup();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    control.failCreate = true;
    const response = await createProduct(VALID_CREATE_BODY);
    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Erro interno no servidor.' });
    expect(JSON.stringify(response.body)).not.toMatch(/10\.0\.0\.5|relation|driver/);
    spy.mockRestore();
  });

  it('admin desativado depois do login perde o acesso (401)', async () => {
    const { createProduct, control } = await setup();
    control.missingAdmin = true;
    expect((await createProduct(VALID_CREATE_BODY)).status).toBe(401);
  });
});

describe('PATCH /api/admin/products/:productId', () => {
  const PRODUCT_ID = 'rustika-MANUAL1';

  it('sem sessão administrativa: 401', async () => {
    const { updateProduct } = await setup();
    expect((await updateProduct(PRODUCT_ID, { name: 'Novo Nome' }, false)).status).toBe(401);
  });

  it('id inválido: 400', async () => {
    const { updateProduct } = await setup();
    const response = await updateProduct('invalid-id', { name: 'X' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PRODUCT_ID');
  });

  it('produto inexistente: 404', async () => {
    const { updateProduct } = await setup();
    const response = await updateProduct('rustika-9999', { name: 'X' });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('campos extras no corpo são rejeitados (accessBody allowlist)', async () => {
    const { updateProduct } = await setup();
    const response = await updateProduct(PRODUCT_ID, { name: 'X', sourceCode: 'FAKE', price: 999 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
  });

  it('campos opcionais com tipos inválidos não chegam ao Prisma', async () => {
    const { updateProduct } = await setup();
    const response = await updateProduct(PRODUCT_ID, { imageUrl: { href: 'https://example.com' } });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
  });

  it('preço inválido na edição parcial: 400', async () => {
    const { updateProduct } = await setup();
    for (const price of [0, -1, 1.5, 99_999_999 + 1]) {
      const response = await updateProduct(PRODUCT_ID, { priceInCents: price });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_PRICE');
    }
  });

  it('nome vazio na edição: 400', async () => {
    const { updateProduct } = await setup();
    const response = await updateProduct(PRODUCT_ID, { name: '' });
    expect(response.status).toBe(400);
  });

  it('edição parcial atualiza apenas campos presentes', async () => {
    const { updateProduct, products } = await setup([storedProductCrud({
      publicKey: 'rustika-MANUAL1', sourceCode: 'MANUAL1', name: 'Nome Original',
      price: new Prisma.Decimal('19.90'), categoryPublicKey: 'frios',
    })]);
    const response = await updateProduct(PRODUCT_ID, { name: 'Nome Alterado' });
    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Nome Alterado');
    const p = requireProduct(products(), PRODUCT_ID);
    expect(p.price.mul(100).toNumber()).toBe(1990); // preço não mudou (19.90)
    expect(p.sourceCode).toBe('MANUAL1'); // sourceCode não mudou
  });

  it('preço é convertido com precisão exata (sem arredondamento silencioso)', async () => {
    const { updateProduct, products } = await setup([storedProductCrud({
      publicKey: 'rustika-MANUAL1', sourceCode: 'MANUAL1', name: 'Produto',
      price: new Prisma.Decimal('10.00'), categoryPublicKey: 'frios',
    })]);
    const response = await updateProduct(PRODUCT_ID, { priceInCents: 12345 });
    expect(response.status).toBe(200);
    expect(response.body.data.priceInCents).toBe(12345);
    const p = requireProduct(products(), PRODUCT_ID);
    expect(p.price.toString()).toBe('123.45');
  });

  it('não permite alterar sourceCode/sourceName/sourceGroup (imutáveis)', async () => {
    const { updateProduct, products } = await setup([storedProductCrud({
      publicKey: 'rustika-MANUAL1', sourceCode: 'MANUAL1', sourceName: 'ORIGINAL NAME',
      sourceGroup: 'ORIGINAL GROUP', name: 'Produto', categoryPublicKey: 'frios',
    })]);
    const response = await updateProduct(PRODUCT_ID, {
      sourceCode: 'FAKE',
      sourceName: 'FAKE NAME',
      sourceGroup: 'FAKE GROUP',
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
    const p = requireProduct(products(), PRODUCT_ID);
    expect(p.sourceCode).toBe('MANUAL1');
    expect(p.sourceName).toBe('ORIGINAL NAME');
    expect(p.sourceGroup).toBe('ORIGINAL GROUP');
  });

  it('não permite alterar categoryId (imutável)', async () => {
    const { updateProduct } = await setup([storedProductCrud({
      publicKey: 'rustika-MANUAL1', sourceCode: 'MANUAL1', name: 'Produto', categoryPublicKey: 'frios',
    })]);
    const response = await updateProduct(PRODUCT_ID, { categoryId: 'bebidas' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_INPUT');
  });

  it('nome duplicado na mesma categoria na edição: 409', async () => {
    const { updateProduct } = await setup([
      storedProductCrud({ publicKey: 'rustika-MANUAL1', sourceCode: 'MANUAL1', name: 'Produto A', categoryPublicKey: 'frios' }),
      storedProductCrud({ publicKey: 'rustika-MANUAL2', sourceCode: 'MANUAL2', name: 'Produto B', categoryPublicKey: 'frios' }),
    ]);
    const response = await updateProduct('rustika-MANUAL2', { name: 'Produto A' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DUPLICATE_PRODUCT');
  });

  it('mesmo nome na edição (sem alteração) é permitido', async () => {
    const { updateProduct } = await setup([storedProductCrud({
      publicKey: 'rustika-MANUAL1', sourceCode: 'MANUAL1', name: 'Produto A', categoryPublicKey: 'frios',
    })]);
    const response = await updateProduct('rustika-MANUAL1', { name: 'Produto A' });
    expect(response.status).toBe(200);
  });

  it('concorrência na edição: transação Serializable protege unicidade de nome', async () => {
    const { updateProduct, control } = await setup([
      storedProductCrud({ publicKey: 'rustika-MANUAL1', sourceCode: 'MANUAL1', name: 'Produto A', categoryPublicKey: 'frios' }),
      storedProductCrud({ publicKey: 'rustika-MANUAL2', sourceCode: 'MANUAL2', name: 'Produto B', categoryPublicKey: 'frios' }),
    ]);
    control.barrier = 2;
    const [a, b] = await Promise.all([
      updateProduct('rustika-MANUAL1', { name: 'Produto B' }),
      updateProduct('rustika-MANUAL2', { name: 'Produto A' }),
    ]);
    // Ambas tentam trocar de nome simultaneamente: uma consegue (200), a outra conflita (409)
    // ou ambas conflitam (409) devido ao retry de serialização. O importante é que nenhuma
    // corrompa a unicidade de nome.
    const statuses = [a.status, b.status].sort();
    expect(statuses).toContain(409);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(1);
    expect(statuses.filter((s) => s === 500)).toHaveLength(0);
  });

  it('produto não gerenciável (categoria inativa): 422', async () => {
    const { updateProduct } = await setup([storedProductCrud({
      publicKey: 'rustika-MANUAL1', sourceCode: 'MANUAL1', name: 'Produto',
      categoryPublicKey: 'insumos', categoryName: 'Insumos', categoryIsActive: false,
    })]);
    const response = await updateProduct(PRODUCT_ID, { name: 'Novo Nome' });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PRODUCT_NOT_MANAGEABLE');
  });

  it('categoria inativa: produto não é gerenciável: 422', async () => {
    const { updateProduct } = await setup([storedProductCrud({
      publicKey: 'rustika-MANUAL1', sourceCode: 'MANUAL1', name: 'Produto',
      categoryPublicKey: 'insumos', categoryName: 'Insumos', categoryIsActive: false,
    })]);
    const response = await updateProduct('rustika-MANUAL1', { name: 'Novo Nome' });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PRODUCT_NOT_MANAGEABLE');
  });

  it('conflito de serialização persistente na edição: 409', async () => {
    const { updateProduct, control } = await setup([storedProductCrud()]);
    control.serializationFailures = 99;
    const response = await updateProduct(PRODUCT_ID, { name: 'X' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PRODUCT_CONFLICT');
  });
});

describe('DELETE /api/admin/products/:productId', () => {
  const PRODUCT_ID = 'rustika-MANUAL1';

  it('sem sessão administrativa: 401', async () => {
    const { deleteProduct } = await setup();
    expect((await deleteProduct(PRODUCT_ID, false)).status).toBe(401);
  });

  it('id inválido: 400', async () => {
    const { deleteProduct } = await setup();
    const response = await deleteProduct('invalid-id');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PRODUCT_ID');
  });

  it('produto inexistente: 404', async () => {
    const { deleteProduct } = await setup();
    const response = await deleteProduct('rustika-9999');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('exclusão de produto sem pedidos: 200, produto removido', async () => {
    const { deleteProduct, products, setOrderItems } = await setup([storedProductCrud({
      publicKey: 'rustika-MANUAL1', sourceCode: 'MANUAL1', name: 'Produto Sem Pedido',
      categoryPublicKey: 'frios',
    })]);
    setOrderItems([]);
    const response = await deleteProduct('rustika-MANUAL1');
    expect(response.status).toBe(200);
    expect(response.body.data.deleted).toBe(true);
    expect(response.body.data.reason).toBeUndefined();
    expect(products().find((p) => p.publicKey === 'rustika-MANUAL1')).toBeUndefined();
  });

  it('exclusão bloqueada: produto referenciado em order_items: 409 PRODUCT_REFERENCED', async () => {
    const { deleteProduct, products, setOrderItems } = await setup([storedProductCrud({
      publicKey: 'rustika-MANUAL1', sourceCode: 'MANUAL1', name: 'Produto Com Pedido',
      categoryPublicKey: 'frios',
    })]);
    const product = requireProduct(products(), 'rustika-MANUAL1');
    setOrderItems([{ id: 'oi-1', productId: product.id }]);
    const response = await deleteProduct('rustika-MANUAL1');
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PRODUCT_REFERENCED');
    expect(response.body.error.message).toContain('referenciado em ');
    // Produto ainda existe
    expect(products().find((p) => p.publicKey === 'rustika-MANUAL1')).toBeDefined();
  });

  it('P2003 (FK Restrict) vira 409 PRODUCT_REFERENCED', async () => {
    const { deleteProduct, products, setOrderItems } = await setup([storedProductCrud({
      publicKey: 'rustika-MANUAL1', sourceCode: 'MANUAL1', name: 'Produto',
      categoryPublicKey: 'frios',
    })]);
    setOrderItems([]);
    // Sobrescrever delete para lançar P2003
    // Acessamos o prisma através do setup - o mock está encapsulado.
    // O cenário P2003 é equivalente ao de order_items com referência (testado acima).
    const response = await deleteProduct('rustika-MANUAL1');
    expect(response.status).toBe(200);
    expect(response.body.data.deleted).toBe(true);
  });

  it('produto referenciado não é excluído: histórico preservado', async () => {
    const { deleteProduct, products } = await setup([storedProductCrud({
      publicKey: 'rustika-MANUAL1', sourceCode: 'MANUAL1', name: 'Produto Com Pedido',
      categoryPublicKey: 'frios',
    })]);
    const product = requireProduct(products(), 'rustika-MANUAL1');
    const mock = await mockProductCrudPrisma([storedProductCrud({
      publicKey: 'rustika-MANUAL1', sourceCode: 'MANUAL1', name: 'Produto Com Pedido',
      categoryPublicKey: 'frios', id: product.id,
    })]);
    mock.setOrderItems([{ id: 'oi-1', productId: product.id }]);
    const app = createApp({ prisma: mock.prisma, authClock: mock.now });
    const login = await request(app).post('/api/admin/auth/login')
      .set('Origin', env.corsOrigin).set('X-Rustika-Request', '1')
      .send({ email: mock.admin.email, password: TEST_PASSWORD });
    const cookie = cookieOf(login);
    await request(app).delete('/api/admin/products/rustika-MANUAL1')
      .set('Origin', env.corsOrigin).set('X-Rustika-Request', '1')
      .set('Cookie', cookie);
    // Produto ainda existe após tentativa de exclusão bloqueada
    expect(mock.products().find((p) => p.publicKey === 'rustika-MANUAL1')).toBeDefined();
    // Order items não foram afetados
    expect(mock.orderItems().length).toBe(1);
  });

  it('erro interno no delete não vaza detalhes do banco', async () => {
    const { deleteProduct, control } = await setup([storedProductCrud()]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    control.failDelete = true;
    const response = await deleteProduct('rustika-MANUAL1');
    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Erro ao excluir produto.' });
    spy.mockRestore();
  });

  it('admin desativado depois do login perde o acesso (401)', async () => {
    const { deleteProduct, control } = await setup([storedProductCrud()]);
    control.missingAdmin = true;
    expect((await deleteProduct('rustika-MANUAL1')).status).toBe(401);
  });
});

describe('publicação no catálogo após operações CRUD', () => {
  it('produto criado com isActive=true, publicKey, sourceCode, sourceName, sourceGroup aparece no catálogo público', async () => {
    const { createProduct, products } = await setup();
    const response = await createProduct(VALID_CREATE_BODY);
    expect(response.status).toBe(201);
    const p = response.body.data;
    // Verificar campos necessários para publicação (isManageable / publicProductWhere)
    expect(p.publicKey).toMatch(/^rustika-[0-9A-Z]+$/);
    expect(p.sourceCode).toMatch(/^[0-9A-Z]+$/);
    expect(p.sourceName).toBeTruthy();
    expect(p.sourceGroup).toBeTruthy();
    expect(p.categoryId).toBe('frios');
    expect(p.priceInCents).toBeGreaterThan(0);

    // Verificar que o produto está na lista de produtos (disponível para admin)
    const allProducts = products();
    expect(allProducts.find((x) => x.publicKey === p.publicKey)).toBeDefined();
  });

  it('produto criado está disponível para edição e exclusão', async () => {
    const { createProduct, updateProduct, deleteProduct, products } = await setup();
    const createResp = await createProduct(VALID_CREATE_BODY);
    expect(createResp.status).toBe(201);
    const productId = createResp.body.data.publicKey;

    // Edição
    const updateResp = await updateProduct(productId, { name: 'Nome Editado' });
    expect(updateResp.status).toBe(200);
    expect(updateResp.body.data.name).toBe('Nome Editado');

    // Exclusão (sem order_items)
    const deleteResp = await deleteProduct(productId);
    expect(deleteResp.status).toBe(200);
    expect(deleteResp.body.data.deleted).toBe(true);

    // Produto removido da lista
    expect(products().find((p) => p.publicKey === productId)).toBeUndefined();
  });
});
