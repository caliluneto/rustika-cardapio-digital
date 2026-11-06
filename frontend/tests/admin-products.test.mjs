import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError, createApiClient } from '../src/services/api.ts';
import {
  AVAILABILITY_LABEL, NO_FILTERS, categoriesOf, confirmationMessage, createAdminProductsClient, describeAvailabilityError,
  describeProductsListError, filterProducts, offeredTargets, parseAdminProduct, parseProductsSnapshot,
} from '../src/services/adminProducts.ts';
import { AdminProductsView } from '../src/pages/AdminProducts.tsx';

const product = (code, overrides = {}) => ({
  id: `rustika-${code}`, sourceCode: code, name: `Produto ${code}`, categoryId: 'frios', categoryName: 'Frios',
  priceInCents: 2990, availabilityState: 'UNKNOWN', updatedAt: '2026-11-05T12:00:00.000Z', ...overrides,
});
function fakeFetch(handler) {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  return { calls, fetcher };
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } });
const clientOf = (fetcher) => createAdminProductsClient(createApiClient({ baseUrl: 'http://api.test/api', fetcher }));

// ---------------------------------------------------------------- cliente HTTP

test('lista: GET /admin/products com cookie, sem query string e sem corpo', async () => {
  const { calls, fetcher } = fakeFetch(() => json(200, { success: true, data: { truncated: false, products: [product('1001')] } }));
  const snapshot = await clientOf(fetcher).list();
  assert.equal(snapshot.products.length, 1);
  assert.equal(calls[0].url, 'http://api.test/api/admin/products');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].url.includes('?'), false);
});

test('lista: resposta fora do contrato vira INVALID_RESPONSE', () => {
  for (const data of [null, {}, { products: 'x', truncated: false }, { products: [], truncated: 'no' }, { products: [product('1', { availabilityState: 'MAYBE' })], truncated: false },
    { products: [product('1', { id: 'abc' })], truncated: false }, { products: [product('1', { priceInCents: -1 })], truncated: false },
    { products: [product('1', { priceInCents: 1.5 })], truncated: false }, { products: [product('1', { name: 7 })], truncated: false }]) {
    assert.throws(() => parseProductsSnapshot(data), (err) => err instanceof ApiError && err.code === 'INVALID_RESPONSE');
  }
  assert.equal(parseAdminProduct(product('77')).sourceCode, '77');
});

test('atualização: PATCH com expectedState/toState apenas, cabeçalhos de escrita e cookie', async () => {
  const { calls, fetcher } = fakeFetch(() => json(200, { success: true, data: { product: product('1001', { availabilityState: 'AVAILABLE' }) } }));
  const updated = await clientOf(fetcher).updateAvailability('rustika-1001', { expectedState: 'UNKNOWN', toState: 'AVAILABLE', price: 1, isActive: false });
  assert.equal(updated.availabilityState, 'AVAILABLE');
  const { url, init } = calls[0];
  assert.equal(url, 'http://api.test/api/admin/products/rustika-1001/availability');
  assert.equal(init.method, 'PATCH');
  assert.equal(init.credentials, 'include');
  assert.equal(init.headers['X-Rustika-Request'], '1');
  assert.deepEqual(JSON.parse(init.body), { expectedState: 'UNKNOWN', toState: 'AVAILABLE' });
});

test('id inválido não gera requisição', async () => {
  const { calls, fetcher } = fakeFetch(() => json(200, { success: true, data: {} }));
  await assert.rejects(clientOf(fetcher).updateAvailability('../x', { expectedState: 'UNKNOWN', toState: 'AVAILABLE' }), (err) => err instanceof ApiError && err.code === 'INVALID_PRODUCT_ID');
  assert.equal(calls.length, 0);
});

test('cancelamento: o sinal de aborto é repassado ao transporte', async () => {
  const seen = [];
  const transport = { getWithAuth: async (_path, signal) => { seen.push(signal); return { products: [], truncated: false }; }, patch: async () => ({}) };
  const controller = new AbortController();
  await createAdminProductsClient(transport).list(controller.signal);
  assert.equal(seen[0], controller.signal);
});

// ---------------------------------------------------------------- regras do cliente

