import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError, createApiClient } from '../src/services/api.ts';
import {
  ORDERS_POLL_INTERVAL_MS, canOfferTransition, confirmationMessage, createAdminOrdersClient, describeListError,
  describeStatusError, parseAdminOrder, parseSnapshot,
} from '../src/services/adminOrders.ts';
import { createOrdersPoller } from '../src/services/adminOrdersPolling.ts';
import { AdminOrdersView } from '../src/pages/AdminOrders.tsx';

const id = (n) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`;
const order = (n, overrides = {}) => ({
  id: id(n), orderNumber: n, status: 'RECEIVED', comandaNumber: '000123', customerName: `Cliente ${n}`, tableOrReference: 'Mesa 2', notes: null,
  totalInCents: 5998, createdAt: '2026-11-05T12:00:00.000Z', updatedAt: '2026-11-05T12:01:00.000Z', allowedTransitions: ['IN_PREPARATION', 'CANCELLED'],
  items: [{ productNameSnapshot: 'Frios', quantity: 2, unitPriceInCentsSnapshot: 2999, subtotalInCents: 5998, notes: null }],
  history: [{ fromStatus: null, toStatus: 'RECEIVED', notes: null, createdAt: '2026-11-05T12:00:00.000Z', actorName: null }],
  ...overrides,
});

function fakeFetch(handler) {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  return { calls, fetcher };
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } });

// ---------------------------------------------------------------- cliente HTTP

test('lista: GET /admin/orders com cookie (credentials include), sem query string e sem corpo', async () => {
  const { calls, fetcher } = fakeFetch(() => json(200, { success: true, data: { truncated: false, nextCursor: null, orders: [order(1)] } }));
  const client = createAdminOrdersClient(createApiClient({ baseUrl: 'http://api.test/api', fetcher }));
  const snapshot = await client.list();
  assert.equal(snapshot.orders.length, 1);
  assert.equal(calls[0].url, 'http://api.test/api/admin/orders');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].url.includes('?'), false);
});

test('lista: resposta fora do contrato vira INVALID_RESPONSE (nada é renderizado às cegas)', async () => {
  for (const data of [null, {}, { orders: 'x', truncated: false, nextCursor: null }, { orders: [], truncated: 'no', nextCursor: null },
    { orders: [], truncated: false, nextCursor: 'x' }, { orders: [order(1, { status: 'EM_PREPARO' })], truncated: false, nextCursor: null },
    { orders: [order(1, { id: 'abc' })], truncated: false, nextCursor: null }, { orders: [order(1, { totalInCents: -1 })], truncated: false, nextCursor: null },
    { orders: [order(1, { items: [{ productNameSnapshot: 1 }] })], truncated: false, nextCursor: null }]) {
    assert.throws(() => parseSnapshot(data), (err) => err instanceof ApiError && err.code === 'INVALID_RESPONSE');
  }
  assert.equal(parseAdminOrder(order(3)).orderNumber, 3);
});

test('lista envia filtro, limite e cursor e expõe próxima página', async () => {
  const cursor = id(9);
  const { calls, fetcher } = fakeFetch(() => json(200, { success: true, data: { truncated: true, nextCursor: cursor, orders: [order(10)] } }));
  const client = createAdminOrdersClient(createApiClient({ baseUrl: 'http://api.test/api', fetcher }));
  const snapshot = await client.list({ status: 'DELIVERED', limit: 20, cursor: id(11) });
  assert.equal(snapshot.nextCursor, cursor);
  assert.match(calls[0].url, /status=DELIVERED/);
  assert.match(calls[0].url, /limit=20/);
  assert.match(calls[0].url, /cursor=55555555/);
});

test('atualização: PATCH com expectedStatus/toStatus, cabeçalhos de escrita e cookie; notas vazias são omitidas', async () => {
  const { calls, fetcher } = fakeFetch(() => json(200, { success: true, data: { order: order(1, { status: 'IN_PREPARATION', allowedTransitions: ['READY', 'CANCELLED'] }) } }));
  const client = createAdminOrdersClient(createApiClient({ baseUrl: 'http://api.test/api', fetcher }));
  const updated = await client.updateStatus(id(1), { expectedStatus: 'RECEIVED', toStatus: 'IN_PREPARATION', notes: '   ' });
  assert.equal(updated.status, 'IN_PREPARATION');
  const { url, init } = calls[0];
  assert.equal(url, `http://api.test/api/admin/orders/${id(1)}/status`);
  assert.equal(init.method, 'PATCH');
  assert.equal(init.credentials, 'include');
  assert.equal(init.headers['X-Rustika-Request'], '1');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), { expectedStatus: 'RECEIVED', toStatus: 'IN_PREPARATION' });
});

