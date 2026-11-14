import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartReducer, initialCartState, selectCartItemCount, selectCartTotal, selectItemSubtotal, cartSessionReducer, initialCartSession } from '../src/contexts/cart.ts';
import { normalizeComanda } from '../src/contexts/comanda.ts';

const product = (overrides = {}) => ({
  id: '1', sourceCode: '1', sourceName: 'Água', sourceGroup: 'Bebidas',
  categoryId: 'sem-alcool', name: 'Água', priceInCents: 799, ...overrides,
});
const add = (state, item = product(), quantity) => cartReducer(state, { type: 'ADD_ITEM', product: item, quantity });
const action = (type, productId = '1') => ({ type, productId });

test('estado inicial vazio e seletores zerados', () => {
  assert.deepEqual(initialCartState.items, []);
  assert.equal(selectCartTotal(initialCartState), 0);
  assert.equal(selectCartItemCount(initialCartState), 0);
});

test('adiciona, agrupa por ID e preserva snapshot independente', () => {
  const original = product();
  const first = add(initialCartState, original, 2);
  const second = add(first, product({ name: 'Nome diferente' }), 3);
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].quantity, 5);
  assert.equal(second.items[0].product.name, 'Água');
  assert.notStrictEqual(first.items[0].product, original);
  original.name = 'Alterado externamente';
  assert.equal(second.items[0].product.name, 'Água');
});

test('incrementa, decrementa e remove automaticamente ao chegar a zero', () => {
  const first = add(initialCartState);
  const second = cartReducer(first, action('INCREMENT'));
  assert.equal(second.items[0].quantity, 2);
  const third = cartReducer(second, action('DECREMENT'));
  assert.equal(third.items[0].quantity, 1);
  const empty = cartReducer(third, action('DECREMENT'));
  assert.deepEqual(empty.items, []);
  assert.strictEqual(cartReducer(empty, action('DECREMENT')), empty);
});

test('remove manualmente apenas o item solicitado e limpa o carrinho', () => {
  const state = add(add(initialCartState), product({ id: '2' }));
  const removed = cartReducer(state, action('REMOVE_ITEM'));
  assert.deepEqual(removed.items.map((item) => item.product.id), ['2']);
  assert.strictEqual(cartReducer(removed, action('REMOVE_ITEM', 'ausente')), removed);
  assert.deepEqual(cartReducer(removed, { type: 'CLEAR_CART' }).items, []);
});

test('bloqueia indisponível e aceita disponibilidade não confirmada', () => {
  const state = add(initialCartState, product({ isAvailable: false }));
  assert.strictEqual(state, initialCartState);
  const unconfirmed = add(state, product({ isAvailable: undefined }));
  assert.equal(unconfirmed.items.length, 1);
  assert.equal(unconfirmed.items[0].product.isAvailable, undefined);
  assert.strictEqual(add(unconfirmed, product({ isAvailable: false })), unconfirmed);
});

test('rejeita quantidades inválidas e preserva itens anteriores', () => {
  const state = add(initialCartState);
  for (const quantity of [0, -1, 1.5, 100, NaN, Infinity, null, '2']) {
    assert.strictEqual(add(state, product({ id: '2' }), quantity), state);
    assert.strictEqual(add(state, product(), quantity), state);
  }
  assert.equal(state.items[0].quantity, 1);
});

test('respeita limite 99 em adições e incrementos sem truncar', () => {
  const state = add(initialCartState, product(), 98);
  assert.strictEqual(add(state, product(), 2), state);
  const max = cartReducer(state, action('INCREMENT'));
  assert.equal(max.items[0].quantity, 99);
  assert.strictEqual(cartReducer(max, action('INCREMENT')), max);
  assert.strictEqual(add(max), max);
});

test('reducer é imutável e determinístico, inclusive em chamadas repetidas', () => {
  const original = Object.freeze(product());
  const first = add(initialCartState, original);
  Object.freeze(first.items[0].product);
  Object.freeze(first.items[0]);
  Object.freeze(first.items);
  Object.freeze(first);
  const nextAction = action('INCREMENT');
  const next = cartReducer(first, nextAction);
  assert.deepEqual(next, cartReducer(first, nextAction));
  assert.equal(first.items[0].quantity, 1);
  assert.equal(next.items[0].quantity, 2);
  assert.equal(original.priceInCents, 799);
});

test('calcula subtotal, total e quantidade com precisão em centavos', () => {
  const state = add(add(initialCartState, product({ priceInCents: 199 }), 3), product({ id: '2', priceInCents: 5 }), 2);
  assert.equal(selectItemSubtotal(state.items[0]), 597);
  assert.equal(selectCartTotal(state), 607);
  assert.equal(selectCartItemCount(state), 5);
});

test('rejeita preços inválidos e alteração de preço para ID existente', () => {
  const state = add(initialCartState);
  for (const priceInCents of [-1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '799']) {
    assert.strictEqual(add(state, product({ id: '2', priceInCents })), state);
  }
  assert.strictEqual(add(state, product({ priceInCents: 800 })), state);
  assert.strictEqual(add(state, product({ id: '' })), state);
  assert.equal(state.items[0].product.priceInCents, 799);
});

test('bloqueia overflow na multiplicação, soma e incremento', () => {
  const max = Number.MAX_SAFE_INTEGER;
  const expensive = product({ priceInCents: max });
  assert.strictEqual(add(initialCartState, expensive, 2), initialCartState);
  const state = add(initialCartState, expensive);
  assert.equal(selectCartTotal(state), max);
  assert.strictEqual(cartReducer(state, action('INCREMENT')), state);
  assert.strictEqual(add(state, product({ id: '2', priceInCents: 1 })), state);
  assert.equal(add(state, product({ id: '2', priceInCents: 0 })).items.length, 2);
  assert.throws(() => selectItemSubtotal({ product: expensive, quantity: 2 }), RangeError);
  assert.throws(() => selectCartTotal({ items: [{ product: expensive, quantity: 1 }, { product: product({ id: '2', priceInCents: 1 }), quantity: 1 }] }), RangeError);
});

test('ações inválidas ou para ID inexistente não alteram o estado', () => {
  const state = add(initialCartState);
  assert.strictEqual(cartReducer(state, action('INCREMENT', 'ausente')), state);
  assert.strictEqual(cartReducer(state, action('DECREMENT', 'ausente')), state);
  assert.strictEqual(cartReducer(state, { type: 'DESCONHECIDA' }), state);
  assert.equal(state.items[0].quantity, 1);
});

test('resultado da sessão reflete a decisão real do reducer para ações consecutivas', () => {
  const accepted = { type: 'ADD_ITEM', product: product(), quantity: 99 };
  const first = cartSessionReducer(initialCartSession, accepted);
  assert.equal(first.result.accepted, true);
  assert.strictEqual(first.result.action, accepted);
  const rejected = { type: 'ADD_ITEM', product: product(), quantity: 1 };
  const second = cartSessionReducer(first, rejected);
  assert.equal(second.result.accepted, false);
  assert.strictEqual(second.result.action, rejected);
  assert.strictEqual(second.cart, first.cart);
  assert.deepEqual(cartSessionReducer(first, rejected), second);
});

test('convenção local da comanda normaliza bordas e preserva zeros', () => {
  assert.equal(normalizeComanda('  001234  '), '001234');
  assert.equal(normalizeComanda('0'), '0');
  for (const input of ['', '  ', '1234567', '12 34', '-1', '1.2', 'abc', '１２３']) {
    assert.equal(normalizeComanda(input), null);
  }
});
