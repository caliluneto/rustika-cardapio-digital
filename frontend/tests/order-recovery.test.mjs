import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/services/api.ts';
import {
  comandaSessionUsable, createAttemptStore, createOrderSubmitter, describeOrderError,
  requireUsableComandaSession,
} from '../src/services/orderSubmission.ts';

const body = (name = 'Ana', quantity = 1) => ({ customerName: name, items: [{ productId: 'rustika-131', quantity, expectedUnitPriceInCents: 5999 }] });
function keys() { let n = 0; return () => `11111111-1111-4111-8111-${String(++n).padStart(12, '0')}`; }
const network = () => new ApiError(0, 'NETWORK', 'offline', null);

function scripted(outcomes) {
  const calls = [];
  return {
    calls,
    client: { createOrder: async (b, key) => {
      calls.push({ body: b, key });
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      return next ?? { orderNumber: calls.length };
    } },
  };
}

test('fechar e reabrir o Checkout após falha de rede mantém a mesma chave (armazenamento compartilhado)', async () => {
  const store = createAttemptStore(); const k = keys();
  const { calls, client } = scripted([network(), { orderNumber: 9 }]);
  await assert.rejects(createOrderSubmitter(client, k, store).submit(body()));
  const reopened = createOrderSubmitter(client, k, store); // nova montagem do diálogo
  assert.equal(reopened.uncertain, true);
  assert.equal((await reopened.submit(body())).orderNumber, 9);
  assert.equal(calls[0].key, calls[1].key);
});

test('com envio incerto, alterar o pedido é recusado sem ir à rede; o pendente é reenviado com corpo e chave originais', async () => {
  const store = createAttemptStore();
  const { calls, client } = scripted([network(), { orderNumber: 3 }, { orderNumber: 4 }]);
  const submitter = createOrderSubmitter(client, keys(), store);
  await assert.rejects(submitter.submit(body('Ana')));
  await assert.rejects(submitter.submit(body('Ana Maria')), (err) => err.code === 'PENDING_ORDER_UNCERTAIN');
  assert.equal(calls.length, 1);
  assert.equal((await submitter.retryPending()).orderNumber, 3);
  assert.deepEqual(calls[1], { body: body('Ana'), key: calls[0].key });
  assert.equal(submitter.uncertain, false);
  await submitter.submit(body('Ana Maria'));
  assert.notEqual(calls[2].key, calls[0].key); // depois de resolvido, o pedido novo tem chave nova
});

for (const [label, error] of [
  ['5xx', new ApiError(500, 'INTERNAL_ERROR', 'x', null)],
  ['timeout', new ApiError(0, 'TIMEOUT', 'x', null)],
  ['cancelamento', new DOMException('a', 'AbortError')],
]) {
  test(`${label} deixa o envio incerto`, async () => {
    const store = createAttemptStore();
    const { client } = scripted([error]);
    const submitter = createOrderSubmitter(client, keys(), store);
    await assert.rejects(submitter.submit(body()));
    assert.equal(submitter.uncertain, true);
  });
}

for (const [label, error] of [
  ['401', new ApiError(401, 'INVALID_SESSION', 'x', null)],
  ['403', new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'x', null)],
  ['409 PRICE_CHANGED', new ApiError(409, 'PRICE_CHANGED', 'x', null)],
  ['400', new ApiError(400, 'INVALID_INPUT', 'x', null)],
]) {
  test(`recusa definitiva (${label}) descarta a tentativa: nada foi criado, a próxima usa chave nova`, async () => {
    const store = createAttemptStore();
    const { calls, client } = scripted([error, { orderNumber: 1 }]);
    const submitter = createOrderSubmitter(client, keys(), store);
    await assert.rejects(submitter.submit(body()));
    assert.equal(submitter.uncertain, false);
    await submitter.submit(body());
    assert.notEqual(calls[0].key, calls[1].key);
  });
}

for (const [label, error] of [
  ['429', new ApiError(429, 'TOO_MANY_REQUESTS', 'x', 5)],
  ['409 ORDER_CONFLICT', new ApiError(409, 'ORDER_CONFLICT', 'x', null)],
]) {
  test(`${label}: mantém a chave para reenviar igual, sem marcar incerteza`, async () => {
    const store = createAttemptStore();
    const { calls, client } = scripted([error, { orderNumber: 1 }]);
    const submitter = createOrderSubmitter(client, keys(), store);
    await assert.rejects(submitter.submit(body()));
    assert.equal(submitter.uncertain, false);
    await submitter.submit(body());
    assert.equal(calls[0].key, calls[1].key);
  });
}

test('pedido confirmado não é reenviado como novo pela mesma tentativa', async () => {
  const store = createAttemptStore();
  const { client } = scripted([{ orderNumber: 1 }]);
  const submitter = createOrderSubmitter(client, keys(), store);
  await submitter.submit(body());
  await assert.rejects(submitter.retryPending(), (err) => err.code === 'NO_PENDING_ORDER');
});

test('duas montagens do Checkout não enviam ao mesmo tempo', async () => {
  const store = createAttemptStore(); let release;
  const client = { createOrder: () => new Promise((resolve) => { release = () => resolve({ orderNumber: 1 }); }) };
  const first = createOrderSubmitter(client, keys(), store).submit(body());
  await assert.rejects(createOrderSubmitter(client, keys(), store).submit(body()), (err) => err.code === 'ORDER_IN_PROGRESS');
  release(); await first;
});

test('sessão de comanda só vale até expirar e nunca sem dados do backend', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  assert.equal(comandaSessionUsable(null, now), false);
  assert.equal(comandaSessionUsable({ expiresAt: '2026-11-03T12:00:01Z' }, now), true);
  assert.equal(comandaSessionUsable({ expiresAt: '2026-11-03T12:00:00Z' }, now), false);
  assert.equal(comandaSessionUsable({ expiresAt: 'invalida' }, now), false);
});

test('sessão expirada entre a renderização e o envio é bloqueada antes da rede', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  assert.doesNotThrow(() => requireUsableComandaSession({ expiresAt: '2026-11-03T12:00:01Z' }, now));
  assert.throws(
    () => requireUsableComandaSession({ expiresAt: '2026-11-03T12:00:00Z' }, now),
    (err) => err.status === 401 && err.code === 'INVALID_SESSION',
  );
  assert.throws(
    () => requireUsableComandaSession(null, now),
    (err) => err.status === 401 && err.code === 'INVALID_SESSION',
  );
});

test('mensagem do envio incerto orienta a reenviar o pedido anterior', () => {
  assert.match(describeOrderError(new ApiError(0, 'PENDING_ORDER_UNCERTAIN', 'Reenvie o pedido anterior antes de alterar.', null)), /Reenvie o pedido anterior/);
});
