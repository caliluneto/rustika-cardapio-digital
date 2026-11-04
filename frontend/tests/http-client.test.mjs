import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApiClient } from '../src/services/api.ts';
import { loginError } from '../src/pages/AdminLogin.tsx';
import { inviteError } from '../src/pages/AdminDashboard.tsx';
import { redeemError } from '../src/components/ComandaRedeem.tsx';

const BASE = 'http://localhost:4000/api';
const KEY = '11111111-1111-4111-8111-111111111111';

function json(status, payload, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ok: status >= 200 && status < 300, status, json: async () => payload, headers: { get: (name) => lower[name.toLowerCase()] ?? null } };
}

function recording(respond) {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, init }); return respond(url, init); };
  return { calls, client: createApiClient({ baseUrl: BASE, fetcher, timeoutMs: 50 }) };
}

test('post envia credentials include, X-Rustika-Request: 1 e JSON', async () => {
  const { calls, client } = recording(() => json(200, { success: true, data: { ok: 1 } }));
  assert.deepEqual(await client.post('/admin/auth/login', { email: 'a@example.test', password: 'x' }), { ok: 1 });
  const { init } = calls[0];
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'include');
  assert.equal(init.headers['X-Rustika-Request'], '1');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.body, JSON.stringify({ email: 'a@example.test', password: 'x' }));
});

test('post não deixa o chamador remover o header de proteção nem trocar o Content-Type', async () => {
  const { calls, client } = recording(() => json(200, { success: true, data: null }));
  await client.post('/comanda-sessions', {}, undefined, { headers: { 'X-Rustika-Request': '0', 'Content-Type': 'text/plain' } });
  assert.equal(calls[0].init.headers['X-Rustika-Request'], '1');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
});

test('getWithAuth usa cookie (credentials include) e nunca Authorization nem localStorage', async () => {
  const previous = globalThis.window;
  let reads = 0;
  globalThis.window = { localStorage: { getItem: () => { reads++; return 'legacy-token'; } } };
  try {
    const { calls, client } = recording(() => json(200, { success: true, data: { admin: { id: '1' } } }));
    await client.getWithAuth('/admin/auth/session');
    assert.equal(calls[0].init.credentials, 'include');
    assert.equal(calls[0].init.headers.Authorization, undefined);
    assert.equal(reads, 0);
  } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
});

test('catálogo público continua sem credenciais e sem header de escrita', async () => {
  const { calls, client } = recording(() => json(200, { success: true, data: [] }));
  await client.getCategories();
  assert.equal(calls[0].init.credentials, undefined);
  assert.equal(calls[0].init.headers['X-Rustika-Request'], undefined);
});

test('204 (logout) resolve sem erro', async () => {
  const { client } = recording(() => ({ ok: true, status: 204, json: async () => { throw new Error('sem corpo'); } }));
  assert.equal(await client.post('/admin/auth/logout', {}), undefined);
});

for (const [status, code] of [[401, 'INVALID_SESSION'], [403, 'ORIGIN_NOT_ALLOWED'], [409, 'PRICE_CHANGED']]) {
  test(`HTTP ${status} vira ApiError com status, código e mensagem do servidor`, async () => {
    const { client } = recording(() => json(status, { success: false, error: { code, message: `mensagem ${status}` } }));
    await assert.rejects(client.post('/orders', {}), (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, status);
      assert.equal(err.code, code);
      assert.equal(err.message, `mensagem ${status}`);
      assert.equal(err.retryable, false);
      return true;
    });
  });
}

test('HTTP 429 expõe Retry-After e é reenviável', async () => {
  const { client } = recording(() => json(429, { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas.' } }, { 'Retry-After': '42' }));
  await assert.rejects(client.post('/orders', {}), (err) => {
    assert.equal(err.status, 429);
    assert.equal(err.retryAfterSeconds, 42);
    assert.equal(err.retryable, true);
    assert.match(err.message, /42 s/);
    return true;
  });
});

test('erro sem corpo usa mensagem padrão por status', async () => {
  const { client } = recording(() => ({ ok: false, status: 401, json: async () => { throw new Error('x'); } }));
  await assert.rejects(client.getWithAuth('/comanda-sessions/current'), (err) => err.code === 'HTTP_401' && /sessão/i.test(err.message));
});

test('falha de rede e timeout viram ApiError reenviável com status 0', async () => {
  const offline = recording(() => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(offline.client.post('/orders', {}), (err) => err instanceof ApiError && err.status === 0 && err.code === 'NETWORK' && err.retryable);
  const slow = recording((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('a', 'AbortError')))));
  await assert.rejects(slow.client.post('/orders', {}), (err) => err instanceof ApiError && err.code === 'TIMEOUT');
});

test('cancelamento pelo chamador continua AbortError', async () => {
  const controller = new AbortController(); controller.abort();
  const { client } = recording(() => json(200, { success: true, data: null }));
  await assert.rejects(client.post('/orders', {}, controller.signal), (err) => err.name === 'AbortError');
});

test('resposta 2xx fora do envelope é recusada', async () => {
  const { client } = recording(() => json(200, { ok: true }));
  await assert.rejects(client.post('/comanda-sessions', {}), (err) => err.code === 'INVALID_RESPONSE');
});

test('createOrder envia Idempotency-Key e recusa chave que não é UUID v4 sem chamar a rede', async () => {
  const { calls, client } = recording(() => json(201, { success: true, data: { orderNumber: 7 } }));
  assert.equal((await client.createOrder({ customerName: 'Ana', items: [] }, KEY)).orderNumber, 7);
  assert.equal(calls[0].url, `${BASE}/orders`);
  assert.equal(calls[0].init.headers['Idempotency-Key'], KEY);
  assert.equal(calls[0].init.headers['X-Rustika-Request'], '1');
  assert.equal(calls[0].init.credentials, 'include');
  await assert.rejects(client.createOrder({ customerName: 'Ana', items: [] }, 'key-1'), (err) => err.code === 'INVALID_IDEMPOTENCY_KEY');
  assert.equal(calls.length, 1);
});

test('mensagens das telas de acesso por status', () => {
  assert.equal(loginError(new ApiError(401, 'INVALID_CREDENTIALS', 'x', null)), 'E-mail ou senha inválidos.');
  assert.match(loginError(new ApiError(429, 'TOO_MANY_REQUESTS', 'Muitas tentativas. Tente novamente em 9 s.', 9)), /9 s/);
  assert.equal(inviteError(new ApiError(409, 'COMANDA_CLOSED', 'x', null)), 'Esta comanda está fechada.');
  assert.match(redeemError(new ApiError(401, 'INVALID_INVITATION', 'x', null)), /inválido, expirado ou já utilizado/);
  assert.match(redeemError(new Error('qualquer')), /Tente novamente/);
});