test('atualização: motivo de cancelamento é aparado e enviado; id inválido nem chega à rede', async () => {
  const { calls, fetcher } = fakeFetch(() => json(200, { success: true, data: { order: order(1, { status: 'CANCELLED', allowedTransitions: [] }) } }));
  const client = createAdminOrdersClient(createApiClient({ baseUrl: 'http://api.test/api', fetcher }));
  await client.updateStatus(id(1), { expectedStatus: 'RECEIVED', toStatus: 'CANCELLED', notes: '  Cliente desistiu ' });
  assert.deepEqual(JSON.parse(calls[0].init.body), { expectedStatus: 'RECEIVED', toStatus: 'CANCELLED', notes: 'Cliente desistiu' });
  await assert.rejects(client.updateStatus('../x', { expectedStatus: 'RECEIVED', toStatus: 'CANCELLED' }), (err) => err.code === 'INVALID_ORDER_ID');
  assert.equal(calls.length, 1);
});

test('erros HTTP preservam status/código da API (409 vira conflito; 401 pede novo login)', async () => {
  const body = (code, message) => ({ success: false, error: { code, message } });
  const make = (status, payload) => createAdminOrdersClient(createApiClient({ baseUrl: 'http://api.test/api', fetcher: async () => json(status, payload) }));
  const change = { expectedStatus: 'RECEIVED', toStatus: 'IN_PREPARATION' };
  await assert.rejects(make(409, body('STATUS_CONFLICT', 'O pedido já está em READY.')).updateStatus(id(1), change), (err) => err.status === 409 && err.code === 'STATUS_CONFLICT');
  await assert.rejects(make(401, body('UNAUTHORIZED', 'x')).list(), (err) => err.status === 401);
  await assert.rejects(createAdminOrdersClient(createApiClient({ baseUrl: 'http://api.test/api', fetcher: async () => { throw new Error('boom'); } })).list(),
    (err) => err.status === 0 && err.code === 'NETWORK');
});

test('mensagens ao operador: conflito, sessão, rede e 5xx sem vazar detalhes internos', () => {
  const conflict = describeStatusError(new ApiError(409, 'STATUS_CONFLICT', 'detalhe interno 10.0.0.5', null));
  assert.equal(conflict.conflict, true);
  assert.match(conflict.message, /alterado por outra pessoa/);
  assert.equal(describeStatusError(new ApiError(422, 'INVALID_TRANSITION', 'x', null)).conflict, true);
  assert.equal(describeStatusError(new ApiError(404, 'ORDER_NOT_FOUND', 'x', null)).conflict, true);
  assert.equal(describeStatusError(new ApiError(401, 'UNAUTHORIZED', 'x', null)).unauthorized, true);
  assert.match(describeStatusError(new ApiError(0, 'NETWORK', 'x', null)).message, /comunicação/);
  const server = describeStatusError(new ApiError(500, 'INTERNAL_ERROR', 'stack 10.0.0.5', null));
  assert.equal(server.conflict, false);
  assert.doesNotMatch(server.message, /10\.0\.0\.5|stack/);
  assert.doesNotMatch(describeStatusError(new Error('segredo')).message, /segredo/);
  assert.equal(describeListError(new ApiError(401, 'UNAUTHORIZED', 'x', null)).unauthorized, true);
  assert.equal(describeListError(new ApiError(0, 'NETWORK', 'x', null)).unauthorized, false);
});

test('ações: só transições devolvidas pela API são oferecidas; cancelar pede aviso explícito', () => {
  const o = order(1, { status: 'READY', allowedTransitions: ['DELIVERED'] });
  assert.equal(canOfferTransition(o, 'DELIVERED'), true);
  assert.equal(canOfferTransition(o, 'CANCELLED'), false);
  assert.equal(canOfferTransition(order(2, { status: 'DELIVERED', allowedTransitions: [] }), 'RECEIVED'), false);
  assert.match(confirmationMessage(order(1), 'IN_PREPARATION'), /Recebido → Em preparo\. Confirmar\?/);
  assert.match(confirmationMessage(order(1), 'CANCELLED'), /não pode ser desfeito/);
});

// ---------------------------------------------------------------- polling