test('busca por nome ou código (sem acento), categoria e disponibilidade; filtros se combinam', () => {
  const all = [
    product('1001', { name: 'Linguiça Toscana', availabilityState: 'AVAILABLE' }),
    product('PA062240', { name: 'Peito de Frango', categoryId: 'aves', categoryName: 'Aves', availabilityState: 'UNAVAILABLE' }),
    product('2002', { name: 'Queijo Minas', categoryId: 'frios', availabilityState: 'UNKNOWN' }),
  ];
  assert.equal(filterProducts(all, NO_FILTERS).length, 3);
  assert.deepEqual(filterProducts(all, { ...NO_FILTERS, search: 'linguica' }).map((p) => p.id), ['rustika-1001']);
  assert.deepEqual(filterProducts(all, { ...NO_FILTERS, search: 'pa0622' }).map((p) => p.id), ['rustika-PA062240']);
  assert.deepEqual(filterProducts(all, { ...NO_FILTERS, categoryId: 'frios' }).map((p) => p.id), ['rustika-1001', 'rustika-2002']);
  assert.deepEqual(filterProducts(all, { ...NO_FILTERS, availability: 'UNKNOWN' }).map((p) => p.id), ['rustika-2002']);
  assert.deepEqual(filterProducts(all, { search: 'q', categoryId: 'frios', availability: 'UNKNOWN' }).map((p) => p.id), ['rustika-2002']);
  assert.deepEqual(filterProducts(all, { search: 'zzz', categoryId: '', availability: '' }), []);
  assert.deepEqual(categoriesOf(all), [{ id: 'frios', name: 'Frios' }, { id: 'aves', name: 'Aves' }]);
});

test('ações oferecidas: nunca UNKNOWN como alvo e nunca o estado atual', () => {
  assert.deepEqual(offeredTargets('UNKNOWN'), ['AVAILABLE', 'UNAVAILABLE']);
  assert.deepEqual(offeredTargets('AVAILABLE'), ['UNAVAILABLE']);
  assert.deepEqual(offeredTargets('UNAVAILABLE'), ['AVAILABLE']);
});

test('mensagem de confirmação nomeia produto, código, mudança e efeito', () => {
  const text = confirmationMessage(product('1001', { name: 'Queijo', availabilityState: 'AVAILABLE' }), 'UNAVAILABLE');
  assert.match(text, /Queijo/); assert.match(text, /1001/); assert.match(text, /Disponível → Indisponível/); assert.match(text, /não poderão pedir/);
  assert.match(confirmationMessage(product('1'), 'AVAILABLE'), /poderão pedir/);
});

test('erros: 401 pede novo login; 409/422/404 pedem recarga; falhas não expõem detalhes internos', () => {
  const api = (status, message = 'x') => new ApiError(status, 'CODE', message, null);
  assert.deepEqual(describeAvailabilityError(api(401)), { message: 'Sua sessão expirou. Entre novamente.', conflict: false, unauthorized: true });
  for (const status of [409, 422, 404]) assert.equal(describeAvailabilityError(api(status)).conflict, true);
  assert.equal(describeAvailabilityError(api(0)).conflict, false);
  assert.match(describeAvailabilityError(api(500, 'relation "products" at 10.0.0.5')).message, /servidor não conseguiu/);
  assert.doesNotMatch(describeAvailabilityError(api(500, 'relation "products" at 10.0.0.5')).message, /10\.0\.0\.5|relation/);
  assert.match(describeAvailabilityError(new Error('boom')).message, /Não foi possível/);
  assert.equal(describeProductsListError(api(401)).unauthorized, true);
  assert.equal(describeProductsListError(api(500)).unauthorized, false);
});

// ---------------------------------------------------------------- apresentação

const view = (overrides = {}) => renderToStaticMarkup(createElement(AdminProductsView, {
  loading: false, error: null, products: [], truncated: false, filters: NO_FILTERS, busyId: null, notice: null, confirming: null,
  onFilters() {}, onRequest() {}, onConfirm() {}, onAbort() {}, onRefresh() {}, ...overrides,
}));

test('carregando, vazio, erro e truncamento', () => {
  assert.match(view({ loading: true }), /Carregando produtos/);
  assert.match(view(), /Nenhum produto disponível para gerenciar/);
  const error = view({ error: 'Falha qualquer' });
  assert.match(error, /role="alert"/); assert.match(error, /Falha qualquer/);
  assert.match(view({ products: [product('1')], truncated: true }), /Lista parcial/);
});

test('lista: nome, código, categoria, preço e estado; ações por estado; sem campos de edição de preço', () => {
  const html = view({ products: [
    product('1001', { availabilityState: 'AVAILABLE' }), product('2002', { availabilityState: 'UNAVAILABLE', name: 'Fora' }), product('3003'),
  ] });
  assert.match(html, /Produto 1001/); assert.match(html, /Código 1001/); assert.match(html, /Frios/); assert.match(html, /R\$\s?29,90/);
  for (const label of Object.values(AVAILABILITY_LABEL)) assert.match(html, new RegExp(label));
  const available = html.split('data-product-id="rustika-1001"')[1].split('</li>')[0];
  assert.match(available, /data-to-state="UNAVAILABLE"/); assert.doesNotMatch(available, /data-to-state="AVAILABLE"/);
  const unknown = html.split('data-product-id="rustika-3003"')[1].split('</li>')[0];
  assert.match(unknown, /data-to-state="AVAILABLE"/); assert.match(unknown, /data-to-state="UNAVAILABLE"/);
  assert.doesNotMatch(html, /type="number"|name="price"|Excluir|Importar|Upload/i);
  assert.match(html, /3 de 3 produtos/);
});

