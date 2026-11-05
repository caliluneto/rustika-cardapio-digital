import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReviewOrder } from '../src/contexts/orderReview.ts';
import { cartReducer, initialCartState, selectCartTotal, selectItemSubtotal } from '../src/contexts/cart.ts';
import { normalizeComanda } from '../src/contexts/comanda.ts';

const product = { id: '1', sourceCode: '1', sourceName: 'Item', sourceGroup: 'Grupo', categoryId: 'teste', name: 'Item', priceInCents: 199 };
const populated = cartReducer(initialCartState, { type: 'ADD_ITEM', product, quantity: 2 });

test('revisão exige produtos e comanda local válida, preservando zeros', () => {
  assert.equal(canReviewOrder(initialCartState, '001'), false);
  for (const value of [null, '', 'abc', '9041737', '1 2', ' 001 ']) assert.equal(canReviewOrder(populated, value), false);
  assert.equal(canReviewOrder(populated, normalizeComanda(' 001 ')), true);
  assert.equal(selectItemSubtotal(populated.items[0]), 398);
  assert.equal(selectCartTotal(populated), 398);
});

test('revisão rejeita quantidades, preços e somas inseguras', () => {
  for (const item of [
    { product, quantity: 0 },
    { product, quantity: 100 },
    { product: { ...product, priceInCents: -1 }, quantity: 1 },
    { product: { ...product, priceInCents: Number.MAX_SAFE_INTEGER }, quantity: 2 },
    { product: { ...product, isAvailable: false }, quantity: 1 },
  ]) assert.equal(canReviewOrder({ items: [item] }, '1'), false);
  assert.equal(canReviewOrder({ items: [populated.items[0], populated.items[0]] }, '1'), false);
  assert.equal(canReviewOrder({ items: [{ product: { ...product, priceInCents: Number.MAX_SAFE_INTEGER }, quantity: 1 }, { product: { ...product, id: '2', priceInCents: 1 }, quantity: 1 }] }, '1'), false);
});