function manualTimers() {
  const pending = new Map(); let next = 1;
  return {
    setTimer: (callback, ms) => { const handle = next++; pending.set(handle, { callback, ms }); return handle; },
    clearTimer: (handle) => { pending.delete(handle); },
    pending,
    fire() { const [handle, entry] = [...pending][0]; pending.delete(handle); entry.callback(); },
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('intervalo moderado (>= 5 s) e primeira consulta imediata; próximo ciclo só depois do fim da consulta', async () => {
  assert.ok(ORDERS_POLL_INTERVAL_MS >= 5000);
  const timers = manualTimers(); const data = []; let loads = 0;
  const poller = createOrdersPoller({ load: async () => ++loads, onData: (value) => data.push(value), onError: () => {}, intervalMs: 10000, timers });
  poller.start(); await tick();
  assert.deepEqual(data, [1]);
  assert.equal(timers.pending.size, 1);
  assert.equal([...timers.pending.values()][0].ms, 10000);
  timers.fire(); await tick();
  assert.deepEqual(data, [1, 2]);
  poller.stop();
});

test('sem sobreposição: refresh() durante uma consulta não abre outra; roda uma vez depois', async () => {
  const timers = manualTimers(); let active = 0; let maxActive = 0; let loads = 0; const releases = [];
  const poller = createOrdersPoller({
    load: () => new Promise((resolve) => { active++; maxActive = Math.max(maxActive, active); loads++; releases.push(() => { active--; resolve(loads); }); }),
    onData: () => {}, onError: () => {}, intervalMs: 10000, timers,
  });
  poller.start(); poller.refresh(); poller.refresh(); poller.refresh();
  await tick();
  assert.equal(loads, 1);
  releases.shift()(); await tick();
  assert.equal(loads, 2); // uma rodada extra, não três
  assert.equal(maxActive, 1);
  releases.shift()(); await tick();
  assert.equal(timers.pending.size, 1);
  poller.stop();
});

test('parar (desmontagem): cancela o timer, aborta a consulta e descarta resultado tardio', async () => {
  const timers = manualTimers(); const data = []; let signal; let release;
  const poller = createOrdersPoller({
    load: (s) => new Promise((resolve) => { signal = s; release = () => resolve('tarde'); }),
    onData: (value) => data.push(value), onError: () => data.push('erro'), intervalMs: 10000, timers,
  });
  poller.start(); await tick();
  poller.stop();
  assert.equal(signal.aborted, true);
  assert.equal(poller.isRunning(), false);
  release(); await tick();
  assert.deepEqual(data, []);
  assert.equal(timers.pending.size, 0);
  poller.refresh(); await tick(); // parado: refresh não reativa
  assert.equal(timers.pending.size, 0);
});

test('parar com timer agendado remove o timer; reiniciar não duplica ciclos', async () => {
  const timers = manualTimers(); let loads = 0;
  const poller = createOrdersPoller({ load: async () => ++loads, onData: () => {}, onError: () => {}, intervalMs: 10000, timers });
  poller.start(); await tick();
  assert.equal(timers.pending.size, 1);
  poller.stop();
  assert.equal(timers.pending.size, 0);
  poller.start(); await tick();
  assert.equal(loads, 2);
  assert.equal(timers.pending.size, 1);
  poller.stop();
});

test('erro de rede mantém o polling (nova tentativa); 401 encerra o polling', async () => {
  const timers = manualTimers(); const errors = []; let mode = 'network';
  const poller = createOrdersPoller({
    load: async () => { throw mode === 'network' ? new ApiError(0, 'NETWORK', 'x', null) : new ApiError(401, 'UNAUTHORIZED', 'x', null); },
    onData: () => {}, onError: (error) => errors.push(error.status), shouldStop: (error) => error.status === 401, intervalMs: 10000, timers,
  });
  poller.start(); await tick();
  assert.deepEqual(errors, [0]);
  assert.equal(poller.isRunning(), true);
  assert.equal(timers.pending.size, 1);
  mode = 'auth'; timers.fire(); await tick();
  assert.deepEqual(errors, [0, 401]);
  assert.equal(poller.isRunning(), false);
  assert.equal(timers.pending.size, 0);
});

// ---------------------------------------------------------------- apresentação

const noop = () => {};
const view = (overrides = {}) => renderToStaticMarkup(createElement(AdminOrdersView, {
  loading: false, error: null, orders: [], truncated: false, nextCursor: null, filter: '', loadingMore: false,
  updatedAt: null, busyId: null, notice: null, confirming: null, cancelNote: '',
  onRequest: noop, onConfirm: noop, onAbort: noop, onCancelNote: noop, onRefresh: noop, onFilter: noop, onLoadMore: noop, ...overrides,
}));

test('estados de carregamento, vazio e erro', () => {
  assert.match(view({ loading: true }), /Carregando pedidos/);
  assert.match(view(), /Nenhum pedido encontrado/);
  const failed = view({ error: 'Falha de comunicação com o servidor. Tentaremos novamente.' });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Falha de comunicação/);
  assert.doesNotMatch(failed, /Nenhum pedido encontrado/);
});

test('pedido recebido: comanda, cliente, itens, quantidades, total, status e horários', () => {
  const html = view({ orders: [order(7, { notes: 'Sem gelo' })] });
  for (const expected of ['Pedido #7', 'Comanda 000123', 'Cliente 7', 'Mesa 2', '2×', 'Frios', 'Recebido', 'Observação: Sem gelo', 'recebido às', 'atualizado às']) {
    assert.ok(html.includes(expected), expected);
  }
  assert.match(html, /R\$\s?59,98/);
  assert.match(html, /Histórico \(1\)/);
});

test('botões refletem exatamente allowedTransitions; pedido final não tem ação', () => {
  const received = view({ orders: [order(1)] });
  assert.match(received, /data-to-status="IN_PREPARATION"/);
  assert.match(received, /data-to-status="CANCELLED"/);
  assert.doesNotMatch(received, /data-to-status="(READY|DELIVERED|RECEIVED)"/);
  const ready = view({ orders: [order(2, { status: 'READY', allowedTransitions: ['DELIVERED'] })] });
  assert.match(ready, /data-to-status="DELIVERED"/);
  assert.doesNotMatch(ready, /data-to-status="CANCELLED"/);
  const done = view({ orders: [order(3, { status: 'DELIVERED', allowedTransitions: [] })] });
  assert.doesNotMatch(done, /data-to-status=/);
  assert.match(done, /Pedido finalizado/);
});

test('confirmação explícita antes de enviar; cancelar mostra aviso e campo de motivo; ações ficam bloqueadas', () => {
  const html = view({ orders: [order(1), order(2)], confirming: { orderId: id(1), toStatus: 'CANCELLED' } });
  assert.match(html, /Confirmar mudança de status/);
  assert.match(html, /não pode ser desfeito/);
  assert.match(html, /Motivo \(opcional\)/);
  assert.match(html, /<button[^>]*data-to-status="IN_PREPARATION"[^>]*disabled/); // pedido 2: bloqueado enquanto há confirmação aberta
  const busy = view({ orders: [order(1)], confirming: { orderId: id(1), toStatus: 'IN_PREPARATION' }, busyId: id(1) });
  assert.match(busy, /Enviando…/);
  assert.match(busy, /<button[^>]*disabled[^>]*>Voltar/);
});

test('avisos: conflito 409 aparece como alerta; sucesso como status; lista paginada oferece carregar mais', () => {
  assert.match(view({ orders: [order(1)], notice: { kind: 'conflict', text: 'O pedido foi alterado por outra pessoa.' } }), /role="alert"[^>]*>O pedido foi alterado/);
  assert.match(view({ orders: [order(1)], notice: { kind: 'success', text: 'Pedido #1 ok.' } }), /role="status"[^>]*>Pedido #1 ok/);
  assert.match(view({ orders: [order(1)], truncated: true, nextCursor: id(1) }), /Carregar pedidos anteriores/);
});

// ---------------------------------------------------------------- estrutura

test('painel: sem WebSocket/Socket.IO/EventSource, polling parado na desmontagem e protegido por sessão administrativa', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // comentários podem citar a proibição
  const sources = ['../src/pages/AdminOrders.tsx', '../src/services/adminOrders.ts', '../src/services/adminOrdersPolling.ts'].map(code).join('\n');
  assert.doesNotMatch(sources, /WebSocket|socket\.io|EventSource|localStorage|sessionStorage/i);
  assert.match(read('../src/pages/AdminOrders.tsx'), /return \(\) => \{ poller\.stop\(\); pollerRef\.current = null; \};/);
  const dashboard = read('../src/pages/AdminDashboard.tsx');
  assert.match(dashboard, /\{!loggingOut && <AdminOrders onUnauthorized=\{onLogout\} \/>\}/);
  // O logout desmonta o painel (e, portanto, para o polling) ANTES de enviar o POST de logout.
  const handleLogout = dashboard.slice(dashboard.indexOf('const handleLogout'), dashboard.indexOf('const handleIssueInvite'));
  assert.ok(handleLogout.indexOf('setLoggingOut(true)') < handleLogout.indexOf('endAdminSession(api)'));
  assert.match(dashboard, /await client\.post\('\/admin\/auth\/logout', \{\}\)/);
  const wrapper = read('../src/AppWrapper.tsx');
  assert.match(wrapper, /adminData \? \(\s*<AdminDashboard/); // o painel só monta com sessão administrativa válida
});