test('filtros aplicados: contagem e mensagem de resultado vazio', () => {
  const products = [product('1001', { name: 'Queijo' }), product('2002', { name: 'Lombo' })];
  assert.match(view({ products, filters: { ...NO_FILTERS, search: 'queijo' } }), /1 de 2 produtos/);
  const none = view({ products, filters: { ...NO_FILTERS, search: 'xyz' } });
  assert.match(none, /Nenhum produto corresponde/); assert.match(none, /0 de 2/);
});

test('confirmação: mostra a mudança, exige Confirmar/Voltar e trava as demais ações', () => {
  const products = [product('1001', { availabilityState: 'AVAILABLE' }), product('2002')];
  const html = view({ products, confirming: { productId: 'rustika-1001', to: 'UNAVAILABLE' } });
  assert.match(html, /role="group"/); assert.match(html, /Disponível → Indisponível/); assert.match(html, />Confirmar</); assert.match(html, />Voltar</);
  const other = html.split('data-product-id="rustika-2002"')[1].split('</li>')[0];
  assert.match(other, /disabled=""/); // outras ações travadas enquanto há confirmação aberta
  assert.match(view({ products, confirming: { productId: 'rustika-1001', to: 'UNAVAILABLE' }, busyId: 'rustika-1001' }), /Enviando…/);
});

test('avisos: sucesso usa status; erro e conflito usam alerta', () => {
  assert.match(view({ notice: { kind: 'success', text: 'Feito' } }), /role="status"[^>]*>Feito/);
  assert.match(view({ notice: { kind: 'error', text: 'Falhou' } }), /role="alert"[^>]*>Falhou/);
  assert.match(view({ notice: { kind: 'conflict', text: 'Mudou' } }), /role="alert"[^>]*>Mudou/);
});

// ---------------------------------------------------------------- integração com o painel e CSS

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('o painel de produtos é montado no painel administrativo e desmontado durante o logout', () => {
  const dashboard = source('../src/pages/AdminDashboard.tsx');
  assert.match(dashboard, /import AdminProducts from '\.\/AdminProducts'/);
  assert.match(dashboard, /\{!loggingOut && <AdminProducts onUnauthorized=\{onLogout\} \/>\}/);
});

test('o container cancela a requisição pendente ao desmontar e não usa polling automático', () => {
  const page = source('../src/pages/AdminProducts.tsx');
  assert.match(page, /controller\.current\?\.abort\(\)/);
  assert.match(page, /return \(\) => \{ controller\.current\?\.abort\(\)/);
  assert.doesNotMatch(page, /setInterval|createOrdersPoller/);
});

test('layout responsivo: grade de filtros fluida, ações em largura total no celular, tema existente', () => {
  const css = source('../src/index.css');
  assert.match(css, /\.admin-product-filters \{[^}]*repeat\(auto-fit, minmax\(10rem, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 480px\) \{ \.admin-product \.admin-order-actions button/);
  assert.match(css, /\.admin-product \{[^}]*border: 1px solid var\(--line\)/);
});

// ---------------------------------------------------------------- experiência do cliente (regressão; sem alterar testes existentes)

import { cartReducer, initialCartState } from '../src/contexts/cart.ts';
import { describeOrderError } from '../src/services/orderSubmission.ts';

const publicProduct = (id, isAvailable) => ({ id, name: `P ${id}`, priceInCents: 1000, categoryId: 'frios', isAvailable });

test('cliente: produto indisponível não entra no carrinho; não confirmado entra mas o servidor decide; carrinho é preservado', () => {
  let cart = cartReducer(initialCartState, { type: 'ADD_ITEM', product: publicProduct('rustika-1', true) });
  assert.equal(cart.items.length, 1);
  assert.equal(cartReducer(cart, { type: 'ADD_ITEM', product: publicProduct('rustika-2', false) }), cart);
  cart = cartReducer(cart, { type: 'ADD_ITEM', product: publicProduct('rustika-3', null) });
  assert.equal(cart.items.length, 2);
});

test('cliente: PRODUCT_UNAVAILABLE no envio informa e orienta revisar o carrinho (a limpeza só ocorre após pedido confirmado)', () => {
  const message = describeOrderError(new ApiError(409, 'PRODUCT_UNAVAILABLE', 'x', null));
  assert.match(message, /não está mais disponível/); assert.match(message, /Revise o carrinho/);
  const checkout = readFileSync(new URL('../src/pages/Checkout.tsx', import.meta.url), 'utf8');
  assert.match(checkout, /only after a confirmed order; failures keep the cart/);
});

test('lista truncada nunca é apresentada como o catálogo completo', () => {
  const html = view({ products: [product('1')], truncated: true });
  assert.match(html, /1 de 1 produtos carregados \(lista parcial/);
  assert.doesNotMatch(view({ products: [product('1')] }), /lista parcial/);
});
