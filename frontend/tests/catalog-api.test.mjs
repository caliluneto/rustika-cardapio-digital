import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../src/services/api.ts';
import { adaptCategory, adaptProduct, filterProducts } from '../src/services/catalogAdapter.ts';
import { loadCatalog, resolveCatalogMode } from '../src/services/catalogSource.ts';
import { cartReducer, initialCartState, selectCartTotal } from '../src/contexts/cart.ts';
import { canReviewOrder } from '../src/contexts/orderReview.ts';
import { baseUrl, category, dto, json } from './catalog-fixtures.mjs';

test('adapta DTO preservando chaves, centavos, ingredientes e dados de origem', () => {
  const product = adaptProduct(dto(), baseUrl);
  assert.equal(product.id, 'rustika-001');
  assert.equal(product.sourceCode, '001');
  assert.equal(product.sourceName, ' NEGRONI ');
  assert.equal(product.priceInCents, 5999);
  assert.equal(product.ingredients, dto().ingredients);
  assert.equal(product.description, dto().description);
  assert.equal(product.imageUrl, 'http://catalog.example/images/negroni.jpg');
  assert.deepEqual(adaptCategory(category), category);
});

test('disponibilidade mantém os três estados, sem coerção de null', () => {
  for (const availability of [true, false, null]) {
    assert.equal(adaptProduct(dto('1', { isAvailable: availability }), baseUrl).isAvailable, availability);
  }
});

test('adaptação rejeita preço fracionário/inseguro e disponibilidade incorreta', () => {
  for (const override of [
    { priceInCents: 59.99 }, { priceInCents: -1 }, { priceInCents: '5999' },
    { priceInCents: Number.MAX_SAFE_INTEGER + 1 }, { isAvailable: 'true' },
    { isAvailable: undefined }, { sourceCode: '2' }, { id: 'uuid' },
    { categoryId: 'Invalid' }, { ingredients: 10 },
  ]) assert.throws(() => adaptProduct(dto('1', override), baseUrl), /inválido/);
});

test('produtos sem foto/ingredientes não recebem conteúdo inventado e URLs inadequadas são omitidas', () => {
  const product = dto();
  delete product.imageUrl; delete product.imageAlt; delete product.ingredients;
  const adapted = adaptProduct(product, baseUrl);
  assert.equal(adapted.imageUrl, undefined);
  assert.equal(adapted.imageAlt, undefined);
  assert.equal(adapted.ingredients, undefined);
  for (const imageUrl of ['javascript:alert(1)', 'data:text/html,test', 'http://user:password@example.com/photo', '']) {
    assert.equal(adaptProduct(dto('1', { imageUrl }), baseUrl).imageUrl, undefined);
  }
  assert.equal(adaptProduct(dto('1', { imageUrl: 'https://images.example/photo.jpg' }), baseUrl).imageUrl, 'https://images.example/photo.jpg');
});

test('carrega 138 produtos em três páginas, categorias uma vez e filtros locais sem nova chamada', async () => {
  const calls = [];
  const all = Array.from({ length: 138 }, (_, i) => dto(String(i + 1), { categoryId: i % 2 ? 'drinks' : 'porcoes' }));
  const client = createApiClient({ baseUrl, fetcher: async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Accept, 'application/json');
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/categories')) return json([category, { ...category, id: 'porcoes', displayOrder: 1 }]);
    assert.equal(parsed.searchParams.get('limit'), '50');
    const cursor = parsed.searchParams.get('cursor');
    const start = cursor ? all.findIndex((item) => item.id === cursor) + 1 : 0;
    const items = all.slice(start, start + 50);
    return json({ items, nextCursor: start + 50 < all.length ? items.at(-1).id : null });
  } });
  const result = await client.getCatalog();
  assert.equal(result.products.length, 138);
  assert.equal(new Set(result.products.map((item) => item.id)).size, 138);
  assert.deepEqual(result.categories.map((item) => item.id), ['porcoes', 'drinks']);
  assert.equal(filterProducts(result.products, 'drinks').length, 69);
  assert.equal(filterProducts(result.products, 'porcoes').length, 69);
  assert.equal(filterProducts(result.products, null).length, 138);
  assert.equal(calls.length, 4);
});

test('serviço mantém filtros em todas as páginas', async () => {
  const calls = [];
  const client = createApiClient({ baseUrl, fetcher: async (url) => {
    const query = new URL(url).searchParams;
    calls.push(query);
    assert.equal(query.get('categoryId'), 'drinks');
    assert.equal(query.get('availability'), 'UNKNOWN');
    return json(calls.length === 1 ? { items: [dto('1')], nextCursor: 'rustika-1' } : { items: [dto('2')], nextCursor: null });
  } });
  assert.equal((await client.getAllProducts({ categoryId: 'drinks', availability: 'UNKNOWN' })).length, 2);
  assert.equal(calls[1].get('cursor'), 'rustika-1');
});

