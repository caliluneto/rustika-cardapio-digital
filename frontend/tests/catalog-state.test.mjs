import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCatalogStore } from '../src/services/catalogStore.ts';
import CatalogStatus from '../src/components/CatalogStatus.tsx';
import Catalog from '../src/components/Catalog.tsx';
import ConnectionIndicator from '../src/components/ConnectionIndicator.tsx';
import ProductCard from '../src/components/ProductCard.tsx';
import ProductModal from '../src/components/ProductModal.tsx';
import { CartProvider } from '../src/contexts/CartContext.tsx';
import { category, dto } from './catalog-fixtures.mjs';

test('carregamento compartilhado evita chamadas duplicadas e publica só o catálogo completo', async () => {
  let resolve; let calls = 0;
  const store = createCatalogStore(() => { calls++; return new Promise((done) => { resolve = done; }); });
  const states = [];
  const unsubscribe = store.subscribe(() => states.push(store.getSnapshot().status));
  assert.equal(store.getSnapshot().status, 'loading');
  const first = store.load();
  const second = store.load();
  const retry = store.retry();
  assert.strictEqual(first, second); assert.strictEqual(first, retry);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().status, 'loading');
  assert.equal('data' in store.getSnapshot(), false);
  resolve({ categories: [category], products: [dto()] });
  await first;
  assert.equal(store.getSnapshot().status, 'ready');
  await store.load();
  assert.equal(calls, 1);
  assert.deepEqual(states, ['loading', 'ready']);
  unsubscribe();
});

test('erro permite nova tentativa explícita, sem repetição automática', async () => {
  let calls = 0;
  const store = createCatalogStore(async () => {
    if (++calls === 1) throw new Error('API indisponível');
    return { categories: [], products: [] };
  });
  await store.load();
  assert.deepEqual(store.getSnapshot(), { status: 'error', message: 'API indisponível' });
  await store.load();
  assert.equal(calls, 1);
  const retry = store.retry();
  assert.equal(store.getSnapshot().status, 'loading');
  await retry;
  assert.deepEqual(store.getSnapshot(), { status: 'ready', data: { categories: [], products: [] } });
  assert.equal(calls, 2);
});

test('unsubscribe impede notificações após desmontagem e preserva carga para nova assinatura', async () => {
  let calls = 0;
  const store = createCatalogStore(async () => ({ categories: [], products: [] }));
  const unsubscribe = store.subscribe(() => calls++);
  unsubscribe();
  await store.load();
  assert.equal(calls, 0);
  assert.equal(store.getSnapshot().status, 'ready');
});

test('estados visuais de carregamento, erro e vazio têm mensagens e acessibilidade', () => {
  const render = (state) => renderToStaticMarkup(createElement(CatalogStatus, { state, onRetry: () => {} }));
  const loading = render({ status: 'loading' });
  assert.match(loading, /Carregando o cardápio/);
  assert.match(loading, /aria-busy="true"/);
  assert.doesNotMatch(loading, /Tentar novamente/);
  const error = render({ status: 'error', message: 'API indisponível' });
  assert.match(error, /role="alert"/);
  assert.match(error, /API indisponível/);
  assert.match(error, /Tentar novamente/);
  assert.match(render({ status: 'ready', data: { categories: [], products: [] } }), /Nenhum produto disponível/);
});

test('cartão mantém apresentação sem foto e identifica disponibilidade desconhecida', () => {
  const product = dto(); delete product.imageUrl;
  const html = renderToStaticMarkup(createElement(ProductCard, { product, categoryName: 'Drinks', onSelect: () => {} }));
  assert.match(html, /product-card--text/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Disponibilidade não confirmada/);
});

test('fotografia cadastrada usa nome como alt se o cadastro não fornecer texto alternativo', () => {
  const html = renderToStaticMarkup(createElement(ProductCard, { product: dto('1', { imageAlt: undefined }), categoryName: 'Drinks', onSelect: () => {} }));
  assert.match(html, /<img/);
  assert.match(html, /alt="Negroni"/);
});

test('modal preserva ingredientes e bloqueio de indisponíveis; null não confirma estoque', () => {
  function render(availability) {
    return renderToStaticMarkup(createElement(CartProvider, null, createElement(ProductModal, {
      product: dto('1', { isAvailable: availability }), categoryName: 'Drinks', trigger: null,
      onClose: () => {}, onViewCart: () => {},
    })));
  }
  const unknown = render(null);
  assert.match(unknown, /Ingredientes/);
  assert.match(unknown, /Campari \/ gin \/ vermute/);
  assert.match(unknown, /Disponibilidade não confirmada/);
  assert.match(unknown, /Adicionar ao carrinho/);
  assert.doesNotMatch(render(false), /Adicionar ao carrinho/);
  assert.match(render(false), /Produto indisponível/);
  assert.doesNotMatch(render(true), /Disponibilidade não confirmada/);
});

test('catálogo reaproveita categorias e cartões, sem texto de demonstração em modo API', () => {
  const html = renderToStaticMarkup(createElement(Catalog, {
    categories: [category], products: [dto()], productDialogOpen: false,
    onOpenProduct: () => {}, onCloseProduct: () => {}, onViewCart: () => {},
  }));
  assert.match(html, /Filtrar cardápio por categoria/);
  assert.match(html, /Negroni/);
  assert.doesNotMatch(html, /planilha|Catálogo demonstrativo/);
});

test('verificação de conexão permanece disponível manualmente', () => {
  const html = renderToStaticMarkup(createElement(ConnectionIndicator, { autoCheck: false }));
  assert.match(html, /Verificação de conexão/);
  assert.match(html, /Verificar conexão/);
  assert.doesNotMatch(html, /API disponível|Verificando…/);
});
