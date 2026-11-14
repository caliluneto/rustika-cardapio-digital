import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApiClient } from '../src/services/api.ts';
import OrderTracking from '../src/components/OrderTracking.tsx';
import {
  ORDER_TRACKING_POLL_MS, createOrderTrackingClient, parseCustomerOrder,
} from '../src/services/orderTracking.ts';

const id = '44444444-4444-4444-8444-000000000001';
const tracked = (overrides = {}) => ({
  id, orderNumber: 42, status: 'IN_PREPARATION', comandaNumber: '000123', customerName: 'Ana',
  totalInCents: 11998, createdAt: '2026-11-12T12:00:00.000Z', updatedAt: '2026-11-12T12:05:00.000Z',
  history: [
    { fromStatus: null, toStatus: 'RECEIVED', createdAt: '2026-11-12T12:00:00.000Z' },
    { fromStatus: 'RECEIVED', toStatus: 'IN_PREPARATION', createdAt: '2026-11-12T12:05:00.000Z' },
  ],
  ...overrides,
});

test('parser aceita somente o contrato público do próprio pedido', () => {
  const order = parseCustomerOrder(tracked());
  assert.equal(order.status, 'IN_PREPARATION');
  assert.equal(order.history.length, 2);
  for (const invalid of [null, {}, tracked({ id: 'x' }), tracked({ status: 'OTHER' }), tracked({ history: 'x' })]) {
    assert.throws(() => parseCustomerOrder(invalid), (error) => error.code === 'INVALID_RESPONSE');
  }
});

test('cliente consulta GET autenticado por cookie e sem token na URL', async () => {
  const calls = [];
  const api = createApiClient({ baseUrl: 'http://api.test/api', fetcher: async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ success: true, data: tracked() }), headers: { get: () => null } };
  } });
  const order = await createOrderTrackingClient(api).get(id);
  assert.equal(order.orderNumber, 42);
  assert.equal(calls[0].url, `http://api.test/api/orders/${id}`);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.credentials, 'include');
  assert.doesNotMatch(calls[0].url, /token|credential|session/);
});

test('cartão mostra status e linha do tempo; polling é moderado', () => {
  assert.ok(ORDER_TRACKING_POLL_MS >= 5000);
  const html = renderToStaticMarkup(createElement(OrderTracking, {
    initial: tracked(), client: { get: async () => parseCustomerOrder(tracked()) },
  }));
  assert.match(html, /Acompanhe seu pedido #42/);
  assert.match(html, /Status atual: <strong>Em preparação/);
  assert.match(html, /data-history-status="RECEIVED"/);
  assert.match(html, /data-history-status="IN_PREPARATION"/);
});