test('detalhes usam a chave pública e não fazem paginação', async () => {
  const client = createApiClient({ baseUrl, fetcher: async (url) => {
    assert.equal(url, `${baseUrl}/products/rustika-001`);
    return json(dto());
  } });
  assert.equal((await client.getProduct('rustika-001')).id, 'rustika-001');
  await assert.rejects(client.getProduct('uuid'), /inválido/);
});

test('resposta vazia é catálogo vazio válido', async () => {
  const client = createApiClient({ baseUrl, fetcher: async (url) => json(url.includes('/categories') ? [] : { items: [], nextCursor: null }) });
  assert.deepEqual(await client.getCatalog(), { categories: [], products: [] });
});

test('falha numa página rejeita a carga completa sem retornar dados parciais', async () => {
  let calls = 0;
  const client = createApiClient({ baseUrl, fetcher: async () => {
    calls++;
    return calls === 1 ? json({ items: [dto('1')], nextCursor: 'rustika-1' }) : new Response('private error', { status: 500 });
  } });
  await assert.rejects(client.getAllProducts(), /HTTP 500/);
  assert.equal(calls, 2);
});

test('cursor repetido, página duplicada ou sem avanço não gera loop infinito', async () => {
  for (const page of [
    { items: [], nextCursor: 'rustika-1' },
    { items: [dto('1')], nextCursor: 'rustika-2' },
    { items: [dto('1')], nextCursor: 'rustika-1' },
  ]) {
    let calls = 0;
    const client = createApiClient({ baseUrl, fetcher: async () => { calls++; return json(page); } });
    await assert.rejects(client.getAllProducts(), /inválido/);
    assert.ok(calls <= 2);
  }
});

test('envelopes, JSON e contratos inválidos são recusados', async () => {
  for (const body of ['invalid', '{}', '{"success":false,"data":[]}', '{"success":true,"data":{"items":[]}}']) {
    const client = createApiClient({ baseUrl, fetcher: async () => new Response(body) });
    await assert.rejects(client.getAllProducts(), /inválido/);
  }
});

test('catálogo rejeita categorias duplicadas e produtos órfãos', async () => {
  const duplicate = createApiClient({ baseUrl, fetcher: async () => json([category, category]) });
  await assert.rejects(duplicate.getCategories(), /inválido/);
  const orphan = createApiClient({ baseUrl, fetcher: async (url) => json(url.includes('/categories') ? [] : { items: [dto()], nextCursor: null }) });
  await assert.rejects(orphan.getCatalog(), /inválido/);
});

test('erro HTTP e erro de rede não exibem mensagens internas do servidor', async () => {
  const client = createApiClient({ baseUrl, fetcher: async () => new Response('secret database password', { status: 503 }) });
  await assert.rejects(client.getCategories(), (error) => /HTTP 503/.test(error.message) && !error.message.includes('password'));
  const network = createApiClient({ baseUrl, fetcher: async () => { throw new Error('private network error'); } });
  await assert.rejects(network.getCategories(), /Não foi possível acessar a API/);
});

test('timeout encerra a requisição e cancelamento não vira catálogo vazio', async () => {
  const client = createApiClient({ baseUrl, timeoutMs: 10, fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) });
  await assert.rejects(client.getCategories(), /demorou/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.getCategories(controller.signal), { name: 'AbortError' });
});

test('modo padrão é API; demo exige configuração explícita e não consulta API', async () => {
  assert.equal(resolveCatalogMode(), 'api');
  assert.equal(resolveCatalogMode('api'), 'api');
  assert.equal(resolveCatalogMode('demo'), 'demo');
  assert.throws(() => resolveCatalogMode(''), /Configuração/);
  let apiCalls = 0; let demoCalls = 0;
  const api = async () => { apiCalls++; return { categories: [], products: [] }; };
  const demo = async () => { demoCalls++; return { categories: [category], products: [dto()] }; };
  await loadCatalog(undefined, api, demo);
  await loadCatalog('demo', api, demo);
  assert.equal(apiCalls, 1); assert.equal(demoCalls, 1);
  await assert.rejects(loadCatalog('api', async () => { throw new Error('API indisponível'); }, demo));
  assert.equal(demoCalls, 1);
});

test('catálogo demonstrativo preserva 138 produtos e dez categorias', async () => {
  const data = await loadCatalog('demo', async () => { throw new Error('Não deve chamar API'); });
  assert.equal(data.products.length, 138);
  assert.equal(data.categories.length, 10);
});

test('produtos adaptados mantêm cálculos e revisão local; indisponíveis não entram no carrinho', () => {
  for (const availability of [true, null]) {
    const product = adaptProduct(dto('001', { isAvailable: availability }), baseUrl);
    const cart = cartReducer(initialCartState, { type: 'ADD_ITEM', product, quantity: 3 });
    assert.equal(selectCartTotal(cart), 17997);
    assert.equal(canReviewOrder(cart, '001'), true);
    assert.equal(cart.items[0].product.isAvailable, availability);
  }
  assert.strictEqual(cartReducer(initialCartState, { type: 'ADD_ITEM', product: adaptProduct(dto('1', { isAvailable: false }), baseUrl) }), initialCartState);
});
