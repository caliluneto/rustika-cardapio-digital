import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewBlocker } from './helpers/cartPreconditions.ts';
import { cartReducer, initialCartState } from '../src/contexts/cart.ts';
import { canReviewOrder } from '../src/contexts/orderReview.ts';

const product = (id, isAvailable = true) => ({ id, name: `P ${id}`, priceInCents: 1000, categoryId: 'c', isAvailable });
const ok = { drawerOpen: true, itemShown: true, comandaTitle: 'Comanda nº 900001', editingHint: false, reviewButton: true };
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ----------------------------------------- comportamento real (regras de produção, sem alterá-las)

test('comportamento: comanda ausente (estado após reload) impede a revisão, mesmo com itens', () => {
  const cart = cartReducer(initialCartState, { type: 'ADD_ITEM', product: product('rustika-1') });
  assert.equal(canReviewOrder(cart, null), false);
  assert.equal(canReviewOrder(cart, '900001'), true);
});

test('comportamento: carrinho vazio não pode ser revisado; produto adicionado habilita', () => {
  assert.equal(canReviewOrder(initialCartState, '900001'), false);
  assert.equal(canReviewOrder(cartReducer(initialCartState, { type: 'ADD_ITEM', product: product('rustika-1') }), '900001'), true);
});

test('comportamento: pedido concluído esvazia o carrinho e o segundo pedido na mesma comanda é revisável', () => {
  let cart = cartReducer(initialCartState, { type: 'ADD_ITEM', product: product('rustika-1') });
  cart = cartReducer(cart, { type: 'CLEAR_CART' });
  assert.equal(cart.items.length, 0);
  assert.equal(canReviewOrder(cart, '900001'), false);
  cart = cartReducer(cart, { type: 'ADD_ITEM', product: product('rustika-2') });
  assert.equal(canReviewOrder(cart, '900001'), true);
});

test('comportamento: disponibilidade alterada após a inclusão no carrinho não remove o item; só o servidor decide no envio', () => {
  const cart = cartReducer(initialCartState, { type: 'ADD_ITEM', product: product('rustika-3', true) });
  assert.equal(canReviewOrder(cart, '900001'), true);
  assert.equal(cartReducer(cart, { type: 'ADD_ITEM', product: product('rustika-4', false) }), cart);
});

// ----------------------------------------- diagnóstico das pré-condições (lógica pura do E2E)

test('pré-condições: cada bloqueio gera mensagem específica e segura, na ordem', () => {
  assert.equal(reviewBlocker(ok, '900001'), null);
  assert.match(reviewBlocker({ ...ok, drawerOpen: false }, '900001'), /carrinho não está aberto/);
  assert.match(reviewBlocker({ ...ok, itemShown: false }, '900001'), /produto esperado/);
  assert.match(reviewBlocker({ ...ok, comandaTitle: null }, '900001'), /nenhuma comanda/);
  assert.match(reviewBlocker({ ...ok, comandaTitle: 'Comanda nº 123' }, '900001'), /diverge/);
  assert.match(reviewBlocker({ ...ok, editingHint: true }, '900001'), /edição da comanda/);
  assert.match(reviewBlocker({ ...ok, reviewButton: false }, '900001'), /Revisar pedido/);
});

// ----------------------------------------- estáticos do spec (seletores; não provam comportamento)

test('estático: o spec restaura a comanda pela interface após o reload e verifica as pré-condições antes de clicar', () => {
  const spec = source('./e2e.spec.ts');
  assert.match(spec, /await page\.reload\(\);[\s\S]*Abrir carrinho[\s\S]*comanda-active-status[\s\S]*Fechar/);
  assert.match(spec, /expect\.poll\(async \(\) => reviewBlocker\(/);
  const start = spec.indexOf('const addToCartAndReview');
  assert.ok(spec.indexOf('reviewBlocker(await readCartFacts', start) < spec.indexOf('button:has-text("Revisar pedido")', start));
  assert.doesNotMatch(spec, /waitForTimeout/);
});

test('estático: nenhuma regra de produção foi alterada para o teste (canReviewOrder segue exigindo comanda)', () => {
  const rules = source('../src/contexts/orderReview.ts');
  assert.match(rules, /if \(!comanda \|\| normalizeComanda\(comanda\) !== comanda \|\| state\.items\.length === 0\) return false;/);
});
