import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/services/api.ts';
import {
  buildOrderRequest, createOrderSubmitter, describeOrderError, orderSubmissionEnabled,
} from '../src/services/orderSubmission.ts';

const product = (id, priceInCents) => ({ id, name: id, priceInCents, categoryId: 'porcoes', isAvailable: true });
const cart = { items: [{ product: product('rustika-131', 5999), quantity: 2 }, { product: product('rustika-PA062240', 5000), quantity: 1 }] };

function keys() {
  let n = 0;
  return () => `11111111-1111-4111-8111-${String(++n).padStart(12, '0')}`;
}

test('buildOrderRequest usa o carrinho existente e o preço só como confirmação', () => {
  assert.deepEqual(buildOrderRequest(cart, { customerName: '  Ana Silva ', tableOrReference: ' Mesa 2 ', notes: '  ' }), {
    customerName: 'Ana Silva',
    tableOrReference: 'Mesa 2',
    items: [
      { productId: 'rustika-131', quantity: 2, expectedUnitPriceInCents: 5999 },
      { productId: 'rustika-PA062240', quantity: 1, expectedUnitPriceInCents: 5000 },
    ],
  });
});

test('buildOrderRequest recusa carrinho vazio e nome curto', () => {
  assert.throws(() => buildOrderRequest({ items: [] }, { customerName: 'Ana' }), (err) => err.code === 'EMPTY_CART');
  assert.throws(() => buildOrderRequest(cart, { customerName: ' A ' }), (err) => err.code === 'INVALID_INPUT');
});

test('reenvio após falha de rede usa a MESMA chave (o backend responde replay, sem duplicar)', async () => {
  const seen = []; let fail = true;
  const submitter = createOrderSubmitter({ createOrder: async (_body, key) => {
    seen.push(key);
    if (fail) { fail = false; throw new ApiError(0, 'NETWORK', 'offline', null); }
    return { orderNumber: 1 };
  } }, keys());
  const body = buildOrderRequest(cart, { customerName: 'Ana' });
  await assert.rejects(submitter.submit(body), (err) => err.code === 'NETWORK');
  await submitter.submit(body);
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);
});

test('pedido alterado (ex.: após PRICE_CHANGED) recebe chave nova', async () => {
  const seen = [];
  const submitter = createOrderSubmitter({ createOrder: async (body, key) => {
    seen.push(key);
    if (body.items[0].expectedUnitPriceInCents === 5999) throw new ApiError(409, 'PRICE_CHANGED', 'x', null);
    return { orderNumber: 2 };
  } }, keys());
  await assert.rejects(submitter.submit(buildOrderRequest(cart, { customerName: 'Ana' })));
  const updated = { items: [{ product: product('rustika-131', 6499), quantity: 2 }] };
  await submitter.submit(buildOrderRequest(updated, { customerName: 'Ana' }));
  assert.notEqual(seen[0], seen[1]);
});

test('depois do sucesso o próximo pedido, mesmo idêntico, é um pedido novo', async () => {
  const seen = [];
  const submitter = createOrderSubmitter({ createOrder: async (_b, key) => { seen.push(key); return { orderNumber: seen.length }; } }, keys());
  const body = buildOrderRequest(cart, { customerName: 'Ana' });
  await submitter.submit(body); await submitter.submit(body);
  assert.notEqual(seen[0], seen[1]);
});

test('clique duplo: só uma requisição fica em andamento', async () => {
  let release; let calls = 0;
  const submitter = createOrderSubmitter({ createOrder: () => { calls++; return new Promise((resolve) => { release = () => resolve({ orderNumber: 1 }); }); } }, keys());
  const body = buildOrderRequest(cart, { customerName: 'Ana' });
  const first = submitter.submit(body);
  assert.equal(submitter.pending, true);
  await assert.rejects(submitter.submit(body), (err) => err.code === 'ORDER_IN_PROGRESS');
  release(); await first;
  assert.equal(calls, 1);
  assert.equal(submitter.pending, false);
});

test('mensagens para 401, 403, 409, 429 e rede', () => {
  assert.match(describeOrderError(new ApiError(401, 'INVALID_SESSION', 'x', null)), /sessão de comanda/i);
  assert.match(describeOrderError(new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'x', null)), /proteção de origem/);
  assert.match(describeOrderError(new ApiError(409, 'PRICE_CHANGED', 'x', null)), /preço/);
  assert.match(describeOrderError(new ApiError(409, 'PRODUCT_UNAVAILABLE', 'x', null)), /disponível/);
  assert.match(describeOrderError(new ApiError(429, 'TOO_MANY_REQUESTS', 'Muitas tentativas. Tente novamente em 5 s.', 5)), /5 s/);
  assert.match(describeOrderError(new ApiError(0, 'NETWORK', 'Sem conexão.', null)), /não será duplicado/);
  assert.match(describeOrderError(new Error('x')), /Não foi possível enviar/);
});

test('envio real fica desativado por padrão (sem VITE_ORDER_SUBMISSION=enabled)', () => {
  assert.equal(orderSubmissionEnabled(), false);
});
